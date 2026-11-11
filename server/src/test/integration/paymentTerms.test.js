import { app, pool, request, registerEntreprise, createEmployeeLogin, restreindreEcritures } from './helpers.js';

afterAll(async () => { await pool.end(); });

const bearer = (t) => ({ Authorization: `Bearer ${t}` });
const list = async (token) => (await request(app).get('/api/payment-terms').set(bearer(token))).body.paymentTerms;

describe('Conditions de paiement — seed + CRUD', () => {
  let admin;
  beforeAll(async () => { admin = await registerEntreprise(); });

  test('register a seedé les conditions par défaut', async () => {
    const terms = await list(admin.token);
    const noms = terms.map((t) => t.name);
    expect(noms).toEqual(expect.arrayContaining(['Paiement immédiat', '30 jours', '30 % à la commande, solde à 30 jours']));
    const immediat = terms.find((t) => t.name === 'Paiement immédiat');
    expect(immediat.lignes).toHaveLength(1);
    expect(immediat.lignes[0]).toMatchObject({ value: 'balance', delayType: 'days_after', nbDays: 0 });
  });

  test('POST : nom requis, au moins une ligne valide, nom en double → 409', async () => {
    expect((await request(app).post('/api/payment-terms').set(bearer(admin.token)).send({ lignes: [{ value: 'balance' }] })).status).toBe(400);
    expect((await request(app).post('/api/payment-terms').set(bearer(admin.token)).send({ name: 'X', lignes: [] })).status).toBe(400);

    const body = { name: `Sur mesure ${Date.now()}`, lignes: [
      { value: 'percent', valueAmount: 40, delayType: 'days_after', nbDays: 0, ordre: 0 },
      { value: 'balance', delayType: 'days_after', nbDays: 45, ordre: 1 },
    ] };
    const ok = await request(app).post('/api/payment-terms').set(bearer(admin.token)).send(body);
    expect(ok.status).toBe(201);
    expect(ok.body.paymentTerm.lignes).toHaveLength(2);
    expect(ok.body.paymentTerm.lignes[0]).toMatchObject({ value: 'percent', valueAmount: 40 });

    const dup = await request(app).post('/api/payment-terms').set(bearer(admin.token)).send(body);
    expect(dup.status).toBe(409);
  });

  test('PUT remplace les lignes ; DELETE + id inexistant → 404', async () => {
    const created = (await request(app).post('/api/payment-terms').set(bearer(admin.token))
      .send({ name: `À modifier ${Date.now()}`, lignes: [{ value: 'balance', delayType: 'days_after', nbDays: 15 }] })).body.paymentTerm;

    const put = await request(app).put(`/api/payment-terms/${created.id}`).set(bearer(admin.token))
      .send({ name: created.name, lignes: [{ value: 'balance', delayType: 'days_after', nbDays: 60 }] });
    expect(put.status).toBe(200);
    expect(put.body.paymentTerm.lignes[0].nbDays).toBe(60);

    expect((await request(app).delete(`/api/payment-terms/${created.id}`).set(bearer(admin.token))).status).toBe(200);
    expect((await request(app).delete(`/api/payment-terms/${created.id}`).set(bearer(admin.token))).status).toBe(404);
  });

  test('écritures réservées admin/directeur (ouvrier → 403, lecture OK)', async () => {
    const ouvrier = await createEmployeeLogin(admin.token, 'ouvrier');
    await restreindreEcritures(admin.entrepriseId, ouvrier.email, ['referentiels_comptables']);
    expect((await request(app).get('/api/payment-terms').set(bearer(ouvrier.token))).status).toBe(200);
    expect((await request(app).post('/api/payment-terms').set(bearer(ouvrier.token)).send({ name: 'KO', lignes: [{ value: 'balance' }] })).status).toBe(403);
  });

  test('isolation multi-tenant : B ne voit pas / ne modifie pas le terme de A', async () => {
    const a = await registerEntreprise();
    const b = await registerEntreprise();
    const termeA = (await request(app).post('/api/payment-terms').set(bearer(a.token))
      .send({ name: `De A ${Date.now()}`, lignes: [{ value: 'balance', delayType: 'days_after', nbDays: 10 }] })).body.paymentTerm;

    expect((await list(b.token)).map((t) => t.id)).not.toContain(termeA.id);
    expect((await request(app).put(`/api/payment-terms/${termeA.id}`).set(bearer(b.token)).send({ name: 'hack' })).status).toBe(404);
    expect((await request(app).delete(`/api/payment-terms/${termeA.id}`).set(bearer(b.token))).status).toBe(404);
  });
});
