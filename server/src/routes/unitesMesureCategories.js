// Catégories d'unités de mesure — calqué sur uom.category d'un ERP de référence. Référentiel
// propre à l'entreprise (voir server/src/db/migrate.js pour la justification du scoping par
// entreprise, contrairement à Odoo où uom.category est une donnée globale partagée). Écritures
// réservées admin/directeur (même posture que /api/taxes, /api/accounts).
import express from 'express';
import { authRequired } from '../middleware/auth.js';
import { pool } from '../db.js';

const router = express.Router();
const ecriture = [authRequired];

const COLUMNS = `id, entreprise_id AS "entrepriseId", nom`;

// ─── GET /api/unites-mesure-categories ───
router.get('/', authRequired, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT ${COLUMNS} FROM unites_mesure_categories WHERE entreprise_id = $1 ORDER BY nom ASC`,
      [req.user.entrepriseId]
    );
    return res.json({ categories: rows });
  } catch (err) {
    console.error('[GET /unites-mesure-categories]', err);
    return res.status(500).json({ error: 'Erreur lors de la récupération des catégories d\'unités.' });
  }
});

// ─── POST /api/unites-mesure-categories ───
router.post('/', ...ecriture, async (req, res) => {
  const nom = String(req.body.nom || '').trim();
  if (!nom) return res.status(400).json({ error: 'Le nom est requis.' });
  try {
    const { rows } = await pool.query(
      `INSERT INTO unites_mesure_categories (entreprise_id, nom) VALUES ($1, $2) RETURNING ${COLUMNS}`,
      [req.user.entrepriseId, nom]
    );
    return res.status(201).json({ categorie: rows[0] });
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'Cette catégorie d\'unités existe déjà.' });
    console.error('[POST /unites-mesure-categories]', err);
    return res.status(500).json({ error: 'Erreur lors de la création de la catégorie.' });
  }
});

// ─── DELETE /api/unites-mesure-categories/:id ───
// unites_mesure.categorie_id est ON DELETE CASCADE : supprimer une catégorie supprime aussi
// ses unités — celles-ci peuvent à leur tour être bloquées par produits.unite_id (ON DELETE
// SET NULL, pas de contrainte à gérer ici) ou achats_lignes/devis_lignes.uom_id (idem).
router.delete('/:id', ...ecriture, async (req, res) => {
  try {
    const result = await pool.query(
      'DELETE FROM unites_mesure_categories WHERE id = $1 AND entreprise_id = $2',
      [req.params.id, req.user.entrepriseId]
    );
    if (result.rowCount === 0) return res.status(404).json({ error: 'Catégorie introuvable.' });
    return res.json({ success: true });
  } catch (err) {
    console.error('[DELETE /unites-mesure-categories/:id]', err);
    return res.status(500).json({ error: 'Erreur lors de la suppression.' });
  }
});

export default router;
