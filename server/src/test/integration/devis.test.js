import { app, pool, request, registerEntreprise, createClient, createEmployeeLogin, createProduit, restreindreEcritures } from './helpers.js';

afterAll(async () => { await pool.end(); });

const bearer = (t) => ({ Authorization: `Bearer ${t}` });

describe('Devis — cycle de vie complet + journal d\'audit', () => {
  let admin;
  let clientId;

  beforeAll(async () => {
    admin = await registerEntreprise();
    clientId = await createClient(admin.token);
  });

  test('brouillon → validé manuellement → facturé échelonné → paiement échéance → remise en brouillon', async () => {
    // Création
    const create = await request(app)
      .post('/api/devis')
      .set(bearer(admin.token))
      .send({ clientId, lignes: [{ produit: 'Maïs', quantite: 2, prixUnitaire: 1000, type: 'produit' }] });
    expect(create.status).toBe(201);
    const devis = create.body.devis;
    expect(devis.statut).toBe('Brouillon');
    expect(devis.total).toBe(2000);
    const devisId = devis.id;
    const ligneId = devis.lignes[0].id;

    // Validation manuelle → Signé
    const valider = await request(app)
      .post(`/api/devis/${devisId}/valider-manuel`)
      .set(bearer(admin.token))
      .send({ confirmePar: 'M. Diallo' });
    expect(valider.status).toBe(200);
    expect(valider.body.devis.statut).toBe('Signé');

    // Facturation échelonnée (2 échéances de 1000)
    const facturer = await request(app)
      .post(`/api/devis/${devisId}/facturer`)
      .set(bearer(admin.token))
      .send({
        modePaiement: 'Espèces',
        modalitePaiement: 'echelonne',
        echeances: [
          { montant: 1000, dateEcheance: '2026-09-15' },
          { montant: 1000, dateEcheance: '2026-10-15' },
        ],
      });
    expect(facturer.status).toBe(200);
    expect(facturer.body.devis.statut).toBe('Non payé');
    expect(facturer.body.devis.echeances).toHaveLength(2);
    const echeanceId = facturer.body.devis.echeances[0].id;

    // Paiement de la 1re échéance → Payé partiellement
    const payer = await request(app)
      .post(`/api/devis/${devisId}/echeances/${echeanceId}/payer`)
      .set(bearer(admin.token))
      .send({});
    expect(payer.status).toBe(200);
    expect(payer.body.devis.statut).toBe('Payé partiellement');

    // Suivi manuel des quantités
    const quantites = await request(app)
      .patch(`/api/devis/${devisId}/lignes-quantites`)
      .set(bearer(admin.token))
      .send({ lignes: [{ id: ligneId, quantiteLivree: 2, quantiteFacturee: 2 }] });
    expect(quantites.status).toBe(200);

    // Remise en brouillon → tout est réinitialisé
    const remise = await request(app)
      .post(`/api/devis/${devisId}/remettre-brouillon`)
      .set(bearer(admin.token))
      .send({});
    expect(remise.status).toBe(200);
    expect(remise.body.devis.statut).toBe('Brouillon');
    expect(remise.body.devis.echeances).toHaveLength(0);

    // --- Journal d'audit : chaque transition financière a laissé une trace ---
    const audit = await request(app).get('/api/auth/audit-log').set(bearer(admin.token));
    expect(audit.status).toBe(200);
    const rows = audit.body.historique;
    const forDevis = (action) =>
      rows.find((r) => r.action === action && r.details && r.details.devisId === devisId);

    expect(forDevis('devis_valide_manuel')).toMatchObject({ details: { confirmePar: 'M. Diallo' } });
    expect(forDevis('devis_facture')).toMatchObject({
      details: { modalitePaiement: 'echelonne', nbEcheances: 2, total: 2000 },
    });
    expect(forDevis('devis_echeance_payee')).toMatchObject({
      details: { echeanceId, montant: 1000, nouveauStatut: 'Payé partiellement' },
    });
    expect(forDevis('devis_quantites_ajustees')).toMatchObject({ details: { nbLignes: 1 } });
    expect(forDevis('devis_remis_brouillon')).toMatchObject({
      details: { statutAvant: 'Payé partiellement' },
    });

    // La ligne d'audit porte l'admin acteur (email) et l'IP de la requête.
    const sample = forDevis('devis_facture');
    expect(sample.email).toBe(admin.email.toLowerCase());
    expect(sample.ipAddress).toBeTruthy();
  });

  test('annulation d\'un devis non signé → statut Annulé + audit', async () => {
    const create = await request(app)
      .post('/api/devis')
      .set(bearer(admin.token))
      .send({ clientId, lignes: [{ produit: 'Riz', quantite: 1, prixUnitaire: 500, type: 'produit' }] });
    const devisId = create.body.devis.id;

    const annuler = await request(app).post(`/api/devis/${devisId}/annuler`).set(bearer(admin.token)).send({});
    expect(annuler.status).toBe(200);
    expect(annuler.body.devis.statut).toBe('Annulé');

    const audit = await request(app).get('/api/auth/audit-log').set(bearer(admin.token));
    const row = audit.body.historique.find(
      (r) => r.action === 'devis_annule' && r.details && r.details.devisId === devisId
    );
    expect(row).toMatchObject({ details: { statutAvant: 'Brouillon' } });
  });

  test('les routes de workflow financier sont réservées à admin (ouvrier → 403)', async () => {
    const create = await request(app)
      .post('/api/devis')
      .set(bearer(admin.token))
      .send({ clientId, lignes: [{ produit: 'X', quantite: 1, prixUnitaire: 100, type: 'produit' }] });
    const devisId = create.body.devis.id;

    const ouvrier = await createEmployeeLogin(admin.token, 'ouvrier');
    await restreindreEcritures(admin.entrepriseId, ouvrier.email, ['devis']);

    const res = await request(app)
      .post(`/api/devis/${devisId}/valider-manuel`)
      .set(bearer(ouvrier.token))
      .send({ confirmePar: 'x' });
    expect(res.status).toBe(403);
  });
});

