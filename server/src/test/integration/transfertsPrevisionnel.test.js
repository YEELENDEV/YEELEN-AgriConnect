// Transferts entre emplacements et stock prévisionnel (2026-09-10) — chantier 6 de l'audit.
//
// Deux vérifications structurelles, plus importantes que les montants :
//   - un transfert ne change PAS la quantité détenue (produits.quantite) : c'est le seul
//     mouvement de l'application dans ce cas, tous les autres passent par mouvementStock qui
//     l'ajuste. Un jour où quelqu'un « unifiera » les chemins, ce test le rattrapera ;
//   - la résolution de l'emplacement interne ne dépend PAS de l'ordre des lignes : dès qu'une
//     entreprise a deux entrepôts, une réception d'achat doit atterrir dans celui marqué par
//     défaut, pas dans le premier venu. Ce défaut-là n'aurait levé aucune erreur.
import { app, pool, request, registerEntreprise, createProduit, createEmployeeLogin, restreindreEcritures } from './helpers.js';

afterAll(async () => { await pool.end(); });

const bearer = (t) => ({ Authorization: `Bearer ${t}` });

async function emplacements(token) {
  const res = await request(app).get('/api/emplacements-stock').set(bearer(token));
  return res.body.emplacements || [];
}

async function creerEmplacement(token, nom) {
  const res = await request(app).post('/api/emplacements-stock').set(bearer(token)).send({ nom });
  if (res.status !== 201) throw new Error(`création emplacement: ${res.status} ${JSON.stringify(res.body)}`);
  return res.body.emplacement;
}

async function quantiteProduit(token, module, produitId) {
  const res = await request(app).get(`/api/produits?module=${module}`).set(bearer(token));
  return res.body.stocks.find((p) => p.id === produitId).quantite;
}

async function quantsParEmplacement(token, module, produitId) {
  const res = await request(app).get(`/api/produits/stock-emplacements?module=${module}`).set(bearer(token));
  const parNom = {};
  for (const l of res.body.lignes || []) {
    if (l.produitId === produitId) parNom[l.emplacementNom] = l.quantite;
  }
  return parNom;
}

// Amène un produit à une quantité réelle ET des quants initialisés, en passant par le comptage
// d'inventaire — le seul chemin qui pose les quants (voir routes/produits.js).
async function approvisionner(token, produitId, quantite) {
  await request(app).put(`/api/produits/${produitId}`).set(bearer(token)).send({ quantite });
  await request(app).post('/api/produits/inventaire').set(bearer(token))
    .send({ produitId, quantiteComptee: quantite });
}

