// Abonnement Phase 1 (2026-09-04) — Lot 1 : schéma + hook d'inscription (essai 45 j) +
// limite d'inscriptions par IP. Lot 2 : garde-fou d'accès (subscriptionGuard/evaluerAcces).
// Lot 3 : administration (/api/billing/entreprises*) + reCAPTCHA v3 sur l'inscription.
// Voir docs/spec-abonnement-phase1.md.
import { app, pool, request, registerEntreprise, uniqueEmail, createProduit, setEntrepriseSubscription, createEmployeeLogin, restreindreEcritures } from './helpers.js';
import { evaluerAcces } from '../../middleware/subscriptionGuard.js';

afterAll(async () => { await pool.end(); });

// Passe le compte en platform admin puis renvoie un token frais (isPlatformAdmin est une
// claim du JWT, il faut se reconnecter — même patron que feedback.test.js).
async function promotePlatformAdmin(admin) {
  await pool.query('UPDATE users SET is_platform_admin = true WHERE LOWER(email) = LOWER($1)', [admin.email]);
  const login = await request(app).post('/api/auth/login').send({ email: admin.email, password: admin.password });
  expect(login.status).toBe(200);
  return login.body.token;
}

describe('Inscription — pose trial_ends_at / subscription_status', () => {
  test('register crée une entreprise en trial, trial_ends_at ≈ now + 45 jours', async () => {
    const admin = await registerEntreprise();
    const { rows } = await pool.query(
      `SELECT subscription_status AS "subscriptionStatus", trial_ends_at AS "trialEndsAt" FROM entreprises WHERE id = $1`,
      [admin.entrepriseId]
    );
    expect(rows[0].subscriptionStatus).toBe('trial');
    const joursRestants = (new Date(rows[0].trialEndsAt) - new Date()) / 86400000;
    expect(joursRestants).toBeGreaterThan(44.9);
    expect(joursRestants).toBeLessThan(45.1);
  });

  test('trial_started est journalisé dans audit_log avec trialDays', async () => {
    const admin = await registerEntreprise();
    const { rows } = await pool.query(
      `SELECT details FROM audit_log WHERE entreprise_id = $1 AND action = 'trial_started'`,
      [admin.entrepriseId]
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].details).toMatchObject({ trialDays: 45 });
  });
});

describe('Limite d\'inscriptions par IP (anti-abus)', () => {
  test('3 inscriptions depuis la même IP passent, la 4e est bloquée (429)', async () => {
    const ip = '203.0.113.42'; // TEST-NET-3 (RFC 5737), jamais routable, sûr pour un test
    await registerEntreprise({ ip, email: uniqueEmail('ip1') });
    await registerEntreprise({ ip, email: uniqueEmail('ip2') });
    await registerEntreprise({ ip, email: uniqueEmail('ip3') });

    const quatrieme = await request(app).post('/api/auth/register').set('X-Forwarded-For', ip).send({
      email: uniqueEmail('ip4'), password: 'Passw0rd!', nomEntreprise: 'Bloquée', typeCompte: 'entreprise',
      telephone: '+22300000000', pays: 'ML', numeroTva: 'ML00000000', adresse: 'Rue test',
    });
    expect(quatrieme.status).toBe(429);
  });

  test('une IP différente n\'est pas affectée par le compteur d\'une autre', async () => {
    const ipA = '203.0.113.10';
    const ipB = '203.0.113.20';
    for (let i = 0; i < 3; i++) {
      await registerEntreprise({ ip: ipA, email: uniqueEmail(`ipA${i}`) });
    }
    // ipA est maintenant à la limite, mais ipB doit passer sans problème.
    const res = await registerEntreprise({ ip: ipB, email: uniqueEmail('ipB') });
    expect(res.entrepriseId).toBeTruthy();
  });
});

