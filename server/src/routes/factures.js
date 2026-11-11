// Factures (account.move + account.move.line) — pièce comptable en double-partie, distincte
// du devis. Calqué sur account.move d'un ERP de référence : brouillon → posté → annulé, un
// numéro attribué par le journal au post (utils/journalSequence.js), des lignes dont
// l'ensemble est équilibré (Σdébit = Σcrédit), un moteur de lettrage
// (account_partial_reconcile / account_full_reconcile) alimenté par register-payment.
//
// POST /api/devis/:id/facturer n'est PAS encore rebranché ici (étape 3b) — cette route est
// autonome pour l'instant.
import express from 'express';
import { authRequired } from '../middleware/auth.js';
import { pool } from '../db.js';
import { appliquerTaxesLigne } from '../utils/taxeCompute.js';
import {
  round2, chargerTaxMap, journalParType, posterMove, enregistrerPaiementMove,
  verifierChaineJournal, reverseMove, allouerAvoir,
} from '../utils/accountMove.js';

const router = express.Router();
const ecriture = [authRequired];

const INVOICE_TYPES = ['out_invoice', 'out_refund', 'in_invoice', 'in_refund'];

const MOVE_COLUMNS = `
  m.id, m.entreprise_id AS "entrepriseId", m.journal_id AS "journalId", m.move_type AS "moveType",
  m.state, m.name, m.ref, m.partner_id AS "partnerId",
  to_char(m.invoice_date, 'YYYY-MM-DD') AS "invoiceDate",
  to_char(m.invoice_date_due, 'YYYY-MM-DD') AS "invoiceDateDue",
  to_char(m.date, 'YYYY-MM-DD') AS "date",
  m.invoice_origin AS "invoiceOrigin", m.payment_term_id AS "paymentTermId",
  m.amount_untaxed::float8 AS "amountUntaxed", m.amount_tax::float8 AS "amountTax",
  m.amount_total::float8 AS "amountTotal", m.amount_residual::float8 AS "amountResidual",
  COALESCE(m.devise, e.devise) AS devise, COALESCE(m.invoice_currency_rate, 1)::float8 AS "invoiceCurrencyRate",
  ROUND(m.amount_total * COALESCE(m.invoice_currency_rate, 1), 2)::float8 AS "amountTotalDeviseEntreprise",
  m.payment_state AS "paymentState", m.reversed_entry_id AS "reversedEntryId",
  m.inalterable_hash AS "inalterableHash", m.secure_sequence_number AS "secureSequenceNumber",
  m.relance_niveau AS "relanceNiveau", to_char(m.derniere_relance, 'YYYY-MM-DD') AS "derniereRelance",
  m.created_at AS "createdAt",
  COALESCE(NULLIF(TRIM(CONCAT(c.prenom, ' ', c.nom)), ''), c.nom) AS "partnerName",
  (SELECT name FROM account_move o WHERE o.id = m.reversed_entry_id) AS "reversedEntryName",
  (SELECT string_agg(rm.name, ', ' ORDER BY rm.id) FROM account_move rm WHERE rm.reversed_entry_id = m.id) AS "reversalMoveNames"
`;

// ─── Helpers ───────────────────────────────────────────────────────────────
// chargerTaxMap / journalParType / posterMove / enregistrerPaiementMove vivent dans
// utils/accountMove.js (partagés avec routes/devis.js:facturer, étape 3b).

// Normalise une ligne reçue du client.
function normLigne(l, i) {
  const dt = ['product', 'line_section', 'line_note'].includes(l?.displayType) ? l.displayType : 'product';
  const section = dt !== 'product';
  return {
    displayType: dt,
    name: l.name || l.produit || '',
    sequence: Number.isInteger(l.sequence) ? l.sequence : (i + 1) * 10,
    quantity: section ? 0 : (Number(l.quantity) || 0),
    priceUnit: section ? 0 : (Number(l.priceUnit) || 0),
    discount: section ? 0 : Math.min(100, Math.max(0, Number(l.discount) || 0)),
    taxIds: section ? [] : [...new Set(
      (Array.isArray(l.taxIds) ? l.taxIds : []).map(Number).filter((n) => Number.isInteger(n) && n > 0)
    )],
  };
}

// Calcule les totaux (HT, taxe, TTC) + la ventilation par taxe à partir des lignes
// normalisées et de la taxMap. Ne touche pas au débit/crédit (fait au post).
function calculerTotaux(lignes, taxMap) {
  let amountUntaxed = 0;
  let amountTax = 0;
  const parTaxe = new Map(); // taxId -> montant cumulé
  const perLigne = [];
  for (const l of lignes) {
    if (l.displayType !== 'product') { perLigne.push({ ...l, priceSubtotal: 0, priceTotal: 0 }); continue; }
    const brut = l.quantity * l.priceUnit * (1 - l.discount / 100);
    const taxes = l.taxIds.map((id) => taxMap.get(id)).filter(Boolean);
    const { base, taxeTotale, parTaxe: pt } = taxes.length
      ? appliquerTaxesLigne(brut, l.quantity, taxes)
      : { base: brut, taxeTotale: 0, parTaxe: new Map() };
    amountUntaxed += base;
    amountTax += taxeTotale;
    for (const [taxId, montant] of pt) parTaxe.set(taxId, (parTaxe.get(taxId) || 0) + montant);
    perLigne.push({ ...l, priceSubtotal: round2(base), priceTotal: round2(base + taxeTotale) });
  }
  return {
    amountUntaxed: round2(amountUntaxed),
    amountTax: round2(amountTax),
    amountTotal: round2(amountUntaxed + amountTax),
    parTaxe,
    perLigne,
  };
}

