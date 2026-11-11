// Plan de comptes — calqué sur account.account d'un ERP de référence. Référentiel propre à
// l'entreprise ; l'étape 2 ne rattache encore aucune écriture (account.move arrive à
// l'étape 3). Écritures réservées admin/directeur (même posture que /api/taxes).
import express from 'express';
import { authRequired } from '../middleware/auth.js';
import { pool } from '../db.js';

const router = express.Router();
const ecriture = [authRequired];

const ACCOUNT_TYPES = [
  'asset_receivable', 'asset_cash', 'asset_current', 'asset_non_current', 'asset_prepayments',
  'asset_fixed', 'liability_payable', 'liability_credit_card', 'liability_current',
  'liability_non_current', 'equity', 'equity_unaffected', 'income', 'income_other', 'expense',
  'expense_other', 'expense_depreciation', 'expense_direct_cost', 'off_balance',
];

const COLUMNS = `
  id, entreprise_id AS "entrepriseId", code, name, account_type AS "accountType",
  reconcile, active, created_at AS "createdAt"
`;

function normAccount(body, { partial = false } = {}) {
  const out = {};
  if (body.code !== undefined || !partial) {
    if (!body.code || !String(body.code).trim()) return { error: 'Le code est requis.' };
    out.code = String(body.code).trim();
  }
  if (body.name !== undefined || !partial) {
    if (!body.name || !String(body.name).trim()) return { error: 'Le nom est requis.' };
    out.name = String(body.name).trim();
  }
  if (body.accountType !== undefined || !partial) {
    if (!ACCOUNT_TYPES.includes(body.accountType)) return { error: 'account_type invalide.' };
    out.accountType = body.accountType;
  }
  if (body.reconcile !== undefined) out.reconcile = Boolean(body.reconcile);
  else if (!partial) out.reconcile = false;
  if (body.active !== undefined) out.active = Boolean(body.active);
  else if (!partial) out.active = true;
  return { value: out };
}

// ─── GET /api/accounts ───
router.get('/', authRequired, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT ${COLUMNS} FROM account_account WHERE entreprise_id = $1 ORDER BY code ASC`,
      [req.user.entrepriseId]
    );
    return res.json({ accounts: rows });
  } catch (err) {
    console.error('[GET /accounts]', err);
    return res.status(500).json({ error: 'Erreur lors de la récupération du plan de comptes.' });
  }
});

// ─── POST /api/accounts ───
router.post('/', ...ecriture, async (req, res) => {
  const { error, value } = normAccount(req.body);
  if (error) return res.status(400).json({ error });
  try {
    const { rows } = await pool.query(
      `INSERT INTO account_account (entreprise_id, code, name, account_type, reconcile, active)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING ${COLUMNS}`,
      [req.user.entrepriseId, value.code, value.name, value.accountType, value.reconcile, value.active]
    );
    return res.status(201).json({ account: rows[0] });
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'Un compte porte déjà ce code.' });
    console.error('[POST /accounts]', err);
    return res.status(500).json({ error: 'Erreur lors de la création du compte.' });
  }
});

// ─── PUT /api/accounts/:id ───
router.put('/:id', ...ecriture, async (req, res) => {
  const { error, value } = normAccount(req.body, { partial: true });
  if (error) return res.status(400).json({ error });
  const champs = Object.keys(value);
  if (champs.length === 0) return res.status(400).json({ error: 'Aucun champ à mettre à jour.' });

  const colonnes = { code: 'code', name: 'name', accountType: 'account_type', reconcile: 'reconcile', active: 'active' };
  const set = champs.map((c, i) => `${colonnes[c]} = $${i + 1}`).join(', ');
  const params = champs.map((c) => value[c]);
  params.push(req.params.id, req.user.entrepriseId);
  try {
    const { rows } = await pool.query(
      `UPDATE account_account SET ${set} WHERE id = $${params.length - 1} AND entreprise_id = $${params.length}
       RETURNING ${COLUMNS}`,
      params
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Compte introuvable.' });
    return res.json({ account: rows[0] });
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'Un compte porte déjà ce code.' });
    console.error('[PUT /accounts/:id]', err);
    return res.status(500).json({ error: 'Erreur lors de la mise à jour du compte.' });
  }
});

// ─── DELETE /api/accounts/:id ───
router.delete('/:id', ...ecriture, async (req, res) => {
  try {
    const result = await pool.query(
      'DELETE FROM account_account WHERE id = $1 AND entreprise_id = $2',
      [req.params.id, req.user.entrepriseId]
    );
    if (result.rowCount === 0) return res.status(404).json({ error: 'Compte introuvable.' });
    // account_journal.default_account_id est ON DELETE SET NULL → pas de violation de FK,
    // le journal qui le pointait voit juste son compte par défaut retomber à NULL.
    return res.json({ success: true });
  } catch (err) {
    console.error('[DELETE /accounts/:id]', err);
    return res.status(500).json({ error: 'Erreur lors de la suppression du compte.' });
  }
});

export default router;
