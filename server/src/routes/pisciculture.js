// Module Pisciculture — mirroir de la portion livraisons+suivi de routes/poulailler.js.
// Le stock (articles/quantités) vit dans le catalogue unifié produits/produit_categories
// (voir routes/produits.js, filtré par ?module=Pisciculture), pas ici. Les vraies
// ventes/achats passent par devis.js/achats.js (stock réellement synchronisé) — pas de
// "mouvements" texte-libre ici : ce ledger, côté Poulailler, est un vestige de l'ancien
// système jamais rebranché au frontend, volontairement pas reproduit pour ce nouveau module.
import express from 'express';
import { authRequired } from '../middleware/auth.js';
import { pool } from '../db.js';
import { log } from '../utils/journal.js';

const router = express.Router();

const LIVRAISON_COLUMNS = `id, date, client, produit, quantite::float8 AS quantite, statut, created_at AS "createdAt"`;
const SUIVI_COLUMNS = `id, date, type, quantite::float8 AS quantite, detail, created_at AS "createdAt"`;

// ═══════════════════════════════════════════════════════════
//  LIVRAISONS
// ═══════════════════════════════════════════════════════════

router.get('/livraisons', authRequired, async (req, res) => {
  try {
    const result = await pool.query(`SELECT ${LIVRAISON_COLUMNS} FROM pisciculture_livraisons WHERE entreprise_id = $1 ORDER BY date DESC, created_at DESC`, [req.user.entrepriseId]);
    return res.json({ livraisons: result.rows });
  } catch (err) {
    log.error('[GET /pisciculture/livraisons]', err);
    return res.status(500).json({ error: 'Erreur lors de la récupération des livraisons.' });
  }
});

router.post('/livraisons', authRequired, async (req, res) => {
  const { date, client, produit, quantite = 0 } = req.body;
  if (!client || !produit) return res.status(400).json({ error: 'client et produit sont requis.' });
  try {
    const result = await pool.query(
      `INSERT INTO pisciculture_livraisons (entreprise_id, user_id, date, client, produit, quantite, statut)
       VALUES ($1, $2, COALESCE($3, date_entreprise($1)), $4, $5, $6, 'En attente')
       RETURNING ${LIVRAISON_COLUMNS}`,
      [req.user.entrepriseId, req.user.sub, date || null, client, produit, Number(quantite) || 0]
    );
    return res.status(201).json({ livraison: result.rows[0] });
  } catch (err) {
    log.error('[POST /pisciculture/livraisons]', err);
    return res.status(500).json({ error: "Erreur lors de l'enregistrement de la livraison." });
  }
});

router.put('/livraisons/:id', authRequired, async (req, res) => {
  const { statut } = req.body;
  if (!statut) return res.status(400).json({ error: 'statut est requis.' });
  try {
    const result = await pool.query(
      `UPDATE pisciculture_livraisons SET statut = $1 WHERE id = $2 AND entreprise_id = $3 RETURNING ${LIVRAISON_COLUMNS}`,
      [statut, req.params.id, req.user.entrepriseId]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Livraison introuvable.' });
    return res.json({ livraison: result.rows[0] });
  } catch (err) {
    log.error('[PUT /pisciculture/livraisons]', err);
    return res.status(500).json({ error: 'Erreur lors de la mise à jour.' });
  }
});

router.delete('/livraisons/:id', authRequired, async (req, res) => {
  try {
    const result = await pool.query('DELETE FROM pisciculture_livraisons WHERE id = $1 AND entreprise_id = $2', [req.params.id, req.user.entrepriseId]);
    if (result.rowCount === 0) return res.status(404).json({ error: 'Livraison introuvable.' });
    return res.json({ success: true });
  } catch (err) {
    log.error('[DELETE /pisciculture/livraisons]', err);
    return res.status(500).json({ error: 'Erreur lors de la suppression.' });
  }
});

// ═══════════════════════════════════════════════════════════
//  SUIVI QUOTIDIEN
// ═══════════════════════════════════════════════════════════

router.get('/suivi', authRequired, async (req, res) => {
  try {
    const result = await pool.query(`SELECT ${SUIVI_COLUMNS} FROM pisciculture_suivi WHERE entreprise_id = $1 ORDER BY date DESC, created_at DESC`, [req.user.entrepriseId]);
    return res.json({ suivi: result.rows });
  } catch (err) {
    log.error('[GET /pisciculture/suivi]', err);
    return res.status(500).json({ error: 'Erreur lors de la récupération du suivi.' });
  }
});

router.post('/suivi', authRequired, async (req, res) => {
  const { date, type, quantite, detail = '' } = req.body;
  if (!type || quantite === undefined) return res.status(400).json({ error: 'type et quantite sont requis.' });
  try {
    const result = await pool.query(
      `INSERT INTO pisciculture_suivi (entreprise_id, user_id, date, type, quantite, detail)
       VALUES ($1, $2, COALESCE($3, date_entreprise($1)), $4, $5, $6)
       RETURNING ${SUIVI_COLUMNS}`,
      [req.user.entrepriseId, req.user.sub, date || null, type, Number(quantite) || 0, detail]
    );
    return res.status(201).json({ entry: result.rows[0] });
  } catch (err) {
    log.error('[POST /pisciculture/suivi]', err);
    return res.status(500).json({ error: "Erreur lors de l'enregistrement." });
  }
});

export default router;
