// Transformation agroalimentaire, étape 1 : recettes de transformation (mrp.bom-like côté ERP
// de référence). Un produit de sortie catalogué (module Cultures/Poulailler/Pisciculture
// existant, aucun 4e module) + ses lignes d'ingrédients (autres produits + quantité). Pas
// d'impact stock à cette étape (voir migrate.js) — étape 2 (ordres de transformation, différée)
// consommera/produira réellement le stock à partir de ces recettes.
import express from 'express';
import { authRequired } from '../middleware/auth.js';
import { pool } from '../db.js';

const router = express.Router();

const RECETTE_COLUMNS = `
  r.id, r.nom, r.quantite_produite::float8 AS "quantiteProduite", r.notes,
  r.produit_sortie_id AS "produitSortieId", p.nom AS "produitSortieNom", p.module,
  r.created_at AS "createdAt"
`;

router.get('/', authRequired, async (req, res) => {
  const { module } = req.query;
  try {
    const result = module
      ? await pool.query(
          `SELECT ${RECETTE_COLUMNS}, COUNT(l.id)::int AS "nombreLignes"
           FROM produit_recettes r
           JOIN produits p ON p.id = r.produit_sortie_id
           LEFT JOIN produit_recettes_lignes l ON l.recette_id = r.id
           WHERE r.entreprise_id = $1 AND p.module = $2
           GROUP BY r.id, p.nom, p.module
           ORDER BY r.nom ASC`,
          [req.user.entrepriseId, module]
        )
      : await pool.query(
          `SELECT ${RECETTE_COLUMNS}, COUNT(l.id)::int AS "nombreLignes"
           FROM produit_recettes r
           JOIN produits p ON p.id = r.produit_sortie_id
           LEFT JOIN produit_recettes_lignes l ON l.recette_id = r.id
           WHERE r.entreprise_id = $1
           GROUP BY r.id, p.nom, p.module
           ORDER BY p.module ASC, r.nom ASC`,
          [req.user.entrepriseId]
        );
    return res.json({ recettes: result.rows });
  } catch (err) {
    console.error('[GET /produit-recettes]', err);
    return res.status(500).json({ error: 'Erreur lors de la récupération des recettes.' });
  }
});

