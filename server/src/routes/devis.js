import express from 'express';
import crypto from 'crypto';
import { authRequired } from '../middleware/auth.js';
import { pool } from '../db.js';
import { sendDevisEmail } from '../services/mailer.js';
import { syncDevisPaiement } from '../utils/financeSync.js';
import { applyVenteLignesToStock, reverseVenteLignesToStock } from '../utils/stockSync.js';
import { streamDevisPdf, identiteDocument } from '../utils/devisPdf.js';
import { logFieldChanges, getJournal } from '../utils/journalModifications.js';
import { logAuditEvent } from '../utils/auditLog.js';
import { genererEcheancesDepuisTerme } from './paymentTerms.js';
import { appliquerTaxesLigne } from '../utils/taxeCompute.js';
import { posterMove, enregistrerPaiementMove, journalParType, round2 } from '../utils/accountMove.js';
import { convertir } from '../utils/currencyRates.js';

// Date de validité par défaut d'un devis : aujourd'hui + 30 jours (comme default_validity_date
// d'un ERP de référence). Format 'YYYY-MM-DD'.
function validiteParDefaut() {
  const d = new Date();
  d.setDate(d.getDate() + 30);
  return d.toISOString().slice(0, 10);
}

const router = express.Router();

const DEVIS_COLUMNS = `
  d.id, d.numero, d.statut, to_char(d.date, 'YYYY-MM-DD') AS date, d.date_signature AS "dateSignature",
  d.signataire_nom AS "signataireNom", d.total::float8 AS total, d.notes,
  d.remise_globale::float8 AS "remiseGlobale",
  COALESCE(d.devise, e.devise) AS devise, COALESCE(d.taux_change, 1)::float8 AS "tauxChange",
  ROUND(d.total * COALESCE(d.taux_change, 1), 2)::float8 AS "totalDeviseEntreprise",
  d.conditions_paiement AS "conditionsPaiement", d.livraison_promise AS "livraisonPromise",
  to_char(d.validity_date, 'YYYY-MM-DD') AS "validityDate", d.payment_term_id AS "paymentTermId",
  (d.statut IN ('Brouillon', 'Devis', 'Envoyé') AND d.validity_date IS NOT NULL AND d.validity_date < date_entreprise(d.entreprise_id)) AS expired,
  d.client_id AS "clientId", c.nom AS "clientNom", c.prenom AS "clientPrenom",
  c.email AS "clientEmail", c.telephone AS "clientTelephone", c.adresse AS "clientAdresse",
  c.adresse_rue AS "clientAdresseRue", c.adresse_ville AS "clientAdresseVille",
  c.adresse_code_postal AS "clientCodePostal", c.adresse_pays AS "clientPays",
  d.created_at AS "createdAt"
`;

// Colonnes réservées à la LISTE. Elles ne rejoignent pas DEVIS_COLUMNS, qui est relue par
// getDevisComplet — lui-même appelé DEPUIS des transactions ouvertes (facturer,
// remettre-brouillon) qui écrivent dans account_move. Une sous-requête vers cette table
// depuis la constante partagée a fait expirer la suite de tests du cycle de vie : trois
// exécutions vertes sans elle, échecs avec. Même leçon que DOCUMENT_COLUMNS dans achats.js —
// une constante de colonnes lue dans plusieurs contextes doit rester simple.
const DEVIS_LISTE_COLUMNS = `
  ${DEVIS_COLUMNS},
  -- Vendeur : l'auteur du devis. users ne stocke qu'un e-mail ; quand le compte est rattaché
  -- à un salarié, son nom est ce qu'un utilisateur reconnaît.
  (SELECT COALESCE(NULLIF(btrim(s.prenom || ' ' || s.nom), ''), u.email)
     FROM users u
     LEFT JOIN salaries s ON s.user_id = u.id AND s.entreprise_id = d.entreprise_id
    WHERE u.id = d.user_id) AS "vendeurNom",
  -- État de facturation, axe distinct du statut commercial (patron invoice_status).
  (SELECT mv.payment_state FROM account_move mv WHERE mv.id = d.move_id) AS "etatFacturation"
`;

// Ne garde qu'un recolte_id qui appartient réellement à l'entreprise appelante (isolation multi-tenant)
async function validerRecolteIds(dbClient, lignes, entrepriseId) {
  const ids = [...new Set(lignes.map(l => l.recolteId).filter(Boolean))];
  if (ids.length === 0) return new Set();
  const result = await dbClient.query(
    'SELECT id FROM recoltes WHERE id = ANY($1::int[]) AND entreprise_id = $2',
    [ids, entrepriseId]
  );
  return new Set(result.rows.map(r => r.id));
}

// Un devis n'est rattaché à aucun module (contrairement à un achat) : chaque ligne porte
// son propre stockModule, donc la validation d'appartenance se fait module par module
// (nécessaire depuis la fusion produits du 2026-08-18 : un id valide mais du mauvais
// module doit être rejeté — voir la même note dans routes/achats.js:validerStockIds).
// Retourne, par ligne, l'appartenance du stock_id ET l'unite_id de base du produit trouvé
// (Map plutôt qu'un simple Set) — sert aussi de repli pour l'unité par défaut d'une ligne
// quand aucun uomId n'est fourni explicitement (étape 1 UoM, même logique qu'achats.js).
async function validerStockLigneIds(dbClient, lignes, entrepriseId) {
  const parModule = { Cultures: new Map(), Poulailler: new Map(), Pisciculture: new Map() };
  for (const module of Object.keys(parModule)) {
    const ids = [...new Set(lignes.filter(l => l.stockModule === module && l.stockId).map(l => l.stockId))];
    if (ids.length === 0) continue;
    const result = await dbClient.query(
      'SELECT id, unite_id AS "uniteId" FROM produits WHERE id = ANY($1::int[]) AND entreprise_id = $2 AND module = $3',
      [ids, entrepriseId, module]
    );
    parModule[module] = new Map(result.rows.map(r => [r.id, r.uniteId]));
  }
  return (ligne) => {
    const valides = parModule[ligne.stockModule];
    const ok = Boolean(valides) && Boolean(ligne.stockId) && valides.has(ligne.stockId);
    return { ok, uniteId: ok ? valides.get(ligne.stockId) : null };
  };
}

// Résout l'uom_id effectif d'une ligne : l'unité fournie si elle appartient bien à
// l'entreprise appelante, sinon l'unité de base du produit catalogué en repli, sinon null
// (produit en texte libre non catalogué, ou produit sans unité de base définie) — même
// logique que resolveUomId dans routes/achats.js.
async function resolveUomId(dbClient, entrepriseId, uomId, produitUniteId) {
  if (uomId) {
    const check = await dbClient.query('SELECT id FROM unites_mesure WHERE id = $1 AND entreprise_id = $2', [uomId, entrepriseId]);
    if (check.rows.length > 0) return uomId;
  }
  return produitUniteId ?? null;
}

// Étape 4 (2026-08-18) : une ligne de section/note (type='section') ne porte aucune quantité/
// prix/remise/lien stock réels — ces deux fonctions imposent cette invariante côté serveur
// (défense en profondeur, indépendamment de ce qu'un client enverrait) plutôt que de faire
// confiance au payload entrant.
function normalizeLigne(l) {
  const isSection = l.type === 'section';
  return {
    produit: l.produit,
    type: isSection ? 'section' : 'produit',
    quantite: isSection ? 0 : (Number(l.quantite) || 0),
    prixUnitaire: isSection ? 0 : (Number(l.prixUnitaire) || 0),
    remisePourcentage: isSection ? 0 : Math.min(100, Math.max(0, Number(l.remisePourcentage) || 0)),
    // Étape 1 Comptabilité : plus de taux unique par ligne — une ligne porte des liens vers
    // des taxes réutilisables account_tax (Many2many, comme sale.order.line.tax_id). Les ids
    // sont validés contre l'entreprise appelante avant écriture (voir filtrerTaxIds).
    taxIds: isSection ? [] : [...new Set(
      (Array.isArray(l.taxIds) ? l.taxIds : []).map(Number).filter((n) => Number.isInteger(n) && n > 0)
    )],
    unite: isSection ? null : (l.unite || null),
    recolteId: isSection ? null : l.recolteId,
    stockId: isSection ? null : l.stockId,
    stockModule: isSection ? null : l.stockModule,
    uomId: isSection ? null : l.uomId,
  };
}

// Charge les taxes actives de l'entreprise dans une Map<id, config>. `q` est soit le pool,
// soit un client de transaction en cours.
async function chargerTaxMap(entrepriseId, q = pool) {
  const { rows } = await q.query(
    `SELECT id, amount_type AS "amountType", amount::float8 AS amount,
            price_include AS "priceInclude", include_base_amount AS "includeBaseAmount", sequence
     FROM account_tax WHERE entreprise_id = $1 AND active = TRUE`,
    [entrepriseId]
  );
  return new Map(rows.map((t) => [t.id, t]));
}

// Ne garde d'une liste d'ids que ceux réellement présents dans la taxMap (donc appartenant
// à l'entreprise et actifs) — défense contre un payload qui référencerait la taxe d'une
// autre entreprise ou un id inexistant.
function filtrerTaxIds(taxIds, taxMap) {
  return (taxIds || []).filter((id) => taxMap.has(id));
}

