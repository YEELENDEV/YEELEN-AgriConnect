// Transformation agroalimentaire, étape 2 : ordres de transformation — exécute une recette,
// vérifie la consommation/production réelle du stock (produits.quantite) et un lot de sortie
// créé (stock_lots), puis l'annulation (DELETE) qui restitue tout.
import { request, app, pool, registerEntreprise, createProduit, createEmployeeLogin, restreindreEcritures } from './helpers.js';

afterAll(async () => { await pool.end(); });

async function stockQuantite(token, module, produitId) {
  const res = await request(app).get(`/api/produits?module=${module}`).set('Authorization', `Bearer ${token}`);
  return res.body.stocks.find((p) => p.id === produitId).quantite;
}

async function setStock(token, produitId, quantite) {
  await request(app).put(`/api/produits/${produitId}`).set('Authorization', `Bearer ${token}`).send({ quantite });
}

async function creerRecetteFromage(token) {
  const lait = await createProduit(token, { module: 'Poulailler', nom: `Lait cru ${Date.now()}` });
  const presure = await createProduit(token, { module: 'Poulailler', nom: `Présure ${Date.now()}` });
  const fromage = await createProduit(token, { module: 'Poulailler', nom: `Fromage frais ${Date.now()}` });
  await setStock(token, lait.id, 100);
  await setStock(token, presure.id, 5);

  const recette = await request(app).post('/api/produit-recettes').set('Authorization', `Bearer ${token}`)
    .send({ produitSortieId: fromage.id, nom: 'Recette fromage', quantiteProduite: 1 });
  const recetteId = recette.body.recette.id;
  await request(app).post(`/api/produit-recettes/${recetteId}/lignes`).set('Authorization', `Bearer ${token}`)
    .send({ produitId: lait.id, quantite: 10 });
  await request(app).post(`/api/produit-recettes/${recetteId}/lignes`).set('Authorization', `Bearer ${token}`)
    .send({ produitId: presure.id, quantite: 0.5 });

  return { recetteId, lait, presure, fromage };
}

