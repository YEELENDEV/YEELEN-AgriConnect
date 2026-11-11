// Paiements clients autonomes (account.payment sans facture) — étape 6 Comptabilité.
// Un encaissement enregistré hors facture (avance / acompte / à-valoir), qu'on affecte
// ensuite à une ou plusieurs factures. Écritures réservées admin/directeur.
import express from 'express';
import { authRequired } from '../middleware/auth.js';
import { pool } from '../db.js';
import { creerPaiementAutonome, allouerPaiement } from '../utils/accountMove.js';

const router = express.Router();
const ecriture = [authRequired];

// ─── GET /api/paiements?partnerId=&unallocated=1 ───
router.get('/', authRequired, async (req, res) => {
  const cond = ['p.entreprise_id = $1'];
  const params = [req.user.entrepriseId];
  if (req.query.partnerId) { params.push(req.query.partnerId); cond.push(`p.partner_id = $${params.length}`); }
  try {
    const { rows } = await pool.query(
      `SELECT p.id, p.amount::float8 AS amount, to_char(p.payment_date, 'YYYY-MM-DD') AS "paymentDate",
              p.payment_type AS "paymentType", p.partner_id AS "partnerId", p.ref, p.state,
              pm.name AS "moveName",
              COALESCE(ABS(pl.amount_residual::float8), 0) AS "unallocated",
              COALESCE(NULLIF(TRIM(CONCAT(c.prenom, ' ', c.nom)), ''), c.nom) AS "partnerName"
       FROM account_payment p
       LEFT JOIN account_move pm ON pm.id = p.move_id
       LEFT JOIN account_move_line pl ON pl.move_id = p.move_id AND pl.display_type = 'payment_term'
       LEFT JOIN contacts c ON c.id = p.partner_id
       WHERE ${cond.join(' AND ')}
       ORDER BY p.id DESC`,
      params
    );
    const filtered = req.query.unallocated === '1' ? rows.filter((r) => r.unallocated > 0.01) : rows;
    return res.json({ paiements: filtered });
  } catch (err) {
    console.error('[GET /paiements]', err);
    return res.status(500).json({ error: 'Erreur lors de la récupération des paiements.' });
  }
});

// ─── POST /api/paiements ─── (paiement client autonome)
router.post('/', ...ecriture, async (req, res) => {
  const { partnerId, amount, paymentDate, journalId, ref } = req.body;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const r = await creerPaiementAutonome(client, {
      entrepriseId: req.user.entrepriseId, userId: req.user.sub,
      partnerId: partnerId ? Number(partnerId) : null, amount, paymentDate, journalId, ref,
    });
    await client.query('COMMIT');
    return res.status(201).json({ paiement: r });
  } catch (err) {
    await client.query('ROLLBACK');
    if (!err.status) console.error('[POST /paiements]', err);
    return res.status(err.status || 500).json({ error: err.status ? err.message : 'Erreur lors de la création du paiement.' });
  } finally {
    client.release();
  }
});

// ─── POST /api/paiements/:id/allocate ─── (affecte un montant à une facture)
router.post('/:id/allocate', ...ecriture, async (req, res) => {
  const { moveId, amount } = req.body;
  if (!moveId) return res.status(400).json({ error: 'moveId requis.' });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const r = await allouerPaiement(client, {
      paymentId: req.params.id, moveId: Number(moveId), amount, entrepriseId: req.user.entrepriseId,
    });
    await client.query('COMMIT');
    return res.json({ allocation: r });
  } catch (err) {
    await client.query('ROLLBACK');
    if (!err.status) console.error('[POST /paiements/:id/allocate]', err);
    return res.status(err.status || 500).json({ error: err.status ? err.message : "Erreur lors de l'affectation." });
  } finally {
    client.release();
  }
});

export default router;
