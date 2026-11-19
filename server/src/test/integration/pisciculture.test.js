import { app, pool, request, registerEntreprise, createProduit } from './helpers.js';

afterAll(async () => { await pool.end(); });

const bearer = (t) => ({ Authorization: `Bearer ${t}` });

// Mirroir de poulailler.test.js — sans le bloc "mouvements + synchro finances" : ce ledger
// texte-libre est un vestige côté Poulailler (jamais rebranché au frontend), volontairement
// pas reproduit pour Pisciculture (voir routes/pisciculture.js). Les vraies ventes/achats
// passent par devis.js/achats.js, déjà couverts par leurs propres suites de tests.
describe('Pisciculture — livraisons', () => {
  let admin;
  beforeAll(async () => { admin = await registerEntreprise(); });

  test('création (client + produit requis, statut initial « En attente ») ; PUT statut ; PUT/DELETE inexistant → 404', async () => {
    expect((await request(app).post('/api/pisciculture/livraisons').set(bearer(admin.token)).send({ produit: 'Tilapia' })).status).toBe(400);

    const create = await request(app).post('/api/pisciculture/livraisons').set(bearer(admin.token))
      .send({ client: 'Poissonnerie du Port', produit: 'Tilapia', quantite: 150 });
    expect(create.status).toBe(201);
    expect(create.body.livraison).toMatchObject({ client: 'Poissonnerie du Port', statut: 'En attente' });
    const id = create.body.livraison.id;

    expect((await request(app).put(`/api/pisciculture/livraisons/${id}`).set(bearer(admin.token)).send({})).status).toBe(400);
    const put = await request(app).put(`/api/pisciculture/livraisons/${id}`).set(bearer(admin.token)).send({ statut: 'Livré' });
    expect(put.status).toBe(200);
    expect(put.body.livraison.statut).toBe('Livré');

    expect((await request(app).put('/api/pisciculture/livraisons/999999').set(bearer(admin.token)).send({ statut: 'Livré' })).status).toBe(404);

    expect((await request(app).delete(`/api/pisciculture/livraisons/${id}`).set(bearer(admin.token))).status).toBe(200);
    expect((await request(app).delete('/api/pisciculture/livraisons/999999').set(bearer(admin.token))).status).toBe(404);
    expect((await request(app).get('/api/pisciculture/livraisons').set(bearer(admin.token))).body.livraisons.map((l) => l.id)).not.toContain(id);
  });
});

describe('Pisciculture — suivi quotidien', () => {
  test('création (type + quantite requis) ; GET scopé', async () => {
    const admin = await registerEntreprise();
    expect((await request(app).post('/api/pisciculture/suivi').set(bearer(admin.token)).send({ type: 'mortalite' })).status).toBe(400);

    const res = await request(app).post('/api/pisciculture/suivi').set(bearer(admin.token)).send({ type: 'croissance', quantite: 250, detail: 'Bassin 1' });
    expect(res.status).toBe(201);
    expect(res.body.entry).toMatchObject({ type: 'croissance', quantite: 250 });

    const list = await request(app).get('/api/pisciculture/suivi').set(bearer(admin.token));
    expect(list.body.suivi.map((s) => s.id)).toContain(res.body.entry.id);
  });
});

describe('Pisciculture — isolation multi-tenant', () => {
  test("B ne voit rien de A et ne peut pas toucher ses livraisons / suivi", async () => {
    const a = await registerEntreprise();
    const b = await registerEntreprise();
    const livA = (await request(app).post('/api/pisciculture/livraisons').set(bearer(a.token))
      .send({ client: 'A', produit: 'Tilapia' })).body.livraison;
    const suiviA = (await request(app).post('/api/pisciculture/suivi').set(bearer(a.token))
      .send({ type: 'mortalite', quantite: 3 })).body.entry;

    expect((await request(app).get('/api/pisciculture/livraisons').set(bearer(b.token))).body.livraisons.map((l) => l.id)).not.toContain(livA.id);
    expect((await request(app).get('/api/pisciculture/suivi').set(bearer(b.token))).body.suivi.map((s) => s.id)).not.toContain(suiviA.id);

    expect((await request(app).put(`/api/pisciculture/livraisons/${livA.id}`).set(bearer(b.token)).send({ statut: 'Livré' })).status).toBe(404);
    expect((await request(app).delete(`/api/pisciculture/livraisons/${livA.id}`).set(bearer(b.token))).status).toBe(404);
  });
});

// Régression sur les whitelists 'module' étendues (produits.js, achats.js, stockSync.js,
// socle.js CHECK) — confirme que Pisciculture est acceptée de bout en bout, catégories
// seedées à l'inscription incluses, et que le stock est réellement synchronisé (pas
// silencieusement ignoré, comme stockSync.js le ferait pour un module non reconnu).
describe('Pisciculture — catalogue produits (stock unifié) + synchro achats', () => {
  test('4 catégories par défaut seedées à l\'inscription', async () => {
    const admin = await registerEntreprise();
    const res = await request(app).get('/api/produit-categories?module=Pisciculture').set(bearer(admin.token));
    expect(res.status).toBe(200);
    expect(res.body.categories.map((c) => c.nom).sort()).toEqual(['Aliment', 'Alevins', 'Autre', 'Poissons vivants'].sort());
  });

  test('POST /produits accepte module Pisciculture ; achat reçu incrémente réellement le stock', async () => {
    const admin = await registerEntreprise();
    const produit = await createProduit(admin.token, { module: 'Pisciculture', nom: 'Alevins tilapia' });

    const before = await pool.query('SELECT quantite::float8 AS quantite FROM produits WHERE id = $1', [produit.id]);
    expect(before.rows[0].quantite).toBe(0);

    const create = await request(app).post('/api/achats').set(bearer(admin.token)).send({
      module: 'Pisciculture', fournisseurNom: 'Écloserie du Fleuve',
      lignes: [{ produit: produit.nom, quantite: 500, prixUnitaire: 50, stockId: produit.id }],
    });
    expect(create.status).toBe(201);
    const docId = create.body.document.id;

    await request(app).post(`/api/achats/${docId}/commander`).set(bearer(admin.token)).send({});
    const recevoir = await request(app).post(`/api/achats/${docId}/recevoir`).set(bearer(admin.token)).send({});
    expect(recevoir.status).toBe(200);

    const after = await pool.query('SELECT quantite::float8 AS quantite FROM produits WHERE id = $1', [produit.id]);
    expect(after.rows[0].quantite).toBe(500);
  });
});
