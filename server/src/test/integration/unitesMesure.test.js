// Étape 1 de l'alignement Odoo produit/stock (2026-09-03) : référentiel d'unités de mesure
// (unites_mesure_categories / unites_mesure) + conversion de facteur dans stockSync.js quand
// une ligne d'achat/devis porte un uom_id différent de l'unité de base du produit.
import { app, pool, request, registerEntreprise, createEmployeeLogin, createClient, createProduit, restreindreEcritures } from './helpers.js';

afterAll(async () => { await pool.end(); });

const bearer = (t) => ({ Authorization: `Bearer ${t}` });

describe('Référentiel unités de mesure', () => {
  let admin;

  beforeAll(async () => {
    admin = await registerEntreprise();
  });

  test('seedé à l\'inscription : catégories Poids/Volume/Unité + leurs unités, une référence par catégorie', async () => {
    const cats = (await request(app).get('/api/unites-mesure-categories').set(bearer(admin.token))).body.categories;
    const noms = cats.map((c) => c.nom).sort();
    expect(noms).toEqual(['Poids', 'Unité', 'Volume']);

    const unites = (await request(app).get('/api/unites-mesure').set(bearer(admin.token))).body.unites;
    const poids = unites.filter((u) => u.categorieNom === 'Poids');
    expect(poids.map((u) => u.nom).sort()).toEqual(['Gramme', 'Kilogramme', 'Tonne']);
    expect(poids.filter((u) => u.estReference)).toHaveLength(1);
    expect(poids.find((u) => u.nom === 'Kilogramme').estReference).toBe(true);
    expect(Number(poids.find((u) => u.nom === 'Gramme').facteur)).toBeCloseTo(0.001);
    expect(Number(poids.find((u) => u.nom === 'Tonne').facteur)).toBe(1000);
  });

  test('POST catégorie ; 409 sur un nom déjà utilisé par l\'entreprise', async () => {
    const nom = `Longueur ${Date.now()}`;
    const res = await request(app).post('/api/unites-mesure-categories').set(bearer(admin.token)).send({ nom });
    expect(res.status).toBe(201);
    const dup = await request(app).post('/api/unites-mesure-categories').set(bearer(admin.token)).send({ nom });
    expect(dup.status).toBe(409);
  });

  test('DELETE catégorie → cascade ses unités', async () => {
    const cat = (await request(app).post('/api/unites-mesure-categories').set(bearer(admin.token))
      .send({ nom: `Cat jetable ${Date.now()}` })).body.categorie;
    const unite = (await request(app).post('/api/unites-mesure').set(bearer(admin.token))
      .send({ categorieId: cat.id, nom: 'Boîte', symbole: 'bte', facteur: 1, estReference: true })).body.unite;

    const del = await request(app).delete(`/api/unites-mesure-categories/${cat.id}`).set(bearer(admin.token));
    expect(del.status).toBe(200);

    const unites = (await request(app).get('/api/unites-mesure').set(bearer(admin.token))).body.unites;
    expect(unites.find((u) => u.id === unite.id)).toBeUndefined();
  });

  test('POST unité — validations : categorieId requis, nom requis, facteur positif, categorieId inconnu → 400', async () => {
    const cat = (await request(app).post('/api/unites-mesure-categories').set(bearer(admin.token))
      .send({ nom: `Cat validation ${Date.now()}` })).body.categorie;

    expect((await request(app).post('/api/unites-mesure').set(bearer(admin.token)).send({ nom: 'X' })).status).toBe(400);
    expect((await request(app).post('/api/unites-mesure').set(bearer(admin.token)).send({ categorieId: cat.id })).status).toBe(400);
    expect((await request(app).post('/api/unites-mesure').set(bearer(admin.token))
      .send({ categorieId: cat.id, nom: 'X', facteur: -1 })).status).toBe(400);
    expect((await request(app).post('/api/unites-mesure').set(bearer(admin.token))
      .send({ categorieId: 99999999, nom: 'X' })).status).toBe(400);
  });

  test('POST unité — 409 sur (categorieId, nom) déjà utilisé', async () => {
    const cat = (await request(app).post('/api/unites-mesure-categories').set(bearer(admin.token))
      .send({ nom: `Cat dup ${Date.now()}` })).body.categorie;
    const nom = 'Sac';
    expect((await request(app).post('/api/unites-mesure').set(bearer(admin.token)).send({ categorieId: cat.id, nom })).status).toBe(201);
    expect((await request(app).post('/api/unites-mesure').set(bearer(admin.token)).send({ categorieId: cat.id, nom })).status).toBe(409);
  });

  test('PUT unité — mise à jour partielle', async () => {
    const cat = (await request(app).post('/api/unites-mesure-categories').set(bearer(admin.token))
      .send({ nom: `Cat put ${Date.now()}` })).body.categorie;
    const unite = (await request(app).post('/api/unites-mesure').set(bearer(admin.token))
      .send({ categorieId: cat.id, nom: 'Carton', facteur: 1 })).body.unite;

    const put = await request(app).put(`/api/unites-mesure/${unite.id}`).set(bearer(admin.token)).send({ facteur: 24 });
    expect(put.status).toBe(200);
    expect(Number(put.body.unite.facteur)).toBe(24);
    expect(put.body.unite.nom).toBe('Carton');
  });

  test('DELETE unité — 404 si introuvable ; ON DELETE SET NULL détache le produit qui la référençait', async () => {
    expect((await request(app).delete('/api/unites-mesure/99999999').set(bearer(admin.token))).status).toBe(404);

    const cat = (await request(app).post('/api/unites-mesure-categories').set(bearer(admin.token))
      .send({ nom: `Cat detach ${Date.now()}` })).body.categorie;
    const unite = (await request(app).post('/api/unites-mesure').set(bearer(admin.token))
      .send({ categorieId: cat.id, nom: 'Botte', facteur: 1 })).body.unite;
    const produit = await createProduit(admin.token, { uniteId: unite.id });

    const del = await request(app).delete(`/api/unites-mesure/${unite.id}`).set(bearer(admin.token));
    expect(del.status).toBe(200);

    const produits = (await request(app).get('/api/produits?module=Cultures').set(bearer(admin.token))).body.stocks;
    expect(produits.find((p) => p.id === produit.id).uniteId).toBeNull();
  });

  test('écritures réservées admin/directeur — un ouvrier reçoit 403 sur POST/PUT/DELETE mais garde le GET', async () => {
    const ouvrier = await createEmployeeLogin(admin.token, 'ouvrier');
    await restreindreEcritures(admin.entrepriseId, ouvrier.email, ['referentiels_produits']);
    expect((await request(app).get('/api/unites-mesure').set(bearer(ouvrier.token))).status).toBe(200);
    expect((await request(app).post('/api/unites-mesure-categories').set(bearer(ouvrier.token)).send({ nom: 'X' })).status).toBe(403);

    const cat = (await request(app).post('/api/unites-mesure-categories').set(bearer(admin.token))
      .send({ nom: `Cat role ${Date.now()}` })).body.categorie;
    const unite = (await request(app).post('/api/unites-mesure').set(bearer(admin.token))
      .send({ categorieId: cat.id, nom: 'Pièce', facteur: 1 })).body.unite;
    expect((await request(app).put(`/api/unites-mesure/${unite.id}`).set(bearer(ouvrier.token)).send({ facteur: 2 })).status).toBe(403);
    expect((await request(app).delete(`/api/unites-mesure/${unite.id}`).set(bearer(ouvrier.token))).status).toBe(403);
  });

  test('isolation multi-tenant : PUT/DELETE cross-tenant → 404, GET ne fuite pas', async () => {
    const autre = await registerEntreprise();
    const cat = (await request(app).post('/api/unites-mesure-categories').set(bearer(admin.token))
      .send({ nom: `Cat isolation ${Date.now()}` })).body.categorie;
    const unite = (await request(app).post('/api/unites-mesure').set(bearer(admin.token))
      .send({ categorieId: cat.id, nom: 'Balle', facteur: 1 })).body.unite;

    expect((await request(app).put(`/api/unites-mesure/${unite.id}`).set(bearer(autre.token)).send({ facteur: 2 })).status).toBe(404);
    expect((await request(app).delete(`/api/unites-mesure/${unite.id}`).set(bearer(autre.token))).status).toBe(404);

    const unitesAutre = (await request(app).get('/api/unites-mesure').set(bearer(autre.token))).body.unites;
    expect(unitesAutre.find((u) => u.id === unite.id)).toBeUndefined();
  });
});