// Récupère une facture complète (en-tête + lignes + taxes + échéances + paiements/lettrages).
async function getFactureComplete(id, entrepriseId) {
  const m = await pool.query(
    `SELECT ${MOVE_COLUMNS} FROM account_move m
     LEFT JOIN contacts c ON c.id = m.partner_id
     JOIN entreprises e ON e.id = m.entreprise_id
     WHERE m.id = $1 AND m.entreprise_id = $2`,
    [id, entrepriseId]
  );
  if (m.rows.length === 0) return null;
  const lignes = await pool.query(
    `SELECT l.id, l.display_type AS "displayType", l.sequence, l.account_id AS "accountId", l.name,
            l.quantity::float8 AS quantity, l.price_unit::float8 AS "priceUnit", l.discount::float8 AS discount,
            l.price_subtotal::float8 AS "priceSubtotal", l.price_total::float8 AS "priceTotal",
            l.debit::float8 AS debit, l.credit::float8 AS credit, l.balance::float8 AS balance,
            l.amount_currency::float8 AS "amountCurrency",
            l.tax_line_id AS "taxLineId", l.amount_residual::float8 AS "amountResidual",
            l.reconciled, l.matching_number AS "matchingNumber",
            to_char(l.date_maturity, 'YYYY-MM-DD') AS "dateMaturity",
            a.code AS "accountCode", a.name AS "accountName"
     FROM account_move_line l
     LEFT JOIN account_account a ON a.id = l.account_id
     WHERE l.move_id = $1 ORDER BY l.sequence ASC, l.id ASC`,
    [id]
  );
  const ligneIds = lignes.rows.map((l) => l.id);
  const liens = ligneIds.length
    ? await pool.query(
        `SELECT move_line_id AS "ligneId", tax_id AS "taxId" FROM account_move_line_taxes
         WHERE move_line_id = ANY($1::int[])`,
        [ligneIds]
      )
    : { rows: [] };
  const taxParLigne = new Map();
  for (const { ligneId, taxId } of liens.rows) {
    if (!taxParLigne.has(ligneId)) taxParLigne.set(ligneId, []);
    taxParLigne.get(ligneId).push(taxId);
  }
  const echeances = await pool.query(
    `SELECT id, montant::float8 AS montant, to_char(date_echeance, 'YYYY-MM-DD') AS "dateEcheance",
            statut, ordre
     FROM echeances_paiement WHERE move_id = $1 ORDER BY ordre ASC`,
    [id]
  );
  const paiements = await pool.query(
    `SELECT DISTINCT p.id, p.amount::float8 AS amount, to_char(p.payment_date, 'YYYY-MM-DD') AS "paymentDate",
            p.payment_type AS "paymentType", p.state, p.ref, p.journal_id AS "journalId",
            pm.name AS "paymentMoveName"
     FROM account_payment p
     JOIN account_move_line pl ON pl.move_id = p.move_id
     JOIN account_partial_reconcile apr
       ON apr.debit_move_line_id = pl.id OR apr.credit_move_line_id = pl.id
     JOIN account_move_line il
       ON (il.id = apr.debit_move_line_id OR il.id = apr.credit_move_line_id) AND il.move_id = $1
     LEFT JOIN account_move pm ON pm.id = p.move_id
     WHERE p.entreprise_id = $2
     ORDER BY p.id ASC`,
    [id, entrepriseId]
  );
  const taxes = await pool.query(
    `SELECT id, name, amount_type AS "amountType", amount::float8 AS amount
     FROM account_tax WHERE entreprise_id = $1 AND active = TRUE ORDER BY sequence ASC, id ASC`,
    [entrepriseId]
  );
  return {
    ...m.rows[0],
    lignes: lignes.rows.map((l) => ({ ...l, taxIds: taxParLigne.get(l.id) || [] })),
    echeances: echeances.rows,
    paiements: paiements.rows,
    taxes: taxes.rows,
  };
}

// ─── GET /api/factures ─────────────────────────────────────────────────────
router.get('/', authRequired, async (req, res) => {
  const { moveType, state, partnerId } = req.query;
  const cond = ['m.entreprise_id = $1'];
  const params = [req.user.entrepriseId];
  if (moveType) {
    params.push(moveType);
    cond.push(`m.move_type = $${params.length}`);
  } else {
    // Par défaut la liste "Factures" ne montre que les factures/avoirs — jamais les
    // écritures `entry` (contreparties de paiement `account_payment`), qui n'ont pas
    // de sens comme "facture" et affichaient un chip d'état de paiement trompeur.
    params.push(INVOICE_TYPES);
    cond.push(`m.move_type = ANY($${params.length})`);
  }
  if (state) { params.push(state); cond.push(`m.state = $${params.length}`); }
  if (partnerId) { params.push(partnerId); cond.push(`m.partner_id = $${params.length}`); }
  try {
    const { rows } = await pool.query(
      `SELECT ${MOVE_COLUMNS} FROM account_move m
       LEFT JOIN contacts c ON c.id = m.partner_id
       JOIN entreprises e ON e.id = m.entreprise_id
       WHERE ${cond.join(' AND ')} ORDER BY m.id DESC`,
      params
    );
    return res.json({ factures: rows });
  } catch (err) {
    console.error('[GET /factures]', err);
    return res.status(500).json({ error: 'Erreur lors de la récupération des factures.' });
  }
});

// ─── GET /api/factures/aged-receivable?date= ─── (balance âgée client)
// Déclarée avant /:id. Ventile le reste dû des factures client postées par ancienneté vs
// leur date d'échéance. Les avoirs (out_refund) comptent en négatif ; les factures annulées
// par un avoir (payment_state 'reversed') sont exclues.
router.get('/aged-receivable', authRequired, async (req, res) => {
  const asOf = /^\d{4}-\d{2}-\d{2}$/.test(req.query.date || '') ? req.query.date : new Date().toISOString().slice(0, 10);
  try {
    const { rows } = await pool.query(
      `SELECT m.partner_id AS "partnerId",
              COALESCE(NULLIF(TRIM(CONCAT(c.prenom, ' ', c.nom)), ''), c.nom, 'Client') AS "partnerName",
              -- Multi-devise réel : amount_residual d'un account_move est dans la devise DU
              -- DOCUMENT (contrairement à account_move_line.amount_residual, qui appartient au
              -- grand livre et est donc déjà en devise entreprise). Ce rapport AGRÈGE plusieurs
              -- factures entre elles, donc chaque résidu est converti en devise entreprise au
              -- taux figé de sa propre facture avant d'être sommé — sans quoi des euros
              -- s'additionnent à des francs CFA et le total est faux.
              ROUND((CASE WHEN m.move_type = 'out_refund' THEN -1 ELSE 1 END)
                    * m.amount_residual * COALESCE(m.invoice_currency_rate, 1), 2)::float8 AS residu,
              ($1::date - COALESCE(m.invoice_date_due, m.invoice_date, m.date)) AS jours
       FROM account_move m
       LEFT JOIN contacts c ON c.id = m.partner_id
       WHERE m.entreprise_id = $2 AND m.state = 'posted'
         AND m.move_type IN ('out_invoice', 'out_refund')
         AND m.payment_state <> 'reversed'
         AND m.amount_residual > 0`,
      [asOf, req.user.entrepriseId]
    );
    const parPartenaire = new Map();
    const vide = () => ({ notDue: 0, d1_30: 0, d31_60: 0, d61_90: 0, d90plus: 0, total: 0 });
    for (const r of rows) {
      if (!parPartenaire.has(r.partnerId)) parPartenaire.set(r.partnerId, { partnerId: r.partnerId, partnerName: r.partnerName, buckets: vide() });
      const b = parPartenaire.get(r.partnerId).buckets;
      const j = Number(r.jours);
      const k = j <= 0 ? 'notDue' : j <= 30 ? 'd1_30' : j <= 60 ? 'd31_60' : j <= 90 ? 'd61_90' : 'd90plus';
      b[k] = round2(b[k] + r.residu);
      b.total = round2(b.total + r.residu);
    }
    const partners = [...parPartenaire.values()].sort((a, b) => b.buckets.total - a.buckets.total);
    const totals = vide();
    for (const p of partners) for (const k of Object.keys(totals)) totals[k] = round2(totals[k] + p.buckets[k]);
    return res.json({ asOf, partners, totals });
  } catch (err) {
    console.error('[GET /factures/aged-receivable]', err);
    return res.status(500).json({ error: 'Erreur lors du calcul de la balance âgée.' });
  }
});

