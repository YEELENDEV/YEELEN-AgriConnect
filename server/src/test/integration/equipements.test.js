import { app, pool, request, registerEntreprise, createEmployeeLogin, restreindreEcritures } from './helpers.js';

afterAll(async () => { await pool.end(); });

const bearer = (t) => ({ Authorization: `Bearer ${t}` });

const creerEquipement = async (token, nom = `Tracteur ${Date.now()}`) => {
  const res = await request(app).post('/api/equipements').set(bearer(token))
    .send({ nom, categorie: 'Machine', etat: 'Fonctionnel', valeur: 1500000 });
  expect(res.status).toBe(201);
  return res.body.equipement.id;
};

describe('Équipements — CRUD + rôles', () => {
  let admin;
  beforeAll(async () => { admin = await registerEntreprise(); });

  test('création : nom requis ; PUT met à jour ; PUT/DELETE sur id inexistant → 404', async () => {
    const sansNom = await request(app).post('/api/equipements').set(bearer(admin.token)).send({ categorie: 'Machine' });
    expect(sansNom.status).toBe(400);

    const id = await creerEquipement(admin.token, 'Motoculteur');
    const put = await request(app).put(`/api/equipements/${id}`).set(bearer(admin.token))
      .send({ nom: 'Motoculteur', etat: 'En panne', categorie: 'Machine', valeur: 900000 });
    expect(put.status).toBe(200);
    expect(put.body.equipement).toMatchObject({ nom: 'Motoculteur', etat: 'En panne' });

    expect((await request(app).put('/api/equipements/999999').set(bearer(admin.token)).send({ nom: 'x' })).status).toBe(404);
    expect((await request(app).delete('/api/equipements/999999').set(bearer(admin.token))).status).toBe(404);
    expect((await request(app).delete(`/api/equipements/${id}`).set(bearer(admin.token))).status).toBe(200);
  });

  test('rôles : ouvrier → 403 ; gestionnaire (autorisé) → 201', async () => {
    const ouvrier = await createEmployeeLogin(admin.token, 'ouvrier');
    await restreindreEcritures(admin.entrepriseId, ouvrier.email, ['equipements']);
    const gestionnaire = await createEmployeeLogin(admin.token, 'gestionnaire');
    const id = await creerEquipement(admin.token);

    expect((await request(app).post('/api/equipements').set(bearer(ouvrier.token)).send({ nom: 'KO' })).status).toBe(403);
    expect((await request(app).put(`/api/equipements/${id}`).set(bearer(ouvrier.token)).send({ nom: 'KO' })).status).toBe(403);
    expect((await request(app).delete(`/api/equipements/${id}`).set(bearer(ouvrier.token))).status).toBe(403);
    // lecture ouverte à tous
    expect((await request(app).get('/api/equipements').set(bearer(ouvrier.token))).status).toBe(200);

    const parGestionnaire = await request(app).post('/api/equipements').set(bearer(gestionnaire.token)).send({ nom: 'Pompe' });
    expect(parGestionnaire.status).toBe(201);
  });
});

describe('Équipements — maintenance', () => {
  let admin;
  let equipId;
  beforeAll(async () => {
    admin = await registerEntreprise();
    equipId = await creerEquipement(admin.token);
  });

  test('ajout (description requise), liste, suppression, re-suppression → 404', async () => {
    const sansDesc = await request(app).post(`/api/equipements/${equipId}/maintenance`).set(bearer(admin.token)).send({ cout: 100 });
    expect(sansDesc.status).toBe(400);

    const add = await request(app).post(`/api/equipements/${equipId}/maintenance`).set(bearer(admin.token))
      .send({ description: 'Vidange', cout: 25000 });
    expect(add.status).toBe(201);
    expect(add.body.maintenance).toMatchObject({ description: 'Vidange', cout: 25000, equipementId: equipId });
    const mId = add.body.maintenance.id;

    const list = await request(app).get(`/api/equipements/${equipId}/maintenance`).set(bearer(admin.token));
    expect(list.status).toBe(200);
    expect(list.body.maintenance.map((m) => m.id)).toContain(mId);

    expect((await request(app).delete(`/api/equipements/maintenance/${mId}`).set(bearer(admin.token))).status).toBe(200);
    expect((await request(app).delete(`/api/equipements/maintenance/${mId}`).set(bearer(admin.token))).status).toBe(404);
  });

  test('sous-routes sur un équipement inexistant → 404', async () => {
    expect((await request(app).get('/api/equipements/999999/maintenance').set(bearer(admin.token))).status).toBe(404);
    expect((await request(app).post('/api/equipements/999999/maintenance').set(bearer(admin.token)).send({ description: 'x' })).status).toBe(404);
  });
});

describe('Équipements — isolation multi-tenant', () => {
  test("B ne voit pas l'équipement de A et ne peut pas y toucher (ni ses interventions)", async () => {
    const a = await registerEntreprise();
    const b = await registerEntreprise();
    const idA = await creerEquipement(a.token, 'Équipement A');

    const listB = await request(app).get('/api/equipements').set(bearer(b.token));
    expect(listB.body.equipements.map((e) => e.id)).not.toContain(idA);

    expect((await request(app).put(`/api/equipements/${idA}`).set(bearer(b.token)).send({ nom: 'hack' })).status).toBe(404);
    expect((await request(app).delete(`/api/equipements/${idA}`).set(bearer(b.token))).status).toBe(404);
    expect((await request(app).get(`/api/equipements/${idA}/maintenance`).set(bearer(b.token))).status).toBe(404);
    expect((await request(app).post(`/api/equipements/${idA}/maintenance`).set(bearer(b.token)).send({ description: 'x' })).status).toBe(404);
  });
});