describe('Emplacements de stock — CRUD des internes', () => {
  test("l'emplacement interne seedé est marqué par défaut, les virtuels ne le sont pas", async () => {
    const admin = await registerEntreprise();
    const liste = await emplacements(admin.token);
    const internes = liste.filter((e) => e.type === 'interne');
    expect(internes).toHaveLength(1);
    expect(internes[0].parDefaut).toBe(true);
    expect(liste.filter((e) => e.parDefaut)).toHaveLength(1);
  });

  test('créer, renommer, désigner par défaut, supprimer', async () => {
    const admin = await registerEntreprise();
    const second = await creerEmplacement(admin.token, 'Silo Nord');
    expect(second.type).toBe('interne');
    expect(second.parDefaut).toBe(false);

    const renomme = await request(app).put(`/api/emplacements-stock/${second.id}`)
      .set(bearer(admin.token)).send({ nom: 'Silo Est' });
    expect(renomme.body.emplacement.nom).toBe('Silo Est');

    // Un seul défaut par entreprise, garanti par l'index unique partiel : désigner le nouveau
    // doit retirer l'ancien, pas échouer sur une contrainte.
    const promu = await request(app).put(`/api/emplacements-stock/${second.id}`)
      .set(bearer(admin.token)).send({ parDefaut: true });
    expect(promu.status).toBe(200);
    const apres = await emplacements(admin.token);
    expect(apres.filter((e) => e.parDefaut).map((e) => e.id)).toEqual([second.id]);

    // Il n'est plus supprimable tant qu'il est le défaut.
    const refus = await request(app).delete(`/api/emplacements-stock/${second.id}`).set(bearer(admin.token));
    expect(refus.status).toBe(400);

    const ancien = apres.find((e) => e.type === 'interne' && e.id !== second.id);
    const supprime = await request(app).delete(`/api/emplacements-stock/${ancien.id}`).set(bearer(admin.token));
    expect(supprime.status).toBe(200);
  });

  test('un emplacement virtuel ne se modifie ni ne se supprime', async () => {
    const admin = await registerEntreprise();
    const perte = (await emplacements(admin.token)).find((e) => e.type === 'perte');

    const modif = await request(app).put(`/api/emplacements-stock/${perte.id}`)
      .set(bearer(admin.token)).send({ nom: 'Poubelle' });
    expect(modif.status).toBe(400);
    const suppr = await request(app).delete(`/api/emplacements-stock/${perte.id}`).set(bearer(admin.token));
    expect(suppr.status).toBe(400);
  });

  test('un emplacement encore garni ne se supprime pas', async () => {
    const admin = await registerEntreprise();
    const produit = await createProduit(admin.token, { module: 'Cultures', nom: `Maïs ${Date.now()}` });
    await approvisionner(admin.token, produit.id, 100);
    const silo = await creerEmplacement(admin.token, 'Silo plein');
    await request(app).post('/api/produits/transferts').set(bearer(admin.token))
      .send({ produitId: produit.id, sourceId: (await emplacements(admin.token)).find((e) => e.parDefaut).id, destinationId: silo.id, quantite: 40 });

    const res = await request(app).delete(`/api/emplacements-stock/${silo.id}`).set(bearer(admin.token));
    // stock_quants cascade sur l'emplacement : supprimer ferait disparaître 40 unités en silence.
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/stock/i);
  });

  test('nom en doublon refusé, et écriture réservée à admin/directeur', async () => {
    const admin = await registerEntreprise();
    await creerEmplacement(admin.token, 'Silo unique');
    const doublon = await request(app).post('/api/emplacements-stock').set(bearer(admin.token)).send({ nom: 'Silo unique' });
    expect(doublon.status).toBe(409);

    const ouvrier = await createEmployeeLogin(admin.token, 'ouvrier');
    await restreindreEcritures(admin.entrepriseId, ouvrier.email, ['emplacements_stock']);
    const interdit = await request(app).post('/api/emplacements-stock').set(bearer(ouvrier.token)).send({ nom: 'Silo ouvrier' });
    expect(interdit.status).toBe(403);
    const lecture = await request(app).get('/api/emplacements-stock').set(bearer(ouvrier.token));
    expect(lecture.status).toBe(200);
  });
});

