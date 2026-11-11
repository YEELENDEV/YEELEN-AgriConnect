// Taxes réutilisables — calqué sur account.tax d'un ERP de référence. Une taxe nommée,
// propre à l'entreprise, réutilisable sur les lignes de devis (Many2many via
// devis_lignes_taxes). L'étape 1 calcule amount_type 'percent' et 'fixed' (à l'unité) ;
// 'group'/'division' sont acceptés par le CHECK mais pas encore calculés ni exposés à l'UI.
// Écritures réservées admin/directeur (même posture que /api/payment-terms et /api/banques).
import express from 'express';
import { authRequired } from '../middleware/auth.js';
import { pool } from '../db.js';

const router = express.Router();

const ecriture = [authRequired];

const TAX_COLUMNS = `
  id, entreprise_id AS "entrepriseId", name,
  type_tax_use AS "typeTaxUse", amount_type AS "amountType", amount::float8 AS amount,
  price_include AS "priceInclude", include_base_amount AS "includeBaseAmount",
  active, sequence, description, invoice_label AS "invoiceLabel", created_at AS "createdAt"
`;

const TYPES_USE = ['sale', 'purchase', 'none'];
const AMOUNT_TYPES = ['percent', 'fixed', 'group', 'division'];

// Normalise + valide le corps d'une requête de création/màj. Renvoie { error } ou { value }.
function normTax(body, { partial = false } = {}) {
  const out = {};
  if (body.name !== undefined || !partial) {
    if (!body.name || !String(body.name).trim()) return { error: 'Le nom est requis.' };
    out.name = String(body.name).trim();
  }
  if (body.typeTaxUse !== undefined) {
    if (!TYPES_USE.includes(body.typeTaxUse)) return { error: 'type_tax_use invalide.' };
    out.typeTaxUse = body.typeTaxUse;
  } else if (!partial) out.typeTaxUse = 'sale';
  if (body.amountType !== undefined) {
    if (!AMOUNT_TYPES.includes(body.amountType)) return { error: 'amount_type invalide.' };
    out.amountType = body.amountType;
  } else if (!partial) out.amountType = 'percent';
  if (body.amount !== undefined || !partial) {
    const a = Number(body.amount);
    if (!Number.isFinite(a) || a < 0) return { error: 'Le montant doit être un nombre positif.' };
    out.amount = a;
  }
  if (body.priceInclude !== undefined) out.priceInclude = Boolean(body.priceInclude);
  else if (!partial) out.priceInclude = false;
  if (body.includeBaseAmount !== undefined) out.includeBaseAmount = Boolean(body.includeBaseAmount);
  else if (!partial) out.includeBaseAmount = false;
  if (body.active !== undefined) out.active = Boolean(body.active);
  else if (!partial) out.active = true;
  if (body.sequence !== undefined) out.sequence = parseInt(body.sequence, 10) || 1;
  else if (!partial) out.sequence = 1;
  if (body.description !== undefined) out.description = body.description ? String(body.description) : null;
  if (body.invoiceLabel !== undefined) out.invoiceLabel = body.invoiceLabel ? String(body.invoiceLabel) : null;
  return { value: out };
}

// ─── GET /api/taxes ───  (ouvert à tout utilisateur authentifié, lecture seule)
router.get('/', authRequired, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT ${TAX_COLUMNS} FROM account_tax WHERE entreprise_id = $1 ORDER BY sequence ASC, name ASC`,
      [req.user.entrepriseId]
    );
    return res.json({ taxes: rows });
  } catch (err) {
    console.error('[GET /taxes]', err);
    return res.status(500).json({ error: 'Erreur lors de la récupération des taxes.' });
  }
});

// ─── POST /api/taxes ───
router.post('/', ...ecriture, async (req, res) => {
  const { error, value } = normTax(req.body);
  if (error) return res.status(400).json({ error });
  try {
    const { rows } = await pool.query(
      `INSERT INTO account_tax
         (entreprise_id, name, type_tax_use, amount_type, amount, price_include, include_base_amount, active, sequence, description, invoice_label)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       RETURNING ${TAX_COLUMNS}`,
      [req.user.entrepriseId, value.name, value.typeTaxUse, value.amountType, value.amount,
       value.priceInclude, value.includeBaseAmount, value.active, value.sequence,
       value.description ?? null, value.invoiceLabel ?? null]
    );
    return res.status(201).json({ tax: rows[0] });
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'Une taxe porte déjà ce nom.' });
    console.error('[POST /taxes]', err);
    return res.status(500).json({ error: 'Erreur lors de la création de la taxe.' });
  }
});

// ─── PUT /api/taxes/:id ───
router.put('/:id', ...ecriture, async (req, res) => {
  const { error, value } = normTax(req.body, { partial: true });
  if (error) return res.status(400).json({ error });
  const champs = Object.keys(value);
  if (champs.length === 0) return res.status(400).json({ error: 'Aucun champ à mettre à jour.' });

  const colonnes = {
    name: 'name', typeTaxUse: 'type_tax_use', amountType: 'amount_type', amount: 'amount',
    priceInclude: 'price_include', includeBaseAmount: 'include_base_amount', active: 'active',
    sequence: 'sequence', description: 'description', invoiceLabel: 'invoice_label',
  };
  const set = champs.map((c, i) => `${colonnes[c]} = $${i + 1}`).join(', ');
  const params = champs.map((c) => value[c]);
  params.push(req.params.id, req.user.entrepriseId);

  try {
    const { rows } = await pool.query(
      `UPDATE account_tax SET ${set} WHERE id = $${params.length - 1} AND entreprise_id = $${params.length}
       RETURNING ${TAX_COLUMNS}`,
      params
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Taxe introuvable.' });
    return res.json({ tax: rows[0] });
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'Une taxe porte déjà ce nom.' });
    console.error('[PUT /taxes/:id]', err);
    return res.status(500).json({ error: 'Erreur lors de la mise à jour de la taxe.' });
  }
});

// ─── DELETE /api/taxes/:id ───  (les liens devis_lignes_taxes cascadent)
router.delete('/:id', ...ecriture, async (req, res) => {
  try {
    const result = await pool.query(
      'DELETE FROM account_tax WHERE id = $1 AND entreprise_id = $2',
      [req.params.id, req.user.entrepriseId]
    );
    if (result.rowCount === 0) return res.status(404).json({ error: 'Taxe introuvable.' });
    return res.json({ success: true });
  } catch (err) {
    console.error('[DELETE /taxes/:id]', err);
    return res.status(500).json({ error: 'Erreur lors de la suppression de la taxe.' });
  }
});

export default router;
