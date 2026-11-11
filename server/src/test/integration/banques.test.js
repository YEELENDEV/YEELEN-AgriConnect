import { app, pool, request, registerEntreprise, createEmployeeLogin, restreindreEcritures } from './helpers.js';

afterAll(async () => { await pool.end(); });

const bearer = (t) => ({ Authorization: `Bearer ${t}` });

async function creerBanque(token, nomBanque = `Banque ${Date.now()}`) {
  const res = await request(app).post('/api/banques').set(bearer(token)).send({ nomBanque, solde: 100000 });
  expect(res.status).toBe(201);
  return res.body.banque_id;
}
async function listeBanques(token) {
  const res = await request(app).get('/api/banques').set(bearer(token));
  expect(res.status).toBe(200);
  return res.body.banques;
}

describe('Banques — CRUD', () => {
  let admin;
  beforeAll(async () => { admin = await registerEntreprise(); });

  test('création : nom requis ; GET liste ; PUT met à jour ; DELETE retire', async () => {
    const sansNom = await request(app).post('/api/banques').set(bearer(admin.token)).send({ solde: 0 });
    expect(sansNom.status).toBe(400);

    const id = await creerBanque(admin.token, 'BOA');
    expect((await listeBanques(admin.token)).map((b) => b.id)).toContain(id);

    const put = await request(app).put(`/api/banques/${id}`).set(bearer(admin.token))
      .send({ nomBanque: 'BOA — courant', solde: 250000 });
    expect(put.status).toBe(200);
    const apres = (await listeBanques(admin.token)).find((b) => b.id === id);
    expect(apres).toMatchObject({ nomBanque: 'BOA — courant', solde: 250000 });

    expect((await request(app).delete(`/api/banques/${id}`).set(bearer(admin.token))).status).toBe(200);
    expect((await listeBanques(admin.token)).map((b) => b.id)).not.toContain(id);
  });

  test('PUT / DELETE sur un id inexistant → 404', async () => {
    expect((await request(app).put('/api/banques/999999').set(bearer(admin.token)).send({ nomBanque: 'x' })).status).toBe(404);
    expect((await request(app).delete('/api/banques/999999').set(bearer(admin.token))).status).toBe(404);
  });
});

describe('Banques — rôles', () => {
  test('un ouvrier ne peut pas écrire (POST/PUT/DELETE → 403) mais peut lire', async () => {
    const admin = await registerEntreprise();
    const ouvrier = await createEmployeeLogin(admin.token, 'ouvrier');
    await restreindreEcritures(admin.entrepriseId, ouvrier.email, ['banques']);
    const id = await creerBanque(admin.token);

    expect((await request(app).post('/api/banques').set(bearer(ouvrier.token)).send({ nomBanque: 'KO' })).status).toBe(403);
    expect((await request(app).put(`/api/banques/${id}`).set(bearer(ouvrier.token)).send({ nomBanque: 'KO' })).status).toBe(403);
    expect((await request(app).delete(`/api/banques/${id}`).set(bearer(ouvrier.token))).status).toBe(403);

    const lecture = await request(app).get('/api/banques').set(bearer(ouvrier.token));
    expect(lecture.status).toBe(200);
  });
});

describe('Banques — compte principal et catégorisation des finances', () => {
  test('PUT /entreprise/banque-principale (admin) ; ouvrier → 403 ; un achat reçu passe alors en catégorie Banque', async () => {
    const admin = await registerEntreprise();
    const ouvrier = await createEmployeeLogin(admin.token, 'ouvrier');
    await restreindreEcritures(admin.entrepriseId, ouvrier.email, ['banques']);
    const banqueId = await creerBanque(admin.token, 'Ecobank');

    const refuse = await request(app).put('/api/entreprise/banque-principale').set(bearer(ouvrier.token)).send({ banqueId });
    expect(refuse.status).toBe(403);

    const set = await request(app).put('/api/entreprise/banque-principale').set(bearer(admin.token)).send({ banqueId });
    expect(set.status).toBe(200);
    const get = await request(app).get('/api/entreprise/banque-principale').set(bearer(admin.token));
    expect(get.body.banquePrincipaleId).toBe(banqueId);

    // Achat reçu → l'écriture finances doit être catégorisée Banque (et non Caisse).
    const achat = await request(app).post('/api/achats').set(bearer(admin.token))
      .send({ module: 'Cultures', fournisseurNom: 'Banque Test Fournisseur', lignes: [{ produit: 'X', quantite: 1, prixUnitaire: 5000 }] });
    const docId = achat.body.document.id;
    await request(app).post(`/api/achats/${docId}/commander`).set(bearer(admin.token)).send({});
    await request(app).post(`/api/achats/${docId}/recevoir`).set(bearer(admin.token)).send({});

    const finances = (await request(app).get('/api/business/finances').set(bearer(admin.token))).body.finances;
    const ligne = finances.find((f) => f.description === 'Achat — Banque Test Fournisseur (Cultures)');
    expect(ligne).toBeTruthy();
    expect(ligne.categorie).toBe('Banque');
    expect(ligne.banqueId).toBe(banqueId);
  });
});

describe('Banques — isolation multi-tenant', () => {
  test('B ne voit pas la banque de A et ne peut ni la modifier ni la supprimer', async () => {
    const a = await registerEntreprise();
    const b = await registerEntreprise();
    const idA = await creerBanque(a.token, 'De A');

    expect((await listeBanques(b.token)).map((x) => x.id)).not.toContain(idA);
    expect((await request(app).put(`/api/banques/${idA}`).set(bearer(b.token)).send({ nomBanque: 'hack' })).status).toBe(404);
    expect((await request(app).delete(`/api/banques/${idA}`).set(bearer(b.token))).status).toBe(404);
  });
});
