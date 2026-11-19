// Lot 2a de l'audit : révocation des sessions (S5), mot de passe oublié et liens d'activation
// à la place du mot de passe envoyé en clair par email (S6).
import { app, pool, request, registerEntreprise, createEmployeeLogin, uniqueEmail } from './helpers.js';
import { creerJetonCompte } from '../../utils/jetonsCompte.js';
import { viderCacheRoles } from '../../utils/rolesService.js';

afterAll(async () => { await pool.end(); });

const bearer = (t) => ({ Authorization: `Bearer ${t}` });
const login = (email, password) => request(app).post('/api/auth/login').send({ email, password });
const idDe = async (email) => (await pool.query('SELECT id FROM users WHERE LOWER(email) = LOWER($1)', [email])).rows[0].id;
const jetonDuLien = (lien) => new URL(lien).hash.replace('#jeton=', '');
const attendre = (ms) => new Promise((r) => setTimeout(r, ms));

describe('Révocation des sessions (S5)', () => {
  beforeEach(() => viderCacheRoles());

  test('changer son mot de passe ferme les autres sessions et garde la session courante', async () => {
    const admin = await registerEntreprise();
    const autreAppareil = (await login(admin.email, admin.password)).body.token;
    expect((await request(app).get('/api/auth/me').set(bearer(autreAppareil))).status).toBe(200);

    const res = await request(app).post('/api/auth/changer-mot-de-passe').set(bearer(admin.token))
      .send({ actuel: admin.password, nouveau: 'NouveauSecret42' });
    expect(res.status).toBe(200);
    expect(res.body.token).toBeTruthy();

    // L'autre appareil et l'ancien jeton de cet appareil sont refusés…
    for (const jeton of [autreAppareil, admin.token]) {
      const r = await request(app).get('/api/auth/me').set(bearer(jeton));
      expect(r.status).toBe(401);
      expect(r.body.reason).toBe('session_revoquee');
    }
    // … le nouveau jeton fonctionne, et seul le nouveau mot de passe ouvre une session.
    expect((await request(app).get('/api/auth/me').set(bearer(res.body.token))).status).toBe(200);
    expect((await login(admin.email, admin.password)).status).toBe(401);
    expect((await login(admin.email, 'NouveauSecret42')).status).toBe(200);
  });

  test('changer-mot-de-passe refuse un mauvais mot de passe actuel, un mot de passe identique ou faible', async () => {
    const admin = await registerEntreprise();
    const appel = (corps) => request(app).post('/api/auth/changer-mot-de-passe').set(bearer(admin.token)).send(corps);
    expect((await appel({ actuel: 'Mauvais123', nouveau: 'NouveauSecret42' })).status).toBe(400); // jamais 401 : déconnecterait
    expect((await appel({ actuel: admin.password, nouveau: admin.password })).status).toBe(400);
    expect((await appel({ actuel: admin.password, nouveau: 'court' })).status).toBe(400);
    // Rien n'a changé : la session est toujours valide.
    expect((await request(app).get('/api/auth/me').set(bearer(admin.token))).status).toBe(200);
  });

  test('« déconnecter mes autres appareils » ferme les autres sessions', async () => {
    const admin = await registerEntreprise();
    const autreAppareil = (await login(admin.email, admin.password)).body.token;
    const res = await request(app).post('/api/auth/deconnecter-autres-appareils').set(bearer(admin.token));
    expect(res.status).toBe(200);
    expect((await request(app).get('/api/auth/me').set(bearer(autreAppareil))).status).toBe(401);
    expect((await request(app).get('/api/auth/me').set(bearer(res.body.token))).status).toBe(200);
    // Le mot de passe, lui, n'a pas changé.
    expect((await login(admin.email, admin.password)).status).toBe(200);
  });
});

describe('Mot de passe oublié (S6)', () => {
  test('réponse identique pour un compte connu ou inconnu ; un jeton n’est créé que pour le compte connu', async () => {
    const admin = await registerEntreprise();
    const inconnu = await request(app).post('/api/auth/mot-de-passe-oublie').send({ email: uniqueEmail('personne') });
    const connu = await request(app).post('/api/auth/mot-de-passe-oublie').send({ email: admin.email });
    expect(inconnu.status).toBe(200);
    expect(connu.status).toBe(200);
    expect(connu.body).toEqual(inconnu.body);

    await attendre(400); // le travail réel se fait après la réponse
    const { rows } = await pool.query(
      "SELECT count(*)::int AS n FROM jetons_compte WHERE user_id = $1 AND objet = 'reinitialisation'", [await idDe(admin.email)]
    );
    expect(rows[0].n).toBe(1);
  });

  test('au plus 3 demandes par heure et par compte', async () => {
    const admin = await registerEntreprise();
    for (let i = 0; i < 5; i++) {
      await request(app).post('/api/auth/mot-de-passe-oublie').send({ email: admin.email });
      await attendre(150);
    }
    const { rows } = await pool.query(
      "SELECT count(*)::int AS n FROM audit_log WHERE user_id = $1 AND action = 'reinitialisation_demandee'", [await idDe(admin.email)]
    );
    expect(rows[0].n).toBe(3);
  });

  test('le lien définit le mot de passe une seule fois, et ferme les sessions ouvertes', async () => {
    const admin = await registerEntreprise();
    const jeton = await creerJetonCompte(pool, { userId: await idDe(admin.email), objet: 'reinitialisation' });

    const faible = await request(app).post('/api/auth/definir-mot-de-passe').send({ jeton, password: 'court' });
    expect(faible.status).toBe(400); // rejeté avant toute consommation du lien

    const ok = await request(app).post('/api/auth/definir-mot-de-passe').send({ jeton, password: 'Reinitialise2026' });
    expect(ok.status).toBe(200);
    viderCacheRoles();
    expect((await request(app).get('/api/auth/me').set(bearer(admin.token))).status).toBe(401);
    expect((await login(admin.email, 'Reinitialise2026')).status).toBe(200);

    const reutilise = await request(app).post('/api/auth/definir-mot-de-passe').send({ jeton, password: 'Encore2026xx' });
    expect(reutilise.status).toBe(400);
    expect(reutilise.body.reason).toBe('jeton_invalide');
  });

  test('un lien expiré, inventé ou mal formé est refusé', async () => {
    const admin = await registerEntreprise();
    const jeton = await creerJetonCompte(pool, { userId: await idDe(admin.email), objet: 'reinitialisation' });
    await pool.query("UPDATE jetons_compte SET expire_le = now() - interval '1 minute' WHERE user_id = $1", [await idDe(admin.email)]);
    for (const j of [jeton, 'A'.repeat(43), '../../etc/passwd', null]) {
      const r = await request(app).post('/api/auth/definir-mot-de-passe').send({ jeton: j, password: 'Valide2026xx' });
      expect(r.status).toBe(400);
    }
  });
});