describe('Transformation — ordres de transformation (étape 2)', () => {
  test('exécuter un ordre consomme les ingrédients (ratio appliqué) et produit un lot de sortie', async () => {
    const admin = await registerEntreprise();
    const { recetteId, lait, presure, fromage } = await creerRecetteFromage(admin.token);

    const ordre = await request(app).post('/api/ordres-transformation').set('Authorization', `Bearer ${admin.token}`)
      .send({ recetteId, quantiteProduite: 2 }); // ratio = 2 → 20 lait, 1 présure, 2 fromage
    expect(ordre.status).toBe(201);
    expect(ordre.body.ordre.quantiteProduite).toBe(2);
    expect(ordre.body.ordre.numeroLotSortie).toBe(`TR-${ordre.body.ordre.id}`);
    expect(ordre.body.ordre.lotSortieId).not.toBeNull();

    expect(await stockQuantite(admin.token, 'Poulailler', lait.id)).toBe(80); // 100 - 20
    expect(await stockQuantite(admin.token, 'Poulailler', presure.id)).toBe(4); // 5 - 1
    expect(await stockQuantite(admin.token, 'Poulailler', fromage.id)).toBe(2); // 0 + 2

    const lots = await request(app).get(`/api/produits/${fromage.id}/lots`).set('Authorization', `Bearer ${admin.token}`);
    const lotCree = lots.body.lots.find((l) => l.numeroLot === `TR-${ordre.body.ordre.id}`);
    expect(lotCree).toBeDefined();
    expect(lotCree.quantiteInitiale).toBe(2);
    expect(lotCree.quantiteRestante).toBe(2);

    const detail = await request(app).get(`/api/ordres-transformation/${ordre.body.ordre.id}`).set('Authorization', `Bearer ${admin.token}`);
    expect(detail.status).toBe(200);
    expect(detail.body.ordre.lignes).toHaveLength(2);
    const ligneLait = detail.body.ordre.lignes.find((l) => l.produitId === lait.id);
    expect(ligneLait.quantiteConsommee).toBe(20);

    // Régression : resoudreEmplacements (stockSync.js) doit connaître l'emplacement virtuel
    // « production », sinon stock_moves/stock_quants restent silencieusement vides pour ces
    // mouvements bien que produits.quantite (vérifié ci-dessus) soit correct.
    const { rows: movesLait } = await pool.query(
      `SELECT src.type AS "sourceType", dst.type AS "destType", m.state
       FROM stock_moves m JOIN emplacements_stock src ON src.id = m.emplacement_source_id
       JOIN emplacements_stock dst ON dst.id = m.emplacement_dest_id
       WHERE m.produit_id = $1 ORDER BY m.id DESC LIMIT 1`,
      [lait.id]
    );
    expect(movesLait[0]).toEqual({ sourceType: 'interne', destType: 'production', state: 'fait' });

    const { rows: movesFromage } = await pool.query(
      `SELECT src.type AS "sourceType", dst.type AS "destType", m.state
       FROM stock_moves m JOIN emplacements_stock src ON src.id = m.emplacement_source_id
       JOIN emplacements_stock dst ON dst.id = m.emplacement_dest_id
       WHERE m.produit_id = $1 ORDER BY m.id DESC LIMIT 1`,
      [fromage.id]
    );
    expect(movesFromage[0]).toEqual({ sourceType: 'production', destType: 'interne', state: 'fait' });

    const { rows: quantFromage } = await pool.query(
      `SELECT q.quantite::float8 AS quantite FROM stock_quants q
       JOIN emplacements_stock e ON e.id = q.emplacement_id
       WHERE q.produit_id = $1 AND e.type = 'interne'`,
      [fromage.id]
    );
    expect(quantFromage[0].quantite).toBe(2);
  });

  test('annuler un ordre (DELETE) restitue le stock et supprime le lot de sortie', async () => {
    const admin = await registerEntreprise();
    const { recetteId, lait, presure, fromage } = await creerRecetteFromage(admin.token);

    const ordre = await request(app).post('/api/ordres-transformation').set('Authorization', `Bearer ${admin.token}`)
      .send({ recetteId, quantiteProduite: 1 });
    const ordreId = ordre.body.ordre.id;
    const lotSortieId = ordre.body.ordre.lotSortieId;

    const del = await request(app).delete(`/api/ordres-transformation/${ordreId}`).set('Authorization', `Bearer ${admin.token}`);
    expect(del.status).toBe(200);

    expect(await stockQuantite(admin.token, 'Poulailler', lait.id)).toBe(100);
    expect(await stockQuantite(admin.token, 'Poulailler', presure.id)).toBe(5);
    expect(await stockQuantite(admin.token, 'Poulailler', fromage.id)).toBe(0);

    const lots = await request(app).get(`/api/produits/${fromage.id}/lots`).set('Authorization', `Bearer ${admin.token}`);
    expect(lots.body.lots.find((l) => l.id === lotSortieId)).toBeUndefined();

    const relire = await request(app).get(`/api/ordres-transformation/${ordreId}`).set('Authorization', `Bearer ${admin.token}`);
    expect(relire.status).toBe(404);
  });

  test('validations : recetteId/quantiteProduite manquants, recette hors entreprise, recette sans ingrédient → 400', async () => {
    const admin = await registerEntreprise();
    const autre = await registerEntreprise();
    const { recetteId } = await creerRecetteFromage(admin.token);

    const sansRien = await request(app).post('/api/ordres-transformation').set('Authorization', `Bearer ${admin.token}`).send({});
    expect(sansRien.status).toBe(400);

    const quantiteNulle = await request(app).post('/api/ordres-transformation').set('Authorization', `Bearer ${admin.token}`)
      .send({ recetteId, quantiteProduite: 0 });
    expect(quantiteNulle.status).toBe(400);

    const crossTenant = await request(app).post('/api/ordres-transformation').set('Authorization', `Bearer ${autre.token}`)
      .send({ recetteId, quantiteProduite: 1 });
    expect(crossTenant.status).toBe(400);

    const fromageVide = await createProduit(admin.token, { module: 'Poulailler', nom: `Vide ${Date.now()}` });
    const recetteVide = await request(app).post('/api/produit-recettes').set('Authorization', `Bearer ${admin.token}`)
      .send({ produitSortieId: fromageVide.id, nom: 'Recette vide' });
    const sansIngredient = await request(app).post('/api/ordres-transformation').set('Authorization', `Bearer ${admin.token}`)
      .send({ recetteId: recetteVide.body.recette.id, quantiteProduite: 1 });
    expect(sansIngredient.status).toBe(400);
  });

  test('un ouvrier ne peut pas exécuter/annuler un ordre, mais peut lire', async () => {
    const admin = await registerEntreprise();
    const ouvrier = await createEmployeeLogin(admin.token, 'ouvrier');
    await restreindreEcritures(admin.entrepriseId, ouvrier.email, ['ordres_transformation']);
    const { recetteId } = await creerRecetteFromage(admin.token);

    const create = await request(app).post('/api/ordres-transformation').set('Authorization', `Bearer ${ouvrier.token}`)
      .send({ recetteId, quantiteProduite: 1 });
    expect(create.status).toBe(403);

    const lire = await request(app).get('/api/ordres-transformation').set('Authorization', `Bearer ${ouvrier.token}`);
    expect(lire.status).toBe(200);
  });

  test('?module= filtre sur le module du produit de sortie ; isolation locataire', async () => {
    const admin = await registerEntreprise();
    const autre = await registerEntreprise();
    const { recetteId } = await creerRecetteFromage(admin.token);
    await request(app).post('/api/ordres-transformation').set('Authorization', `Bearer ${admin.token}`)
      .send({ recetteId, quantiteProduite: 1 });

    const filtreCultures = await request(app).get('/api/ordres-transformation?module=Cultures').set('Authorization', `Bearer ${admin.token}`);
    expect(filtreCultures.body.ordres).toHaveLength(0);

    const filtrePoulailler = await request(app).get('/api/ordres-transformation?module=Poulailler').set('Authorization', `Bearer ${admin.token}`);
    expect(filtrePoulailler.body.ordres.length).toBeGreaterThan(0);

    const autreEntreprise = await request(app).get('/api/ordres-transformation').set('Authorization', `Bearer ${autre.token}`);
    expect(autreEntreprise.body.ordres).toHaveLength(0);
  });
});