describe('evaluerAcces (fonction pure — tous les branchements)', () => {
  const now = new Date('2026-09-04T00:00:00Z');

  test('exempt : toujours autorisé, mode active', () => {
    expect(evaluerAcces({ subscription_status: 'exempt' }, 'POST', now)).toEqual({ allow: true, mode: 'active' });
  });

  test('suspended : toujours bloqué (402), même avec des dates par ailleurs valides', () => {
    const r = evaluerAcces({ subscription_status: 'suspended', activated_until: '2027-01-01' }, 'GET', now);
    expect(r).toMatchObject({ allow: false, mode: 'locked', status: 402, body: { reason: 'suspended' } });
  });

  test('essai en cours : autorisé, mode trial', () => {
    expect(evaluerAcces({ subscription_status: 'trial', trial_ends_at: '2026-10-01' }, 'POST', now))
      .toEqual({ allow: true, mode: 'trial' });
  });

  test('période payée en cours : autorisée, mode active (prime sur un trial_ends_at par ailleurs présent)', () => {
    const ent = { subscription_status: 'trial', activated_until: '2027-01-01', trial_ends_at: '2026-01-01' };
    expect(evaluerAcces(ent, 'POST', now)).toEqual({ allow: true, mode: 'active' });
  });

  test('expiré, dans la grâce (grace_until explicite) : GET autorisé, POST 402 readonly', () => {
    const ent = { subscription_status: 'trial', trial_ends_at: '2026-09-01', grace_until: '2026-09-10' };
    expect(evaluerAcces(ent, 'GET', now)).toEqual({ allow: true, mode: 'readonly' });
    expect(evaluerAcces(ent, 'POST', now)).toMatchObject({ allow: false, mode: 'readonly', status: 402, body: { reason: 'expired', mode: 'readonly' } });
  });

  test('expiré, grâce dépassée : bloqué même en lecture (GET)', () => {
    const ent = { subscription_status: 'trial', trial_ends_at: '2026-07-01', grace_until: '2026-07-31' };
    expect(evaluerAcces(ent, 'GET', now)).toMatchObject({ allow: false, mode: 'locked', status: 402, body: { reason: 'expired', mode: 'locked' } });
  });

  test('sans grace_until explicite : calcule fin + GRACE_DAYS (30j par défaut)', () => {
    // trial_ends_at = 2026-08-10, +30j = 2026-09-09 -> encore dans la grâce le 2026-09-04
    expect(evaluerAcces({ subscription_status: 'trial', trial_ends_at: '2026-08-10' }, 'GET', now).mode).toBe('readonly');
    // trial_ends_at = 2026-07-01, +30j = 2026-07-31 -> grâce dépassée le 2026-09-04
    expect(evaluerAcces({ subscription_status: 'trial', trial_ends_at: '2026-07-01' }, 'GET', now).mode).toBe('locked');
  });
});

