import { app, pool, request, registerEntreprise, createEmployeeLogin, restreindreEcritures } from './helpers.js';

afterAll(async () => { await pool.end(); });

const bearer = (t) => ({ Authorization: `Bearer ${t}` });
const list = async (token) => (await request(app).get('/api/taxes').set(bearer(token))).body.taxes;

describe('Taxes (account.tax-like) — CRUD, rôles, isolation', () => {
  let admin;
  beforeAll(async () => { admin = await registerEntreprise(); });

  test('aucune taxe seedée par défaut (pas de TVA par pays codée en dur)', async () => {
    expect(await list(admin.token)).toEqual([]);
  });

  test('POST : nom + montant requis ; amount_type validé ; nom en double → 409', async () => {
    expect((await request(app).post('/api/taxes').set(bearer(admin.token)).send({ amount: 20 })).status).toBe(400);
    expect((await request(app).post('/api/taxes').set(bearer(admin.token)).send({ name: 'X', amount: -5 })).status).toBe(400);
    expect((await request(app).post('/api/taxes').set(bearer(admin.token)).send({ name: 'X', amount: 20, amountType: 'bidon' })).status).toBe(400);

    const ok = await request(app).post('/api/taxes').set(bearer(admin.token))
      .send({ name: 'TVA 20 %', amount: 20, amountType: 'percent' });
    expect(ok.status).toBe(201);
    expect(ok.body.tax).toMatchObject({ name: 'TVA 20 %', amountType: 'percent', amount: 20, typeTaxUse: 'sale', active: true });

    const dup = await request(app).post('/api/taxes').set(bearer(admin.token))
      .send({ name: 'TVA 20 %', amount: 20 });
    expect(dup.status).toBe(409);
  });

  test('PUT met à jour un sous-ensemble de champs ; DELETE puis 404', async () => {
    const t = (await request(app).post('/api/taxes').set(bearer(admin.token))
      .send({ name: `Éco ${Date.now()}`, amount: 5, amountType: 'fixed' })).body.tax;

    const put = await request(app).put(`/api/taxes/${t.id}`).set(bearer(admin.token))
      .send({ amount: 8, priceInclude: true });
    expect(put.status).toBe(200);
    expect(put.body.tax).toMatchObject({ amount: 8, priceInclude: true, amountType: 'fixed' });

    expect((await request(app).delete(`/api/taxes/${t.id}`).set(bearer(admin.token))).status).toBe(200);
    expect((await request(app).delete(`/api/taxes/${t.id}`).set(bearer(admin.token))).status).toBe(404);
    expect((await request(app).put(`/api/taxes/${t.id}`).set(bearer(admin.token)).send({ amount: 1 })).status).toBe(404);
  });

  test('écritures réservées admin/directeur (ouvrier → 403, lecture OK)', async () => {
    const ouvrier = await createEmployeeLogin(admin.token, 'ouvrier');
    await restreindreEcritures(admin.entrepriseId, ouvrier.email, ['referentiels_comptables']);
    expect((await request(app).get('/api/taxes').set(bearer(ouvrier.token))).status).toBe(200);
    expect((await request(app).post('/api/taxes').set(bearer(ouvrier.token)).send({ name: 'KO', amount: 1 })).status).toBe(403);
  });

  test('isolation multi-tenant : B ne voit ni ne modifie la taxe de A', async () => {
    const a = await registerEntreprise();
    const b = await registerEntreprise();
    const taxA = (await request(app).post('/api/taxes').set(bearer(a.token))
      .send({ name: `De A ${Date.now()}`, amount: 10 })).body.tax;

    expect((await list(b.token)).map((x) => x.id)).not.toContain(taxA.id);
    expect((await request(app).put(`/api/taxes/${taxA.id}`).set(bearer(b.token)).send({ amount: 99 })).status).toBe(404);
    expect((await request(app).delete(`/api/taxes/${taxA.id}`).set(bearer(b.token))).status).toBe(404);
  });
});
