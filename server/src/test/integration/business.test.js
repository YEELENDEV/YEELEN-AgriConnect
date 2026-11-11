import { app, pool, request, registerEntreprise, createEmployeeLogin, restreindreEcritures } from './helpers.js';

afterAll(async () => { await pool.end(); });

const bearer = (t) => ({ Authorization: `Bearer ${t}` });
const financesDe = async (token) => (await request(app).get('/api/business/finances').set(bearer(token))).body.finances;

describe('Business / finances — écritures manuelles', () => {
  let admin;
  beforeAll(async () => { admin = await registerEntreprise(); });

  test('POST : montant requis ; catégorie défaut Caisse ; Banque sans banqueId → 400 ; Banque + banqueId → 201', async () => {
    expect((await request(app).post('/api/business/finances').set(bearer(admin.token)).send({ description: 'x' })).status).toBe(400);

    const caisse = await request(app).post('/api/business/finances').set(bearer(admin.token)).send({ montant: 15000, description: 'Vente au comptant' });
    expect([200, 201]).toContain(caisse.status);
    expect(caisse.body.entry.categorie).toBe('Caisse');

    const banqueSansId = await request(app).post('/api/business/finances').set(bearer(admin.token)).send({ categorie: 'Banque', montant: 5000 });
    expect(banqueSansId.status).toBe(400);

    const banqueId = (await request(app).post('/api/banques').set(bearer(admin.token)).send({ nomBanque: 'BOA' })).body.banque_id;
    const avecBanque = await request(app).post('/api/business/finances').set(bearer(admin.token))
      .send({ categorie: 'Banque', montant: 5000, banqueId, description: 'Virement reçu' });
    expect(avecBanque.status).toBe(201);
    expect(avecBanque.body.entry).toMatchObject({ categorie: 'Banque', banqueId });

    const relu = (await financesDe(admin.token)).find((f) => f.id === avecBanque.body.entry.id);
    expect(relu.banqueNom).toBe('BOA');
  });

  test('DELETE (admin/directeur) retire l\'écriture ; id inexistant → 404', async () => {
    const entry = (await request(app).post('/api/business/finances').set(bearer(admin.token)).send({ montant: 999, description: 'À supprimer' })).body.entry;
    expect((await request(app).delete(`/api/business/finances/${entry.id}`).set(bearer(admin.token))).status).toBe(200);
    expect((await financesDe(admin.token)).map((f) => f.id)).not.toContain(entry.id);
    expect((await request(app).delete('/api/business/finances/999999').set(bearer(admin.token))).status).toBe(404);
  });
});

describe('Business / finances — rôles', () => {
  test('ouvrier : GET autorisé, POST et DELETE → 403', async () => {
    const admin = await registerEntreprise();
    const ouvrier = await createEmployeeLogin(admin.token, 'ouvrier');
    await restreindreEcritures(admin.entrepriseId, ouvrier.email, ['finances']);
    const entry = (await request(app).post('/api/business/finances').set(bearer(admin.token)).send({ montant: 100, description: 'x' })).body.entry;

    expect((await request(app).get('/api/business/finances').set(bearer(ouvrier.token))).status).toBe(200);
    expect((await request(app).post('/api/business/finances').set(bearer(ouvrier.token)).send({ montant: 1 })).status).toBe(403);
    expect((await request(app).delete(`/api/business/finances/${entry.id}`).set(bearer(ouvrier.token))).status).toBe(403);
  });
});

describe('Business / finances — isolation multi-tenant', () => {
  test('B ne voit pas les écritures de A et ne peut pas les supprimer', async () => {
    const a = await registerEntreprise();
    const b = await registerEntreprise();
    const entryA = (await request(app).post('/api/business/finances').set(bearer(a.token)).send({ montant: 4200, description: 'Écriture A' })).body.entry;

    expect((await financesDe(b.token)).map((f) => f.id)).not.toContain(entryA.id);
    expect((await request(app).delete(`/api/business/finances/${entryA.id}`).set(bearer(b.token))).status).toBe(404);
  });
});