describe('Devis — Étape 0 Comptabilité (validité, suppression Annulé, conditions de paiement)', () => {
  let admin;
  let clientId;
  const bear = (t) => ({ Authorization: `Bearer ${t}` });

  beforeAll(async () => {
    admin = await registerEntreprise();
    clientId = await createClient(admin.token);
  });

  const creerDevis = async (prixUnitaire = 1000, quantite = 10) => {
    const r = await request(app).post('/api/devis').set(bear(admin.token))
      .send({ clientId, lignes: [{ produit: 'Maïs', quantite, prixUnitaire, type: 'produit' }] });
    return r.body.devis;
  };
  const signer = async (id) => {
    await request(app).post(`/api/devis/${id}/valider-manuel`).set(bear(admin.token)).send({ confirmePar: 'M. Test' });
  };
  const termeId = async (nom) => {
    const terms = (await request(app).get('/api/payment-terms').set(bear(admin.token))).body.paymentTerms;
    return terms.find((t) => t.name === nom).id;
  };

  test('validity_date : défaut = date + 30 j ; PUT la modifie ; expired calculé', async () => {
    const d = await creerDevis();
    expect(d.validityDate).toBeTruthy();
    expect(d.expired).toBe(false);

    const put = await request(app).put(`/api/devis/${d.id}`).set(bear(admin.token))
      .send({ validityDate: '2020-01-01' });
    expect(put.status).toBe(200);
    expect(put.body.devis.validityDate.slice(0, 10)).toBe('2020-01-01');
    expect(put.body.devis.expired).toBe(true); // Brouillon + date passée

    // une fois signé, plus considéré comme expiré même si la date est passée
    await signer(d.id);
    const relu = (await request(app).get(`/api/devis/${d.id}`).set(bear(admin.token))).body.devis;
    expect(relu.expired).toBe(false);
  });

  test('un devis Annulé peut être supprimé (Odoo : draft OR cancel)', async () => {
    const d = await creerDevis(200, 1);
    await request(app).post(`/api/devis/${d.id}/annuler`).set(bear(admin.token)).send({});
    const del = await request(app).delete(`/api/devis/${d.id}`).set(bear(admin.token));
    expect(del.status).toBe(200);
    expect((await request(app).get(`/api/devis/${d.id}`).set(bear(admin.token))).status).toBe(404);
  });

  test('un devis Signé ne peut toujours pas être supprimé', async () => {
    const d = await creerDevis(200, 1);
    await signer(d.id);
    expect((await request(app).delete(`/api/devis/${d.id}`).set(bear(admin.token))).status).toBe(400);
  });

  test('facturer avec paymentTermId « 30 jours » → 1 échéance à J+30, statut Non payé', async () => {
    const d = await creerDevis(); // total 10000
    await signer(d.id);
    const res = await request(app).post(`/api/devis/${d.id}/facturer`).set(bear(admin.token))
      .send({ modePaiement: 'Banque', paymentTermId: await termeId('30 jours') });
    expect(res.status).toBe(200);
    expect(res.body.devis.statut).toBe('Non payé');
    expect(res.body.devis.paymentTermId).toBeTruthy();
    expect(res.body.devis.echeances).toHaveLength(1);
    expect(res.body.devis.echeances[0].montant).toBe(10000);
    const dans30j = new Date(); dans30j.setDate(dans30j.getDate() + 30);
    expect(res.body.devis.echeances[0].dateEcheance.slice(0, 10)).toBe(dans30j.toISOString().slice(0, 10));
  });

  test('facturer avec « Paiement immédiat » → traité comme complet (échéance déjà payée)', async () => {
    const d = await creerDevis(500, 2); // total 1000
    await signer(d.id);
    const res = await request(app).post(`/api/devis/${d.id}/facturer`).set(bear(admin.token))
      .send({ modePaiement: 'Espèces', paymentTermId: await termeId('Paiement immédiat') });
    expect(res.status).toBe(200);
    expect(res.body.devis.statut).toBe('Facturé');
    expect(res.body.devis.echeances[0].statut).toBe('Payé');
  });

  test('facturer avec acompte 30 % + terme « 30 jours » → 2 échéances (3000 aujourd\'hui, 7000 à J+30)', async () => {
    const d = await creerDevis(); // total 10000
    await signer(d.id);
    const res = await request(app).post(`/api/devis/${d.id}/facturer`).set(bear(admin.token))
      .send({ modePaiement: 'Banque', paymentTermId: await termeId('30 jours'), acompte: { method: 'percentage', value: 30 } });
    expect(res.status).toBe(200);
    expect(res.body.devis.echeances).toHaveLength(2);
    const montants = res.body.devis.echeances.map((e) => e.montant).sort((a, b) => a - b);
    expect(montants).toEqual([3000, 7000]);
  });

  test('facturer avec un paymentTermId d\'une autre entreprise → 400', async () => {
    const autre = await registerEntreprise();
    const termeAutre = await (async () => {
      const terms = (await request(app).get('/api/payment-terms').set(bear(autre.token))).body.paymentTerms;
      return terms[0].id;
    })();
    const d = await creerDevis(200, 1);
    await signer(d.id);
    const res = await request(app).post(`/api/devis/${d.id}/facturer`).set(bear(admin.token))
      .send({ modePaiement: 'Banque', paymentTermId: termeAutre });
    expect(res.status).toBe(400);
  });
});

