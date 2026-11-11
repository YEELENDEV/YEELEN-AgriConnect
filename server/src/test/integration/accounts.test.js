import { app, pool, request, registerEntreprise, createEmployeeLogin, restreindreEcritures } from './helpers.js';

afterAll(async () => { await pool.end(); });

const bearer = (t) => ({ Authorization: `Bearer ${t}` });
const list = async (token) => (await request(app).get('/api/accounts').set(bearer(token))).body.accounts;

describe('Plan de comptes (account.account-like) — seed, CRUD, rôles, isolation', () => {
  let admin;
  beforeAll(async () => { admin = await registerEntreprise(); });

  test('register a seedé le plan de comptes générique', async () => {
    const codes = (await list(admin.token)).map((a) => a.code);
    expect(codes).toEqual(expect.arrayContaining(['121000', '211000', '101401', '400000', '251000']));
    const clients = (await list(admin.token)).find((a) => a.code === '121000');
    expect(clients).toMatchObject({ accountType: 'asset_receivable', reconcile: true });
  });

  test('POST : code + nom + account_type valides ; code en double → 409', async () => {
    expect((await request(app).post('/api/accounts').set(bearer(admin.token)).send({ name: 'X', accountType: 'income' })).status).toBe(400);
    expect((await request(app).post('/api/accounts').set(bearer(admin.token)).send({ code: '999', name: 'X', accountType: 'bidon' })).status).toBe(400);

    const ok = await request(app).post('/api/accounts').set(bearer(admin.token))
      .send({ code: '706000', name: 'Prestations de services', accountType: 'income' });
    expect(ok.status).toBe(201);
    expect(ok.body.account).toMatchObject({ code: '706000', accountType: 'income', reconcile: false, active: true });

    const dup = await request(app).post('/api/accounts').set(bearer(admin.token))
      .send({ code: '706000', name: 'Doublon', accountType: 'income' });
    expect(dup.status).toBe(409);
  });

  test('PUT met à jour un sous-ensemble ; DELETE puis 404', async () => {
    const a = (await request(app).post('/api/accounts').set(bearer(admin.token))
      .send({ code: `T${Date.now()}`.slice(0, 12), name: 'Temp', accountType: 'expense' })).body.account;

    const put = await request(app).put(`/api/accounts/${a.id}`).set(bearer(admin.token))
      .send({ name: 'Temp modifié', reconcile: true });
    expect(put.status).toBe(200);
    expect(put.body.account).toMatchObject({ name: 'Temp modifié', reconcile: true, accountType: 'expense' });

    expect((await request(app).delete(`/api/accounts/${a.id}`).set(bearer(admin.token))).status).toBe(200);
    expect((await request(app).delete(`/api/accounts/${a.id}`).set(bearer(admin.token))).status).toBe(404);
    expect((await request(app).put(`/api/accounts/${a.id}`).set(bearer(admin.token)).send({ name: 'zombie' })).status).toBe(404);
  });

  test('écritures réservées admin/directeur (ouvrier → 403, lecture OK)', async () => {
    const ouvrier = await createEmployeeLogin(admin.token, 'ouvrier');
    await restreindreEcritures(admin.entrepriseId, ouvrier.email, ['referentiels_comptables']);
    expect((await request(app).get('/api/accounts').set(bearer(ouvrier.token))).status).toBe(200);
    expect((await request(app).post('/api/accounts').set(bearer(ouvrier.token)).send({ code: 'KO', name: 'KO', accountType: 'income' })).status).toBe(403);
  });

  test('isolation multi-tenant : B ne voit ni ne modifie le compte de A', async () => {
    const a = await registerEntreprise();
    const b = await registerEntreprise();
    const compteA = (await request(app).post('/api/accounts').set(bearer(a.token))
      .send({ code: `A${Date.now()}`.slice(0, 12), name: 'De A', accountType: 'income' })).body.account;
    expect((await list(b.token)).map((x) => x.id)).not.toContain(compteA.id);
    expect((await request(app).put(`/api/accounts/${compteA.id}`).set(bearer(b.token)).send({ name: 'hack' })).status).toBe(404);
    expect((await request(app).delete(`/api/accounts/${compteA.id}`).set(bearer(b.token))).status).toBe(404);
  });
});