// Calcul des taxes d'une ligne : voir utils/taxeCompute.js (source unique, partagée avec
// devisPdf.js).
// Montant HT de la ligne (après remise ligne, avant taxe) — c'est ce qu'un ERP de référence appelle
// "Amount"/"Montant" sur une ligne de commande.
function ligneTotal(l) {
  if (l.type === 'section') return 0;
  const sousTotal = (Number(l.quantite) || 0) * (Number(l.prixUnitaire) || 0);
  return sousTotal * (1 - (Number(l.remisePourcentage) || 0) / 100);
}

// Alignement visuel ERP (révisé le jour même après retour utilisateur) : chaque ligne porte
// son propre taux de taxe, comme dans un ERP de référence — abandon de la première version (un taux unique
// par devis, voir migrate.js:migrateTaxeDevisVersLignes pour la bascule). Remise globale
// toujours unique par devis, appliquée au montant HT de chaque ligne avant sa propre taxe
// (ordre comptable standard : remise avant taxe). Stocké dans devis.total (pas recalculé
// uniquement côté frontend) pour que financeSync/stockSync, qui lisent tous deux devis.total
// comme source de vérité, restent cohérents avec ce qui s'affiche.
function calculerTotal(lignesNormalisees, remiseGlobale, taxMap = new Map()) {
  const facteurRemiseGlobale = 1 - (Number(remiseGlobale) || 0) / 100;
  return lignesNormalisees.reduce((s, l) => {
    const ht = ligneTotal(l) * facteurRemiseGlobale;
    const taxes = filtrerTaxIds(l.taxIds, taxMap).map((id) => taxMap.get(id));
    // base = ht pour une taxe classique ; base < ht pour une taxe price_include (le prix
    // saisi étant TTC). Total ligne = base + taxe dans les deux cas.
    const { base, taxeTotale } = taxes.length
      ? appliquerTaxesLigne(ht, Number(l.quantite) || 0, taxes)
      : { base: ht, taxeTotale: 0 };
    return s + base + taxeTotale;
  }, 0);
}

// Insère les lignes normalisées d'un devis + leurs liens vers account_tax. Factorisé entre
// POST / et PUT /:id (mêmes règles, y compris la validation d'appartenance des recolte_id /
// stock_id / tax_id à l'entreprise appelante).
async function insererLignes(client, devisId, lignesNormalisees, entrepriseId, taxMap) {
  const recolteIdsValides = await validerRecolteIds(client, lignesNormalisees, entrepriseId);
  const stockLigneValide = await validerStockLigneIds(client, lignesNormalisees, entrepriseId);
  for (let i = 0; i < lignesNormalisees.length; i++) {
    const l = lignesNormalisees[i];
    const stockInfo = stockLigneValide(l);
    const uomId = await resolveUomId(client, entrepriseId, l.uomId, stockInfo.uniteId);
    const { rows: [{ id: ligneId }] } = await client.query(
      `INSERT INTO devis_lignes (devis_id, produit, quantite, prix_unitaire, remise_pourcentage, unite, ordre, recolte_id, stock_id, stock_module, type, uom_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) RETURNING id`,
      [devisId, l.produit, l.quantite, l.prixUnitaire, l.remisePourcentage, l.unite, i,
       recolteIdsValides.has(l.recolteId) ? l.recolteId : null,
       stockInfo.ok ? l.stockId : null, stockInfo.ok ? l.stockModule : null, l.type, uomId]
    );
    for (const taxId of filtrerTaxIds(l.taxIds, taxMap)) {
      await client.query(
        `INSERT INTO devis_lignes_taxes (devis_ligne_id, tax_id) VALUES ($1, $2)
         ON CONFLICT (devis_ligne_id, tax_id) DO NOTHING`,
        [ligneId, taxId]
      );
    }
  }
}

// Multi-devise réel, étape 2 : résout la devise effective d'un devis (explicite > celle du
// contact > celle de l'entreprise) et fige son taux de change vs la devise de l'entreprise à
// l'instant présent — voir utils/currencyRates.js. Le taux n'est PAS recalculé plus tard (même
// principe que le taux d'une facture Odoo) : seuls POST / (création) et POST /:id/envoyer
// (voir plus bas) le fixent, jamais un simple PUT de lignes.
async function resoudreDeviseEtTaux(dbClient, entrepriseId, clientId, deviseDemandee) {
  const ent = await dbClient.query('SELECT devise FROM entreprises WHERE id = $1', [entrepriseId]);
  const deviseEntreprise = ent.rows[0].devise;
  let deviseContact = null;
  if (clientId) {
    const contact = await dbClient.query('SELECT devise_facturation FROM contacts WHERE id = $1 AND entreprise_id = $2', [clientId, entrepriseId]);
    deviseContact = contact.rows[0]?.devise_facturation || null;
  }
  const devise = deviseDemandee || deviseContact || deviseEntreprise;
  const { taux } = await convertir(1, devise, deviseEntreprise);
  return { devise, tauxChange: taux };
}

// Génère un numéro de devis lisible, propre à l'entreprise (ex: DEV-2026-0007)
async function genererNumero(entrepriseId) {
  const year = new Date().getFullYear();
  const count = await pool.query(
    `SELECT COUNT(*) FROM devis WHERE entreprise_id = $1 AND EXTRACT(YEAR FROM created_at) = $2`,
    [entrepriseId, year]
  );
  const n = Number(count.rows[0].count) + 1;
  return `DEV-${year}-${String(n).padStart(4, '0')}`;
}

// Récupère un devis complet (en-tête + lignes) à partir de son id, en vérifiant l'entreprise
async function getDevisComplet(devisId, entrepriseId) {
  const devisResult = await pool.query(
    `SELECT ${DEVIS_COLUMNS}, d.mode_paiement AS "modePaiement", d.modalite_paiement AS "modalitePaiement"
     FROM devis d LEFT JOIN contacts c ON c.id = d.client_id JOIN entreprises e ON e.id = d.entreprise_id
     WHERE d.id = $1 AND d.entreprise_id = $2`,
    [devisId, entrepriseId]
  );
  if (devisResult.rows.length === 0) return null;
  const lignesResult = await pool.query(
    `SELECT id, produit, type, quantite::float8 AS quantite, prix_unitaire::float8 AS "prixUnitaire",
            remise_pourcentage::float8 AS "remisePourcentage", unite,
            quantite_livree::float8 AS "quantiteLivree", quantite_facturee::float8 AS "quantiteFacturee",
            recolte_id AS "recolteId", stock_id AS "stockId", stock_module AS "stockModule", uom_id AS "uomId"
     FROM devis_lignes WHERE devis_id = $1 ORDER BY ordre ASC`,
    [devisId]
  );
  // Liens ligne→taxe (Many2many) rattachés à chaque ligne + référentiel des taxes de
  // l'entreprise (pour l'affichage/recalcul côté client et le récapitulatif PDF).
  const ligneIds = lignesResult.rows.map((l) => l.id);
  const liensResult = ligneIds.length
    ? await pool.query(
        `SELECT devis_ligne_id AS "ligneId", tax_id AS "taxId"
         FROM devis_lignes_taxes WHERE devis_ligne_id = ANY($1::int[])`,
        [ligneIds]
      )
    : { rows: [] };
  const taxIdsParLigne = new Map();
  for (const { ligneId, taxId } of liensResult.rows) {
    if (!taxIdsParLigne.has(ligneId)) taxIdsParLigne.set(ligneId, []);
    taxIdsParLigne.get(ligneId).push(taxId);
  }
  const lignes = lignesResult.rows.map((l) => ({ ...l, taxIds: taxIdsParLigne.get(l.id) || [] }));
  const taxesResult = await pool.query(
    `SELECT id, name, amount_type AS "amountType", amount::float8 AS amount,
            price_include AS "priceInclude", include_base_amount AS "includeBaseAmount",
            sequence, invoice_label AS "invoiceLabel"
     FROM account_tax WHERE entreprise_id = $1 AND active = TRUE
     ORDER BY sequence ASC, id ASC`,
    [entrepriseId]
  );
  const echeancesResult = await pool.query(
    `SELECT id, montant::float8 AS montant, to_char(date_echeance, 'YYYY-MM-DD') AS "dateEcheance", statut, date_paiement AS "datePaiement" FROM echeances_paiement WHERE devis_id = $1 ORDER BY ordre ASC`,
    [devisId]
  );
  // Étape 3b : facture comptable liée (account_move), si le devis a été facturé.
  const moveResult = await pool.query(
    `SELECT m.id, m.name, m.state, m.payment_state AS "paymentState",
            m.amount_residual::float8 AS "amountResidual", m.amount_total::float8 AS "amountTotal"
     FROM devis d JOIN account_move m ON m.id = d.move_id
     WHERE d.id = $1 AND d.entreprise_id = $2`,
    [devisId, entrepriseId]
  );
  return {
    ...devisResult.rows[0],
    lignes,
    taxes: taxesResult.rows,
    echeances: echeancesResult.rows,
    move: moveResult.rows[0] || null,
  };
}

// ═══════════════════════════════════════════════════════════
//  LISTE / DÉTAIL (authentifié)
// ═══════════════════════════════════════════════════════════