describe('Devis — Étape 1 Comptabilité (taxes account.tax-like)', () => {
  let admin;
  let clientId;
  const bear = (t) => ({ Authorization: `Bearer ${t}` });

  beforeAll(async () => {
    admin = await registerEntreprise();
    clientId = await createClient(admin.token);
  });

  const creerTaxe = async (payload, token = admin.token) =>
    (await request(app).post('/api/taxes').set(bear(token)).send(payload)).body.tax;

  const devisAvecLigne = async (ligne, remiseGlobale) => {
    const r = await request(app).post('/api/devis').set(bear(admin.token))
      .send({ clientId, remiseGlobale, lignes: [{ produit: 'Maïs', type: 'produit', ...ligne }] });
    return r.body.devis;
  };

  test('taxe percent : total = HT + HT * taux / 100, taxIds renvoyés, référentiel taxes joint', async () => {
    const tva = await creerTaxe({ name: 'TVA 20 %', amount: 20, amountType: 'percent' });
    const d = await devisAvecLigne({ quantite: 10, prixUnitaire: 1000, taxIds: [tva.id] });
    expect(d.total).toBeCloseTo(12000, 2);
    expect(d.lignes[0].taxIds).toEqual([tva.id]);
    expect(d.taxes.map((t) => t.id)).toContain(tva.id);
  });

  test('taxe price_include (percent) : la base est extraite du prix TTC', async () => {
    const tvaInc = await creerTaxe({ name: 'TVA 20 % incluse', amount: 20, amountType: 'percent', priceInclude: true });
    const d = await devisAvecLigne({ quantite: 1, prixUnitaire: 120, taxIds: [tvaInc.id] });
    // base HT = 100, taxe = 20 → total (TTC) = 120, inchangé
    expect(d.total).toBeCloseTo(120, 2);
  });

  test('taxe fixed : montant = amount * quantité', async () => {
    const eco = await creerTaxe({ name: 'Éco-contribution', amount: 5, amountType: 'fixed' });
    const d = await devisAvecLigne({ quantite: 3, prixUnitaire: 100, taxIds: [eco.id] });
    expect(d.total).toBeCloseTo(315, 2); // 300 HT + 5*3
  });

  test('deux taxes percent sur une ligne : chacune sur la base', async () => {
    const a = await creerTaxe({ name: 'Taxe A 10 %', amount: 10, amountType: 'percent' });
    const b = await creerTaxe({ name: 'Taxe B 5 %', amount: 5, amountType: 'percent' });
    const d = await devisAvecLigne({ quantite: 1, prixUnitaire: 1000, taxIds: [a.id, b.id] });
    expect(d.total).toBeCloseTo(1150, 2); // 1000 + 100 + 50
  });

  test('include_base_amount : la 2e taxe porte sur base + 1re taxe (cascade)', async () => {
    const a = await creerTaxe({ name: 'Cascade A 10 %', amount: 10, amountType: 'percent', includeBaseAmount: true, sequence: 1 });
    const b = await creerTaxe({ name: 'Cascade B 5 %', amount: 5, amountType: 'percent', sequence: 2 });
    const d = await devisAvecLigne({ quantite: 1, prixUnitaire: 1000, taxIds: [a.id, b.id] });
    // A = 100 → base 1100 ; B = 55 → total 1000 + 155
    expect(d.total).toBeCloseTo(1155, 2);
  });

  test('remise globale appliquée avant la taxe', async () => {
    const tva = await creerTaxe({ name: 'TVA 20 % remise', amount: 20, amountType: 'percent' });
    const d = await devisAvecLigne({ quantite: 10, prixUnitaire: 1000, taxIds: [tva.id] }, 10);
    // HT 10000 - 10% = 9000 ; taxe 1800 → 10800
    expect(d.total).toBeCloseTo(10800, 2);
  });

  test('un taxId d\'une autre entreprise est ignoré silencieusement (total = HT)', async () => {
    const autre = await registerEntreprise();
    const taxeAutre = await creerTaxe({ name: `Autre ${Date.now()}`, amount: 50, amountType: 'percent' }, autre.token);
    const d = await devisAvecLigne({ quantite: 1, prixUnitaire: 1000, taxIds: [taxeAutre.id] });
    expect(d.total).toBeCloseTo(1000, 2);
    expect(d.lignes[0].taxIds).toEqual([]);
  });

  test('PUT recalcule le total à partir des taxIds mis à jour', async () => {
    const tva = await creerTaxe({ name: 'TVA PUT 20 %', amount: 20, amountType: 'percent' });
    const d = await devisAvecLigne({ quantite: 1, prixUnitaire: 1000 });
    expect(d.total).toBeCloseTo(1000, 2);
    const put = await request(app).put(`/api/devis/${d.id}`).set(bear(admin.token))
      .send({ lignes: [{ produit: 'Maïs', type: 'produit', quantite: 1, prixUnitaire: 1000, taxIds: [tva.id] }] });
    expect(put.status).toBe(200);
    expect(put.body.devis.total).toBeCloseTo(1200, 2);
    expect(put.body.devis.lignes[0].taxIds).toEqual([tva.id]);
  });
});

describe('Devis — Étape 3b : facturer produit une facture comptable (account.move)', () => {
  let admin;
  let clientId;
  const bear = (t) => ({ Authorization: `Bearer ${t}` });

  beforeAll(async () => {
    admin = await registerEntreprise();
    clientId = await createClient(admin.token);
  });

  const devisSigne = async (prixUnitaire = 1000, quantite = 10) => {
    const r = await request(app).post('/api/devis').set(bear(admin.token))
      .send({ clientId, lignes: [{ produit: 'Maïs', quantite, prixUnitaire, type: 'produit' }] });
    await request(app).post(`/api/devis/${r.body.devis.id}/valider-manuel`).set(bear(admin.token)).send({ confirmePar: 'M. Test' });
    return r.body.devis;
  };
  const termeId = async (nom) => {
    const terms = (await request(app).get('/api/payment-terms').set(bear(admin.token))).body.paymentTerms;
    return terms.find((t) => t.name === nom).id;
  };

  test('facturer (paiement complet) → devis.move lié, posté, équilibré, soldé', async () => {
    const d = await devisSigne(500, 2); // total 1000
    const res = await request(app).post(`/api/devis/${d.id}/facturer`).set(bear(admin.token))
      .send({ modePaiement: 'Espèces', modalitePaiement: 'complet' });
    expect(res.status).toBe(200);
    expect(res.body.devis.statut).toBe('Facturé');
    expect(res.body.devis.move).toBeTruthy();
    expect(res.body.devis.move.name).toMatch(/^FAC\/\d{4}\/\d{4}$/);
    expect(res.body.devis.move.state).toBe('posted');
    expect(res.body.devis.move.paymentState).toBe('paid');
    expect(res.body.devis.move.amountResidual).toBeCloseTo(0, 2);

    // la facture est consultable via /api/factures et son écriture est équilibrée
    const f = (await request(app).get(`/api/factures/${res.body.devis.move.id}`).set(bear(admin.token))).body.facture;
    const dd = f.lignes.reduce((s, l) => s + l.debit, 0);
    const cc = f.lignes.reduce((s, l) => s + l.credit, 0);
    expect(dd).toBeCloseTo(cc, 2);
    expect(f.invoiceOrigin).toBe(d.numero);
    // paiement complet → échéance du jour ⇒ invoice_date_due = aujourd'hui (pas un J+30 fictif)
    const auj = new Date().toISOString().slice(0, 10);
    expect(f.invoiceDateDue).toBe(auj);
    expect(f.invoiceDate).toBe(auj);
  });

  test('facturer échelonné (terme 30 jours + acompte) → move non soldé, 2 échéances partagées', async () => {
    const d = await devisSigne(); // total 10000
    const res = await request(app).post(`/api/devis/${d.id}/facturer`).set(bear(admin.token))
      .send({ modePaiement: 'Banque', paymentTermId: await termeId('30 jours'), acompte: { method: 'percentage', value: 30 } });
    expect(res.status).toBe(200);
    expect(res.body.devis.move.paymentState).toBe('not_paid');
    expect(res.body.devis.move.amountResidual).toBeCloseTo(10000, 2);
    expect(res.body.devis.echeances).toHaveLength(2);

    // payer la 1re échéance → devis "Payé partiellement" ET move "partial"
    const eid = res.body.devis.echeances[0].id;
    const payer = await request(app).post(`/api/devis/${d.id}/echeances/${eid}/payer`).set(bear(admin.token)).send({});
    expect(payer.status).toBe(200);
    expect(payer.body.devis.statut).toBe('Payé partiellement');
    expect(payer.body.devis.move.paymentState).toBe('partial');
    expect(payer.body.devis.move.amountResidual).toBeCloseTo(7000, 2);
  });

  test('remettre-brouillon défait aussi la facture comptable', async () => {
    const d = await devisSigne(200, 1);
    const fac = await request(app).post(`/api/devis/${d.id}/facturer`).set(bear(admin.token))
      .send({ modePaiement: 'Espèces', modalitePaiement: 'complet' });
    const moveId = fac.body.devis.move.id;
    expect((await request(app).get(`/api/factures/${moveId}`).set(bear(admin.token))).status).toBe(200);

    const remise = await request(app).post(`/api/devis/${d.id}/remettre-brouillon`).set(bear(admin.token)).send({});
    expect(remise.status).toBe(200);
    expect(remise.body.devis.statut).toBe('Brouillon');
    expect(remise.body.devis.move).toBeNull();
    expect((await request(app).get(`/api/factures/${moveId}`).set(bear(admin.token))).status).toBe(404);
  });
});