describe('Transfert entre emplacements', () => {
  test('déplace le stock sans changer la quantité détenue', async () => {
    const admin = await registerEntreprise();
    const produit = await createProduit(admin.token, { module: 'Cultures', nom: `Riz ${Date.now()}` });
    await approvisionner(admin.token, produit.id, 100);
    const defaut = (await emplacements(admin.token)).find((e) => e.parDefaut);
    const silo = await creerEmplacement(admin.token, 'Silo Sud');

    const res = await request(app).post('/api/produits/transferts').set(bearer(admin.token))
      .send({ produitId: produit.id, sourceId: defaut.id, destinationId: silo.id, quantite: 30, motif: 'Réorganisation' });
    expect(res.status).toBe(201);

    // LE test du chantier : la marchandise n'a pas quitté l'entreprise.
    expect(await quantiteProduit(admin.token, 'Cultures', produit.id)).toBe(100);
    const quants = await quantsParEmplacement(admin.token, 'Cultures', produit.id);
    expect(quants[defaut.nom]).toBe(70);
    expect(quants['Silo Sud']).toBe(30);

    const mvts = await request(app).get('/api/produits/mouvements?module=Cultures').set(bearer(admin.token));
    const transfert = mvts.body.mouvements.find((m) => m.documentType === 'transfert');
    expect(transfert.sourceNom).toBe(defaut.nom);
    expect(transfert.destNom).toBe('Silo Sud');
    expect(transfert.quantite).toBe(30);
  });

  test('refuse plus que le disponible de la source, pas du produit', async () => {
    const admin = await registerEntreprise();
    const produit = await createProduit(admin.token, { module: 'Cultures', nom: `Blé ${Date.now()}` });
    await approvisionner(admin.token, produit.id, 100);
    const defaut = (await emplacements(admin.token)).find((e) => e.parDefaut);
    const silo = await creerEmplacement(admin.token, 'Silo vide');

    // Le silo est vide alors que le produit a 100 en stock : c'est tout l'objet d'un stock par
    // emplacement, et un contrôle porté sur le produit entier laisserait passer ce transfert.
    const res = await request(app).post('/api/produits/transferts').set(bearer(admin.token))
      .send({ produitId: produit.id, sourceId: silo.id, destinationId: defaut.id, quantite: 10 });
    expect(res.status).toBe(400);
    expect(await quantiteProduit(admin.token, 'Cultures', produit.id)).toBe(100);
  });

  test('refuse un emplacement virtuel, une source égale à la destination, un produit étranger', async () => {
    const admin = await registerEntreprise();
    const autre = await registerEntreprise();
    const produit = await createProduit(admin.token, { module: 'Cultures', nom: `Mil ${Date.now()}` });
    await approvisionner(admin.token, produit.id, 50);
    const liste = await emplacements(admin.token);
    const defaut = liste.find((e) => e.parDefaut);
    const perte = liste.find((e) => e.type === 'perte');

    // Transférer vers « Pertes » contournerait le rebut, qui lui tient le total détenu.
    const versVirtuel = await request(app).post('/api/produits/transferts').set(bearer(admin.token))
      .send({ produitId: produit.id, sourceId: defaut.id, destinationId: perte.id, quantite: 5 });
    expect(versVirtuel.status).toBe(400);

    const surPlace = await request(app).post('/api/produits/transferts').set(bearer(admin.token))
      .send({ produitId: produit.id, sourceId: defaut.id, destinationId: defaut.id, quantite: 5 });
    expect(surPlace.status).toBe(400);

    const etranger = await request(app).post('/api/produits/transferts').set(bearer(autre.token))
      .send({ produitId: produit.id, sourceId: defaut.id, destinationId: defaut.id, quantite: 5 });
    expect(etranger.status).toBe(400);

    expect(await quantiteProduit(admin.token, 'Cultures', produit.id)).toBe(50);
  });

  test("une réception d'achat entre dans l'emplacement PAR DÉFAUT, pas dans le premier venu", async () => {
    const admin = await registerEntreprise();
    const produit = await createProduit(admin.token, { module: 'Cultures', nom: `Sorgho ${Date.now()}` });
    // Le nouvel emplacement est créé après, donc son id est plus grand : promu par défaut, il
    // doit tout de même l'emporter sur l'ancien. C'est la garantie que la résolution suit le
    // drapeau et non l'ordre des lignes.
    const silo = await creerEmplacement(admin.token, 'Entrepôt principal');
    await request(app).put(`/api/emplacements-stock/${silo.id}`).set(bearer(admin.token)).send({ parDefaut: true });

    const doc = await request(app).post('/api/achats').set(bearer(admin.token))
      .send({ module: 'Cultures', fournisseurNom: 'Semencier', date: '2026-09-10',
              lignes: [{ produit: produit.nom, stockId: produit.id, quantite: 25, prixUnitaire: 100 }] });
    expect(doc.status).toBe(201);
    await request(app).post(`/api/achats/${doc.body.document.id}/commander`).set(bearer(admin.token)).send({});
    await request(app).post(`/api/achats/${doc.body.document.id}/recevoir`).set(bearer(admin.token)).send({});

    const quants = await quantsParEmplacement(admin.token, 'Cultures', produit.id);
    expect(quants['Entrepôt principal']).toBe(25);
    expect(quants['Emplacement principal']).toBeUndefined();
  });
});

