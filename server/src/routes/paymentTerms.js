// Conditions de paiement réutilisables — calqué sur account.payment.term /
// account.payment.term.line d'un ERP de référence. Un terme nommé + des lignes qui
// répartissent le montant (`value`: percent/fixed/balance) et calculent une date
// (`delay_type` + `nb_days`). Consommé par POST /api/devis/:id/facturer pour générer
// les echeances_paiement. Écritures réservées admin/directeur (même posture que
// /api/business/finances et /api/banques).
import express from 'express';
import { authRequired } from '../middleware/auth.js';
import { pool } from '../db.js';

const router = express.Router();

const ecriture = [authRequired];

const LINE_COLUMNS = `
  id, value, value_amount::float8 AS "valueAmount", delay_type AS "delayType",
  nb_days AS "nbDays", ordre
`;

// Normalise + valide une ligne reçue du client. Renvoie null si invalide.
function normLine(l, i) {
  const value = ['percent', 'fixed', 'balance'].includes(l?.value) ? l.value : null;
  const delayType = ['days_after', 'days_after_end_of_month'].includes(l?.delayType) ? l.delayType : 'days_after';
  if (!value) return null;
  return {
    value,
    valueAmount: value === 'balance' ? 0 : Math.max(0, Number(l.valueAmount) || 0),
    delayType,
    nbDays: Math.max(0, parseInt(l.nbDays, 10) || 0),
    ordre: Number.isInteger(l.ordre) ? l.ordre : i,
  };
}

async function fetchTerm(id, entrepriseId) {
  const term = await pool.query(
    `SELECT id, name, active, sequence, display_on_invoice AS "displayOnInvoice"
     FROM payment_terms WHERE id = $1 AND entreprise_id = $2`,
    [id, entrepriseId]
  );
  if (term.rows.length === 0) return null;
  const lines = await pool.query(
    `SELECT ${LINE_COLUMNS} FROM payment_term_lines WHERE payment_term_id = $1 ORDER BY ordre ASC, id ASC`,
    [id]
  );
  return { ...term.rows[0], lignes: lines.rows };
}

// ─── GET /api/payment-terms ───
router.get('/', authRequired, async (req, res) => {
  try {
    const terms = await pool.query(
      `SELECT id, name, active, sequence, display_on_invoice AS "displayOnInvoice"
       FROM payment_terms WHERE entreprise_id = $1 ORDER BY sequence ASC, name ASC`,
      [req.user.entrepriseId]
    );
    const lines = await pool.query(
      `SELECT payment_term_id AS "termId", ${LINE_COLUMNS}
       FROM payment_term_lines
       WHERE payment_term_id IN (SELECT id FROM payment_terms WHERE entreprise_id = $1)
       ORDER BY ordre ASC, id ASC`,
      [req.user.entrepriseId]
    );
    const byTerm = new Map();
    for (const l of lines.rows) {
      const { termId, ...rest } = l;
      if (!byTerm.has(termId)) byTerm.set(termId, []);
      byTerm.get(termId).push(rest);
    }
    return res.json({ paymentTerms: terms.rows.map(t => ({ ...t, lignes: byTerm.get(t.id) || [] })) });
  } catch (err) {
    console.error('[GET /payment-terms]', err);
    return res.status(500).json({ error: 'Erreur lors de la récupération des conditions de paiement.' });
  }
});

// ─── POST /api/payment-terms ───
router.post('/', ...ecriture, async (req, res) => {
  const { name, sequence, displayOnInvoice, lignes } = req.body;
  if (!name || !name.trim()) return res.status(400).json({ error: 'Le nom est requis.' });
  const normLines = (Array.isArray(lignes) ? lignes : []).map(normLine).filter(Boolean);
  if (normLines.length === 0) return res.status(400).json({ error: 'Au moins une ligne valide est requise.' });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const term = await client.query(
      `INSERT INTO payment_terms (entreprise_id, name, sequence, display_on_invoice)
       VALUES ($1, $2, $3, $4) RETURNING id`,
      [req.user.entrepriseId, name.trim(), Number(sequence) || 10, displayOnInvoice !== false]
    );
    for (const l of normLines) {
      await client.query(
        `INSERT INTO payment_term_lines (payment_term_id, value, value_amount, delay_type, nb_days, ordre)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [term.rows[0].id, l.value, l.valueAmount, l.delayType, l.nbDays, l.ordre]
      );
    }
    await client.query('COMMIT');
    return res.status(201).json({ paymentTerm: await fetchTerm(term.rows[0].id, req.user.entrepriseId) });
  } catch (err) {
    await client.query('ROLLBACK');
    if (err.code === '23505') return res.status(409).json({ error: 'Une condition de paiement porte déjà ce nom.' });
    console.error('[POST /payment-terms]', err);
    return res.status(500).json({ error: 'Erreur lors de la création.' });
  } finally {
    client.release();
  }
});

// ─── PUT /api/payment-terms/:id ─── (remplace le nom/les métadonnées + toutes les lignes)
router.put('/:id', ...ecriture, async (req, res) => {
  const { name, sequence, displayOnInvoice, active, lignes } = req.body;
  const normLines = (Array.isArray(lignes) ? lignes : []).map(normLine).filter(Boolean);
  if (Array.isArray(lignes) && normLines.length === 0) {
    return res.status(400).json({ error: 'Au moins une ligne valide est requise.' });
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const upd = await client.query(
      `UPDATE payment_terms SET
         name = COALESCE($1, name),
         sequence = COALESCE($2, sequence),
         display_on_invoice = COALESCE($3, display_on_invoice),
         active = COALESCE($4, active)
       WHERE id = $5 AND entreprise_id = $6 RETURNING id`,
      [name?.trim() || null, sequence != null ? Number(sequence) : null,
       typeof displayOnInvoice === 'boolean' ? displayOnInvoice : null,
       typeof active === 'boolean' ? active : null, req.params.id, req.user.entrepriseId]
    );
    if (upd.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Condition de paiement introuvable.' });
    }
    if (Array.isArray(lignes)) {
      await client.query('DELETE FROM payment_term_lines WHERE payment_term_id = $1', [req.params.id]);
      for (const l of normLines) {
        await client.query(
          `INSERT INTO payment_term_lines (payment_term_id, value, value_amount, delay_type, nb_days, ordre)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [req.params.id, l.value, l.valueAmount, l.delayType, l.nbDays, l.ordre]
        );
      }
    }
    await client.query('COMMIT');
    return res.json({ paymentTerm: await fetchTerm(req.params.id, req.user.entrepriseId) });
  } catch (err) {
    await client.query('ROLLBACK');
    if (err.code === '23505') return res.status(409).json({ error: 'Une condition de paiement porte déjà ce nom.' });
    console.error('[PUT /payment-terms/:id]', err);
    return res.status(500).json({ error: 'Erreur lors de la mise à jour.' });
  } finally {
    client.release();
  }
});