// ─── GET /api/factures/overdue ─── (factures client en retard, pour les relances)
router.get('/overdue', authRequired, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT ${MOVE_COLUMNS},
              (date_entreprise(m.entreprise_id) - COALESCE(m.invoice_date_due, m.invoice_date, m.date)) AS "daysOverdue"
       FROM account_move m
       LEFT JOIN contacts c ON c.id = m.partner_id
       JOIN entreprises e ON e.id = m.entreprise_id
       WHERE m.entreprise_id = $1 AND m.state = 'posted' AND m.move_type = 'out_invoice'
         AND m.payment_state IN ('not_paid', 'partial')
         AND COALESCE(m.invoice_date_due, m.invoice_date, m.date) < date_entreprise(m.entreprise_id)
       ORDER BY COALESCE(m.invoice_date_due, m.invoice_date, m.date) ASC`,
      [req.user.entrepriseId]
    );
    return res.json({ factures: rows });
  } catch (err) {
    console.error('[GET /factures/overdue]', err);
    return res.status(500).json({ error: 'Erreur lors de la récupération des impayés.' });
  }
});

// ─── POST /api/factures/:id/mark-reminded ─── (incrémente le compteur de relance)
router.post('/:id/mark-reminded', ...ecriture, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `UPDATE account_move SET relance_niveau = relance_niveau + 1, derniere_relance = date_entreprise($2)
       WHERE id = $1 AND entreprise_id = $2 AND move_type = 'out_invoice' AND state = 'posted'
       RETURNING id`,
      [req.params.id, req.user.entrepriseId]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Facture introuvable ou non applicable.' });
    return res.json({ facture: await getFactureComplete(req.params.id, req.user.entrepriseId) });
  } catch (err) {
    console.error('[POST /factures/:id/mark-reminded]', err);
    return res.status(500).json({ error: 'Erreur lors de l’enregistrement de la relance.' });
  }
});

// ─── GET /api/factures/credit-notes-unallocated ─── (avoirs postés à imputer)
// Déclarée avant /:id. Avoirs out_refund/in_refund postés dont la ligne payment_term
// garde un résiduel — à affecter sur une facture ouverte du même partenaire.
router.get('/credit-notes-unallocated', authRequired, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT m.id, m.name, m.move_type AS "moveType", m.partner_id AS "partnerId",
              to_char(m.invoice_date, 'YYYY-MM-DD') AS "invoiceDate", m.ref,
              ABS(pl.amount_residual::float8) AS "unallocated",
              COALESCE(NULLIF(TRIM(CONCAT(c.prenom, ' ', c.nom)), ''), c.nom) AS "partnerName"
       FROM account_move m
       JOIN account_move_line pl ON pl.move_id = m.id AND pl.display_type = 'payment_term'
       LEFT JOIN contacts c ON c.id = m.partner_id
       WHERE m.entreprise_id = $1 AND m.state = 'posted'
         AND m.move_type IN ('out_refund', 'in_refund')
         AND ABS(pl.amount_residual::float8) > 0.01
       ORDER BY m.id DESC`,
      [req.user.entrepriseId]
    );
    return res.json({ creditNotes: rows });
  } catch (err) {
    console.error('[GET /factures/credit-notes-unallocated]', err);
    return res.status(500).json({ error: 'Erreur lors de la récupération des avoirs.' });
  }
});

// ─── POST /api/factures/:id/allocate-credit ─── (:id = l'avoir ; body { invoiceId, amount })
router.post('/:id/allocate-credit', ...ecriture, async (req, res) => {
  const { invoiceId, amount } = req.body;
  if (!invoiceId) return res.status(400).json({ error: 'invoiceId requis.' });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const r = await allouerAvoir(client, {
      creditNoteId: Number(req.params.id), moveId: Number(invoiceId), amount, entrepriseId: req.user.entrepriseId,
    });
    await client.query('COMMIT');
    return res.json({ allocation: r });
  } catch (err) {
    await client.query('ROLLBACK');
    if (!err.status) console.error('[POST /factures/:id/allocate-credit]', err);
    return res.status(err.status || 500).json({ error: err.status ? err.message : "Erreur lors de l'affectation de l'avoir." });
  } finally {
    client.release();
  }
});

// ─── GET /api/factures/verify-hash?journalId= ─── (contrôle d'intégrité de la chaîne)
// Déclarée avant /:id pour ne pas être capturée par celle-ci.
router.get('/verify-hash', ...ecriture, async (req, res) => {
  const journalId = Number(req.query.journalId);
  if (!journalId) return res.status(400).json({ error: 'journalId requis.' });
  try {
    const jr = await pool.query(
      'SELECT restrict_mode_hash_table AS "hashOn" FROM account_journal WHERE id = $1 AND entreprise_id = $2',
      [journalId, req.user.entrepriseId]
    );
    if (jr.rows.length === 0) return res.status(404).json({ error: 'Journal introuvable.' });
    const result = await verifierChaineJournal(pool, journalId, req.user.entrepriseId);
    return res.json({ ...result, hashMode: jr.rows[0].hashOn });
  } catch (err) {
    console.error('[GET /factures/verify-hash]', err);
    return res.status(500).json({ error: 'Erreur lors de la vérification.' });
  }
});
// ─── États comptables : grand livre et balance générale ───
//
// La comptabilité en partie double était complète — écritures, journaux, plan de comptes,
// lettrage, avoirs, écart de change — mais aucun état n'en sortait : on saisissait juste, on ne
// pouvait rien lire. L'audit du 2026-09-10 l'a posé comme le manque principal du module.
//
// Trois règles communes aux deux états :
//   1. Seules les pièces "posted" comptent. Un brouillon n'est pas une écriture comptable ;
//      l'inclure fausserait la balance et ferait mentir l'égalité débit = crédit.
//   2. La date qui fait foi est account_move.date (la date comptable), pas invoice_date.
//      account_move_line ne porte pas de date : elle appartient à la pièce.
//   3. Les montants viennent de debit/credit, toujours en devise de l'entreprise (voir
//      utils/accountMove.js). Ne JAMAIS leur appliquer un formatage en devise du document —
//      c'est le piège documenté dans CLAUDE.md sur les écrans multi-devises.
//
// Déclarées AVANT GET /:id, comme aged-receivable et overdue : sans cela "/grand-livre" serait
// capté comme un identifiant.

// Période par défaut : l'année civile en cours de l'entreprise, dans son propre fuseau.
async function resoudrePeriode(entrepriseId, query) {
  const { rows } = await pool.query(
    "SELECT to_char(date_trunc('year', date_entreprise($1)), 'YYYY-MM-DD') AS debut, to_char(date_entreprise($1), 'YYYY-MM-DD') AS fin",
    [entrepriseId]
  );
  const estIso = (v) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);
  return {
    debut: estIso(query.dateDebut) ? query.dateDebut : rows[0].debut,
    fin: estIso(query.dateFin) ? query.dateFin : rows[0].fin,
  };
}