router.get('/', authRequired, async (req, res) => {
  const { clientId } = req.query;
  try {
    // clientId optionnel : alimente le bouton intelligent "Devis (N)" sur la
    // fiche contact (ContactsTab) sans dupliquer cette route pour un
    // sous-ensemble filtré.
    const result = clientId
      ? await pool.query(
          `SELECT ${DEVIS_LISTE_COLUMNS} FROM devis d LEFT JOIN contacts c ON c.id = d.client_id JOIN entreprises e ON e.id = d.entreprise_id
           WHERE d.entreprise_id = $1 AND d.client_id = $2 ORDER BY d.id DESC`,
          [req.user.entrepriseId, clientId]
        )
      : await pool.query(
          `SELECT ${DEVIS_LISTE_COLUMNS} FROM devis d LEFT JOIN contacts c ON c.id = d.client_id JOIN entreprises e ON e.id = d.entreprise_id
           WHERE d.entreprise_id = $1 ORDER BY d.id DESC`,
          [req.user.entrepriseId]
        );
    return res.json({ devis: result.rows });
  } catch (err) {
    console.error('[GET /devis]', err);
    return res.status(500).json({ error: 'Erreur lors de la récupération des devis.' });
  }
});

// Ventes en lignes individuelles (une ligne par produit), pour alimenter le sous-onglet
// Comptabilité de Cultures et Poulailler. Un devis n'est PAS rattaché à un module
// (contrairement à achats_documents) — ce ledger est donc pour toute l'entreprise,
// partagé à l'identique entre les deux sous-onglets Comptabilité. Les devis encore en
// Brouillon sont exclus : ce ne sont pas encore des ventes engagées.
router.get('/ledger', authRequired, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT dl.id, d.date, dl.produit,
              COALESCE(NULLIF(TRIM(CONCAT(c.prenom, ' ', c.nom)), ''), c.nom, 'Client') AS partenaire,
              dl.quantite::float8 AS quantite,
              dl.prix_unitaire::float8 AS "prixUnitaire",
              -- Multi-devise : les lignes de devis sont dans la devise DU DEVIS. Ce ledger
              -- alimente des écrans qui SOMMENT plusieurs devis entre eux (Rapports,
              -- Comptabilité de chaque module, Analyse des ventes) : sans montant converti,
              -- ils additionnaient des euros à des francs CFA. "montant" reste dans la devise
              -- d'origine pour l'affichage ligne à ligne, "montantDeviseEntreprise" est la
              -- seule valeur à utiliser pour un total.
              COALESCE(d.devise, e.devise) AS devise,
              COALESCE(d.taux_change, 1)::float8 AS "tauxChange",
              ROUND(dl.quantite * dl.prix_unitaire, 2)::float8 AS montant,
              ROUND(dl.quantite * dl.prix_unitaire * COALESCE(d.taux_change, 1), 2)::float8
                AS "montantDeviseEntreprise"
       FROM devis_lignes dl
       JOIN devis d ON d.id = dl.devis_id
       JOIN entreprises e ON e.id = d.entreprise_id
       LEFT JOIN contacts c ON c.id = d.client_id
       WHERE d.entreprise_id = $1 AND d.statut NOT IN ('Brouillon', 'Annulé') AND dl.type = 'produit'
       ORDER BY d.date DESC, dl.ordre ASC`,
      [req.user.entrepriseId]
    );
    return res.json({ mouvements: result.rows });
  } catch (err) {
    console.error('[GET /devis/ledger]', err);
    return res.status(500).json({ error: "Erreur lors de la récupération de l'historique des ventes." });
  }
});

router.get('/:id', authRequired, async (req, res) => {
  try {
    const devis = await getDevisComplet(req.params.id, req.user.entrepriseId);
    if (!devis) return res.status(404).json({ error: 'Devis introuvable.' });
    return res.json({ devis });
  } catch (err) {
    console.error('[GET /devis/:id]', err);
    return res.status(500).json({ error: 'Erreur lors de la récupération du devis.' });
  }
});

// Journal des modifications (chatter) — voir server/src/utils/journalModifications.js.
// Pas de vérification d'appartenance du devis ici au-delà du filtre entreprise_id : même
// posture que le reste de cette route file, la ligne n'existe simplement pas si l'id
// n'appartient pas à l'entreprise appelante.
router.get('/:id/journal', authRequired, async (req, res) => {
  try {
    const changements = await getJournal('devis', Number(req.params.id), req.user.entrepriseId);
    return res.json({ changements });
  } catch (err) {
    console.error('[GET /devis/:id/journal]', err);
    return res.status(500).json({ error: 'Erreur lors de la récupération du journal.' });
  }
});

// ═══════════════════════════════════════════════════════════
//  CRÉATION (Brouillon, avec plusieurs lignes de produits)
// ═══════════════════════════════════════════════════════════

router.post('/', authRequired, async (req, res) => {
  const { clientId, lignes, notes, remiseGlobale, conditionsPaiement, livraisonPromise, validityDate, devise } = req.body;
  if (!clientId || !Array.isArray(lignes) || lignes.length === 0) {
    return res.status(400).json({ error: 'Un client et au moins une ligne de produit sont requis.' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const numero = await genererNumero(req.user.entrepriseId);
    const lignesNormalisees = lignes.map(normalizeLigne);
    const taxMap = await chargerTaxMap(req.user.entrepriseId, client);
    const total = calculerTotal(lignesNormalisees, remiseGlobale, taxMap);
    const { devise: deviseResolue, tauxChange } = await resoudreDeviseEtTaux(client, req.user.entrepriseId, clientId, devise);

    const devisResult = await client.query(
      `INSERT INTO devis (entreprise_id, user_id, client_id, numero, statut, total, notes, remise_globale, conditions_paiement, livraison_promise, validity_date, devise, taux_change)
       VALUES ($1, $2, $3, $4, 'Brouillon', $5, $6, $7, $8, $9, $10, $11, $12) RETURNING id`,
      [req.user.entrepriseId, req.user.sub, clientId, numero, total, notes || null,
       Number(remiseGlobale) || 0, conditionsPaiement || null, livraisonPromise || null,
       validityDate || validiteParDefaut(), deviseResolue, tauxChange]
    );
    const devisId = devisResult.rows[0].id;
    await insererLignes(client, devisId, lignesNormalisees, req.user.entrepriseId, taxMap);

    await client.query('COMMIT');

    const devis = await getDevisComplet(devisId, req.user.entrepriseId);
    return res.status(201).json({ devis });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[POST /devis]', err);
    return res.status(500).json({ error: 'Erreur lors de la création du devis.' });
  } finally {
    client.release();
  }
});

// ═══════════════════════════════════════════════════════════
//  MODIFICATION (Brouillon/Devis, ou Signé tant que pas facturé)
// ═══════════════════════════════════════════════════════════

// Aligné sur Odoo : une commande confirmée mais pas encore facturée reste éditable
// (on peut y ajouter des articles). Un devis "Signé" a déjà décrémenté le stock (voir
// applyVenteLignesToStock dans /valider-manuel), mais n'a pas encore d'account_move —
// celui-ci n'est créé qu'au POST /:id/facturer. On autorise donc la modification des
// lignes tant que statut ∈ {Brouillon, Devis, Signé}, en réajustant le stock réservé
// après coup pour un devis déjà signé. Dès "Facturé"/payé, l'écriture comptable postée
// interdit toute mutation des lignes (passer par un avoir).
const STATUTS_MODIFIABLES = ['Brouillon', 'Devis', 'Signé'];

router.put('/:id', authRequired, async (req, res) => {
  const { clientId, lignes, notes, remiseGlobale, conditionsPaiement, livraisonPromise, validityDate } = req.body;

  const client = await pool.connect();
  try {
    const check = await client.query('SELECT statut, total::float8 AS total, remise_globale::float8 AS "remiseGlobale" FROM devis WHERE id = $1 AND entreprise_id = $2', [req.params.id, req.user.entrepriseId]);
    if (check.rows.length === 0) return res.status(404).json({ error: 'Devis introuvable.' });
    const statutActuel = check.rows[0].statut;
    if (!STATUTS_MODIFIABLES.includes(statutActuel)) {
      return res.status(400).json({ error: 'Ce devis ne peut plus être modifié à ce stade.' });
    }

    // Devis déjà signé + remplacement effectif des lignes : on mémorise l'ancien jeu de
    // lignes pour restituer le stock réservé avant de réserver le nouveau (après COMMIT).
    let anciennesLignesStock = null;
    if (statutActuel === 'Signé' && Array.isArray(lignes)) {
      const { rows } = await client.query(
        'SELECT produit, quantite::float8 AS quantite, stock_id AS "stockId", stock_module AS "stockModule", uom_id AS "uomId" FROM devis_lignes WHERE devis_id = $1',
        [req.params.id]
      );
      anciennesLignesStock = rows;
    }

    await client.query('BEGIN');

    // Un appel qui ne touche que la remise globale/conditions (sans renvoyer de lignes,
    // ex: le panneau "Totaux" de la popup de détail) ne doit pas faire retomber le total à
    // 0 — on recharge alors les lignes déjà en base (avec leurs liens de taxes) pour le
    // recalcul.
    const taxMap = await chargerTaxMap(req.user.entrepriseId, client);
    let lignesSource;
    if (Array.isArray(lignes)) {
      lignesSource = lignes;
    } else {
      const { rows: lignesEnBase } = await client.query(
        `SELECT id, produit, type, quantite::float8 AS quantite, prix_unitaire::float8 AS "prixUnitaire",
                remise_pourcentage::float8 AS "remisePourcentage", unite,
                recolte_id AS "recolteId", stock_id AS "stockId", stock_module AS "stockModule"
         FROM devis_lignes WHERE devis_id = $1`,
        [req.params.id]
      );
      const { rows: liens } = await client.query(
        `SELECT devis_ligne_id AS "ligneId", tax_id AS "taxId" FROM devis_lignes_taxes
         WHERE devis_ligne_id = ANY($1::int[])`,
        [lignesEnBase.map((l) => l.id)]
      );
      const parLigne = new Map();
      for (const { ligneId, taxId } of liens) {
        if (!parLigne.has(ligneId)) parLigne.set(ligneId, []);
        parLigne.get(ligneId).push(taxId);
      }
      lignesSource = lignesEnBase.map((l) => ({ ...l, taxIds: parLigne.get(l.id) || [] }));
    }
    const lignesNormalisees = lignesSource.map(normalizeLigne);
    const remiseGlobaleFinale = remiseGlobale != null ? Number(remiseGlobale) || 0 : check.rows[0].remiseGlobale;
    const total = calculerTotal(lignesNormalisees, remiseGlobaleFinale, taxMap);

    await client.query(
      `UPDATE devis SET client_id = COALESCE($1, client_id), total = $2, notes = COALESCE($3, notes),
       remise_globale = $4,
       conditions_paiement = COALESCE($5, conditions_paiement), livraison_promise = COALESCE($6, livraison_promise),
       validity_date = COALESCE($7, validity_date)
       WHERE id = $8`,
      [clientId, total, notes, remiseGlobaleFinale, conditionsPaiement, livraisonPromise, validityDate || null, req.params.id]
    );
    await logFieldChanges(req.user.entrepriseId, 'devis', Number(req.params.id), req.user.sub,
      { total: check.rows[0].total }, { total }, ['total']);

    if (Array.isArray(lignes)) {
      // Les liens devis_lignes_taxes cascadent sur la suppression des lignes.
      await client.query('DELETE FROM devis_lignes WHERE devis_id = $1', [req.params.id]);
      await insererLignes(client, req.params.id, lignesNormalisees, req.user.entrepriseId, taxMap);
    }

    await client.query('COMMIT');

    const devis = await getDevisComplet(req.params.id, req.user.entrepriseId);

    // Réconciliation du stock réservé pour un devis déjà signé dont les lignes viennent
    // d'être remplacées : on inverse l'ancien jeu puis on applique le nouveau. Même
    // pattern non transactionnel que /valider-manuel et /remettre-brouillon (stockSync
    // écrit sur le pool en autocommit) — l'écart de lignes identiques se solde à zéro,
    // au prix de deux lignes dans stock_mouvements.
    if (anciennesLignesStock) {
      await reverseVenteLignesToStock(req.user.entrepriseId, anciennesLignesStock, {
        userId: req.user.sub, documentType: 'devis', documentId: Number(req.params.id), raison: 'devis_modification_lignes',
      });
      await applyVenteLignesToStock(req.user.entrepriseId, devis.lignes, {
        userId: req.user.sub, documentType: 'devis', documentId: Number(req.params.id), raison: 'devis_modification_lignes',
      });
    }

    return res.json({ devis });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[PUT /devis/:id]', err);
    return res.status(500).json({ error: 'Erreur lors de la mise à jour.' });
  } finally {
    client.release();
  }
});

router.delete('/:id', authRequired, async (req, res) => {
  try {
    const check = await pool.query('SELECT statut FROM devis WHERE id = $1 AND entreprise_id = $2', [req.params.id, req.user.entrepriseId]);
    if (check.rows.length === 0) return res.status(404).json({ error: 'Devis introuvable.' });
    // Brouillon/Devis (jamais engagé) OU Annulé (statut terminal pré-signature, le stock
    // et les finances n'ont jamais bougé) — aligné sur "draft or cancel" d'un ERP de référence.
    if (!['Brouillon', 'Devis', 'Annulé'].includes(check.rows[0].statut)) {
      return res.status(400).json({ error: 'Seul un devis en brouillon ou annulé peut être supprimé.' });
    }
    await pool.query('DELETE FROM devis WHERE id = $1 AND entreprise_id = $2', [req.params.id, req.user.entrepriseId]);
    return res.json({ success: true });
  } catch (err) {
    console.error('[DELETE /devis/:id]', err);
    return res.status(500).json({ error: 'Erreur lors de la suppression.' });
  }
});

// ═══════════════════════════════════════════════════════════
//  ENVOI AU CLIENT (génère le lien public + envoie l'email)
// ═══════════════════════════════════════════════════════════

// ─── POST /api/devis/:id/lien-whatsapp ───
// Prépare un envoi par WhatsApp. Contrairement à /envoyer, le serveur n'expédie rien : il
// renvoie le lien public et un message tout prêt, que le frontend ouvre dans WhatsApp via un
// lien click-to-chat. C'est l'utilisateur qui appuie sur « envoyer » — pas d'API WhatsApp
// Business, donc pas de compte Meta ni de coût par message.
//
// Le token public est RÉUTILISÉ s'il existe déjà : en régénérer un invaliderait le lien
// qu'un client aurait déjà reçu par email.
router.post('/:id/lien-whatsapp', authRequired, async (req, res) => {
  try {
    const devis = await getDevisComplet(req.params.id, req.user.entrepriseId);
    if (!devis) return res.status(404).json({ error: 'Devis introuvable.' });
    if (!devis.clientTelephone || !devis.clientTelephone.trim()) {
      return res.status(400).json({ error: "Le client n'a pas de numéro de téléphone renseigné." });
    }

    const entrepriseResult = await pool.query('SELECT nom, devise FROM entreprises WHERE id = $1', [req.user.entrepriseId]);
    const entrepriseNom = entrepriseResult.rows[0]?.nom || 'Votre exploitant';

    const tokenExistant = await pool.query(
      'SELECT token_public FROM devis WHERE id = $1 AND entreprise_id = $2',
      [req.params.id, req.user.entrepriseId]
    );
    const token = tokenExistant.rows[0]?.token_public || crypto.randomBytes(24).toString('hex');
    const lienConsultation = `${process.env.FRONTEND_URL || 'http://localhost:8090'}/devis/${token}`;

    // Une pièce déjà facturée porte un taux FIGÉ à l'émission, qu'on ne rouvre jamais (voir la
    // règle multi-devise dans CLAUDE.md) : la facture comptable a été postée à ce taux-là, et le
    // recalculer ici désaccorderait le devis de son écriture. On ne refige donc le taux que tant
    // que la pièce n'est pas facturée — cas d'origine, un devis qui part chez le client.
    const dejaFacture = Boolean(devis.move);
    let tauxChangeEnvoi = null;
    if (!dejaFacture && devis.devise !== entrepriseResult.rows[0].devise) {
      const { taux } = await convertir(1, devis.devise, entrepriseResult.rows[0].devise);
      tauxChangeEnvoi = taux;
    }

    const etaitBrouillon = devis.statut === 'Brouillon';
    await pool.query(
      `UPDATE devis SET statut = CASE WHEN statut = 'Brouillon' THEN 'Envoyé' ELSE statut END,
              token_public = $1, taux_change = COALESCE($2, taux_change)
       WHERE id = $3 AND entreprise_id = $4`,
      [token, tauxChangeEnvoi, req.params.id, req.user.entrepriseId]
    );
    if (etaitBrouillon) {
      await logFieldChanges(req.user.entrepriseId, 'devis', Number(req.params.id), req.user.sub,
        { statut: devis.statut }, { statut: 'Envoyé' }, ['statut']);
    }

    // Le même lien public sert aux deux : la page affiche et le PDF s'intitule « FACTURE » dès
    // que le devis est facturé (utils/devisPdf.js). Seul le mot du message change — annoncer un
    // devis alors que le client reçoit une facture serait le genre de détail qui fait douter.
    // WhatsApp par lien click-to-chat ne transporte aucune pièce jointe : c'est un lien vers la
    // pièce, pas le PDF lui-même.
    const nomClient = `${devis.clientPrenom || ''} ${devis.clientNom}`.trim();
    // Le numéro cité est celui que le client lira sur sa pièce (identiteDocument) : citer le
    // numéro du devis sur une facture le renverrait à une référence introuvable sur son document.
    const identite = identiteDocument(devis);
    const message = identite.estFacture
      ? `Bonjour ${nomClient}, voici votre facture ${identite.numero} de ${entrepriseNom} : ${lienConsultation}`
      : `Bonjour ${nomClient}, voici votre devis ${identite.numero} de ${entrepriseNom} : ${lienConsultation}`;

    return res.json({
      lienConsultation,
      telephone: devis.clientTelephone,
      estFacture: dejaFacture,
      message,
    });
  } catch (err) {
    console.error('[POST /devis/:id/lien-whatsapp]', err);
    return res.status(500).json({ error: "Erreur lors de la préparation du message WhatsApp." });
  }
});

router.post('/:id/envoyer', authRequired, async (req, res) => {
  try {
    const devis = await getDevisComplet(req.params.id, req.user.entrepriseId);
    if (!devis) return res.status(404).json({ error: 'Devis introuvable.' });
    if (!devis.clientEmail) return res.status(400).json({ error: "Le client n'a pas d'adresse email renseignée." });

    const token = crypto.randomBytes(24).toString('hex');
    const entrepriseResult = await pool.query('SELECT nom, devise FROM entreprises WHERE id = $1', [req.user.entrepriseId]);
    const entrepriseNom = entrepriseResult.rows[0]?.nom || 'Votre exploitant';
    const lienConsultation = `${process.env.FRONTEND_URL || 'http://localhost:8090'}/devis/${token}`;

    // Multi-devise réel, étape 2 : le taux est refigé au moment de l'envoi (pas seulement à la
    // création) — c'est ce taux-là, celui du jour où le client reçoit réellement le devis, qui
    // doit rester figé ensuite (même principe que la validation d'une facture chez Odoo).
    // Seulement si la devise diffère de celle de l'entreprise : pas d'appel externe inutile
    // pour l'immense majorité des devis, toujours dans la devise de l'entreprise.
    let tauxChangeEnvoi = null;
    if (devis.devise !== entrepriseResult.rows[0].devise) {
      const { taux } = await convertir(1, devis.devise, entrepriseResult.rows[0].devise);
      tauxChangeEnvoi = taux;
    }

    // L'email est envoyé AVANT toute écriture en base (même patron que mfa.js pour le code
    // par email) : si l'envoi échoue, le devis ne doit pas se retrouver coincé en 'Envoyé'
    // avec un token public généré pour un lien que le client n'a jamais reçu — bug réel
    // documenté dans CLAUDE.md, corrigé ici.
    try {
      await sendDevisEmail(devis.clientEmail, `${devis.clientPrenom || ''} ${devis.clientNom}`.trim(), entrepriseNom, devis.numero, lienConsultation);
    } catch (mailErr) {
      console.error('[POST /devis/:id/envoyer] envoi email', mailErr);
      return res.status(502).json({ error: "L'email n'a pas pu être envoyé. Le devis reste en brouillon, réessayez." });
    }

    await pool.query(
      `UPDATE devis SET statut = 'Envoyé', token_public = $1, taux_change = COALESCE($2, taux_change) WHERE id = $3`,
      [token, tauxChangeEnvoi, req.params.id]
    );
    await logFieldChanges(req.user.entrepriseId, 'devis', Number(req.params.id), req.user.sub,
      { statut: devis.statut }, { statut: 'Envoyé' }, ['statut']);

    return res.json({ success: true, lienConsultation });
  } catch (err) {
    console.error('[POST /devis/:id/envoyer]', err);
    return res.status(500).json({ error: "Erreur lors de l'envoi du devis." });
  }
});

// Valide manuellement un devis (accord obtenu par téléphone, en personne, etc.),
// sans passer par le lien de signature électronique. Réservé à l'admin.
router.post('/:id/valider-manuel', authRequired, async (req, res) => {
  const { confirmePar } = req.body;
  if (!confirmePar || !confirmePar.trim()) {
    return res.status(400).json({ error: 'Précisez qui a donné son accord (nom du client).' });
  }
  try {
    const check = await pool.query('SELECT statut, numero FROM devis WHERE id = $1 AND entreprise_id = $2', [req.params.id, req.user.entrepriseId]);
    if (check.rows.length === 0) return res.status(404).json({ error: 'Devis introuvable.' });
    if (!['Brouillon', 'Devis'].includes(check.rows[0].statut)) {
      return res.status(400).json({ error: 'Ce devis ne peut plus être validé manuellement.' });
    }

    await pool.query(
      `UPDATE devis SET statut = 'Signé', signataire_nom = $1, date_signature = now() WHERE id = $2`,
      [`${confirmePar} (validation manuelle, sans signature)`, req.params.id]
    );
    await logFieldChanges(req.user.entrepriseId, 'devis', Number(req.params.id), req.user.sub,
      { statut: check.rows[0].statut }, { statut: 'Signé' }, ['statut']);
    await logAuditEvent({
      entrepriseId: req.user.entrepriseId, userId: req.user.sub, email: req.user.email, action: 'devis_valide_manuel', req,
      details: { devisId: Number(req.params.id), numero: check.rows[0].numero, statutAvant: check.rows[0].statut, confirmePar: confirmePar.trim() },
    });

    const devis = await getDevisComplet(req.params.id, req.user.entrepriseId);
    await applyVenteLignesToStock(req.user.entrepriseId, devis.lignes, {
      userId: req.user.sub, documentType: 'devis', documentId: Number(req.params.id), raison: 'devis_signature',
    });
    return res.json({ devis });
  } catch (err) {
    console.error('[POST /devis/:id/valider-manuel]', err);
    return res.status(500).json({ error: 'Erreur lors de la validation.' });
  }
});

// Annule un devis avant signature (Brouillon/Envoyé uniquement) — le stock n'a encore
// jamais bougé à ce stade (voir applyVenteLignesToStock, déclenché seulement à la
// signature), donc aucune réversion n'est nécessaire ici, contrairement à
// remettre-brouillon. Statut terminal simple, pas de retour possible vers Brouillon
// depuis Annulé (recréer un nouveau devis plutôt que ressusciter celui-ci).
router.post('/:id/annuler', authRequired, async (req, res) => {
  try {
    const check = await pool.query('SELECT statut, numero FROM devis WHERE id = $1 AND entreprise_id = $2', [req.params.id, req.user.entrepriseId]);
    if (check.rows.length === 0) return res.status(404).json({ error: 'Devis introuvable.' });
    if (!['Brouillon', 'Devis', 'Envoyé'].includes(check.rows[0].statut)) {
      return res.status(400).json({ error: 'Seul un devis pas encore signé peut être annulé.' });
    }
    await pool.query(`UPDATE devis SET statut = 'Annulé' WHERE id = $1`, [req.params.id]);
    await logFieldChanges(req.user.entrepriseId, 'devis', Number(req.params.id), req.user.sub,
      { statut: check.rows[0].statut }, { statut: 'Annulé' }, ['statut']);
    await logAuditEvent({
      entrepriseId: req.user.entrepriseId, userId: req.user.sub, email: req.user.email, action: 'devis_annule', req,
      details: { devisId: Number(req.params.id), numero: check.rows[0].numero, statutAvant: check.rows[0].statut },
    });
    const devis = await getDevisComplet(req.params.id, req.user.entrepriseId);
    return res.json({ devis });
  } catch (err) {
    console.error('[POST /devis/:id/annuler]', err);
    return res.status(500).json({ error: "Erreur lors de l'annulation." });
  }
});

// ═══════════════════════════════════════════════════════════
//  CONSULTATION PUBLIQUE (sans authentification, via token)
// ═══════════════════════════════════════════════════════════

router.get('/public/:token', async (req, res) => {
  try {
    const devisResult = await pool.query(
      `SELECT d.id, d.numero, d.statut, to_char(d.date, 'YYYY-MM-DD') AS date, d.total::float8 AS total, d.notes,
              d.signature_data AS "signatureData", d.signataire_nom AS "signataireNom",
              to_char(d.date_signature, 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS "dateSignature",
              c.nom AS "clientNom", c.prenom AS "clientPrenom",
              e.nom AS "entrepriseNom", e.devise, e.locale,
              -- Même identité que le PDF : la page que le client ouvre depuis son lien doit
              -- afficher le numéro de facture, pas celui du devis.
              m.name AS "factureNom"
       FROM devis d
       LEFT JOIN contacts c ON c.id = d.client_id
       LEFT JOIN entreprises e ON e.id = d.entreprise_id
       LEFT JOIN account_move m ON m.id = d.move_id
       WHERE d.token_public = $1`,
      [req.params.token]
    );
    if (devisResult.rows.length === 0) return res.status(404).json({ error: 'Devis introuvable.' });

    const devis = devisResult.rows[0];
    const lignesResult = await pool.query(
      `SELECT produit, type, quantite::float8 AS quantite, prix_unitaire::float8 AS "prixUnitaire",
              remise_pourcentage::float8 AS "remisePourcentage", recolte_id AS "recolteId"
       FROM devis_lignes WHERE devis_id = $1 ORDER BY ordre ASC`,
      [devis.id]
    );
    return res.json({ devis: { ...devis, lignes: lignesResult.rows } });
  } catch (err) {
    console.error('[GET /devis/public]', err);
    return res.status(500).json({ error: 'Erreur lors de la récupération du devis.' });
  }
});

// ═══════════════════════════════════════════════════════════
//  SIGNATURE (sans authentification, via token)
// ═══════════════════════════════════════════════════════════

// Seuls ces statuts sont signables par le client. Le lien public reste valide après la
// facturation (même page, intitulée « Facture ») et après une annulation : l'ancienne règle
// (« tout sauf Signé/Facturé ») laissait re-signer une facture payée ou un devis annulé, ce
// qui repassait le statut à « Signé » et décomptait le stock une seconde fois.
const STATUTS_SIGNABLES = ['Envoyé', 'Devis'];
// Signature = image PNG/JPEG en data URL produite par le pad de DevisPublicView. Bornée pour
// qu'un appel anonyme ne puisse pas stocker des mégaoctets arbitraires en base.
const SIGNATURE_DATA_URL = /^data:image\/(png|jpeg);base64,[A-Za-z0-9+/=]+$/;
const SIGNATURE_TAILLE_MAX = 500_000;

router.post('/public/:token/signer', async (req, res) => {
  const { signatureData, signataireNom } = req.body;
  if (!signatureData || !signataireNom || typeof signatureData !== 'string' || typeof signataireNom !== 'string') {
    return res.status(400).json({ error: 'La signature et le nom du signataire sont requis.' });
  }
  if (signatureData.length > SIGNATURE_TAILLE_MAX || !SIGNATURE_DATA_URL.test(signatureData)) {
    return res.status(400).json({ error: 'Signature invalide.' });
  }
  const nomSignataire = signataireNom.trim().slice(0, 200);
  if (!nomSignataire) {
    return res.status(400).json({ error: 'La signature et le nom du signataire sont requis.' });
  }
  try {
    const check = await pool.query(`SELECT id, statut, entreprise_id AS "entrepriseId" FROM devis WHERE token_public = $1`, [req.params.token]);
    if (check.rows.length === 0) return res.status(404).json({ error: 'Devis introuvable.' });
    if (!STATUTS_SIGNABLES.includes(check.rows[0].statut)) {
      return res.status(400).json({ error: 'Ce devis ne peut plus être signé.' });
    }

    // Mise à jour conditionnelle (statut revérifié dans le WHERE) : deux soumissions
    // simultanées ne peuvent pas signer deux fois — ni donc décompter le stock deux fois.
    const maj = await pool.query(
      `UPDATE devis SET statut = 'Signé', signature_data = $1, signataire_nom = $2, date_signature = now()
       WHERE token_public = $3 AND statut = ANY($4)`,
      [signatureData, nomSignataire, req.params.token, STATUTS_SIGNABLES]
    );
    if (maj.rowCount === 0) {
      return res.status(400).json({ error: 'Ce devis ne peut plus être signé.' });
    }
    await logFieldChanges(check.rows[0].entrepriseId, 'devis', check.rows[0].id, null,
      { statut: check.rows[0].statut }, { statut: 'Signé' }, ['statut']);
    const lignesResult = await pool.query(
      'SELECT produit, quantite::float8 AS quantite, stock_id AS "stockId", stock_module AS "stockModule", uom_id AS "uomId" FROM devis_lignes WHERE devis_id = $1',
      [check.rows[0].id]
    );
    await applyVenteLignesToStock(check.rows[0].entrepriseId, lignesResult.rows, {
      userId: null, documentType: 'devis', documentId: check.rows[0].id, raison: 'devis_signature',
    });
    return res.json({ success: true });
  } catch (err) {
    console.error('[POST /devis/public/signer]', err);
    return res.status(500).json({ error: 'Erreur lors de la signature.' });
  }
});

// ═══════════════════════════════════════════════════════════
//  CONVERSION EN FACTURE
// ═══════════════════════════════════════════════════════════

router.post('/:id/facturer', authRequired, async (req, res) => {
  // Deux modes d'entrée :
  //  - paymentTermId (+ acompte optionnel) : les échéances sont GÉNÉRÉES depuis la
  //    condition de paiement (account.payment.term-like) ;
  //  - modalitePaiement + echeances : ancienne saisie manuelle, conservée en repli.
  const { modePaiement, modalitePaiement, echeances, paymentTermId, acompte } = req.body;

  const MODES_VALIDES = ['Espèces', 'Banque', 'Mobile Money', 'Chèque'];
  if (!modePaiement || !MODES_VALIDES.includes(modePaiement)) {
    return res.status(400).json({ error: 'Mode de paiement invalide.' });
  }
  if (!paymentTermId) {
    if (!['complet', 'echelonne'].includes(modalitePaiement)) {
      return res.status(400).json({ error: 'Modalité de paiement invalide.' });
    }
    if (modalitePaiement === 'echelonne' && (!Array.isArray(echeances) || echeances.length === 0)) {
      return res.status(400).json({ error: 'Au moins une échéance est requise pour un paiement échelonné.' });
    }
  }

  const client = await pool.connect();
  try {
    const check = await client.query(
      `SELECT d.statut, d.total, d.numero, c.nom AS "clientNom", c.prenom AS "clientPrenom",
              COALESCE(d.devise, e.devise) AS devise, e.devise AS "entrepriseDevise"
       FROM devis d LEFT JOIN contacts c ON c.id = d.client_id JOIN entreprises e ON e.id = d.entreprise_id
       WHERE d.id = $1 AND d.entreprise_id = $2`,
      [req.params.id, req.user.entrepriseId]
    );
    if (check.rows.length === 0) {
      return res.status(404).json({ error: 'Devis introuvable.' }); // client libéré par le finally
    }
    if (check.rows[0].statut !== 'Signé') {
      return res.status(400).json({ error: 'Seul un devis signé peut être converti en facture.' });
    }

    const { total, numero, clientNom, clientPrenom, devise } = check.rows[0];
    // Multi-devise réel, étape 3 : la facture comptable hérite du taux figé sur le devis
    // (jamais recalculé au moment de facturer — même principe que la création/l'envoi).
    // 1 pour un devis dans la devise de l'entreprise (immense majorité des cas).
    const tauxDevisResult = await client.query('SELECT COALESCE(taux_change, 1)::float8 AS taux FROM devis WHERE id = $1', [req.params.id]);
    const tauxChange = tauxDevisResult.rows[0].taux;
    const clientNomComplet = `${clientPrenom || ''} ${clientNom || ''}`.trim();

    // Détermine les échéances + la modalité effective.
    let echeancesFinales;
    let modaliteFinale;
    let paymentTermIdFinal = null;
    if (paymentTermId) {
      const gen = await genererEcheancesDepuisTerme(req.user.entrepriseId, paymentTermId, Number(total), new Date(), acompte);
      if (!gen) {
        return res.status(400).json({ error: 'Condition de paiement inconnue.' });
      }
      echeancesFinales = gen;
      paymentTermIdFinal = Number(paymentTermId);
      const auj = new Date().toISOString().slice(0, 10);
      // Terme "paiement immédiat" (une seule échéance due aujourd'hui, sans acompte) → traité
      // comme un paiement complet (échéance créée déjà réglée + synchro finances).
      modaliteFinale = (gen.length === 1 && gen[0].dateEcheance <= auj) ? 'complet' : 'echelonne';
    } else {
      echeancesFinales = modalitePaiement === 'echelonne' ? echeances : null;
      modaliteFinale = modalitePaiement;
      if (modalitePaiement === 'echelonne') {
        const sommeEcheances = echeances.reduce((s, e) => s + Number(e.montant), 0);
        if (Math.abs(sommeEcheances - Number(total)) > 1) {
          return res.status(400).json({ error: `La somme des échéances (${sommeEcheances}) ne correspond pas au total de la facture (${total}).` });
        }
      }
    }

    await client.query('BEGIN');

    // Statut initial : "Facturé" si tout est payé d'un coup, "Non payé" si échelonné
    const statutInitial = modaliteFinale === 'complet' ? 'Facturé' : 'Non payé';
    await client.query(
      `UPDATE devis SET statut = $1, mode_paiement = $2, modalite_paiement = $3, payment_term_id = $4 WHERE id = $5`,
      [statutInitial, modePaiement, modaliteFinale, paymentTermIdFinal, req.params.id]
    );
    await logFieldChanges(req.user.entrepriseId, 'devis', Number(req.params.id), req.user.sub,
      { statut: check.rows[0].statut }, { statut: statutInitial }, ['statut']);

    // Seul événement réel de facturation que l'app modélise — symétrique au mouvement
    // de stock complet déjà déclenché à la signature.
    await client.query(
      `UPDATE devis_lignes SET quantite_facturee = quantite WHERE devis_id = $1 AND type = 'produit'`,
      [req.params.id]
    );

    if (modaliteFinale === 'echelonne') {
      for (let i = 0; i < echeancesFinales.length; i++) {
        const e = echeancesFinales[i];
        await client.query(
          `INSERT INTO echeances_paiement (devis_id, montant, date_echeance, ordre) VALUES ($1, $2, $3, $4)`,
          [req.params.id, Number(e.montant), e.dateEcheance, i]
        );
      }
    } else {
      // Paiement complet : une échéance unique, déjà réglée
      const echeanceResult = await client.query(
        `INSERT INTO echeances_paiement (devis_id, montant, date_echeance, statut, date_paiement, ordre)
         VALUES ($1, $2, date_entreprise($3), 'Payé', now(), 0) RETURNING id`,
        [req.params.id, total, req.user.entrepriseId]
      );
      await syncDevisPaiement(req.user.entrepriseId, req.user.sub, {
        // finances est en devise ENTREPRISE (comme partout ailleurs) — jamais le total brut
        // en devise du devis.
        montant: round2(Number(total) * tauxChange),
        modePaiement,
        numero,
        clientNom: clientNomComplet,
        devisId: req.params.id,
        echeanceId: echeanceResult.rows[0].id,
      });
    }

    // ─── Étape 3b : produit une vraie facture comptable (account.move) ───
    // Le devis reste l'objet commercial ; la facture posée est la pièce comptable de
    // référence (numéro de journal, écriture équilibrée, lettrage). Les échéances déjà
    // créées ci-dessus sont rattachées AUX DEUX (devis_id + move_id).
    const journalVente = await journalParType(client, req.user.entrepriseId, 'sale');
    if (!journalVente) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Aucun journal de vente configuré — complétez la configuration comptable.' });
    }
    const lignesDevis = await client.query(
      `SELECT id, produit, type, quantite::float8 AS quantite, prix_unitaire::float8 AS "prixUnitaire",
              remise_pourcentage::float8 AS "remisePourcentage", ordre
       FROM devis_lignes WHERE devis_id = $1 ORDER BY ordre ASC, id ASC`,
      [req.params.id]
    );
    const ligneIds = lignesDevis.rows.map((l) => l.id);
    const liensTaxes = ligneIds.length
      ? await client.query(
          `SELECT devis_ligne_id AS "ligneId", tax_id AS "taxId" FROM devis_lignes_taxes
           WHERE devis_ligne_id = ANY($1::int[])`,
          [ligneIds]
        )
      : { rows: [] };
    const taxParLigne = new Map();
    for (const { ligneId, taxId } of liensTaxes.rows) {
      if (!taxParLigne.has(ligneId)) taxParLigne.set(ligneId, []);
      taxParLigne.get(ligneId).push(taxId);
    }
    // Échelonné / terme : la dernière échéance porte la date d'exigibilité.
    // Paiement complet (pas d'échéancier) : la facture est réglée le jour même —
    // invoice_date_due = aujourd'hui, aligné sur l'échéance unique créée plus haut
    // (date du jour dans le fuseau de l'entreprise, statut « Payé »), au lieu d'un J+30 fictif.
    const dueDate = echeancesFinales && echeancesFinales.length
      ? echeancesFinales[echeancesFinales.length - 1].dateEcheance
      : new Date().toISOString().slice(0, 10);

    const mv = await client.query(
      `INSERT INTO account_move
        (entreprise_id, journal_id, move_type, state, partner_id, invoice_date, invoice_date_due,
         invoice_origin, payment_term_id, user_id, devise, invoice_currency_rate)
       VALUES ($1, $2, 'out_invoice', 'draft', (SELECT client_id FROM devis WHERE id = $3),
               date_entreprise($1), $4, $5, $6, $7, $8, $9) RETURNING id`,
      [req.user.entrepriseId, journalVente.id, req.params.id, dueDate, numero, paymentTermIdFinal, req.user.sub, devise, tauxChange]
    );
    const moveId = mv.rows[0].id;
    let seqLigne = 0;
    for (const l of lignesDevis.rows) {
      seqLigne += 10;
      const isSection = l.type === 'section';
      const ins = await client.query(
        `INSERT INTO account_move_line
          (move_id, entreprise_id, display_type, sequence, name, quantity, price_unit, discount)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
        [moveId, req.user.entrepriseId, isSection ? 'line_section' : 'product', seqLigne, l.produit,
         isSection ? 0 : l.quantite, isSection ? 0 : l.prixUnitaire, isSection ? 0 : l.remisePourcentage]
      );
      for (const taxId of (taxParLigne.get(l.id) || [])) {
        await client.query(
          `INSERT INTO account_move_line_taxes (move_line_id, tax_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
          [ins.rows[0].id, taxId]
        );
      }
    }
    // Rattache les échéances (créées plus haut, devis_id) aussi au move avant le post
    // pour que posterMove ne les régénère pas depuis le terme.
    await client.query('UPDATE echeances_paiement SET move_id = $1 WHERE devis_id = $2', [moveId, req.params.id]);
    await posterMove(client, moveId, req.user.entrepriseId);
    // Paiement complet : on solde la facture comptablement (lettrage), sans redoubler le
    // miroir Finances déjà écrit par syncDevisPaiement ci-dessus.
    if (modaliteFinale === 'complet') {
      const pj = await journalParType(client, req.user.entrepriseId, modePaiement === 'Espèces' ? 'cash' : 'bank');
      await enregistrerPaiementMove(client, {
        moveId, entrepriseId: req.user.entrepriseId, userId: req.user.sub,
        amount: Number(total), paymentDate: new Date().toISOString().slice(0, 10),
        journalId: pj ? pj.id : undefined, skipFinanceMirror: true,
      });
    }
    await client.query('UPDATE devis SET move_id = $1 WHERE id = $2', [moveId, req.params.id]);

    await client.query('COMMIT');

    await logAuditEvent({
      entrepriseId: req.user.entrepriseId, userId: req.user.sub, email: req.user.email, action: 'devis_facture', req,
      details: {
        devisId: Number(req.params.id), numero, total: Number(total), modePaiement,
        modalitePaiement: modaliteFinale, paymentTermId: paymentTermIdFinal,
        nbEcheances: modaliteFinale === 'echelonne' ? echeancesFinales.length : 1,
      },
    });

    const devis = await getDevisComplet(req.params.id, req.user.entrepriseId);
    return res.json({ devis });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[POST /devis/:id/facturer]', err);
    return res.status(500).json({ error: 'Erreur lors de la conversion en facture.' });
  } finally {
    client.release();
  }
});

// Annule la facturation et remet le devis en brouillon : supprime les échéances
// et les entrées Finances liées, réinitialise le mode/modalité de paiement.
// Statuts atteignables seulement après le passage à "Signé" — c'est à ce moment-là que
// le stock a été décrémenté (voir applyVenteLignesToStock), donc c'est le signal pour
// savoir s'il faut le restituer ici.
const STATUTS_APRES_SIGNATURE = ['Signé', 'Facturé', 'Non payé', 'Payé partiellement', 'Payé'];

router.post('/:id/remettre-brouillon', authRequired, async (req, res) => {
  const client = await pool.connect();
  try {
    const check = await client.query(
      `SELECT d.statut, d.numero, d.move_id AS "moveId", m.inalterable_hash AS "moveHash",
              EXISTS (SELECT 1 FROM account_move rm WHERE rm.reversed_entry_id = d.move_id) AS "aDesAvoirs"
       FROM devis d LEFT JOIN account_move m ON m.id = d.move_id
       WHERE d.id = $1 AND d.entreprise_id = $2`,
      [req.params.id, req.user.entrepriseId]
    );
    if (check.rows.length === 0) {
      return res.status(404).json({ error: 'Devis introuvable.' }); // client libéré par le finally
    }
    const statutAvant = check.rows[0].statut;
    const moveId = check.rows[0].moveId;
    if (check.rows[0].moveHash) {
      return res.status(400).json({ error: 'La facture liée est sécurisée (inaltérable) — créez un avoir plutôt que de remettre le devis en brouillon.' });
    }
    if (check.rows[0].aDesAvoirs) {
      return res.status(400).json({ error: 'La facture liée a des avoirs — remise en brouillon impossible.' });
    }

    await client.query('BEGIN');

    // Supprime toutes les entrées Finances liées aux échéances de ce devis
    await client.query(`DELETE FROM finances WHERE source_module = 'Devis' AND source_mouvement_id IN (SELECT id FROM echeances_paiement WHERE devis_id = $1)`, [req.params.id]);
    // Supprime les échéances elles-mêmes
    await client.query(`DELETE FROM echeances_paiement WHERE devis_id = $1`, [req.params.id]);

    // Étape 3b : défait aussi la facture comptable liée (undo pré-production). On retire les
    // écritures de paiement lettrées contre elle, puis la facture elle-même (ses lignes +
    // liens de taxes + partiels de lettrage cascadent). Le numéro de journal consommé n'est
    // pas restitué (un trou de séquence est acceptable ici).
    if (moveId) {
      const payMoves = await client.query(
        `SELECT DISTINCT pml.move_id AS id
         FROM account_partial_reconcile apr
         JOIN account_move_line iml ON iml.id IN (apr.debit_move_line_id, apr.credit_move_line_id) AND iml.move_id = $1
         JOIN account_move_line pml ON pml.id IN (apr.debit_move_line_id, apr.credit_move_line_id) AND pml.move_id <> $1`,
        [moveId]
      );
      const payMoveIds = payMoves.rows.map((r) => r.id);
      if (payMoveIds.length) {
        await client.query('DELETE FROM finances WHERE source_module = $1 AND source_mouvement_id IN (SELECT id FROM account_payment WHERE move_id = ANY($2::int[]))', ['Facture', payMoveIds]);
        await client.query('DELETE FROM account_payment WHERE move_id = ANY($1::int[])', [payMoveIds]);
        await client.query('DELETE FROM account_move WHERE id = ANY($1::int[])', [payMoveIds]);
      }
      await client.query('DELETE FROM account_move WHERE id = $1 AND entreprise_id = $2', [moveId, req.user.entrepriseId]);
      await client.query(
        `DELETE FROM account_full_reconcile fr WHERE fr.entreprise_id = $1
           AND NOT EXISTS (SELECT 1 FROM account_partial_reconcile apr WHERE apr.full_reconcile_id = fr.id)`,
        [req.user.entrepriseId]
      );
    }

    // Réinitialise le devis en brouillon
    await client.query(
      `UPDATE devis SET statut = 'Brouillon', mode_paiement = NULL, modalite_paiement = NULL, payment_term_id = NULL,
       move_id = NULL,
       signature_data = NULL, signataire_nom = NULL, date_signature = NULL, token_public = NULL
       WHERE id = $1`,
      [req.params.id]
    );

    await client.query('COMMIT');
    await logFieldChanges(req.user.entrepriseId, 'devis', Number(req.params.id), req.user.sub,
      { statut: statutAvant }, { statut: 'Brouillon' }, ['statut']);
    await logAuditEvent({
      entrepriseId: req.user.entrepriseId, userId: req.user.sub, email: req.user.email, action: 'devis_remis_brouillon', req,
      details: { devisId: Number(req.params.id), numero: check.rows[0].numero, statutAvant },
    });

    if (STATUTS_APRES_SIGNATURE.includes(statutAvant)) {
      const lignesResult = await pool.query(
        'SELECT produit, quantite::float8 AS quantite, stock_id AS "stockId", stock_module AS "stockModule", uom_id AS "uomId" FROM devis_lignes WHERE devis_id = $1',
        [req.params.id]
      );
      await reverseVenteLignesToStock(req.user.entrepriseId, lignesResult.rows, {
        userId: req.user.sub, documentType: 'devis', documentId: Number(req.params.id), raison: 'devis_remise_en_brouillon',
      });
    }

    const devis = await getDevisComplet(req.params.id, req.user.entrepriseId);
    return res.json({ devis });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[POST /devis/:id/remettre-brouillon]', err);
    return res.status(500).json({ error: 'Erreur lors de la remise en brouillon.' });
  } finally {
    client.release();
  }
});

router.post('/:id/echeances/:echeanceId/payer', authRequired, async (req, res) => {
  const client = await pool.connect();
  try {
    const devisResult = await client.query(
      `SELECT d.mode_paiement AS "modePaiement", d.numero, d.statut, d.move_id AS "moveId",
              COALESCE(d.taux_change, 1)::float8 AS "tauxChange",
              c.nom AS "clientNom", c.prenom AS "clientPrenom"
       FROM devis d LEFT JOIN contacts c ON c.id = d.client_id
       WHERE d.id = $1 AND d.entreprise_id = $2`,
      [req.params.id, req.user.entrepriseId]
    );
    if (devisResult.rows.length === 0) return res.status(404).json({ error: 'Devis introuvable.' });

    const echeanceResult = await client.query(
      `SELECT id, montant::float8 AS montant, statut FROM echeances_paiement WHERE id = $1 AND devis_id = $2`,
      [req.params.echeanceId, req.params.id]
    );
    if (echeanceResult.rows.length === 0) return res.status(404).json({ error: 'Échéance introuvable.' });
    if (echeanceResult.rows[0].statut === 'Payé') {
      return res.status(400).json({ error: 'Cette échéance est déjà marquée comme payée.' });
    }

    const { modePaiement, numero, clientNom, clientPrenom, moveId, tauxChange } = devisResult.rows[0];
    const clientNomComplet = `${clientPrenom || ''} ${clientNom || ''}`.trim();

    await client.query('BEGIN');
    await client.query(`UPDATE echeances_paiement SET statut = 'Payé', date_paiement = now() WHERE id = $1`, [req.params.echeanceId]);

    await syncDevisPaiement(req.user.entrepriseId, req.user.sub, {
      // finances est en devise ENTREPRISE — jamais le montant brut de l'échéance (devise du devis).
      montant: round2(echeanceResult.rows[0].montant * tauxChange),
      modePaiement,
      numero,
      clientNom: clientNomComplet,
      devisId: req.params.id,
      echeanceId: req.params.echeanceId,
    });

    // Étape 3b : si une facture comptable est liée, on y enregistre le paiement (lettrage,
    // payment_state) — le miroir Finances a déjà été écrit ci-dessus (skipFinanceMirror).
    // Si ça échoue, toute la transaction est annulée : pas de paiement enregistré sans
    // son écriture comptable.
    if (moveId) {
      await enregistrerPaiementMove(client, {
        moveId, entrepriseId: req.user.entrepriseId, userId: req.user.sub,
        amount: echeanceResult.rows[0].montant,
        skipFinanceMirror: true, skipEcheanceAllocation: true,
      });
    }

    // Recalcule le statut global du devis selon l'état de toutes ses échéances
    const toutesEcheances = await client.query(`SELECT statut FROM echeances_paiement WHERE devis_id = $1`, [req.params.id]);
    const toutesPayees = toutesEcheances.rows.every(e => e.statut === 'Payé');
    const auMoinsUnePayee = toutesEcheances.rows.some(e => e.statut === 'Payé');
    const nouveauStatut = toutesPayees ? 'Facturé' : auMoinsUnePayee ? 'Payé partiellement' : 'Non payé';

    await client.query(`UPDATE devis SET statut = $1 WHERE id = $2`, [nouveauStatut, req.params.id]);
    await client.query('COMMIT');

    await logFieldChanges(req.user.entrepriseId, 'devis', Number(req.params.id), req.user.sub,
      { statut: devisResult.rows[0].statut }, { statut: nouveauStatut }, ['statut']);
    await logAuditEvent({
      entrepriseId: req.user.entrepriseId, userId: req.user.sub, email: req.user.email, action: 'devis_echeance_payee', req,
      details: {
        devisId: Number(req.params.id), numero, echeanceId: Number(req.params.echeanceId),
        montant: echeanceResult.rows[0].montant, nouveauStatut,
      },
    });

    const devis = await getDevisComplet(req.params.id, req.user.entrepriseId);
    return res.json({ devis });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('[POST /devis/:id/echeances/:echeanceId/payer]', err);
    return res.status(500).json({ error: 'Erreur lors du paiement.' });
  } finally {
    client.release();
  }
});


// PDF public (via le lien envoyé au client, sans authentification)
router.get('/public/:token/pdf', async (req, res) => {
  try {
    const devisResult = await pool.query(
      `SELECT d.id, d.numero, d.statut, d.date, d.total::float8 AS total, d.notes,
              d.signature_data AS "signatureData", d.signataire_nom AS "signataireNom", d.date_signature AS "dateSignature",
              c.nom AS "clientNom", c.prenom AS "clientPrenom", e.nom AS "entrepriseNom",
              -- Le PDF public doit porter le même numéro que celui du propriétaire : cette route
              -- construit son propre SELECT au lieu de passer par getDevisComplet, donc la facture
              -- liée doit être jointe ici aussi, sans quoi le client recevrait « DEVIS ».
              m.name AS "factureNom"
       FROM devis d
       LEFT JOIN contacts c ON c.id = d.client_id
       LEFT JOIN entreprises e ON e.id = d.entreprise_id
       LEFT JOIN account_move m ON m.id = d.move_id
       WHERE d.token_public = $1`,
      [req.params.token]
    );
    if (devisResult.rows.length === 0) return res.status(404).json({ error: 'Devis introuvable.' });

    const devis = devisResult.rows[0];
    const lignesResult = await pool.query(
      `SELECT id, produit, type, quantite::float8 AS quantite, prix_unitaire::float8 AS "prixUnitaire",
              remise_pourcentage::float8 AS "remisePourcentage", recolte_id AS "recolteId"
       FROM devis_lignes WHERE devis_id = $1 ORDER BY ordre ASC`,
      [devis.id]
    );
    const ligneIds = lignesResult.rows.map((l) => l.id);
    const liensResult = ligneIds.length
      ? await pool.query(
          `SELECT devis_ligne_id AS "ligneId", tax_id AS "taxId" FROM devis_lignes_taxes
           WHERE devis_ligne_id = ANY($1::int[])`,
          [ligneIds]
        )
      : { rows: [] };
    const taxIdsParLigne = new Map();
    for (const { ligneId, taxId } of liensResult.rows) {
      if (!taxIdsParLigne.has(ligneId)) taxIdsParLigne.set(ligneId, []);
      taxIdsParLigne.get(ligneId).push(taxId);
    }
    devis.lignes = lignesResult.rows.map((l) => ({ ...l, taxIds: taxIdsParLigne.get(l.id) || [] }));
    const { rows: taxesRef } = await pool.query(
      `SELECT id, name, amount_type AS "amountType", amount::float8 AS amount,
              price_include AS "priceInclude", include_base_amount AS "includeBaseAmount", sequence
       FROM account_tax WHERE entreprise_id = (SELECT entreprise_id FROM devis WHERE id = $1) AND active = TRUE`,
      [devis.id]
    );
    devis.taxes = taxesRef;

    streamDevisPdf(res, devis);
  } catch (err) {
    console.error('[GET /devis/public/:token/pdf]', err);
    return res.status(500).json({ error: 'Erreur lors de la génération du PDF.' });
  }
});

// Suivi manuel des quantités livrée/facturée par ligne — accessible à n'importe quel
// statut (contrairement à PUT /:id, verrouillé en Brouillon), puisque ces champs n'ont
// de sens qu'une fois le devis signé/facturé. Aucun verrou de statut ici : réinscriptible
// même après l'auto-remplissage de POST /:id/facturer.
router.patch('/:id/lignes-quantites', authRequired, async (req, res) => {
  const { lignes } = req.body;
  if (!Array.isArray(lignes) || lignes.length === 0) {
    return res.status(400).json({ error: 'Au moins une ligne est requise.' });
  }
  const client = await pool.connect();
  try {
    const check = await client.query('SELECT id, numero FROM devis WHERE id = $1 AND entreprise_id = $2', [req.params.id, req.user.entrepriseId]);
    if (check.rows.length === 0) {
      client.release();
      return res.status(404).json({ error: 'Devis introuvable.' });
    }
    await client.query('BEGIN');
    for (const l of lignes) {
      await client.query(
        `UPDATE devis_lignes SET quantite_livree = $1, quantite_facturee = $2
         WHERE id = $3 AND devis_id = $4 AND type = 'produit'`,
        [Number(l.quantiteLivree) || 0, Number(l.quantiteFacturee) || 0, l.id, req.params.id]
      );
    }
    await client.query('COMMIT');
    await logAuditEvent({
      entrepriseId: req.user.entrepriseId, userId: req.user.sub, email: req.user.email, action: 'devis_quantites_ajustees', req,
      details: { devisId: Number(req.params.id), numero: check.rows[0].numero, nbLignes: lignes.length },
    });
    const devis = await getDevisComplet(req.params.id, req.user.entrepriseId);
    return res.json({ devis });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[PATCH /devis/:id/lignes-quantites]', err);
    return res.status(500).json({ error: 'Erreur lors de la mise à jour des quantités.' });
  } finally {
    client.release();
  }
});

// PDF pour le propriétaire (authentifié), n'importe quel statut
router.get('/:id/pdf', authRequired, async (req, res) => {
  try {
    const devis = await getDevisComplet(req.params.id, req.user.entrepriseId);
    if (!devis) return res.status(404).json({ error: 'Devis introuvable.' });

    const entrepriseResult = await pool.query('SELECT nom FROM entreprises WHERE id = $1', [req.user.entrepriseId]);
    devis.entrepriseNom = entrepriseResult.rows[0]?.nom || 'Entreprise';

    streamDevisPdf(res, devis);
  } catch (err) {
    console.error('[GET /devis/:id/pdf]', err);
    return res.status(500).json({ error: 'Erreur lors de la génération du PDF.' });
  }
});


export default router;