// Option A / modèle Odoo : un devis signé mais pas encore facturé reste éditable
// (ajout d'articles), avec réajustement du stock réservé. Dès "Facturé", verrouillé.
describe('Devis — modification des lignes après signature', () => {
  let admin;
  let clientId;
  const bear = (t) => ({ Authorization: `Bearer ${t}` });

  beforeAll(async () => {
    admin = await registerEntreprise();
    clientId = await createClient(admin.token);
  });

  const stockDe = async (produitId) => {
    const { rows } = await pool.query('SELECT quantite::float8 AS q FROM produits WHERE id = $1', [produitId]);
    return rows[0].q;
  };
  const signer = async (id) =>
    request(app).post(`/api/devis/${id}/valider-manuel`).set(bear(admin.token)).send({ confirmePar: 'M. Test' });

  test('ajout d\'un article sur un devis signé → 200, total recalculé, statut inchangé', async () => {
    const create = await request(app).post('/api/devis').set(bear(admin.token))
      .send({ clientId, lignes: [{ produit: 'Maïs', quantite: 10, prixUnitaire: 1000, type: 'produit' }] });
    const devisId = create.body.devis.id;
    expect(create.body.devis.total).toBe(10000);
    await signer(devisId);

    const put = await request(app).put(`/api/devis/${devisId}`).set(bear(admin.token)).send({
      clientId,
      lignes: [
        { produit: 'Maïs', quantite: 10, prixUnitaire: 1000, type: 'produit' },
        { produit: 'Engrais NPK', quantite: 5, prixUnitaire: 200, type: 'produit' },
      ],
    });
    expect(put.status).toBe(200);
    expect(put.body.devis.statut).toBe('Signé');
    expect(put.body.devis.lignes.filter((l) => l.type !== 'section')).toHaveLength(2);
    expect(put.body.devis.total).toBe(11000);
  });

  test('le stock réservé est réajusté quand on change la quantité d\'une ligne cataloguée', async () => {
    const produit = await createProduit(admin.token, { module: 'Cultures', nom: `Semence ${Date.now()}` });
    await pool.query('UPDATE produits SET quantite = 100 WHERE id = $1', [produit.id]);

    const create = await request(app).post('/api/devis').set(bear(admin.token)).send({
      clientId,
      lignes: [{ produit: produit.nom, quantite: 10, prixUnitaire: 50, type: 'produit', stockId: produit.id, stockModule: 'Cultures' }],
    });
    const devisId = create.body.devis.id;
    await signer(devisId);
    expect(await stockDe(produit.id)).toBe(90); // réservé à la signature

    const put = await request(app).put(`/api/devis/${devisId}`).set(bear(admin.token)).send({
      clientId,
      lignes: [{ produit: produit.nom, quantite: 4, prixUnitaire: 50, type: 'produit', stockId: produit.id, stockModule: 'Cultures' }],
    });
    expect(put.status).toBe(200);
    expect(await stockDe(produit.id)).toBe(96); // ancien +10 restitué, nouveau -4 appliqué
  });

  test('modification des lignes refusée une fois le devis facturé (400)', async () => {
    const create = await request(app).post('/api/devis').set(bear(admin.token))
      .send({ clientId, lignes: [{ produit: 'Maïs', quantite: 2, prixUnitaire: 100, type: 'produit' }] });
    const devisId = create.body.devis.id;
    await signer(devisId);
    await request(app).post(`/api/devis/${devisId}/facturer`).set(bear(admin.token))
      .send({ modePaiement: 'Espèces', modalitePaiement: 'complet' });

    const put = await request(app).put(`/api/devis/${devisId}`).set(bear(admin.token))
      .send({ clientId, lignes: [{ produit: 'Maïs', quantite: 3, prixUnitaire: 100, type: 'produit' }] });
    expect(put.status).toBe(400);
  });
});