// ─── DELETE /api/payment-terms/:id ─── (les lignes cascadent ; devis.payment_term_id → NULL)
router.delete('/:id', ...ecriture, async (req, res) => {
  try {
    const result = await pool.query(
      'DELETE FROM payment_terms WHERE id = $1 AND entreprise_id = $2',
      [req.params.id, req.user.entrepriseId]
    );
    if (result.rowCount === 0) return res.status(404).json({ error: 'Condition de paiement introuvable.' });
    return res.json({ success: true });
  } catch (err) {
    console.error('[DELETE /payment-terms/:id]', err);
    return res.status(500).json({ error: 'Erreur lors de la suppression.' });
  }
});

// Génère la liste des échéances { montant, dateEcheance, ordre } pour un total donné et
// une date de départ, à partir des lignes d'un terme de paiement. Exporté pour
// routes/devis.js. `acompte` (optionnel) : { method: 'percentage'|'fixed', value }
// insère d'abord une échéance d'acompte, le terme s'appliquant ensuite au solde.
export async function genererEcheancesDepuisTerme(entrepriseId, paymentTermId, total, dateBase, acompte) {
  const term = await pool.query(
    `SELECT ${LINE_COLUMNS} FROM payment_term_lines
     WHERE payment_term_id = (SELECT id FROM payment_terms WHERE id = $1 AND entreprise_id = $2)
     ORDER BY ordre ASC, id ASC`,
    [paymentTermId, entrepriseId]
  );
  if (term.rows.length === 0) return null; // terme inconnu / autre entreprise

  const base = dateBase instanceof Date ? dateBase : new Date(dateBase);
  const addDelay = (line) => {
    const d = new Date(base);
    if (line.delayType === 'days_after_end_of_month') {
      d.setMonth(d.getMonth() + 1, 0); // dernier jour du mois courant
      d.setDate(d.getDate() + line.nbDays);
    } else {
      d.setDate(d.getDate() + line.nbDays);
    }
    return d.toISOString().slice(0, 10);
  };
  const round2 = (n) => Math.round(n * 100) / 100;

  let restant = round2(Number(total) || 0);
  const echeances = [];
  let ordre = 0;

  if (acompte && (acompte.method === 'percentage' || acompte.method === 'fixed')) {
    const montant = acompte.method === 'percentage'
      ? round2(restant * (Math.max(0, Math.min(100, Number(acompte.value) || 0)) / 100))
      : round2(Math.max(0, Number(acompte.value) || 0));
    if (montant > 0 && montant < restant) {
      echeances.push({ montant, dateEcheance: base.toISOString().slice(0, 10), ordre: ordre++ });
      restant = round2(restant - montant);
    }
  }

  const soldeInitial = restant;
  const nonBalance = term.rows.filter(l => l.value !== 'balance');
  for (const line of nonBalance) {
    let montant = line.value === 'percent'
      ? round2(soldeInitial * (line.valueAmount / 100))
      : round2(line.valueAmount);
    montant = Math.min(montant, restant);
    if (montant > 0) {
      echeances.push({ montant, dateEcheance: addDelay(line), ordre: ordre++ });
      restant = round2(restant - montant);
    }
  }
  // La (ou les) ligne(s) `balance` prennent le reste — en pratique une seule.
  const balanceLines = term.rows.filter(l => l.value === 'balance');
  if (restant > 0.009) {
    const line = balanceLines[balanceLines.length - 1] || term.rows[term.rows.length - 1];
    echeances.push({ montant: round2(restant), dateEcheance: addDelay(line), ordre: ordre++ });
  } else if (echeances.length > 0) {
    // Résidu d'arrondi : on l'ajoute à la dernière échéance.
    echeances[echeances.length - 1].montant = round2(echeances[echeances.length - 1].montant + restant);
  }
  return echeances;
}

export default router;