describe('Conversion d\'unité dans stockSync — achats/devis', () => {
  let admin;
  let clientId;
  let kgId;
  let grammeId;
  let tonneId;
  let litreId;

  beforeAll(async () => {
    admin = await registerEntreprise();
    clientId = await createClient(admin.token);
    const unites = (await request(app).get('/api/unites-mesure').set(bearer(admin.token))).body.unites;
    kgId = unites.find((u) => u.nom === 'Kilogramme').id;
    grammeId = unites.find((u) => u.nom === 'Gramme').id;
    tonneId = unites.find((u) => u.nom === 'Tonne').id;
    litreId = unites.find((u) => u.nom === 'Litre').id;
  });

  const stockDe = async (produitId) => {
    const { rows } = await pool.query('SELECT quantite::float8 AS q FROM produits WHERE id = $1', [produitId]);
    return rows[0].q;
  };

  test('achat en Grammes converti vers le Kilogramme (unité de base du produit)', async () => {
    const produit = await createProduit(admin.token, { module: 'Cultures', uniteId: kgId });
    await pool.query('UPDATE produits SET quantite = 0 WHERE id = $1', [produit.id]);

    const doc = (await request(app).post('/api/achats').set(bearer(admin.token)).send({
      module: 'Cultures', fournisseurNom: 'Fournisseur Test',
      lignes: [{ produit: produit.nom, quantite: 1000, prixUnitaire: 1, stockId: produit.id, uomId: grammeId }],
    })).body.document;
    expect(doc.lignes[0].uomId).toBe(grammeId);

    await request(app).post(`/api/achats/${doc.id}/commander`).set(bearer(admin.token)).send({});
    const recevoir = await request(app).post(`/api/achats/${doc.id}/recevoir`).set(bearer(admin.token)).send({});
    expect(recevoir.status).toBe(200);

    // 1000 g * (0.001 / 1) = 1 kg
    expect(await stockDe(produit.id)).toBe(1);

    const annuler = await request(app).post(`/api/achats/${doc.id}/annuler-reception`).set(bearer(admin.token)).send({});
    expect(annuler.status).toBe(200);
    expect(await stockDe(produit.id)).toBe(0);
  });

  test('vente (devis signé) en Tonne convertie vers le Kilogramme', async () => {
    const produit = await createProduit(admin.token, { module: 'Cultures', uniteId: kgId });
    await pool.query('UPDATE produits SET quantite = 5000 WHERE id = $1', [produit.id]);

    const create = await request(app).post('/api/devis').set(bearer(admin.token)).send({
      clientId,
      lignes: [{ produit: produit.nom, quantite: 2, prixUnitaire: 100, type: 'produit', stockId: produit.id, stockModule: 'Cultures', uomId: tonneId }],
    });
    expect(create.body.devis.lignes[0].uomId).toBe(tonneId);
    const devisId = create.body.devis.id;

    await request(app).post(`/api/devis/${devisId}/valider-manuel`).set(bearer(admin.token)).send({ confirmePar: 'M. Test' });

    // 2 t * (1000 / 1) = 2000 kg décrémentés
    expect(await stockDe(produit.id)).toBe(3000);
  });

  test('sans uomId fourni : repli sur l\'unité de base du produit, pas de conversion', async () => {
    const produit = await createProduit(admin.token, { module: 'Cultures', uniteId: kgId });
    await pool.query('UPDATE produits SET quantite = 10 WHERE id = $1', [produit.id]);

    const doc = (await request(app).post('/api/achats').set(bearer(admin.token)).send({
      module: 'Cultures', fournisseurNom: 'Fournisseur Test',
      lignes: [{ produit: produit.nom, quantite: 5, prixUnitaire: 1, stockId: produit.id }],
    })).body.document;
    expect(doc.lignes[0].uomId).toBe(kgId); // repli résolu côté serveur

    await request(app).post(`/api/achats/${doc.id}/commander`).set(bearer(admin.token)).send({});
    await request(app).post(`/api/achats/${doc.id}/recevoir`).set(bearer(admin.token)).send({});
    expect(await stockDe(produit.id)).toBe(15);
  });

  test('catégories d\'unité différentes (Poids vs Volume) : aucune conversion, delta brut appliqué', async () => {
    const produit = await createProduit(admin.token, { module: 'Cultures', uniteId: kgId });
    await pool.query('UPDATE produits SET quantite = 10 WHERE id = $1', [produit.id]);

    const doc = (await request(app).post('/api/achats').set(bearer(admin.token)).send({
      module: 'Cultures', fournisseurNom: 'Fournisseur Test',
      lignes: [{ produit: produit.nom, quantite: 3, prixUnitaire: 1, stockId: produit.id, uomId: litreId }],
    })).body.document;

    await request(app).post(`/api/achats/${doc.id}/commander`).set(bearer(admin.token)).send({});
    await request(app).post(`/api/achats/${doc.id}/recevoir`).set(bearer(admin.token)).send({});
    // pas de conversion entre catégories différentes → +3 brut, pas +3000 ni +0.003
    expect(await stockDe(produit.id)).toBe(13);
  });
});