describe('Comptes salariés : lien d’activation au lieu d’un mot de passe par email (S6)', () => {
  test('sans mot de passe, le compte reçoit un lien d’activation renvoyé une fois à l’entreprise', async () => {
    const admin = await registerEntreprise();
    const compteEmail = uniqueEmail('salarie');
    const res = await request(app).post('/api/salaries').set(bearer(admin.token))
      .send({ nom: 'Keita', prenom: 'Ibrahim', createAccount: true, compteEmail });
    expect(res.status).toBe(201);
    expect(res.body.acces.lien).toMatch(/\/activer-compte#jeton=[A-Za-z0-9_-]+$/);
    expect(res.body.acces.emailEnvoye).toBe(false); // pas de SMTP en test

    // Aucun mot de passe ne permet d'entrer avant l'activation…
    expect((await login(compteEmail, 'Passw0rd!')).status).toBe(401);
    // … puis le salarié choisit le sien.
    const jeton = jetonDuLien(res.body.acces.lien);
    expect((await request(app).post('/api/auth/definir-mot-de-passe').send({ jeton, password: 'MonChoix2026' })).status).toBe(200);
    expect((await login(compteEmail, 'MonChoix2026')).status).toBe(200);
  });

  test('un mot de passe fourni (client d’API) reste accepté, sans lien ni email', async () => {
    const admin = await registerEntreprise();
    const employe = await createEmployeeLogin(admin.token, 'ouvrier');
    expect(employe.token).toBeTruthy();
  });

  test('lien d’accès renvoyé par l’entreprise : remplace l’ancien, jamais pour le propriétaire', async () => {
    const admin = await registerEntreprise();
    const creation = await request(app).post('/api/salaries').set(bearer(admin.token))
      .send({ nom: 'Diarra', prenom: 'Awa', createAccount: true, compteEmail: uniqueEmail('awa') });
    const salarieId = creation.body.salarie.id;
    const ancien = jetonDuLien(creation.body.acces.lien);

    const renvoi = await request(app).post(`/api/salaries/${salarieId}/lien-acces`).set(bearer(admin.token));
    expect(renvoi.status).toBe(201);
    const ancienRes = await request(app).post('/api/auth/definir-mot-de-passe').send({ jeton: ancien, password: 'Valide2026xx' });
    expect(ancienRes.status).toBe(400); // l'ancien lien ne sert plus
    const nouveau = jetonDuLien(renvoi.body.acces.lien);
    expect((await request(app).post('/api/auth/definir-mot-de-passe').send({ jeton: nouveau, password: 'Valide2026xx' })).status).toBe(200);

    // Fiche salarié rattachée au compte propriétaire : refusé.
    const proprio = await pool.query(
      "INSERT INTO salaries (entreprise_id, user_id, nom, prenom, statut) VALUES ($1, $2, 'Proprio', 'P', 'Actif') RETURNING id",
      [admin.entrepriseId, await idDe(admin.email)]
    );
    const refus = await request(app).post(`/api/salaries/${proprio.rows[0].id}/lien-acces`).set(bearer(admin.token));
    expect(refus.status).toBe(403);

    // Salarié sans compte : rien à renvoyer.
    const sansCompte = await request(app).post('/api/salaries').set(bearer(admin.token)).send({ nom: 'Sans', prenom: 'Compte' });
    expect((await request(app).post(`/api/salaries/${sansCompte.body.salarie.id}/lien-acces`).set(bearer(admin.token))).status).toBe(400);
  });

  test('isolation : une autre entreprise ne peut pas créer de lien pour mes salariés', async () => {
    const a = await registerEntreprise();
    const b = await registerEntreprise();
    const creation = await request(app).post('/api/salaries').set(bearer(a.token))
      .send({ nom: 'Traore', prenom: 'Moussa', createAccount: true, compteEmail: uniqueEmail('moussa') });
    const r = await request(app).post(`/api/salaries/${creation.body.salarie.id}/lien-acces`).set(bearer(b.token));
    expect(r.status).toBe(404);
  });
});