router.get('/grand-livre', authRequired, async (req, res) => {
  try {
    const { debut, fin } = await resoudrePeriode(req.user.entrepriseId, req.query);
    const compteId = Number(req.query.compteId) || null;

    const paramsLignes = [req.user.entrepriseId, debut, fin];
    const paramsOuverture = [req.user.entrepriseId, debut];
    let filtreLignes = '';
    let filtreOuverture = '';
    if (compteId) {
      paramsLignes.push(compteId);
      paramsOuverture.push(compteId);
      filtreLignes = ` AND a.id = $${paramsLignes.length}`;
      filtreOuverture = ` AND a.id = $${paramsOuverture.length}`;
    }

    // Solde d'ouverture par compte : tout ce qui précède la période. Sans lui, le solde
    // progressif partirait de zéro et ne voudrait rien dire au milieu d'un exercice.
    const ouvertures = await pool.query(
      `SELECT l.account_id AS "compteId",
              COALESCE(SUM(l.debit - l.credit), 0)::float8 AS ouverture
         FROM account_move_line l
         JOIN account_move m ON m.id = l.move_id
         JOIN account_account a ON a.id = l.account_id
        WHERE l.entreprise_id = $1 AND m.state = 'posted' AND m.date < $2${filtreOuverture}
        GROUP BY l.account_id`,
      paramsOuverture
    );
    const ouvertureParCompte = new Map(ouvertures.rows.map(r => [r.compteId, r.ouverture]));

    const lignes = await pool.query(
      `SELECT a.id AS "compteId", a.code AS "compteCode", a.name AS "compteNom",
              a.account_type AS "compteType",
              to_char(m.date, 'YYYY-MM-DD') AS date,
              m.id AS "moveId", m.name AS "pieceNom",
              j.code AS "journalCode",
              l.name AS libelle,
              COALESCE(NULLIF(btrim(COALESCE(c.prenom, '') || ' ' || c.nom), ''), '') AS "partenaireNom",
              l.debit::float8 AS debit, l.credit::float8 AS credit,
              l.matching_number AS lettrage
         FROM account_move_line l
         JOIN account_move m ON m.id = l.move_id
         JOIN account_account a ON a.id = l.account_id
         LEFT JOIN account_journal j ON j.id = m.journal_id
         LEFT JOIN contacts c ON c.id = l.partner_id
        WHERE l.entreprise_id = $1 AND m.state = 'posted'
          AND m.date >= $2 AND m.date <= $3${filtreLignes}
        ORDER BY a.code ASC, m.date ASC, m.id ASC, l.sequence ASC, l.id ASC`,
      paramsLignes
    );

    // Regroupement par compte + solde progressif, calculé ici plutôt qu'à l'écran : c'est une
    // valeur comptable, elle ne doit pas dépendre de l'ordre dans lequel une liste est triée.
    const comptes = [];
    const parId = new Map();
    for (const l of lignes.rows) {
      let compte = parId.get(l.compteId);
      if (!compte) {
        const ouverture = ouvertureParCompte.get(l.compteId) || 0;
        compte = {
          compteId: l.compteId, code: l.compteCode, nom: l.compteNom, type: l.compteType,
          ouverture, totalDebit: 0, totalCredit: 0, solde: ouverture, lignes: [],
        };
        parId.set(l.compteId, compte);
        comptes.push(compte);
      }
      compte.totalDebit += l.debit;
      compte.totalCredit += l.credit;
      compte.solde += l.debit - l.credit;
      compte.lignes.push({
        date: l.date, moveId: l.moveId, piece: l.pieceNom, journal: l.journalCode,
        libelle: l.libelle, partenaire: l.partenaireNom || null,
        debit: l.debit, credit: l.credit, lettrage: l.lettrage,
        soldeProgressif: Number(compte.solde.toFixed(2)),
      });
    }
    for (const c of comptes) {
      c.totalDebit = Number(c.totalDebit.toFixed(2));
      c.totalCredit = Number(c.totalCredit.toFixed(2));
      c.solde = Number(c.solde.toFixed(2));
    }

    return res.json({ periode: { debut, fin }, comptes });
  } catch (err) {
    console.error('[GET /factures/grand-livre]', err);
    return res.status(500).json({ error: 'Erreur lors de la construction du grand livre.' });
  }
});

router.get('/balance', authRequired, async (req, res) => {
  try {
    const { debut, fin } = await resoudrePeriode(req.user.entrepriseId, req.query);

    // Un LEFT JOIN sur account_move avec le filtre "posted" DANS la condition de jointure, et
    // non dans le WHERE : ainsi une ligne rattachée à un brouillon donne m NULL, ses FILTER sont
    // faux et elle pèse zéro — au lieu de faire disparaître le compte entier de l'état.
    const result = await pool.query(
      `SELECT a.id AS "compteId", a.code, a.name AS nom, a.account_type AS type,
              COALESCE(SUM(l.debit - l.credit) FILTER (WHERE m.date < $2), 0)::float8 AS ouverture,
              COALESCE(SUM(l.debit) FILTER (WHERE m.date >= $2 AND m.date <= $3), 0)::float8 AS debit,
              COALESCE(SUM(l.credit) FILTER (WHERE m.date >= $2 AND m.date <= $3), 0)::float8 AS credit
         FROM account_account a
         LEFT JOIN account_move_line l ON l.account_id = a.id AND l.entreprise_id = $1
         LEFT JOIN account_move m ON m.id = l.move_id AND m.state = 'posted'
        WHERE a.entreprise_id = $1
        GROUP BY a.id, a.code, a.name, a.account_type
        ORDER BY a.code ASC`,
      [req.user.entrepriseId, debut, fin]
    );

    // Un compte jamais mouvementé et sans solde d'ouverture n'apprend rien : il allongerait
    // l'état de tout le plan comptable. Un compte soldé à zéro sur la période mais qui avait un
    // solde avant, lui, doit rester visible — c'est justement ce qu'on vérifie en clôture.
    const comptes = result.rows
      .filter(c => c.ouverture !== 0 || c.debit !== 0 || c.credit !== 0)
      .map(c => ({ ...c, cloture: Number((c.ouverture + c.debit - c.credit).toFixed(2)) }));

    const totaux = comptes.reduce(
      (acc, c) => ({
        ouverture: acc.ouverture + c.ouverture,
        debit: acc.debit + c.debit,
        credit: acc.credit + c.credit,
        cloture: acc.cloture + c.cloture,
      }),
      { ouverture: 0, debit: 0, credit: 0, cloture: 0 }
    );
    for (const k of Object.keys(totaux)) totaux[k] = Number(totaux[k].toFixed(2));
    // La partie double impose l'égalité. On la renvoie plutôt que de la laisser deviner :
    // un écart signale une écriture déséquilibrée, pas une erreur d'affichage.
    totaux.equilibre = Math.abs(totaux.debit - totaux.credit) < 0.01;

    return res.json({ periode: { debut, fin }, comptes, totaux });
  } catch (err) {
    console.error('[GET /factures/balance]', err);
    return res.status(500).json({ error: 'Erreur lors de la construction de la balance.' });
  }
});