describe('subscriptionGuard — bout-en-bout via de vraies routes API', () => {
  test('essai en cours : lecture ET écriture autorisées', async () => {
    const admin = await registerEntreprise();
    const getRes = await request(app).get('/api/produits?module=Cultures').set('Authorization', `Bearer ${admin.token}`);
    expect(getRes.status).toBe(200);
    const produit = await createProduit(admin.token, { module: 'Cultures' });
    expect(produit.id).toBeTruthy();
  });

  test('expiré + dans la grâce : lecture 200, écriture 402 readonly', async () => {
    const admin = await registerEntreprise();
    const cats = await request(app).get('/api/produit-categories?module=Cultures').set('Authorization', `Bearer ${admin.token}`);
    const categorieId = cats.body.categories[0].id;
    await setEntrepriseSubscription(admin.entrepriseId, { trialEndsAt: new Date(Date.now() - 5 * 86400000).toISOString() });

    const getRes = await request(app).get('/api/produits?module=Cultures').set('Authorization', `Bearer ${admin.token}`);
    expect(getRes.status).toBe(200);

    const postRes = await request(app).post('/api/produits').set('Authorization', `Bearer ${admin.token}`)
      .send({ module: 'Cultures', nom: 'Bloqué', categorieId });
    expect(postRes.status).toBe(402);
    expect(postRes.body).toMatchObject({ reason: 'expired', mode: 'readonly' });
  });

  test('au-delà de la grâce : tout bloqué (402 locked), sauf les routes whitelistées', async () => {
    const admin = await registerEntreprise();
    await setEntrepriseSubscription(admin.entrepriseId, { trialEndsAt: new Date(Date.now() - 40 * 86400000).toISOString() });

    const getRes = await request(app).get('/api/produits?module=Cultures').set('Authorization', `Bearer ${admin.token}`);
    expect(getRes.status).toBe(402);
    expect(getRes.body).toMatchObject({ reason: 'expired', mode: 'locked' });

    const me = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${admin.token}`);
    expect(me.status).toBe(200);

    const status = await request(app).get('/api/billing/status').set('Authorization', `Bearer ${admin.token}`);
    expect(status.status).toBe(200);
    expect(status.body.mode).toBe('locked');
    expect(status.body.daysLeft).toBe(0);
  });

  test('suspended bloque tout, quelles que soient les dates', async () => {
    const admin = await registerEntreprise();
    await setEntrepriseSubscription(admin.entrepriseId, { status: 'suspended' });
    const getRes = await request(app).get('/api/produits?module=Cultures').set('Authorization', `Bearer ${admin.token}`);
    expect(getRes.status).toBe(402);
    expect(getRes.body).toMatchObject({ reason: 'suspended', mode: 'locked' });
  });

  test('exempt autorise tout, même expiré depuis très longtemps', async () => {
    const admin = await registerEntreprise();
    await setEntrepriseSubscription(admin.entrepriseId, {
      status: 'exempt',
      trialEndsAt: new Date(Date.now() - 400 * 86400000).toISOString(),
    });
    const getRes = await request(app).get('/api/produits?module=Cultures').set('Authorization', `Bearer ${admin.token}`);
    expect(getRes.status).toBe(200);
  });
});

describe('GET /api/billing/status', () => {
  test('essai en cours : mode trial, daysLeft ≈ 45', async () => {
    const admin = await registerEntreprise();
    const res = await request(app).get('/api/billing/status').set('Authorization', `Bearer ${admin.token}`);
    expect(res.status).toBe(200);
    expect(res.body.mode).toBe('trial');
    expect(res.body.status).toBe('trial');
    expect(res.body.daysLeft).toBeGreaterThanOrEqual(44);
    expect(res.body.daysLeft).toBeLessThanOrEqual(45);
  });
});

describe('Administration /api/billing/entreprises* (platform-admin uniquement)', () => {
  test('un admin normal (non platform-admin) reçoit 403 sur toutes les routes', async () => {
    const admin = await registerEntreprise();
    const list = await request(app).get('/api/billing/entreprises').set('Authorization', `Bearer ${admin.token}`);
    expect(list.status).toBe(403);
    const activer = await request(app).post(`/api/billing/entreprises/${admin.entrepriseId}/activer`)
      .set('Authorization', `Bearer ${admin.token}`).send({ periodeMois: 1 });
    expect(activer.status).toBe(403);
  });

  // Spec §7, cas 8/9 : un non-platform-admin n'atteint AUCUNE route /billing/entreprises*, sur
  // sa propre entreprise (pas seulement 403 sur la liste/l'activation, testé ci-dessus) — les
  // 7 routes une à une, pour ne pas laisser un futur ajout de route hors du gate par oubli.
  test('un admin normal reçoit 403 sur chacune des 7 routes /billing/entreprises*, y compris sur sa propre entreprise', async () => {
    const admin = await registerEntreprise();
    const bearer = { Authorization: `Bearer ${admin.token}` };
    const id = admin.entrepriseId;
    const appels = [
      () => request(app).get('/api/billing/entreprises').set(bearer),
      () => request(app).get(`/api/billing/entreprises/${id}`).set(bearer),
      () => request(app).post(`/api/billing/entreprises/${id}/activer`).set(bearer).send({ periodeMois: 1 }),
      () => request(app).post(`/api/billing/entreprises/${id}/prolonger`).set(bearer).send({ jours: 1 }),
      () => request(app).post(`/api/billing/entreprises/${id}/suspendre`).set(bearer).send({}),
      () => request(app).post(`/api/billing/entreprises/${id}/reactiver`).set(bearer),
      () => request(app).post(`/api/billing/entreprises/${id}/exempter`).set(bearer).send({ exempt: true }),
    ];
    for (const appel of appels) {
      const res = await appel();
      expect(res.status).toBe(403);
    }
  });

  // Spec §7, cas 9 : à l'inverse de chaque route tenant-scopée du reste de l'app
  // (WHERE entreprise_id = req.user.entrepriseId), /billing/entreprises* est délibérément
  // CROSS-TENANT pour un platform-admin — c'est tout son intérêt (superviser toutes les
  // entreprises, pas seulement la sienne).
  test('un platform-admin voit et gère des entreprises AUTRES que la sienne (cross-tenant, comportement voulu)', async () => {
    const admin = await registerEntreprise();
    const platformToken = await promotePlatformAdmin(admin);
    const autre1 = await registerEntreprise();
    const autre2 = await registerEntreprise();

    const list = await request(app).get('/api/billing/entreprises?pageSize=200').set('Authorization', `Bearer ${platformToken}`);
    expect(list.status).toBe(200);
    const ids = list.body.entreprises.map((e) => e.id);
    expect(ids).toEqual(expect.arrayContaining([autre1.entrepriseId, autre2.entrepriseId]));
    // La propre entreprise du platform-admin n'est pas non plus exclue de la liste.
    expect(ids).toContain(admin.entrepriseId);

    const suspendre = await request(app).post(`/api/billing/entreprises/${autre1.entrepriseId}/suspendre`)
      .set('Authorization', `Bearer ${platformToken}`).send({});
    expect(suspendre.status).toBe(200);
    const bloque = await request(app).get('/api/produits?module=Cultures').set('Authorization', `Bearer ${autre1.token}`);
    expect(bloque.status).toBe(402);
  });

  test('GET /entreprises (paginé) et GET /entreprises/:id : un platform-admin voit la liste', async () => {
    const admin = await registerEntreprise();
    const platformToken = await promotePlatformAdmin(admin);

    const cible = await registerEntreprise();
    const list = await request(app).get('/api/billing/entreprises?pageSize=5')
      .set('Authorization', `Bearer ${platformToken}`);
    expect(list.status).toBe(200);
    expect(list.body.total).toBeGreaterThan(0);
    expect(Array.isArray(list.body.entreprises)).toBe(true);

    const detail = await request(app).get(`/api/billing/entreprises/${cible.entrepriseId}`)
      .set('Authorization', `Bearer ${platformToken}`);
    expect(detail.status).toBe(200);
    expect(detail.body.entreprise.id).toBe(cible.entrepriseId);
    expect(detail.body.paiements).toEqual([]);
  });

  test('POST .../activer : passe en active, étend activated_until, crée une ligne abonnement_paiements', async () => {
    const admin = await registerEntreprise();
    const platformToken = await promotePlatformAdmin(admin);
    const cible = await registerEntreprise();

    const res = await request(app).post(`/api/billing/entreprises/${cible.entrepriseId}/activer`)
      .set('Authorization', `Bearer ${platformToken}`)
      .send({ montant: 15000, devise: 'XOF', moyen: 'virement', reference: 'REF-1', periodeMois: 12, note: 'test' });
    expect(res.status).toBe(200);
    expect(res.body.subscriptionStatus).toBe('active');

    const { rows } = await pool.query(
      `SELECT subscription_status AS "subscriptionStatus", activated_until AS "activatedUntil" FROM entreprises WHERE id = $1`,
      [cible.entrepriseId]
    );
    expect(rows[0].subscriptionStatus).toBe('active');
    const joursRestants = (new Date(rows[0].activatedUntil) - new Date()) / 86400000;
    expect(joursRestants).toBeGreaterThan(364);

    const paiements = await pool.query('SELECT * FROM abonnement_paiements WHERE entreprise_id = $1', [cible.entrepriseId]);
    expect(paiements.rows).toHaveLength(1);
    expect(Number(paiements.rows[0].montant)).toBe(15000);
    expect(paiements.rows[0].moyen).toBe('virement');

    const audit = await pool.query(
      `SELECT details FROM audit_log WHERE entreprise_id = $1 AND action = 'subscription_activated'`,
      [cible.entrepriseId]
    );
    expect(audit.rows).toHaveLength(1);

    // Accès réellement restauré après une expiration (pas seulement la colonne en base).
    await setEntrepriseSubscription(cible.entrepriseId, {});
    const getRes = await request(app).get('/api/produits?module=Cultures').set('Authorization', `Bearer ${cible.token}`);
    expect(getRes.status).toBe(200);
  });

  test('POST .../prolonger : étend trial_ends_at pendant un essai, sans créer de paiement', async () => {
    const admin = await registerEntreprise();
    const platformToken = await promotePlatformAdmin(admin);
    const cible = await registerEntreprise();
    const avant = (await pool.query('SELECT trial_ends_at FROM entreprises WHERE id = $1', [cible.entrepriseId])).rows[0].trial_ends_at;

    const res = await request(app).post(`/api/billing/entreprises/${cible.entrepriseId}/prolonger`)
      .set('Authorization', `Bearer ${platformToken}`).send({ jours: 10, raison: 'geste commercial' });
    expect(res.status).toBe(200);

    const apres = (await pool.query('SELECT trial_ends_at FROM entreprises WHERE id = $1', [cible.entrepriseId])).rows[0].trial_ends_at;
    expect((new Date(apres) - new Date(avant)) / 86400000).toBeCloseTo(10, 0);

    const paiements = await pool.query('SELECT * FROM abonnement_paiements WHERE entreprise_id = $1', [cible.entrepriseId]);
    expect(paiements.rows).toHaveLength(0);
  });

  test('POST .../suspendre puis .../reactiver : bloque puis restaure un accès cohérent avec les dates', async () => {
    const admin = await registerEntreprise();
    const platformToken = await promotePlatformAdmin(admin);
    const cible = await registerEntreprise();

    const suspendre = await request(app).post(`/api/billing/entreprises/${cible.entrepriseId}/suspendre`)
      .set('Authorization', `Bearer ${platformToken}`).send({ raison: 'abus constaté' });
    expect(suspendre.status).toBe(200);
    const bloque = await request(app).get('/api/produits?module=Cultures').set('Authorization', `Bearer ${cible.token}`);
    expect(bloque.status).toBe(402);
    expect(bloque.body.reason).toBe('suspended');

    const reactiver = await request(app).post(`/api/billing/entreprises/${cible.entrepriseId}/reactiver`)
      .set('Authorization', `Bearer ${platformToken}`);
    expect(reactiver.status).toBe(200);
    expect(reactiver.body.subscriptionStatus).toBe('trial');
    const restaure = await request(app).get('/api/produits?module=Cultures').set('Authorization', `Bearer ${cible.token}`);
    expect(restaure.status).toBe(200);
  });

  test('POST .../exempter : true rend l\'accès permanent même très expiré, false recalcule depuis les dates', async () => {
    const admin = await registerEntreprise();
    const platformToken = await promotePlatformAdmin(admin);
    const cible = await registerEntreprise();
    await setEntrepriseSubscription(cible.entrepriseId, { trialEndsAt: new Date(Date.now() - 400 * 86400000).toISOString() });

    const exempter = await request(app).post(`/api/billing/entreprises/${cible.entrepriseId}/exempter`)
      .set('Authorization', `Bearer ${platformToken}`).send({ exempt: true });
    expect(exempter.status).toBe(200);
    expect(exempter.body.subscriptionStatus).toBe('exempt');
    const ok = await request(app).get('/api/produits?module=Cultures').set('Authorization', `Bearer ${cible.token}`);
    expect(ok.status).toBe(200);

    const retirer = await request(app).post(`/api/billing/entreprises/${cible.entrepriseId}/exempter`)
      .set('Authorization', `Bearer ${platformToken}`).send({ exempt: false });
    expect(retirer.status).toBe(200);
    expect(retirer.body.subscriptionStatus).toBe('expired');
    const bloque = await request(app).get('/api/produits?module=Cultures').set('Authorization', `Bearer ${cible.token}`);
    expect(bloque.status).toBe(402);
  });
});

describe('reCAPTCHA v3 sur l\'inscription (repli gracieux si non configuré)', () => {
  test('sans RECAPTCHA_SECRET_KEY configuré : passe toujours, avec ou sans token', async () => {
    delete process.env.RECAPTCHA_SECRET_KEY;
    const res = await request(app).post('/api/auth/register').set('X-Forwarded-For', '203.0.113.99').send({
      email: uniqueEmail('norecaptcha'), password: 'Passw0rd!', nomEntreprise: 'Sans reCAPTCHA', typeCompte: 'entreprise',
      telephone: '+22300000000', pays: 'ML', numeroTva: 'ML00000000', adresse: 'Rue test',
    });
    expect(res.status).toBe(201);
  });

  test('configuré + score insuffisant renvoyé par Google : 400, aucune entreprise créée', async () => {
    process.env.RECAPTCHA_SECRET_KEY = 'fake-secret-for-test';
    const fetchOriginal = global.fetch;
    global.fetch = async () => ({ json: async () => ({ success: true, action: 'register', score: 0.1 }) });
    try {
      const email = uniqueEmail('badrecaptcha');
      const res = await request(app).post('/api/auth/register').set('X-Forwarded-For', '203.0.113.98').send({
        email, password: 'Passw0rd!', nomEntreprise: 'Score insuffisant', typeCompte: 'entreprise', recaptchaToken: 'x',
        telephone: '+22300000000', pays: 'ML', numeroTva: 'ML00000000', adresse: 'Rue test',
      });
      expect(res.status).toBe(400);
      const { rows } = await pool.query('SELECT id FROM users WHERE LOWER(email) = LOWER($1)', [email]);
      expect(rows).toHaveLength(0);
    } finally {
      global.fetch = fetchOriginal;
      delete process.env.RECAPTCHA_SECRET_KEY;
    }
  });

  test('configuré + siteverify indisponible (erreur réseau) : repli gracieux, inscription passe', async () => {
    process.env.RECAPTCHA_SECRET_KEY = 'fake-secret-for-test';
    const fetchOriginal = global.fetch;
    global.fetch = async () => { throw new Error('réseau indisponible'); };
    try {
      const res = await request(app).post('/api/auth/register').set('X-Forwarded-For', '203.0.113.97').send({
        email: uniqueEmail('recaptchadown'), password: 'Passw0rd!', nomEntreprise: 'Réseau HS', typeCompte: 'entreprise', recaptchaToken: 'x',
        telephone: '+22300000000', pays: 'ML', numeroTva: 'ML00000000', adresse: 'Rue test',
      });
      expect(res.status).toBe(201);
    } finally {
      global.fetch = fetchOriginal;
      delete process.env.RECAPTCHA_SECRET_KEY;
    }
  });
});

// Même patron que devis.test.js/devisesTaux.test.js : /billing/tarifs et
// /billing/entreprises/:id convertissent le prix USD dans la devise de l'entreprise (XOF par
// défaut) via utils/currencyRates.js — sans ce mock, le premier appel non mocké de toute la
// suite déclenche un VRAI appel réseau qui pollue currency_rates pour la date du jour et
// casse les tests de devis/devisesTaux qui, eux, s'attendent à leurs propres taux mockés.
// Purge aussi les taux déjà en base pour AUJOURD'HUI avant d'installer le mock : sans ça,
// obtenirTaux() ne rafraîchit que si aucun taux n'existe encore pour la devise demandée à
// cette date — si devis.test.js/devisesTaux.test.js (ou ce fichier lui-même, ré-exécuté) a
// déjà écrit un taux plus tôt dans la même suite, ce test lirait le leur au lieu du sien.
// Rend le test déterministe quel que soit l'ordre d'exécution des fichiers (non garanti par
// Jest — trouvé en le reproduisant, pas supposé).
async function mockerFetchTaux(rates = { USD: 1, XOF: 600, EUR: 0.9 }) {
  await pool.query('DELETE FROM currency_rates WHERE date = CURRENT_DATE');
  const original = global.fetch;
  global.fetch = async () => ({ ok: true, status: 200, json: async () => ({ result: 'success', rates }) });
  return () => { global.fetch = original; };
}

describe('Tarification par module (2026-09-06)', () => {
  test("GET /entreprise/modules démarre vide, PUT persiste + calcule le prix, GET relit l'état", async () => {
    // modulesActifs: {} explicite — le défaut du helper active les 3 modules pour ne pas
    // casser le reste de la suite (voir helpers.js), ce test-ci veut justement l'état vide.
    const admin = await registerEntreprise({ modulesActifs: {} }); // typeCompte 'entreprise', pays 'ML' (palier 4)

    const avant = await request(app).get('/api/entreprise/modules').set('Authorization', `Bearer ${admin.token}`);
    expect(avant.status).toBe(200);
    expect(avant.body.modules).toEqual({});

    const put = await request(app).put('/api/entreprise/modules')
      .set('Authorization', `Bearer ${admin.token}`)
      .send({ modules: { poulailler: true, cultures: false } });
    expect(put.status).toBe(200);
    expect(put.body.modules).toEqual({ poulailler: true, cultures: false });
    expect(put.body.prix.palier).toBe(4);
    expect(put.body.prix.modulesFactures).toEqual(['poulailler']);
    expect(put.body.prix.bundleApplique).toBe(false);

    const apres = await request(app).get('/api/entreprise/modules').set('Authorization', `Bearer ${admin.token}`);
    expect(apres.body.modules).toEqual({ poulailler: true, cultures: false });
  });

  test('PUT /entreprise/modules filtre les clés inconnues et force des booléens', async () => {
    const admin = await registerEntreprise();
    const put = await request(app).put('/api/entreprise/modules')
      .set('Authorization', `Bearer ${admin.token}`)
      .send({ modules: { poulailler: 1, cle_inventee: true, finances: 'oui' } });
    expect(put.status).toBe(200);
    expect(put.body.modules).toEqual({ poulailler: true, finances: true });
  });

  test('PUT /entreprise/modules refuse un rôle ouvrier (403), GET reste ouvert', async () => {
    const admin = await registerEntreprise();
    const ouvrier = await createEmployeeLogin(admin.token, 'ouvrier');
    await restreindreEcritures(admin.entrepriseId, ouvrier.email, ['modules_actifs']);
    const getOuvrier = await request(app).get('/api/entreprise/modules').set('Authorization', `Bearer ${ouvrier.token}`);
    expect(getOuvrier.status).toBe(200);
    const putOuvrier = await request(app).put('/api/entreprise/modules')
      .set('Authorization', `Bearer ${ouvrier.token}`)
      .send({ modules: { poulailler: true } });
    expect(putOuvrier.status).toBe(403);
  });

  test('GET /billing/tarifs : 1 module facturé = prix unitaire, les 3 = tarif bundle', async () => {
    const restore = await mockerFetchTaux();
    try {
      const admin = await registerEntreprise({ modulesActifs: {} });

      const seul = await request(app).get('/api/billing/tarifs').set('Authorization', `Bearer ${admin.token}`);
      expect(seul.status).toBe(200);
      expect(seul.body.palier).toBe(4);
      expect(seul.body.bundleApplique).toBe(false);
      expect(seul.body.prixTotal.montant).toBe(0);

      await request(app).put('/api/entreprise/modules').set('Authorization', `Bearer ${admin.token}`)
        .send({ modules: { cultures: true, poulailler: true, pisciculture: true } });

      const bundle = await request(app).get('/api/billing/tarifs').set('Authorization', `Bearer ${admin.token}`);
      expect(bundle.status).toBe(200);
      expect(bundle.body.bundleApplique).toBe(true);
      expect(bundle.body.modulesFactures.sort()).toEqual(['cultures', 'pisciculture', 'poulailler']);
    } finally { restore(); }
  });

  test('GET /billing/entreprises/:id (platform-admin) renvoie un prixSuggere cohérent avec les modules actifs', async () => {
    const restore = await mockerFetchTaux();
    try {
      const admin = await registerEntreprise();
      await request(app).put('/api/entreprise/modules').set('Authorization', `Bearer ${admin.token}`)
        .send({ modules: { poulailler: true } });
      const platformToken = await promotePlatformAdmin(admin);

      const detail = await request(app).get(`/api/billing/entreprises/${admin.entrepriseId}`)
        .set('Authorization', `Bearer ${platformToken}`);
      expect(detail.status).toBe(200);
      expect(detail.body.prixSuggere.palier).toBe(4);
      expect(detail.body.prixSuggere.modulesFactures).toEqual(['poulailler']);
      expect(detail.body.prixSuggere.converti.montant).toBeGreaterThan(0);
    } finally { restore(); }
  });

  test('isolation : une entreprise ne voit ni ne modifie les modules/tarifs d\'une autre', async () => {
    const restore = await mockerFetchTaux();
    try {
      const a = await registerEntreprise();
      const b = await registerEntreprise({ modulesActifs: {} });
      await request(app).put('/api/entreprise/modules').set('Authorization', `Bearer ${a.token}`)
        .send({ modules: { cultures: true, poulailler: true, pisciculture: true } });

      const tarifsB = await request(app).get('/api/billing/tarifs').set('Authorization', `Bearer ${b.token}`);
      expect(tarifsB.status).toBe(200);
      expect(tarifsB.body.bundleApplique).toBe(false);

      const modulesB = await request(app).get('/api/entreprise/modules').set('Authorization', `Bearer ${b.token}`);
      expect(modulesB.body.modules).toEqual({});
    } finally { restore(); }
  });
});
