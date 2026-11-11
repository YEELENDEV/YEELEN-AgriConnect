// Journaux comptables — calqué sur account.journal d'un ERP de référence. Référentiel propre
// à l'entreprise ; l'étape 2 ne rattache encore aucune écriture (account.move arrive à
// l'étape 3). Le numérotateur associé vit dans utils/journalSequence.js. Écritures réservées
// admin/directeur (même posture que /api/accounts et /api/taxes).
import express from 'express';
import { authRequired } from '../middleware/auth.js';
import { pool } from '../db.js';

const router = express.Router();
const ecriture = [authRequired];

const JOURNAL_TYPES = ['sale', 'purchase', 'cash', 'bank', 'general'];

const COLUMNS = `
  id, entreprise_id AS "entrepriseId", name, code, type, sequence, active,
  refund_sequence AS "refundSequence", default_account_id AS "defaultAccountId",
  restrict_mode_hash_table AS "restrictModeHashTable", secure_sequence_last AS "secureSequenceLast",
  created_at AS "createdAt"
`;

function normJournal(body, { partial = false } = {}) {
  const out = {};
  if (body.name !== undefined || !partial) {
    if (!body.name || !String(body.name).trim()) return { error: 'Le nom est requis.' };
    out.name = String(body.name).trim();
  }
  if (body.code !== undefined || !partial) {
    const code = String(body.code || '').trim().toUpperCase();
    if (!code) return { error: 'Le code est requis.' };
    if (code.length > 5) return { error: 'Le code fait 5 caractères maximum.' };
    out.code = code;
  }
  if (body.type !== undefined || !partial) {
    if (!JOURNAL_TYPES.includes(body.type)) return { error: 'type de journal invalide.' };
    out.type = body.type;
  }
  if (body.sequence !== undefined) out.sequence = parseInt(body.sequence, 10) || 10;
  else if (!partial) out.sequence = 10;
  if (body.refundSequence !== undefined) out.refundSequence = Boolean(body.refundSequence);
  else if (!partial) out.refundSequence = false;
  // Mode sécurisé (inaltérabilité par hash) — on ne peut que l'ACTIVER, jamais le
  // désactiver une fois des écritures hachées : ignoré s'il vaut false en PUT partiel.
  if (body.restrictModeHashTable === true) out.restrictModeHashTable = true;
  else if (!partial) out.restrictModeHashTable = false;
  if (body.active !== undefined) out.active = Boolean(body.active);
  else if (!partial) out.active = true;
  if (body.defaultAccountId !== undefined) {
    out.defaultAccountId = body.defaultAccountId == null ? null : Number(body.defaultAccountId);
  }
  return { value: out };
}

// Vérifie que defaultAccountId (s'il est fourni non-null) appartient bien à l'entreprise.
async function defaultAccountValide(defaultAccountId, entrepriseId) {
  if (defaultAccountId == null) return true;
  const { rows } = await pool.query(
    'SELECT 1 FROM account_account WHERE id = $1 AND entreprise_id = $2',
    [defaultAccountId, entrepriseId]
  );
  return rows.length > 0;
}

// ─── GET /api/journals ───
router.get('/', authRequired, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT ${COLUMNS} FROM account_journal WHERE entreprise_id = $1 ORDER BY sequence ASC, code ASC`,
      [req.user.entrepriseId]
    );
    return res.json({ journals: rows });
  } catch (err) {
    console.error('[GET /journals]', err);
    return res.status(500).json({ error: 'Erreur lors de la récupération des journaux.' });
  }
});

// ─── POST /api/journals ───
router.post('/', ...ecriture, async (req, res) => {
  const { error, value } = normJournal(req.body);
  if (error) return res.status(400).json({ error });
  if (!(await defaultAccountValide(value.defaultAccountId, req.user.entrepriseId))) {
    return res.status(400).json({ error: 'Compte par défaut inconnu pour cette entreprise.' });
  }
  try {
    const { rows } = await pool.query(
      `INSERT INTO account_journal (entreprise_id, name, code, type, sequence, refund_sequence, active, default_account_id, restrict_mode_hash_table)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING ${COLUMNS}`,
      [req.user.entrepriseId, value.name, value.code, value.type, value.sequence,
       value.refundSequence, value.active, value.defaultAccountId ?? null, value.restrictModeHashTable ?? false]
    );
    return res.status(201).json({ journal: rows[0] });
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'Un journal porte déjà ce code.' });
    console.error('[POST /journals]', err);
    return res.status(500).json({ error: 'Erreur lors de la création du journal.' });
  }
});

// ─── PUT /api/journals/:id ───
router.put('/:id', ...ecriture, async (req, res) => {
  const { error, value } = normJournal(req.body, { partial: true });
  if (error) return res.status(400).json({ error });
  const champs = Object.keys(value);
  if (champs.length === 0) return res.status(400).json({ error: 'Aucun champ à mettre à jour.' });
  if (champs.includes('defaultAccountId')
      && !(await defaultAccountValide(value.defaultAccountId, req.user.entrepriseId))) {
    return res.status(400).json({ error: 'Compte par défaut inconnu pour cette entreprise.' });
  }

  const colonnes = {
    name: 'name', code: 'code', type: 'type', sequence: 'sequence',
    refundSequence: 'refund_sequence', active: 'active', defaultAccountId: 'default_account_id',
    restrictModeHashTable: 'restrict_mode_hash_table',
  };
  const set = champs.map((c, i) => `${colonnes[c]} = $${i + 1}`).join(', ');
  const params = champs.map((c) => value[c]);
  params.push(req.params.id, req.user.entrepriseId);
  try {
    const { rows } = await pool.query(
      `UPDATE account_journal SET ${set} WHERE id = $${params.length - 1} AND entreprise_id = $${params.length}
       RETURNING ${COLUMNS}`,
      params
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Journal introuvable.' });
    return res.json({ journal: rows[0] });
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'Un journal porte déjà ce code.' });
    console.error('[PUT /journals/:id]', err);
    return res.status(500).json({ error: 'Erreur lors de la mise à jour du journal.' });
  }
});

// ─── DELETE /api/journals/:id ───
router.delete('/:id', ...ecriture, async (req, res) => {
  try {
    const result = await pool.query(
      'DELETE FROM account_journal WHERE id = $1 AND entreprise_id = $2',
      [req.params.id, req.user.entrepriseId]
    );
    if (result.rowCount === 0) return res.status(404).json({ error: 'Journal introuvable.' });
    return res.json({ success: true });
  } catch (err) {
    console.error('[DELETE /journals/:id]', err);
    return res.status(500).json({ error: 'Erreur lors de la suppression du journal.' });
  }
});

export default router;