// ─── Compte de résultat, bilan, déclaration de TVA ───
//
// Les trois états qui se lisent sur le grand livre et la balance construits plus haut. Comme le
// registre HACCP ou la météo, ils sont conçus ici : la source communautaire de l'ERP de référence
// ne contient aucun module de rapport comptable. Ce qu'on lui reprend, ce sont les règles portées
// par account_type (account_account.py) :
//
//   1. internal_group = le préfixe d'account_type avant le premier « _ » (_get_internal_group) :
//      asset_receivable → asset, income_other → income. income/expense font le compte de
//      résultat, asset/liability/equity font le bilan, off_balance n'entre dans aucun des deux.
//   2. include_initial_balance est faux pour income/expense (_compute_include_initial_balance) :
//      un compte de résultat repart de zéro à chaque exercice, un compte de bilan cumule depuis
//      toujours. D'où la différence de forme entre les deux états — le compte de résultat se lit
//      SUR une période, le bilan À une date.
//
// Déclarées AVANT GET /:id, comme grand-livre et balance.

const GROUPES_RESULTAT = ['income', 'expense'];

// Le préfixe d'account_type avant le premier « _ ». En SQL plutôt qu'en JS parce que c'est ce qui
// regroupe les lignes, et qu'un GROUP BY sait le faire sans rapatrier le détail.
const EXPR_GROUPE = "split_part(a.account_type, '_', 1)";

router.get('/compte-resultat', authRequired, async (req, res) => {
  try {
    const { debut, fin } = await resoudrePeriode(req.user.entrepriseId, req.query);

    // Produits au crédit, charges au débit : on renvoie chaque solde dans le sens où il se lit
    // (un produit positif est un produit), pas en débit-crédit brut qui rendrait tous les
    // produits négatifs à l'écran.
    const { rows } = await pool.query(
      `SELECT a.id AS "compteId", a.code, a.name AS nom, a.account_type AS type,
              ${EXPR_GROUPE} AS groupe,
              COALESCE(SUM(l.credit - l.debit), 0)::float8 AS montant
         FROM account_account a
         JOIN account_move_line l ON l.account_id = a.id AND l.entreprise_id = $1
         JOIN account_move m ON m.id = l.move_id AND m.state = 'posted'
        WHERE a.entreprise_id = $1 AND ${EXPR_GROUPE} = ANY($4::text[])
          AND m.date >= $2 AND m.date <= $3
        GROUP BY a.id, a.code, a.name, a.account_type
       HAVING COALESCE(SUM(l.credit - l.debit), 0) <> 0
        ORDER BY a.code ASC`,
      [req.user.entrepriseId, debut, fin, GROUPES_RESULTAT]
    );

    // Une charge est au débit : credit - debit la rend négative. On la republie en positif pour
    // qu'elle s'additionne comme une charge, et le résultat reste produits - charges.
    const produits = rows.filter((r) => r.groupe === 'income')
      .map((r) => ({ ...r, montant: Number(r.montant.toFixed(2)) }));
    const charges = rows.filter((r) => r.groupe === 'expense')
      .map((r) => ({ ...r, montant: Number((-r.montant).toFixed(2)) }));

    const totalProduits = Number(produits.reduce((s, r) => s + r.montant, 0).toFixed(2));
    const totalCharges = Number(charges.reduce((s, r) => s + r.montant, 0).toFixed(2));

    return res.json({
      periode: { debut, fin },
      produits, charges,
      totaux: {
        produits: totalProduits,
        charges: totalCharges,
        resultat: Number((totalProduits - totalCharges).toFixed(2)),
      },
    });
  } catch (err) {
    console.error('[GET /factures/compte-resultat]', err);
    return res.status(500).json({ error: 'Erreur lors de la construction du compte de résultat.' });
  }
});

// Produits - charges sur un intervalle de dates ouvert à gauche : sert au résultat de la période
// ET au report à nouveau du bilan (tout ce qui précède), qui sont la même somme sur deux bornes.
async function resultatEntre(entrepriseId, dateMin, dateMax) {
  const conditions = ['l.entreprise_id = $1', "m.state = 'posted'", `${EXPR_GROUPE} = ANY($2::text[])`];
  const params = [entrepriseId, GROUPES_RESULTAT];
  if (dateMin) { params.push(dateMin); conditions.push(`m.date >= $${params.length}`); }
  if (dateMax) { params.push(dateMax); conditions.push(`m.date <= $${params.length}`); }
  const { rows } = await pool.query(
    `SELECT COALESCE(SUM(l.credit - l.debit), 0)::float8 AS resultat
       FROM account_move_line l
       JOIN account_move m ON m.id = l.move_id
       JOIN account_account a ON a.id = l.account_id
      WHERE ${conditions.join(' AND ')}`,
    params
  );
  return Number(rows[0].resultat.toFixed(2));
}

router.get('/bilan', authRequired, async (req, res) => {
  try {
    const { debut, fin } = await resoudrePeriode(req.user.entrepriseId, req.query);

    // Un bilan se lit À une date : pas de borne basse, on cumule depuis la première écriture
    // (include_initial_balance vaut vrai pour tous ces comptes).
    const { rows } = await pool.query(
      `SELECT a.id AS "compteId", a.code, a.name AS nom, a.account_type AS type,
              ${EXPR_GROUPE} AS groupe,
              COALESCE(SUM(l.debit - l.credit), 0)::float8 AS solde
         FROM account_account a
         JOIN account_move_line l ON l.account_id = a.id AND l.entreprise_id = $1
         JOIN account_move m ON m.id = l.move_id AND m.state = 'posted'
        WHERE a.entreprise_id = $1 AND ${EXPR_GROUPE} = ANY($3::text[])
          AND m.date <= $2
        GROUP BY a.id, a.code, a.name, a.account_type
       HAVING COALESCE(SUM(l.debit - l.credit), 0) <> 0
        ORDER BY a.code ASC`,
      [req.user.entrepriseId, fin, ['asset', 'liability', 'equity']]
    );

    const actif = rows.filter((r) => r.groupe === 'asset')
      .map((r) => ({ ...r, solde: Number(r.solde.toFixed(2)) }));
    // Passif et capitaux propres sont créditeurs : on inverse le signe pour qu'ils se lisent
    // positifs, comme les produits du compte de résultat.
    const passif = rows.filter((r) => r.groupe !== 'asset')
      .map((r) => ({ ...r, solde: Number((-r.solde).toFixed(2)) }));

    // Le plan de comptes par défaut n'a ni capitaux propres ni compte de résultat de l'exercice
    // (equity_unaffected), et l'application ne passe aucune écriture de clôture : sans ces deux
    // lignes calculées, l'actif ne serait pas égal au passif dès la première facture. C'est
    // aussi ce qu'affiche un bilan tant que la clôture n'est pas passée — le résultat de la
    // période d'un côté, ce qui la précède en report à nouveau de l'autre.
    const resultatPeriode = await resultatEntre(req.user.entrepriseId, debut, fin);
    const reportANouveau = await resultatEntre(req.user.entrepriseId, null, debut ? veille(debut) : null);

    const totalActif = Number(actif.reduce((s, r) => s + r.solde, 0).toFixed(2));
    const totalPassifComptes = Number(passif.reduce((s, r) => s + r.solde, 0).toFixed(2));
    const totalPassif = Number((totalPassifComptes + resultatPeriode + reportANouveau).toFixed(2));

    return res.json({
      periode: { debut, fin },
      actif, passif,
      resultatPeriode, reportANouveau,
      totaux: {
        actif: totalActif,
        passif: totalPassif,
        equilibre: Math.abs(totalActif - totalPassif) < 0.01,
      },
    });
  } catch (err) {
    console.error('[GET /factures/bilan]', err);
    return res.status(500).json({ error: 'Erreur lors de la construction du bilan.' });
  }
});