// Régression (voir CLAUDE.md « reported, not fixed » puis corrigé) : un échec d'envoi email
// ne doit plus laisser le devis coincé en 'Envoyé' avec un token public généré pour rien.
// L'environnement de test n'a pas d'EMAIL_USER/EMAIL_PASS (voir test/integration/env.js), donc
// nodemailer échoue systématiquement ici — exactement le scénario du bug original.
describe('Devis — POST /:id/envoyer, échec d\'envoi email n\'altère pas l\'état', () => {
  test('email indisponible → 502, devis reste en Brouillon, aucun token_public posé', async () => {
    const admin = await registerEntreprise();
    const contact = await request(app).post('/api/contacts').set({ Authorization: `Bearer ${admin.token}` })
      .send({ nom: 'Client Email SARL', estClient: true, email: 'client-envoi@test.local' });
    expect(contact.status).toBe(201);
    const clientId = contact.body.contact.id;

    const create = await request(app).post('/api/devis').set({ Authorization: `Bearer ${admin.token}` })
      .send({ clientId, lignes: [{ produit: 'Maïs', quantite: 2, prixUnitaire: 100, type: 'produit' }] });
    expect(create.status).toBe(201);
    const devisId = create.body.devis.id;

    const envoyer = await request(app).post(`/api/devis/${devisId}/envoyer`).set({ Authorization: `Bearer ${admin.token}` });
    expect(envoyer.status).toBe(502);

    const { rows } = await pool.query('SELECT statut, token_public FROM devis WHERE id = $1', [devisId]);
    expect(rows[0].statut).toBe('Brouillon');
    expect(rows[0].token_public).toBeNull();
  });

  test('client sans email → 400, aucune tentative d\'envoi', async () => {
    const admin = await registerEntreprise();
    const clientId = await createClient(admin.token);
    const create = await request(app).post('/api/devis').set({ Authorization: `Bearer ${admin.token}` })
      .send({ clientId, lignes: [{ produit: 'Maïs', quantite: 1, prixUnitaire: 100, type: 'produit' }] });
    const devisId = create.body.devis.id;

    const envoyer = await request(app).post(`/api/devis/${devisId}/envoyer`).set({ Authorization: `Bearer ${admin.token}` });
    expect(envoyer.status).toBe(400);
  });
});

// Régression Jalon 1 (2026-09-05) : cette route n'avait jamais été testée — c'est ce qui a
// laissé passer l'absence totale de page frontend consommant getDevisPublic/signerDevisPublic
// (voir docs/journal.md). L'environnement de test n'ayant pas d'EMAIL_USER (voir ci-dessus),
// POST /:id/envoyer échoue toujours ici — le token_public est donc posé directement en base,
// exactement comme un vrai envoi réussi l'aurait fait.
describe('Devis — consultation et signature publiques (token)', () => {
  const posesToken = async (devisId) => {
    const token = `test-token-${devisId}-${Math.random().toString(36).slice(2)}`;
    await pool.query(`UPDATE devis SET statut = 'Envoyé', token_public = $1 WHERE id = $2`, [token, devisId]);
    return token;
  };

  test('GET /public/:token → devis + lignes + devise/locale de l\'entreprise ; token bidon → 404', async () => {
    const admin = await registerEntreprise();
    const clientId = await createClient(admin.token);
    const create = await request(app).post('/api/devis').set(bearer(admin.token))
      .send({ clientId, lignes: [{ produit: 'Maïs', quantite: 3, prixUnitaire: 500, type: 'produit' }] });
    const devisId = create.body.devis.id;
    const token = await posesToken(devisId);

    const res = await request(app).get(`/api/devis/public/${token}`);
    expect(res.status).toBe(200);
    expect(res.body.devis.statut).toBe('Envoyé');
    expect(res.body.devis.total).toBe(1500);
    expect(res.body.devis.devise).toBe('XOF');
    expect(res.body.devis.locale).toBe('fr-FR');
    expect(res.body.devis.lignes).toHaveLength(1);
    expect(res.body.devis.lignes[0].produit).toBe('Maïs');

    const bogus = await request(app).get('/api/devis/public/ce-token-n-existe-pas');
    expect(bogus.status).toBe(404);
  });

  test('POST /public/:token/signer → statut Signé + signataire/date renvoyés ; 2e signature → 400 ; mauvais token → 404', async () => {
    const admin = await registerEntreprise();
    const clientId = await createClient(admin.token);
    const create = await request(app).post('/api/devis').set(bearer(admin.token))
      .send({ clientId, lignes: [{ produit: 'Riz', quantite: 1, prixUnitaire: 200, type: 'produit' }] });
    const devisId = create.body.devis.id;
    const token = await posesToken(devisId);

    const bogus = await request(app).post('/api/devis/public/ce-token-n-existe-pas/signer')
      .send({ signatureData: 'data:image/png;base64,abc', signataireNom: 'Test' });
    expect(bogus.status).toBe(404);

    const sansNom = await request(app).post(`/api/devis/public/${token}/signer`).send({ signatureData: 'data:image/png;base64,abc' });
    expect(sansNom.status).toBe(400);

    const signer = await request(app).post(`/api/devis/public/${token}/signer`)
      .send({ signatureData: 'data:image/png;base64,abc', signataireNom: 'Fatoumata Traoré' });
    expect(signer.status).toBe(200);

    const relire = await request(app).get(`/api/devis/public/${token}`);
    expect(relire.body.devis.statut).toBe('Signé');
    expect(relire.body.devis.signataireNom).toBe('Fatoumata Traoré');
    expect(relire.body.devis.signatureData).toBe('data:image/png;base64,abc');
    expect(relire.body.devis.dateSignature).toBeTruthy();

    const resigner = await request(app).post(`/api/devis/public/${token}/signer`)
      .send({ signatureData: 'data:image/png;base64,xyz', signataireNom: 'Autre' });
    expect(resigner.status).toBe(400);
  });

  test('POST /public/:token/signer refuse un devis annulé (lien toujours valide) et une signature non-image', async () => {
    const admin = await registerEntreprise();
    const clientId = await createClient(admin.token);
    const create = await request(app).post('/api/devis').set(bearer(admin.token))
      .send({ clientId, lignes: [{ produit: 'Sorgho', quantite: 1, prixUnitaire: 100, type: 'produit' }] });
    const devisId = create.body.devis.id;
    const token = await posesToken(devisId);

    const pasImage = await request(app).post(`/api/devis/public/${token}/signer`)
      .send({ signatureData: 'javascript:alert(1)', signataireNom: 'Test' });
    expect(pasImage.status).toBe(400);

    const annuler = await request(app).post(`/api/devis/${devisId}/annuler`).set(bearer(admin.token));
    expect(annuler.status).toBe(200);
    const signer = await request(app).post(`/api/devis/public/${token}/signer`)
      .send({ signatureData: 'data:image/png;base64,abc', signataireNom: 'Test' });
    expect(signer.status).toBe(400);
    const relire = await request(app).get(`/api/devis/public/${token}`);
    expect(relire.body.devis.statut).toBe('Annulé');
  });

  test('GET /public/:token/pdf → 200 + PDF, y compris avant signature ; token bidon → 404', async () => {
    const admin = await registerEntreprise();
    const clientId = await createClient(admin.token);
    const create = await request(app).post('/api/devis').set(bearer(admin.token))
      .send({ clientId, lignes: [{ produit: 'Mil', quantite: 2, prixUnitaire: 300, type: 'produit' }] });
    const devisId = create.body.devis.id;
    const token = await posesToken(devisId);

    const pdf = await request(app).get(`/api/devis/public/${token}/pdf`);
    expect(pdf.status).toBe(200);
    expect(pdf.headers['content-type']).toBe('application/pdf');

    const bogus = await request(app).get('/api/devis/public/ce-token-n-existe-pas/pdf');
    expect(bogus.status).toBe(404);
  });
});