router.post('/', authRequired, async (req, res) => {
  const { produitSortieId, nom, quantiteProduite, notes } = req.body;
  if (!produitSortieId || !nom || !nom.trim()) {
    return res.status(400).json({ error: 'produitSortieId et nom sont requis.' });
  }
  try {
    const produit = await pool.query(
      'SELECT id FROM produits WHERE id = $1 AND entreprise_id = $2',
      [produitSortieId, req.user.entrepriseId]
    );
    if (produit.rows.length === 0) {
      return res.status(400).json({ error: 'Produit de sortie introuvable.' });
    }
    const insert = await pool.query(
      `INSERT INTO produit_recettes (entreprise_id, produit_sortie_id, nom, quantite_produite, notes)
       VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [req.user.entrepriseId, produitSortieId, nom.trim(), Number(quantiteProduite) || 1, notes || null]
    );
    const created = await pool.query(
      `SELECT ${RECETTE_COLUMNS}, 0 AS "nombreLignes"
       FROM produit_recettes r JOIN produits p ON p.id = r.produit_sortie_id
       WHERE r.id = $1`,
      [insert.rows[0].id]
    );
    return res.status(201).json({ recette: created.rows[0] });
  } catch (err) {
    console.error('[POST /produit-recettes]', err);
    return res.status(500).json({ error: 'Erreur lors de la création de la recette.' });
  }
});

router.put('/:id', authRequired, async (req, res) => {
  const { produitSortieId, nom, quantiteProduite, notes } = req.body;
  try {
    let produitSortieValide = null;
    if (produitSortieId != null) {
      const produit = await pool.query(
        'SELECT id FROM produits WHERE id = $1 AND entreprise_id = $2',
        [produitSortieId, req.user.entrepriseId]
      );
      if (produit.rows.length === 0) {
        return res.status(400).json({ error: 'Produit de sortie introuvable.' });
      }
      produitSortieValide = produit.rows[0].id;
    }
    const result = await pool.query(
      `UPDATE produit_recettes SET
         produit_sortie_id = COALESCE($1, produit_sortie_id),
         nom = COALESCE($2, nom),
         quantite_produite = COALESCE($3, quantite_produite),
         notes = COALESCE($4, notes)
       WHERE id = $5 AND entreprise_id = $6
       RETURNING id`,
      [produitSortieValide, nom, quantiteProduite, notes, req.params.id, req.user.entrepriseId]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Recette introuvable.' });
    }
    const updated = await pool.query(
      `SELECT ${RECETTE_COLUMNS},
         (SELECT COUNT(*) FROM produit_recettes_lignes WHERE recette_id = r.id)::int AS "nombreLignes"
       FROM produit_recettes r JOIN produits p ON p.id = r.produit_sortie_id
       WHERE r.id = $1`,
      [req.params.id]
    );
    return res.json({ recette: updated.rows[0] });
  } catch (err) {
    console.error('[PUT /produit-recettes]', err);
    return res.status(500).json({ error: 'Erreur lors de la mise à jour.' });
  }
});

router.delete('/:id', authRequired, async (req, res) => {
  try {
    const result = await pool.query(
      'DELETE FROM produit_recettes WHERE id = $1 AND entreprise_id = $2 RETURNING id',
      [req.params.id, req.user.entrepriseId]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Recette introuvable.' });
    }
    return res.json({ success: true });
  } catch (err) {
    console.error('[DELETE /produit-recettes]', err);
    return res.status(500).json({ error: 'Erreur lors de la suppression.' });
  }
});

router.get('/:id/lignes', authRequired, async (req, res) => {
  try {
    const recette = await pool.query(
      'SELECT id FROM produit_recettes WHERE id = $1 AND entreprise_id = $2',
      [req.params.id, req.user.entrepriseId]
    );
    if (recette.rows.length === 0) {
      return res.status(404).json({ error: 'Recette introuvable.' });
    }
    const result = await pool.query(
      `SELECT l.id, l.quantite::float8 AS quantite, l.notes, l.produit_id AS "produitId", p.nom AS "produitNom"
       FROM produit_recettes_lignes l JOIN produits p ON p.id = l.produit_id
       WHERE l.recette_id = $1
       ORDER BY l.id ASC`,
      [req.params.id]
    );
    return res.json({ lignes: result.rows });
  } catch (err) {
    console.error('[GET /produit-recettes/:id/lignes]', err);
    return res.status(500).json({ error: 'Erreur lors de la récupération des lignes.' });
  }
});

router.post('/:id/lignes', authRequired, async (req, res) => {
  const { produitId, quantite, notes } = req.body;
  if (!produitId || quantite == null || quantite === '') {
    return res.status(400).json({ error: 'produitId et quantite sont requis.' });
  }
  try {
    const recette = await pool.query(
      'SELECT id FROM produit_recettes WHERE id = $1 AND entreprise_id = $2',
      [req.params.id, req.user.entrepriseId]
    );
    if (recette.rows.length === 0) {
      return res.status(404).json({ error: 'Recette introuvable.' });
    }
    const produit = await pool.query(
      'SELECT id FROM produits WHERE id = $1 AND entreprise_id = $2',
      [produitId, req.user.entrepriseId]
    );
    if (produit.rows.length === 0) {
      return res.status(400).json({ error: 'Produit ingrédient introuvable.' });
    }
    const insert = await pool.query(
      `INSERT INTO produit_recettes_lignes (recette_id, produit_id, quantite, notes)
       VALUES ($1, $2, $3, $4) RETURNING id`,
      [req.params.id, produitId, Number(quantite), notes || null]
    );
    const created = await pool.query(
      `SELECT l.id, l.quantite::float8 AS quantite, l.notes, l.produit_id AS "produitId", p.nom AS "produitNom"
       FROM produit_recettes_lignes l JOIN produits p ON p.id = l.produit_id
       WHERE l.id = $1`,
      [insert.rows[0].id]
    );
    return res.status(201).json({ ligne: created.rows[0] });
  } catch (err) {
    console.error('[POST /produit-recettes/:id/lignes]', err);
    return res.status(500).json({ error: "Erreur lors de l'enregistrement de la ligne." });
  }
});

// Jointure (USING) vers produit_recettes pour vérifier le cloisonnement par entreprise en une
// seule requête — même idiome que DELETE /listes-prix/lignes/:id.
router.delete('/lignes/:ligneId', authRequired, async (req, res) => {
  try {
    const result = await pool.query(
      `DELETE FROM produit_recettes_lignes l
       USING produit_recettes r
       WHERE l.id = $1 AND l.recette_id = r.id AND r.entreprise_id = $2`,
      [req.params.ligneId, req.user.entrepriseId]
    );
    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Ligne introuvable.' });
    }
    return res.json({ success: true });
  } catch (err) {
    console.error('[DELETE /produit-recettes/lignes/:id]', err);
    return res.status(500).json({ error: 'Erreur lors de la suppression de la ligne.' });
  }
});

export default router;