// La veille d'une date ISO, en texte : le report à nouveau s'arrête où la période commence.
function veille(dateIso) {
  const d = new Date(`${dateIso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

router.get('/declaration-tva', authRequired, async (req, res) => {
  try {
    const { debut, fin } = await resoudrePeriode(req.user.entrepriseId, req.query);

    // Deux mesures par taxe, prises à deux endroits différents du même move :
    //   le MONTANT vient des lignes de taxe (celles qui portent tax_line_id) ;
    //   la BASE vient des lignes de produit rattachées à cette taxe par la table de liaison.
    // Les additionner depuis une seule requête donnerait un produit cartésien dès qu'une ligne
    // porte deux taxes — d'où deux agrégats séparés, recollés par taxe.
    const sensVente = ['out_invoice', 'out_refund'];
    const sensAchat = ['in_invoice', 'in_refund'];

    const montants = await pool.query(
      `SELECT l.tax_line_id AS "taxeId",
              m.move_type AS "moveType",
              COALESCE(SUM(l.credit - l.debit), 0)::float8 AS montant
         FROM account_move_line l
         JOIN account_move m ON m.id = l.move_id AND m.state = 'posted'
        WHERE l.entreprise_id = $1 AND l.tax_line_id IS NOT NULL
          AND m.date >= $2 AND m.date <= $3
        GROUP BY l.tax_line_id, m.move_type`,
      [req.user.entrepriseId, debut, fin]
    );

    const bases = await pool.query(
      `SELECT lt.tax_id AS "taxeId",
              m.move_type AS "moveType",
              COALESCE(SUM(l.credit - l.debit), 0)::float8 AS base
         FROM account_move_line_taxes lt
         JOIN account_move_line l ON l.id = lt.move_line_id
         JOIN account_move m ON m.id = l.move_id AND m.state = 'posted'
        WHERE l.entreprise_id = $1 AND l.display_type = 'product'
          AND m.date >= $2 AND m.date <= $3
        GROUP BY lt.tax_id, m.move_type`,
      [req.user.entrepriseId, debut, fin]
    );

    const taxes = await pool.query(
      'SELECT id, name AS nom, amount::float8 AS taux, amount_type AS "typeMontant" FROM account_tax WHERE entreprise_id = $1 ORDER BY name ASC',
      [req.user.entrepriseId]
    );

    const parTaxe = new Map();
    for (const t of taxes.rows) {
      parTaxe.set(t.id, {
        taxeId: t.id, nom: t.nom, taux: t.taux, typeMontant: t.typeMontant,
        collectee: { base: 0, montant: 0 }, deductible: { base: 0, montant: 0 },
      });
    }
    const cible = (id, moveType) => {
      const entree = parTaxe.get(id);
      if (!entree) return null;
      if (sensVente.includes(moveType)) return entree.collectee;
      if (sensAchat.includes(moveType)) return entree.deductible;
      return null;
    };
    // Un signe unique pour les deux mesures : credit - debit rend positive une TVA collectée sur
    // facture de vente, et négative sur avoir — un avoir vient donc bien en déduction.
    for (const r of montants.rows) {
      const c = cible(r.taxeId, r.moveType);
      if (c) c.montant += r.montant;
    }
    for (const r of bases.rows) {
      const c = cible(r.taxeId, r.moveType);
      if (c) c.base += r.base;
    }

    // Une facture fournisseur est débitrice : credit - debit rend sa base et sa taxe négatives.
    // On les republie positives — un montant à récupérer se lit positif, et une charge utile qui
    // exigerait du lecteur qu'il connaisse l'astuce du signe serait un piège pour la suite.
    const lignes = [...parTaxe.values()]
      .filter((t) => t.collectee.montant || t.collectee.base || t.deductible.montant || t.deductible.base)
      .map((t) => ({
        ...t,
        collectee: { base: Number(t.collectee.base.toFixed(2)), montant: Number(t.collectee.montant.toFixed(2)) },
        deductible: { base: Number((-t.deductible.base).toFixed(2)), montant: Number((-t.deductible.montant).toFixed(2)) },
      }));

    const collectee = Number(lignes.reduce((s, t) => s + t.collectee.montant, 0).toFixed(2));
    const deductible = Number(lignes.reduce((s, t) => s + t.deductible.montant, 0).toFixed(2));

    return res.json({
      periode: { debut, fin },
      lignes,
      totaux: {
        collectee,
        deductible,
        net: Number((collectee - deductible).toFixed(2)),
      },
    });
  } catch (err) {
    console.error('[GET /factures/declaration-tva]', err);
    return res.status(500).json({ error: 'Erreur lors de la construction de la déclaration de TVA.' });
  }
});

// ─── GET /api/factures/:id ─────────────────────────────────────────────────
router.get('/:id', authRequired, async (req, res) => {
  try {
    const facture = await getFactureComplete(req.params.id, req.user.entrepriseId);
    if (!facture) return res.status(404).json({ error: 'Facture introuvable.' });
    return res.json({ facture });
  } catch (err) {
    console.error('[GET /factures/:id]', err);
    return res.status(500).json({ error: 'Erreur lors de la récupération de la facture.' });
  }
});

// ─── POST /api/factures ─── (brouillon)
router.post('/', authRequired, async (req, res) => {
  const {
    moveType = 'out_invoice', journalId, partnerId, invoiceDate, invoiceDateDue,
    paymentTermId, ref, invoiceOrigin, lignes,
  } = req.body;
  if (!INVOICE_TYPES.includes(moveType)) return res.status(400).json({ error: 'move_type invalide.' });
  if (!Array.isArray(lignes) || lignes.length === 0) {
    return res.status(400).json({ error: 'Au moins une ligne est requise.' });
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // Journal : celui fourni (vérifié), sinon le journal par défaut du bon type.
    const typeJournal = moveType.startsWith('out_') ? 'sale' : 'purchase';
    let jid = journalId ? Number(journalId) : null;
    if (jid) {
      const chk = await client.query('SELECT 1 FROM account_journal WHERE id = $1 AND entreprise_id = $2', [jid, req.user.entrepriseId]);
      if (chk.rows.length === 0) { await client.query('ROLLBACK'); return res.status(400).json({ error: 'Journal inconnu pour cette entreprise.' }); }
    } else {
      const j = await journalParType(client, req.user.entrepriseId, typeJournal);
      if (!j) { await client.query('ROLLBACK'); return res.status(400).json({ error: `Aucun journal « ${typeJournal} » configuré.` }); }
      jid = j.id;
    }
    if (partnerId) {
      const chk = await client.query('SELECT 1 FROM contacts WHERE id = $1 AND entreprise_id = $2', [partnerId, req.user.entrepriseId]);
      if (chk.rows.length === 0) { await client.query('ROLLBACK'); return res.status(400).json({ error: 'Partenaire inconnu pour cette entreprise.' }); }
    }
    if (paymentTermId) {
      const chk = await client.query('SELECT 1 FROM payment_terms WHERE id = $1 AND entreprise_id = $2', [paymentTermId, req.user.entrepriseId]);
      if (chk.rows.length === 0) { await client.query('ROLLBACK'); return res.status(400).json({ error: 'Condition de paiement inconnue.' }); }
    }

    const taxMap = await chargerTaxMap(req.user.entrepriseId, client);
    const normalisees = lignes.map(normLigne);
    const totaux = calculerTotaux(normalisees, taxMap);

    const mv = await client.query(
      `INSERT INTO account_move
        (entreprise_id, journal_id, move_type, state, partner_id, invoice_date, invoice_date_due,
         invoice_origin, payment_term_id, ref, amount_untaxed, amount_tax, amount_total, amount_residual, user_id)
       VALUES ($1,$2,$3,'draft',$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING id`,
      [req.user.entrepriseId, jid, moveType, partnerId || null, invoiceDate || null, invoiceDateDue || null,
       invoiceOrigin || null, paymentTermId || null, ref || null,
       totaux.amountUntaxed, totaux.amountTax, totaux.amountTotal, totaux.amountTotal, req.user.sub]
    );
    const moveId = mv.rows[0].id;
    for (const l of totaux.perLigne) {
      const ins = await client.query(
        `INSERT INTO account_move_line
          (move_id, entreprise_id, display_type, sequence, name, quantity, price_unit, discount, price_subtotal, price_total)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,
        [moveId, req.user.entrepriseId, l.displayType, l.sequence, l.name, l.quantity, l.priceUnit, l.discount, l.priceSubtotal, l.priceTotal]
      );
      for (const taxId of l.taxIds) {
        if (!taxMap.has(taxId)) continue;
        await client.query(
          `INSERT INTO account_move_line_taxes (move_line_id, tax_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`,
          [ins.rows[0].id, taxId]
        );
      }
    }
    await client.query('COMMIT');
    return res.status(201).json({ facture: await getFactureComplete(moveId, req.user.entrepriseId) });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[POST /factures]', err);
    return res.status(err.status || 500).json({ error: err.status ? err.message : 'Erreur lors de la création de la facture.' });
  } finally {
    client.release();
  }
});

