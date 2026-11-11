// Transformation agroalimentaire, étape 1 : recettes de transformation. CRUD recette + lignes,
// validation cross-entreprise, isolation locataire. Pas de test de consommation de stock —
// hors périmètre de cette étape (voir CLAUDE.md / docs/journal.md, étape 2 différée).
import { request, app, registerEntreprise, createProduit, createEmployeeLogin, restreindreEcritures } from './helpers.js';

describe('Transformation — recettes (étape 1)', () => {
  test('CRUD complet : créer une recette, ajouter/supprimer des lignes, supprimer la recette', async () => {
    const admin = await registerEntreprise();
    const lait = await createProduit(admin.token, { module: 'Poulailler', nom: 'Lait cru' });
    const presure = await createProduit(admin.token, { module: 'Poulailler', nom: 'Présure' });
    const fromage = await createProduit(admin.token, { module: 'Poulailler', nom: 'Fromage frais' });

    const create = await request(app)
      .post('/api/produit-recettes')
      .set('Authorization', `Bearer ${admin.token}`)
      .send({ produitSortieId: fromage.id, nom: 'Fromage frais - recette standard', quantiteProduite: 1 });
    expect(create.status).toBe(201);
    expect(create.body.recette.produitSortieId).toBe(fromage.id);
    expect(create.body.recette.nombreLignes).toBe(0);
    const recetteId = create.body.recette.id;

    const ligne1 = await request(app)
      .post(`/api/produit-recettes/${recetteId}/lignes`)
      .set('Authorization', `Bearer ${admin.token}`)
      .send({ produitId: lait.id, quantite: 10 });
    expect(ligne1.status).toBe(201);
    expect(ligne1.body.ligne.produitId).toBe(lait.id);
    expect(ligne1.body.ligne.quantite).toBe(10);

    const ligne2 = await request(app)
      .post(`/api/produit-recettes/${recetteId}/lignes`)
      .set('Authorization', `Bearer ${admin.token}`)
      .send({ produitId: presure.id, quantite: 0.05, notes: 'quelques gouttes' });
    expect(ligne2.status).toBe(201);

    const liste = await request(app)
      .get('/api/produit-recettes?module=Poulailler')
      .set('Authorization', `Bearer ${admin.token}`);
    expect(liste.status).toBe(200);
    const recette = liste.body.recettes.find((r) => r.id === recetteId);
    expect(recette.nombreLignes).toBe(2);

    const lignes = await request(app)
      .get(`/api/produit-recettes/${recetteId}/lignes`)
      .set('Authorization', `Bearer ${admin.token}`);
    expect(lignes.status).toBe(200);
    expect(lignes.body.lignes).toHaveLength(2);

    const delLigne = await request(app)
      .delete(`/api/produit-recettes/lignes/${ligne2.body.ligne.id}`)
      .set('Authorization', `Bearer ${admin.token}`);
    expect(delLigne.status).toBe(200);

    const delRecette = await request(app)
      .delete(`/api/produit-recettes/${recetteId}`)
      .set('Authorization', `Bearer ${admin.token}`);
    expect(delRecette.status).toBe(200);

    const relire = await request(app)
      .get(`/api/produit-recettes/${recetteId}/lignes`)
      .set('Authorization', `Bearer ${admin.token}`);
    expect(relire.status).toBe(404);
  });

  test('produitSortieId manquant ou hors entreprise → 400', async () => {
    const admin = await registerEntreprise();
    const autre = await registerEntreprise();
    const produitAutre = await createProduit(autre.token, { module: 'Cultures', nom: 'Blé' });

    const sansProduit = await request(app)
      .post('/api/produit-recettes')
      .set('Authorization', `Bearer ${admin.token}`)
      .send({ nom: 'Recette sans produit' });
    expect(sansProduit.status).toBe(400);

    const crossTenant = await request(app)
      .post('/api/produit-recettes')
      .set('Authorization', `Bearer ${admin.token}`)
      .send({ produitSortieId: produitAutre.id, nom: 'Recette invalide' });
    expect(crossTenant.status).toBe(400);
  });

  test('ajouter une ligne avec un produit hors entreprise → 400 ; recette/ligne inexistante → 404', async () => {
    const admin = await registerEntreprise();
    const autre = await registerEntreprise();
    const produitAutre = await createProduit(autre.token, { module: 'Cultures', nom: 'Maïs' });
    const fini = await createProduit(admin.token, { module: 'Cultures', nom: 'Farine de maïs' });

    const create = await request(app)
      .post('/api/produit-recettes')
      .set('Authorization', `Bearer ${admin.token}`)
      .send({ produitSortieId: fini.id, nom: 'Farine' });
    const recetteId = create.body.recette.id;

    const ligneCrossTenant = await request(app)
      .post(`/api/produit-recettes/${recetteId}/lignes`)
      .set('Authorization', `Bearer ${admin.token}`)
      .send({ produitId: produitAutre.id, quantite: 5 });
    expect(ligneCrossTenant.status).toBe(400);

    const ligneRecetteInexistante = await request(app)
      .post('/api/produit-recettes/999999/lignes')
      .set('Authorization', `Bearer ${admin.token}`)
      .send({ produitId: fini.id, quantite: 5 });
    expect(ligneRecetteInexistante.status).toBe(404);

    const suppressionLigneInexistante = await request(app)
      .delete('/api/produit-recettes/lignes/999999')
      .set('Authorization', `Bearer ${admin.token}`);
    expect(suppressionLigneInexistante.status).toBe(404);

    const suppressionRecetteAutre = await request(app)
      .delete(`/api/produit-recettes/${recetteId}`)
      .set('Authorization', `Bearer ${autre.token}`);
    expect(suppressionRecetteAutre.status).toBe(404);
  });

  test('un ouvrier (rôle non admin/directeur) ne peut pas écrire, mais peut lire', async () => {
    const admin = await registerEntreprise();
    const ouvrier = await createEmployeeLogin(admin.token, 'ouvrier');
    await restreindreEcritures(admin.entrepriseId, ouvrier.email, ['recettes']);
    const fini = await createProduit(admin.token, { module: 'Cultures', nom: 'Confiture' });

    const create = await request(app)
      .post('/api/produit-recettes')
      .set('Authorization', `Bearer ${ouvrier.token}`)
      .send({ produitSortieId: fini.id, nom: 'Confiture de fraises' });
    expect(create.status).toBe(403);

    const lire = await request(app)
      .get('/api/produit-recettes')
      .set('Authorization', `Bearer ${ouvrier.token}`);
    expect(lire.status).toBe(200);
  });

  test('isolation locataire : une entreprise ne voit pas les recettes d\'une autre', async () => {
    const admin = await registerEntreprise();
    const autre = await registerEntreprise();
    const fini = await createProduit(admin.token, { module: 'Poulailler', nom: 'Oeufs en poudre' });
    await request(app)
      .post('/api/produit-recettes')
      .set('Authorization', `Bearer ${admin.token}`)
      .send({ produitSortieId: fini.id, nom: 'Séchage oeufs' });

    const liste = await request(app)
      .get('/api/produit-recettes')
      .set('Authorization', `Bearer ${autre.token}`);
    expect(liste.status).toBe(200);
    expect(liste.body.recettes).toHaveLength(0);
  });
});