// Multi-devise réel, étape 2 : un devis peut être créé/envoyé dans la devise du contact.
// Purge les taux déjà en base pour AUJOURD'HUI avant d'installer le mock : sans ça,
// obtenirTaux() (utils/currencyRates.js) ne rafraîchit QUE si aucun taux n'existe encore pour
// la devise demandée à cette date — si un autre fichier de test (ex. abonnement.test.js,
// devisesTaux.test.js) a déjà déclenché un vrai appel réseau ou un mock différent plus tôt
// dans la même suite, ce test lirait leurs taux au lieu des siens. Rend chaque test
// déterministe quel que soit l'ordre d'exécution des fichiers (non garanti par Jest).
async function mockerFetchTaux(rates = { USD: 1, XOF: 600, EUR: 0.9 }) {
  await pool.query('DELETE FROM currency_rates WHERE date = CURRENT_DATE');
  const original = global.fetch;
  global.fetch = async () => ({ ok: true, status: 200, json: async () => ({ result: 'success', rates }) });
  return () => { global.fetch = original; };
}

describe('Devis — multi-devise réel (étape 2)', () => {
  test('sans devise particulière → devise/tauxChange de l\'entreprise, aucun appel réseau', async () => {
    const admin = await registerEntreprise();
    const clientId = await createClient(admin.token);
    const original = global.fetch;
    global.fetch = async () => { throw new Error('ne devrait jamais être appelé : même devise'); };
    try {
      const create = await request(app).post('/api/devis').set(bearer(admin.token))
        .send({ clientId, lignes: [{ produit: 'Maïs', quantite: 2, prixUnitaire: 1000, type: 'produit' }] });
      expect(create.status).toBe(201);
      expect(create.body.devis.devise).toBe('XOF');
      expect(create.body.devis.tauxChange).toBe(1);
      expect(create.body.devis.totalDeviseEntreprise).toBe(2000);
    } finally { global.fetch = original; }
  });

  test('client avec devise_facturation propre → le devis l\'hérite par défaut, taux figé', async () => {
    const admin = await registerEntreprise();
    const contact = await request(app).post('/api/contacts').set(bearer(admin.token))
      .send({ nom: 'Client Europe', estClient: true, deviseFacturation: 'EUR' });
    const clientId = contact.body.contact.id;
    expect(contact.body.contact.deviseFacturation).toBe('EUR');

    const restore = await mockerFetchTaux({ USD: 1, XOF: 600, EUR: 0.9 });
    try {
      const create = await request(app).post('/api/devis').set(bearer(admin.token))
        .send({ clientId, lignes: [{ produit: 'Maïs', quantite: 1, prixUnitaire: 100, type: 'produit' }] });
      expect(create.status).toBe(201);
      expect(create.body.devis.devise).toBe('EUR');
      // 1 EUR en devise entreprise (XOF) : (1/0.9) / (1/600) = 600/0.9
      expect(create.body.devis.tauxChange).toBeCloseTo(600 / 0.9, 4);
      expect(create.body.devis.total).toBe(100);
      expect(create.body.devis.totalDeviseEntreprise).toBeCloseTo(100 * (600 / 0.9), 1);
    } finally { restore(); }
  });

  test('devise explicite dans la requête prime sur celle du contact', async () => {
    const admin = await registerEntreprise();
    const contact = await request(app).post('/api/contacts').set(bearer(admin.token))
      .send({ nom: 'Client Europe 2', estClient: true, deviseFacturation: 'EUR' });
    const restore = await mockerFetchTaux({ USD: 1, XOF: 600, GBP: 0.75 });
    try {
      const create = await request(app).post('/api/devis').set(bearer(admin.token))
        .send({ clientId: contact.body.contact.id, devise: 'GBP', lignes: [{ produit: 'Riz', quantite: 1, prixUnitaire: 50, type: 'produit' }] });
      expect(create.status).toBe(201);
      expect(create.body.devis.devise).toBe('GBP');
    } finally { restore(); }
  });

  // Étape 3 : la facturation réelle en devise étrangère fonctionne désormais — le grand
  // livre (account_move_line.debit/credit/balance) reste en devise entreprise, amount_currency
  // et les totaux du move (comme devis.total) restent dans la devise DU DOCUMENT.
  test('facturer (complet) un devis en devise étrangère → move posté, équilibré et soldé, montants corrects dans les 2 devises', async () => {
    const admin = await registerEntreprise();
    const contact = await request(app).post('/api/contacts').set(bearer(admin.token))
      .send({ nom: 'Client Etranger', estClient: true, deviseFacturation: 'EUR' });
    const restoreCreate = await mockerFetchTaux({ USD: 1, XOF: 600, EUR: 0.9 });
    let devisId;
    let tauxAttendu;
    try {
      const create = await request(app).post('/api/devis').set(bearer(admin.token))
        .send({ clientId: contact.body.contact.id, lignes: [{ produit: 'Maïs', quantite: 1, prixUnitaire: 100, type: 'produit' }] });
      devisId = create.body.devis.id;
      tauxAttendu = create.body.devis.tauxChange; // 600/0.9
      expect(create.body.devis.total).toBe(100);
    } finally { restoreCreate(); }

    await request(app).post(`/api/devis/${devisId}/valider-manuel`).set(bearer(admin.token)).send({ confirmePar: 'Test' });
    const facturer = await request(app).post(`/api/devis/${devisId}/facturer`).set(bearer(admin.token))
      .send({ modePaiement: 'Espèces', modalitePaiement: 'complet' });
    expect(facturer.status).toBe(200);
    expect(facturer.body.devis.statut).toBe('Facturé');
    expect(facturer.body.devis.move.state).toBe('posted');
    expect(facturer.body.devis.move.paymentState).toBe('paid');
    expect(facturer.body.devis.move.amountResidual).toBeCloseTo(0, 2);
    // amountTotal du move reste dans la devise DU DOCUMENT (comme devis.total) : 100, pas 66667.
    expect(facturer.body.devis.move.amountTotal).toBeCloseTo(100, 2);

    const f = (await request(app).get(`/api/factures/${facturer.body.devis.move.id}`).set(bearer(admin.token))).body.facture;
    expect(f.devise).toBe('EUR');
    expect(f.invoiceCurrencyRate).toBeCloseTo(tauxAttendu, 4);
    // le grand livre (debit/credit) est en devise ENTREPRISE, équilibré, et correctement converti.
    const dd = f.lignes.reduce((s, l) => s + l.debit, 0);
    const cc = f.lignes.reduce((s, l) => s + l.credit, 0);
    expect(dd).toBeCloseTo(cc, 2);
    expect(dd).toBeCloseTo(100 * tauxAttendu, 1);
    // la ligne produit garde son montant en devise du document via amount_currency.
    const ligneProduit = f.lignes.find((l) => l.displayType === 'product');
    expect(Math.abs(ligneProduit.amountCurrency)).toBeCloseTo(100, 2);
    expect(Math.abs(ligneProduit.balance)).toBeCloseTo(100 * tauxAttendu, 1);

    // finances (miroir en devise ENTREPRISE) reflète le montant converti, pas 100 brut.
    const finances = await pool.query(
      `SELECT montant::float8 AS montant FROM finances WHERE entreprise_id = $1 AND source_module = 'Devis' ORDER BY id DESC LIMIT 1`,
      [admin.entrepriseId]
    );
    expect(finances.rows[0].montant).toBeCloseTo(100 * tauxAttendu, 1);
  });

  // Étape 4 : le taux du jour du paiement (recherché automatiquement via paymentDate, aucun
  // paramètre supplémentaire) diffère de celui figé à la facturation → écart de change posté
  // et lettré séparément, la facture reste soldée normalement (en devise du document).
  describe('écart de change au paiement', () => {
    // Les taux posés ci-dessous (2026-09-20/21) restaient en base après ce bloc. Tant que ces
    // dates étaient dans le futur, c'était sans effet ; une fois passées, ils devenaient « le
    // taux le plus récent » pour tous les tests suivants (obtenirTaux prend la dernière date
    // ≤ aujourd'hui sans rafraîchir) et faisaient échouer devisesTaux.test.js et le test
    // d'envoi multi-devise. Nettoyage explicite : la table est partagée par toute la suite.
    afterAll(async () => {
      await pool.query(`DELETE FROM currency_rates WHERE date IN ('2026-09-20', '2026-09-21')`);
    });

    async function creerFactureEchelonneeEUR(admin) {
      const contact = await request(app).post('/api/contacts').set(bearer(admin.token))
        .send({ nom: 'Client Ecart Change', estClient: true, deviseFacturation: 'EUR' });
      const restore = await mockerFetchTaux({ USD: 1, XOF: 600, EUR: 0.9 }); // taux facture : 600/0.9
      let devisId;
      try {
        const create = await request(app).post('/api/devis').set(bearer(admin.token))
          .send({ clientId: contact.body.contact.id, lignes: [{ produit: 'Maïs', quantite: 1, prixUnitaire: 100, type: 'produit' }] });
        devisId = create.body.devis.id;
      } finally { restore(); }
      await request(app).post(`/api/devis/${devisId}/valider-manuel`).set(bearer(admin.token)).send({ confirmePar: 'Test' });
      // échelonné (une seule échéance, pas encore payée) : la facture reste "Non payé", pour
      // pouvoir tester register-payment séparément avec une date de paiement postérieure.
      const facturer = await request(app).post(`/api/devis/${devisId}/facturer`).set(bearer(admin.token))
        .send({ modePaiement: 'Espèces', modalitePaiement: 'echelonne', echeances: [{ montant: 100, dateEcheance: '2026-09-20' }] });
      return facturer.body.devis.move.id;
    }

    test('taux du paiement plus élevé (devise appréciée) → gain de change, facture soldée', async () => {
      const admin = await registerEntreprise();
      const moveId = await creerFactureEchelonneeEUR(admin);
      // Taux du jour du paiement, posé directement en base pour une date future — XOF/EUR
      // monte à 610/0.85 (l'EUR vaut plus de XOF qu'à la facturation : 610/0.85 > 600/0.9).
      await pool.query(`INSERT INTO currency_rates (devise, taux_vs_usd, date) VALUES ('XOF', 610, '2026-09-20'), ('EUR', 0.85, '2026-09-20')`);

      const pay = await request(app).post(`/api/factures/${moveId}/register-payment`).set(bearer(admin.token))
        .send({ amount: 100, paymentDate: '2026-09-20' });
      expect(pay.status).toBe(200);

      const f = (await request(app).get(`/api/factures/${moveId}`).set(bearer(admin.token))).body.facture;
      expect(f.paymentState).toBe('paid');
      expect(f.amountResidual).toBeCloseTo(0, 2); // en devise du document, inchangé

      const ecartMove = await pool.query(
        `SELECT m.id FROM account_move m WHERE m.entreprise_id = $1 AND m.ref LIKE 'Écart de change%' ORDER BY m.id DESC LIMIT 1`,
        [admin.entrepriseId]
      );
      expect(ecartMove.rows.length).toBe(1);
      const lignes = await pool.query(
        `SELECT debit::float8, credit::float8, reconciled, a.account_type AS "accountType"
         FROM account_move_line l JOIN account_account a ON a.id = l.account_id
         WHERE l.move_id = $1 ORDER BY l.sequence ASC`,
        [ecartMove.rows[0].id]
      );
      expect(lignes.rows).toHaveLength(2);
      const sd = lignes.rows.reduce((s, l) => s + l.debit, 0);
      const sc = lignes.rows.reduce((s, l) => s + l.credit, 0);
      expect(sd).toBeCloseTo(sc, 2); // écriture équilibrée
      // la 2e ligne (compte de résultat) est bien sur le compte Gains de change (favorable
      // pour une vente quand la devise s'apprécie).
      expect(lignes.rows.some((l) => l.accountType === 'income_other' && l.credit > 0)).toBe(true);

      // la ligne "Règlement" du paiement est bien totalement soldée (résidu fantôme fermé).
      const payLigne = await pool.query(
        `SELECT amount_residual::float8 AS r, reconciled FROM account_move_line
         WHERE move_id != $1 AND display_type = 'payment_term' AND account_id = (SELECT account_id FROM account_move_line WHERE move_id = $1 AND display_type = 'payment_term' LIMIT 1)
         ORDER BY id DESC LIMIT 1`,
        [ecartMove.rows[0].id]
      );
      expect(Math.abs(payLigne.rows[0].r)).toBeLessThan(0.01);
      expect(payLigne.rows[0].reconciled).toBe(true);
    });

    test('taux du paiement plus bas (devise dépréciée) → perte de change', async () => {
      const admin = await registerEntreprise();
      const moveId = await creerFactureEchelonneeEUR(admin);
      // currency_rates est une table PLATEFORME (partagée entre entreprises, voir étape 1) —
      // date distincte du test précédent pour ne pas violer l'unicité (devise, date).
      // EUR vaut moins de XOF qu'à la facturation : 590/0.95 < 600/0.9.
      await pool.query(`INSERT INTO currency_rates (devise, taux_vs_usd, date) VALUES ('XOF', 590, '2026-09-21'), ('EUR', 0.95, '2026-09-21')`);

      const pay = await request(app).post(`/api/factures/${moveId}/register-payment`).set(bearer(admin.token))
        .send({ amount: 100, paymentDate: '2026-09-21' });
      expect(pay.status).toBe(200);

      const ecartMove = await pool.query(
        `SELECT m.id FROM account_move m WHERE m.entreprise_id = $1 AND m.ref LIKE 'Écart de change%' ORDER BY m.id DESC LIMIT 1`,
        [admin.entrepriseId]
      );
      const lignes = await pool.query(
        `SELECT debit::float8, credit::float8, a.account_type AS "accountType"
         FROM account_move_line l JOIN account_account a ON a.id = l.account_id
         WHERE l.move_id = $1`,
        [ecartMove.rows[0].id]
      );
      const sd = lignes.rows.reduce((s, l) => s + l.debit, 0);
      const sc = lignes.rows.reduce((s, l) => s + l.credit, 0);
      expect(sd).toBeCloseTo(sc, 2);
      // cette fois le compte de résultat débité doit être "Pertes de change" (expense_other).
      expect(lignes.rows.some((l) => l.accountType === 'expense_other' && l.debit > 0)).toBe(true);
    });

    test('taux du paiement inchangé (même devise ou même taux) → aucune écriture de change', async () => {
      const admin = await registerEntreprise();
      const contact = await request(app).post('/api/contacts').set(bearer(admin.token))
        .send({ nom: 'Client Meme Devise', estClient: true });
      const create = await request(app).post('/api/devis').set(bearer(admin.token))
        .send({ clientId: contact.body.contact.id, lignes: [{ produit: 'Riz', quantite: 1, prixUnitaire: 100, type: 'produit' }] });
      await request(app).post(`/api/devis/${create.body.devis.id}/valider-manuel`).set(bearer(admin.token)).send({ confirmePar: 'Test' });
      const facturer = await request(app).post(`/api/devis/${create.body.devis.id}/facturer`).set(bearer(admin.token))
        .send({ modePaiement: 'Espèces', modalitePaiement: 'echelonne', echeances: [{ montant: 100, dateEcheance: '2026-09-20' }] });
      const moveId = facturer.body.devis.move.id;

      const pay = await request(app).post(`/api/factures/${moveId}/register-payment`).set(bearer(admin.token))
        .send({ amount: 100, paymentDate: '2026-09-20' });
      expect(pay.status).toBe(200);

      const ecartMove = await pool.query(
        `SELECT m.id FROM account_move m WHERE m.entreprise_id = $1 AND m.ref LIKE 'Écart de change%'`,
        [admin.entrepriseId]
      );
      expect(ecartMove.rows).toHaveLength(0);
    });
  });

  // POST /:id/envoyer recalcule le taux AVANT l'envoi mais ne l'écrit qu'après un envoi
  // réussi (même invariant "email avant écriture" déjà établi pour statut/token_public) —
  // l'environnement de test n'a pas d'EMAIL_USER (voir env.js), donc l'envoi échoue toujours
  // ici : ce test vérifie que taux_change n'est donc PAS réécrit dans ce cas, pas le
  // recalcul réussi lui-même (qui nécessiterait de mocker le transport email).
  test('envoyer : le nouveau taux n\'est écrit que si l\'envoi réussit (email indisponible ici → inchangé)', async () => {
    const admin = await registerEntreprise();
    const contact = await request(app).post('/api/contacts').set(bearer(admin.token))
      .send({ nom: 'Client Taux Change', estClient: true, email: 'client-taux@test.local', deviseFacturation: 'EUR' });
    let devisId;
    const restoreCreate = await mockerFetchTaux({ USD: 1, XOF: 600, EUR: 0.9 });
    try {
      const create = await request(app).post('/api/devis').set(bearer(admin.token))
        .send({ clientId: contact.body.contact.id, lignes: [{ produit: 'Maïs', quantite: 1, prixUnitaire: 100, type: 'produit' }] });
      devisId = create.body.devis.id;
      expect(create.body.devis.tauxChange).toBeCloseTo(600 / 0.9, 4);
    } finally { restoreCreate(); }

    const restoreEnvoi = await mockerFetchTaux({ USD: 1, XOF: 610, EUR: 0.85 });
    try {
      const envoyer = await request(app).post(`/api/devis/${devisId}/envoyer`).set(bearer(admin.token));
      expect(envoyer.status).toBe(502); // email indisponible dans cet environnement de test
    } finally { restoreEnvoi(); }

    const relire = await request(app).get(`/api/devis/${devisId}`).set(bearer(admin.token));
    expect(relire.body.devis.tauxChange).toBeCloseTo(600 / 0.9, 4); // inchangé, pas écrasé par le taux calculé avant l'échec
  });

  test('contact sans devise_facturation (désassignée via PUT) → repli sur la devise de l\'entreprise', async () => {
    const admin = await registerEntreprise();
    const contact = await request(app).post('/api/contacts').set(bearer(admin.token))
      .send({ nom: 'Client Reset', estClient: true, deviseFacturation: 'EUR' });
    const put = await request(app).put(`/api/contacts/${contact.body.contact.id}`).set(bearer(admin.token))
      .send({ deviseFacturation: null });
    expect(put.body.contact.deviseFacturation).toBeNull();

    const original = global.fetch;
    global.fetch = async () => { throw new Error('ne devrait jamais être appelé : plus de devise contact'); };
    try {
      const create = await request(app).post('/api/devis').set(bearer(admin.token))
        .send({ clientId: contact.body.contact.id, lignes: [{ produit: 'Maïs', quantite: 1, prixUnitaire: 100, type: 'produit' }] });
      expect(create.body.devis.devise).toBe('XOF');
    } finally { global.fetch = original; }
  });
});
