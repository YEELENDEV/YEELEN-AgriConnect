import { app, pool, request, registerEntreprise, createEmployeeLogin, createClient, uniqueEmail, restreindreEcritures } from './helpers.js';
import { generateEmailCode } from '../../utils/mfaCode.js';

afterAll(async () => { await pool.end(); });

describe('Auth — register / login', () => {
  test('register (entreprise) sans pays/téléphone/TVA/adresse → 400', async () => {
    const email = uniqueEmail('reg');
    const res = await request(app).post('/api/auth/register').send({
      email, password: 'Passw0rd!', nomEntreprise: 'Reg SARL', typeCompte: 'entreprise',
    });
    expect(res.status).toBe(400);
    expect(res.body.token).toBeUndefined();
  });

  test('register (particulier) accepte sans pays/téléphone/TVA/adresse', async () => {
    const email = uniqueEmail('reg-part');
    const res = await request(app).post('/api/auth/register').send({
      email, password: 'Passw0rd!', nomEntreprise: 'Diallo Agriculture', typeCompte: 'particulier',
    });
    expect([200, 201]).toContain(res.status);
    expect(res.body.confirmationRequired).toBe(true);
  });

  test('register (entreprise complet) renvoie confirmationRequired, pas de token ; le code de confirmation active le compte', async () => {
    const email = uniqueEmail('reg');
    const res = await request(app).post('/api/auth/register').send({
      email, password: 'Passw0rd!', nomEntreprise: 'Reg SARL', typeCompte: 'entreprise',
      telephone: '+22300000000', pays: 'ML', numeroTva: 'ML00000000', adresse: 'Rue test',
    });
    expect([200, 201]).toContain(res.status);
    expect(res.body.token).toBeUndefined();
    expect(res.body.confirmationRequired).toBe(true);

    // Le compte existe mais ne peut pas encore se connecter (email non confirmé).
    const loginAvant = await request(app).post('/api/auth/login').send({ email, password: 'Passw0rd!' });
    expect(loginAvant.status).toBe(200);
    expect(loginAvant.body.confirmationRequired).toBe(true);
    expect(loginAvant.body.token).toBeUndefined();

    const { rows } = await pool.query('SELECT id FROM users WHERE LOWER(email) = LOWER($1)', [email]);
    const userId = rows[0].id;

    const mauvaisCode = await request(app).post('/api/auth/confirmer-inscription').send({ email, code: '000000' });
    expect(mauvaisCode.status).toBe(401);

    const bonCode = generateEmailCode(userId, email);
    const confirmation = await request(app).post('/api/auth/confirmer-inscription').send({ email, code: bonCode });
    expect(confirmation.status).toBe(200);
    expect(confirmation.body.token).toBeTruthy();

    const me = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${confirmation.body.token}`);
    expect(me.status).toBe(200);
    expect(me.body.user.email).toBe(email.toLowerCase());
    expect(me.body.user.role).toBe('admin');
    expect(me.body.entreprise.id).toEqual(expect.any(Number));

    // Une fois confirmé, un login normal fonctionne directement (plus de confirmationRequired).
    const loginApres = await request(app).post('/api/auth/login').send({ email, password: 'Passw0rd!' });
    expect(loginApres.status).toBe(200);
    expect(loginApres.body.token).toBeTruthy();

    // Un compte déjà confirmé refuse une seconde confirmation.
    const reconfirmation = await request(app).post('/api/auth/confirmer-inscription').send({ email, code: bonCode });
    expect(reconfirmation.status).toBe(400);
  });

  test('register refuse un email déjà pris', async () => {
    const { email } = await registerEntreprise();
    const dup = await request(app).post('/api/auth/register').send({
      email, password: 'Passw0rd!', nomEntreprise: 'Dup', typeCompte: 'entreprise',
    });
    expect(dup.status).toBeGreaterThanOrEqual(400);
    expect(dup.body.token).toBeUndefined();
  });

  test('login : bon mot de passe → token ; mauvais → 401 ; email inconnu → 401', async () => {
    const { email, password } = await registerEntreprise();

    const ok = await request(app).post('/api/auth/login').send({ email, password });
    expect(ok.status).toBe(200);
    expect(ok.body.token).toBeTruthy();
    expect(ok.body.entreprise).toBeTruthy();

    const bad = await request(app).post('/api/auth/login').send({ email, password: 'faux' });
    expect(bad.status).toBe(401);
    expect(bad.body.token).toBeUndefined();

    const unknown = await request(app).post('/api/auth/login').send({ email: uniqueEmail('nobody'), password: 'x' });
    expect(unknown.status).toBe(401);
  });

  test('une route protégée sans token → 401', async () => {
    const res = await request(app).get('/api/contacts');
    expect(res.status).toBe(401);
  });
});

describe('Rôles — restriction posée par l’entreprise', () => {
  test("un salarié dont le rôle retire les écritures financières reçoit 403 (POST /api/business/finances)", async () => {
    const admin = await registerEntreprise();
    const ouvrier = await createEmployeeLogin(admin.token, 'ouvrier');
    await restreindreEcritures(admin.entrepriseId, ouvrier.email, ['finances']);

    const asAdmin = await request(app)
      .post('/api/business/finances')
      .set('Authorization', `Bearer ${admin.token}`)
      .send({ montant: 1000, description: 'ok' });
    expect([200, 201]).toContain(asAdmin.status);

    const asOuvrier = await request(app)
      .post('/api/business/finances')
      .set('Authorization', `Bearer ${ouvrier.token}`)
      .send({ montant: 1000, description: 'ko' });
    expect(asOuvrier.status).toBe(403);
  });
});

describe('Isolation multi-tenant', () => {
  test("une entreprise ne voit ni ne peut lire les contacts d'une autre", async () => {
    const a = await registerEntreprise();
    const b = await registerEntreprise();

    const contactA = await createClient(a.token, 'Client de A');

    const listB = await request(app).get('/api/contacts').set('Authorization', `Bearer ${b.token}`);
    expect(listB.status).toBe(200);
    const ids = (listB.body.contacts || listB.body || []).map((c) => c.id);
    expect(ids).not.toContain(contactA);

    // B tente de modifier le contact de A : refusé (scopé entreprise_id).
    const editB = await request(app)
      .put(`/api/contacts/${contactA}`)
      .set('Authorization', `Bearer ${b.token}`)
      .send({ nom: 'pirate', estClient: true });
    expect(editB.status).toBe(404);
  });

  test("une entreprise ne peut pas lire le devis d'une autre", async () => {
    const a = await registerEntreprise();
    const b = await registerEntreprise();
    const clientA = await createClient(a.token);

    const devisA = await request(app)
      .post('/api/devis')
      .set('Authorization', `Bearer ${a.token}`)
      .send({ clientId: clientA, lignes: [{ produit: 'X', quantite: 1, prixUnitaire: 100, type: 'produit' }] });
    expect(devisA.status).toBe(201);
    const devisId = devisA.body.devis.id;

    const readB = await request(app).get(`/api/devis/${devisId}`).set('Authorization', `Bearer ${b.token}`);
    expect(readB.status).toBe(404);
  });
});