// ─── PUT /api/factures/:id ─── (brouillon uniquement)
router.put('/:id', authRequired, async (req, res) => {
  const { partnerId, invoiceDate, invoiceDateDue, paymentTermId, ref, invoiceOrigin, lignes } = req.body;
  const client = await pool.connect();
  try {
    const chk = await client.query('SELECT state, move_type FROM account_move WHERE id = $1 AND entreprise_id = $2', [req.params.id, req.user.entrepriseId]);
    if (chk.rows.length === 0) return res.status(404).json({ error: 'Facture introuvable.' });
    if (chk.rows[0].state !== 'draft') return res.status(400).json({ error: 'Seule une facture en brouillon peut être modifiée.' });

    await client.query('BEGIN');
    if (partnerId !== undefined) {
      if (partnerId) {
        const c = await client.query('SELECT 1 FROM contacts WHERE id = $1 AND entreprise_id = $2', [partnerId, req.user.entrepriseId]);
        if (c.rows.length === 0) { await client.query('ROLLBACK'); return res.status(400).json({ error: 'Partenaire inconnu.' }); }
      }
      await client.query('UPDATE account_move SET partner_id = $1 WHERE id = $2', [partnerId || null, req.params.id]);
    }
    // Même contrôle que pour le partenaire : une condition de paiement d'une AUTRE entreprise ne
    // doit pas pouvoir être rattachée (les FK ne vérifient pas l'appartenance au tenant).
    if (paymentTermId) {
      const pt = await client.query('SELECT 1 FROM payment_terms WHERE id = $1 AND entreprise_id = $2', [paymentTermId, req.user.entrepriseId]);
      if (pt.rows.length === 0) { await client.query('ROLLBACK'); return res.status(400).json({ error: 'Condition de paiement inconnue.' }); }
    }
    for (const [k, col] of [['invoiceDate', 'invoice_date'], ['invoiceDateDue', 'invoice_date_due'], ['invoiceOrigin', 'invoice_origin'], ['ref', 'ref'], ['paymentTermId', 'payment_term_id']]) {
      if (req.body[k] !== undefined) {
        await client.query(`UPDATE account_move SET ${col} = $1 WHERE id = $2`, [req.body[k] || null, req.params.id]);
      }
    }
    if (Array.isArray(lignes)) {
      const taxMap = await chargerTaxMap(req.user.entrepriseId, client);
      const totaux = calculerTotaux(lignes.map(normLigne), taxMap);
      await client.query('DELETE FROM account_move_line WHERE move_id = $1', [req.params.id]);
      for (const l of totaux.perLigne) {
        const ins = await client.query(
          `INSERT INTO account_move_line
            (move_id, entreprise_id, display_type, sequence, name, quantity, price_unit, discount, price_subtotal, price_total)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,
          [req.params.id, req.user.entrepriseId, l.displayType, l.sequence, l.name, l.quantity, l.priceUnit, l.discount, l.priceSubtotal, l.priceTotal]
        );
        for (const taxId of l.taxIds) {
          if (!taxMap.has(taxId)) continue;
          await client.query(`INSERT INTO account_move_line_taxes (move_line_id, tax_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`, [ins.rows[0].id, taxId]);
        }
      }
      await client.query(
        'UPDATE account_move SET amount_untaxed = $1, amount_tax = $2, amount_total = $3, amount_residual = $3 WHERE id = $4',
        [totaux.amountUntaxed, totaux.amountTax, totaux.amountTotal, req.params.id]
      );
    }
    await client.query('COMMIT');
    return res.json({ facture: await getFactureComplete(req.params.id, req.user.entrepriseId) });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[PUT /factures/:id]', err);
    return res.status(500).json({ error: 'Erreur lors de la mise à jour de la facture.' });
  } finally {
    client.release();
  }
});

// ─── POST /api/factures/:id/post ─── (brouillon → posté : génère la double-partie)
router.post('/:id/post', ...ecriture, async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await posterMove(client, req.params.id, req.user.entrepriseId);
    await client.query('COMMIT');
    return res.json({ facture: await getFactureComplete(req.params.id, req.user.entrepriseId) });
  } catch (err) {
    await client.query('ROLLBACK');
    if (!err.status) console.error('[POST /factures/:id/post]', err);
    return res.status(err.status || 500).json({ error: err.status ? err.message : 'Erreur lors de la validation de la facture.' });
  } finally {
    client.release();
  }
});

// ─── POST /api/factures/:id/button-draft ─── (posté → brouillon, si aucun paiement)
router.post('/:id/button-draft', ...ecriture, async (req, res) => {
  const client = await pool.connect();
  try {
    const mr = await client.query('SELECT state, payment_state, inalterable_hash AS "hash" FROM account_move WHERE id = $1 AND entreprise_id = $2', [req.params.id, req.user.entrepriseId]);
    if (mr.rows.length === 0) return res.status(404).json({ error: 'Facture introuvable.' });
    if (mr.rows[0].state !== 'posted') return res.status(400).json({ error: 'Seule une facture postée peut repasser en brouillon.' });
    if (mr.rows[0].payment_state !== 'not_paid') return res.status(400).json({ error: 'Impossible : des paiements sont rattachés. Annulez-les d’abord.' });
    if (mr.rows[0].hash) return res.status(400).json({ error: 'Facture sécurisée (inaltérable) — créez un avoir plutôt que de la modifier.' });

    await client.query('BEGIN');
    // Retire les lignes comptables générées au post (taxe + partenaire) et remet à zéro
    // les lignes produit. Le numéro (name) est conservé — pas de réutilisation.
    await client.query(`DELETE FROM account_move_line WHERE move_id = $1 AND display_type IN ('tax', 'payment_term')`, [req.params.id]);
    await client.query(
      `UPDATE account_move_line SET account_id = NULL, debit = 0, credit = 0, balance = 0 WHERE move_id = $1`,
      [req.params.id]
    );
    await client.query(`DELETE FROM echeances_paiement WHERE move_id = $1`, [req.params.id]);
    await client.query(`UPDATE account_move SET state = 'draft', amount_residual = amount_total, payment_state = 'not_paid' WHERE id = $1`, [req.params.id]);
    await client.query('COMMIT');
    return res.json({ facture: await getFactureComplete(req.params.id, req.user.entrepriseId) });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[POST /factures/:id/button-draft]', err);
    return res.status(500).json({ error: 'Erreur lors du retour en brouillon.' });
  } finally {
    client.release();
  }
});

// ─── POST /api/factures/:id/cancel ───
router.post('/:id/cancel', ...ecriture, async (req, res) => {
  try {
    const mr = await pool.query('SELECT state, payment_state FROM account_move WHERE id = $1 AND entreprise_id = $2', [req.params.id, req.user.entrepriseId]);
    if (mr.rows.length === 0) return res.status(404).json({ error: 'Facture introuvable.' });
    if (mr.rows[0].state === 'cancel') return res.status(400).json({ error: 'Facture déjà annulée.' });
    if (mr.rows[0].state === 'posted' && mr.rows[0].payment_state !== 'not_paid') {
      return res.status(400).json({ error: 'Impossible d’annuler : des paiements sont rattachés.' });
    }
    await pool.query(`UPDATE account_move SET state = 'cancel' WHERE id = $1`, [req.params.id]);
    return res.json({ facture: await getFactureComplete(req.params.id, req.user.entrepriseId) });
  } catch (err) {
    console.error('[POST /factures/:id/cancel]', err);
    return res.status(500).json({ error: 'Erreur lors de l’annulation.' });
  }
});

// ─── DELETE /api/factures/:id ─── (brouillon ou annulé uniquement — règle Odoo)
router.delete('/:id', ...ecriture, async (req, res) => {
  try {
    const mr = await pool.query('SELECT state, inalterable_hash AS "hash" FROM account_move WHERE id = $1 AND entreprise_id = $2', [req.params.id, req.user.entrepriseId]);
    if (mr.rows.length === 0) return res.status(404).json({ error: 'Facture introuvable.' });
    if (!['draft', 'cancel'].includes(mr.rows[0].state)) {
      return res.status(400).json({ error: 'Seule une facture en brouillon ou annulée peut être supprimée.' });
    }
    if (mr.rows[0].hash) {
      return res.status(400).json({ error: 'Facture sécurisée (inaltérable) — suppression impossible.' });
    }
    await pool.query('DELETE FROM account_move WHERE id = $1', [req.params.id]);
    return res.json({ success: true });
  } catch (err) {
    console.error('[DELETE /factures/:id]', err);
    return res.status(500).json({ error: 'Erreur lors de la suppression.' });
  }
});

// ─── POST /api/factures/:id/reverse ─── (crée un avoir à partir d'une facture postée)
router.post('/:id/reverse', ...ecriture, async (req, res) => {
  const { reason, date, refundMethod } = req.body;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { creditNoteId } = await reverseMove(client, {
      moveId: req.params.id, entrepriseId: req.user.entrepriseId, userId: req.user.sub,
      reason, date, refundMethod: refundMethod === 'cancel' ? 'cancel' : 'refund',
    });
    await client.query('COMMIT');
    return res.json({ facture: await getFactureComplete(creditNoteId, req.user.entrepriseId) });
  } catch (err) {
    await client.query('ROLLBACK');
    if (!err.status) console.error('[POST /factures/:id/reverse]', err);
    return res.status(err.status || 500).json({ error: err.status ? err.message : "Erreur lors de la création de l'avoir." });
  } finally {
    client.release();
  }
});

// ─── POST /api/factures/:id/register-payment ─── (paiement + lettrage)
router.post('/:id/register-payment', ...ecriture, async (req, res) => {
  const { amount, paymentDate, journalId, ref } = req.body;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await enregistrerPaiementMove(client, {
      moveId: req.params.id, entrepriseId: req.user.entrepriseId, userId: req.user.sub,
      amount, paymentDate, journalId, ref,
    });
    await client.query('COMMIT');
    return res.json({ facture: await getFactureComplete(req.params.id, req.user.entrepriseId) });
  } catch (err) {
    await client.query('ROLLBACK');
    if (!err.status) console.error('[POST /factures/:id/register-payment]', err);
    return res.status(err.status || 500).json({ error: err.status ? err.message : "Erreur lors de l'enregistrement du paiement." });
  } finally {
    client.release();
  }
});

export default router;