describe('Stock prévisionnel', () => {
  test('disponible + entrant commandé, réservé isolé', async () => {
    const admin = await registerEntreprise();
    const produit = await createProduit(admin.token, { module: 'Cultures', nom: `Arachide ${Date.now()}` });
    await approvisionner(admin.token, produit.id, 80);

    const doc = await request(app).post('/api/achats').set(bearer(admin.token))
      .send({ module: 'Cultures', fournisseurNom: 'Semencier', date: '2026-09-10',
              lignes: [{ produit: produit.nom, stockId: produit.id, quantite: 40, prixUnitaire: 100 }] });
    await request(app).post(`/api/achats/${doc.body.document.id}/commander`).set(bearer(admin.token)).send({});

    const res = await request(app).get('/api/produits/previsionnel?module=Cultures').set(bearer(admin.token));
    expect(res.status).toBe(200);
    const ligne = res.body.lignes.find((l) => l.produitId === produit.id);
    expect(ligne.disponible).toBe(80);
    expect(ligne.entrant).toBe(40);
    expect(ligne.previsionnel).toBe(120);
    expect(res.body.commandesPartielles).toBe(0);
  });

  test('une commande reçue ne compte plus comme entrante', async () => {
    const admin = await registerEntreprise();
    const produit = await createProduit(admin.token, { module: 'Cultures', nom: `Niébé ${Date.now()}` });
    await approvisionner(admin.token, produit.id, 10);
    const doc = await request(app).post('/api/achats').set(bearer(admin.token))
      .send({ module: 'Cultures', fournisseurNom: 'Semencier', date: '2026-09-10',
              lignes: [{ produit: produit.nom, stockId: produit.id, quantite: 15, prixUnitaire: 100 }] });
    await request(app).post(`/api/achats/${doc.body.document.id}/commander`).set(bearer(admin.token)).send({});
    await request(app).post(`/api/achats/${doc.body.document.id}/recevoir`).set(bearer(admin.token)).send({});

    const res = await request(app).get('/api/produits/previsionnel?module=Cultures').set(bearer(admin.token));
    const ligne = res.body.lignes.find((l) => l.produitId === produit.id);
    // La marchandise est arrivée : elle est dans le disponible, plus dans l'entrant. La compter
    // deux fois est l'erreur classique d'un prévisionnel.
    expect(ligne.entrant).toBe(0);
    expect(ligne.disponible).toBe(25);
    expect(ligne.previsionnel).toBe(25);
  });

  test('une commande partiellement reçue est comptée à part, jamais dans le chiffre', async () => {
    const admin = await registerEntreprise();
    const produit = await createProduit(admin.token, { module: 'Cultures', nom: `Fonio ${Date.now()}` });
    await approvisionner(admin.token, produit.id, 5);
    const doc = await request(app).post('/api/achats').set(bearer(admin.token))
      .send({ module: 'Cultures', fournisseurNom: 'Semencier', date: '2026-09-10',
              lignes: [{ produit: produit.nom, stockId: produit.id, quantite: 100, prixUnitaire: 100 }] });
    await request(app).post(`/api/achats/${doc.body.document.id}/commander`).set(bearer(admin.token)).send({});
    await request(app).post(`/api/achats/${doc.body.document.id}/reception-partielle`).set(bearer(admin.token)).send({});

    const res = await request(app).get('/api/produits/previsionnel?module=Cultures').set(bearer(admin.token));
    const ligne = res.body.lignes.find((l) => l.produitId === produit.id);
    // Le modèle ne stocke pas les quantités reçues ligne à ligne : compter 100 gonflerait le
    // prévisionnel, l'exclure le sous-estime. On l'exclut du chiffre et on le signale à côté.
    expect(ligne.entrant).toBe(0);
    expect(res.body.commandesPartielles).toBe(1);
  });

  test('module invalide refusé, isolation entre entreprises', async () => {
    const admin = await registerEntreprise();
    const autre = await registerEntreprise();
    const produit = await createProduit(admin.token, { module: 'Cultures', nom: `Manioc ${Date.now()}` });
    await approvisionner(admin.token, produit.id, 60);

    const invalide = await request(app).get('/api/produits/previsionnel?module=Chevres').set(bearer(admin.token));
    expect(invalide.status).toBe(400);

    const res = await request(app).get('/api/produits/previsionnel?module=Cultures').set(bearer(autre.token));
    expect(res.body.lignes.find((l) => l.produitId === produit.id)).toBeUndefined();
  });
});
