// Transformation agroalimentaire, étape 2 : ordres de transformation — exécute une recette
// (produit_recettes) en une seule action : consomme les ingrédients, produit l'article fini,
// crée un lot de sortie (stock_lots). Pas de brouillon/workflow multi-état (comme applications_
// intrants, un journal append-only) — une exécution = un ordre, annulable par DELETE (undo
// complet des mouvements de stock).
import express from 'express';
import { authRequired } from '../middleware/auth.js';
import { pool } from '../db.js';
import {
  consommerIngredientTransformation, restituerIngredientTransformation,
  produireSortieTransformation, retirerSortieTransformation,
} from '../utils/stockSync.js';

const router = express.Router();

const ORDRE_COLUMNS = `
  o.id, o.recette_id AS "recetteId", o.recette_nom AS "recetteNom",
  o.produit_sortie_id AS "produitSortieId", o.produit_sortie_nom AS "produitSortieNom",
  o.quantite_produite::float8 AS "quantiteProduite",
  o.lot_sortie_id AS "lotSortieId", o.numero_lot_sortie AS "numeroLotSortie",
  to_char(o.date_transformation, 'YYYY-MM-DD') AS "dateTransformation",
  o.operateur, o.notes, o.created_at AS "createdAt"
`;

// ?module= filtre sur le module du produit de sortie (survit même si la recette d'origine a
// été supprimée, puisque produit_sortie_id est conservé indépendamment sur l'ordre).
router.get('/', authRequired, async (req, res) => {
  const { module } = req.query;
  try {
    const result = module
      ? await pool.query(
          `SELECT ${ORDRE_COLUMNS}, COUNT(l.id)::int AS "nombreLignes"
           FROM ordres_transformation o
           LEFT JOIN ordres_transformation_lignes l ON l.ordre_id = o.id
           JOIN produits p ON p.id = o.produit_sortie_id
           WHERE o.entreprise_id = $1 AND p.module = $2
           GROUP BY o.id
           ORDER BY o.date_transformation DESC, o.id DESC`,
          [req.user.entrepriseId, module]
        )
      : await pool.query(
          `SELECT ${ORDRE_COLUMNS}, COUNT(l.id)::int AS "nombreLignes"
           FROM ordres_transformation o
           LEFT JOIN ordres_transformation_lignes l ON l.ordre_id = o.id
           WHERE o.entreprise_id = $1
           GROUP BY o.id
           ORDER BY o.date_transformation DESC, o.id DESC`,
          [req.user.entrepriseId]
        );
    return res.json({ ordres: result.rows });
  } catch (err) {
    console.error('[GET /ordres-transformation]', err);
    return res.status(500).json({ error: 'Erreur lors de la récupération des ordres de transformation.' });
  }
});

router.get('/:id', authRequired, async (req, res) => {
  try {
    const ordre = await pool.query(
      `SELECT ${ORDRE_COLUMNS} FROM ordres_transformation o WHERE o.id = $1 AND o.entreprise_id = $2`,
      [req.params.id, req.user.entrepriseId]
    );
    if (ordre.rows.length === 0) {
      return res.status(404).json({ error: 'Ordre de transformation introuvable.' });
    }
    const lignes = await pool.query(
      `SELECT id, produit_id AS "produitId", produit_nom AS "produitNom", quantite_consommee::float8 AS "quantiteConsommee"
       FROM ordres_transformation_lignes WHERE ordre_id = $1 ORDER BY id ASC`,
      [req.params.id]
    );
    const lotsEntrants = await pool.query(
      `SELECT id, lot_id AS "lotId", numero_lot AS "numeroLot"
       FROM ordres_transformation_lots_entrants WHERE ordre_id = $1 ORDER BY id ASC`,
      [req.params.id]
    );
    return res.json({ ordre: { ...ordre.rows[0], lignes: lignes.rows, lotsEntrants: lotsEntrants.rows } });
  } catch (err) {
    console.error('[GET /ordres-transformation/:id]', err);
    return res.status(500).json({ error: "Erreur lors de la récupération de l'ordre." });
  }
});

router.post('/', authRequired, async (req, res) => {
  const { recetteId, quantiteProduite, dateTransformation, operateur, notes, numeroLotSortie, lotsEntrantsIds } = req.body;
  const quantite = Number(quantiteProduite);
  if (!recetteId || !(quantite > 0)) {
    return res.status(400).json({ error: 'recetteId et quantiteProduite (> 0) sont requis.' });
  }
  try {
    const recette = await pool.query(
      `SELECT r.id, r.nom, r.quantite_produite::float8 AS "quantiteProduite",
              r.produit_sortie_id AS "produitSortieId", p.nom AS "produitSortieNom"
       FROM produit_recettes r JOIN produits p ON p.id = r.produit_sortie_id
       WHERE r.id = $1 AND r.entreprise_id = $2`,
      [recetteId, req.user.entrepriseId]
    );
    if (recette.rows.length === 0) {
      return res.status(400).json({ error: 'Recette introuvable.' });
    }
    const rec = recette.rows[0];

    const lignesRecette = await pool.query(
      `SELECT l.produit_id AS "produitId", p.nom AS "produitNom", l.quantite::float8 AS quantite
       FROM produit_recettes_lignes l JOIN produits p ON p.id = l.produit_id
       WHERE l.recette_id = $1`,
      [recetteId]
    );
    if (lignesRecette.rows.length === 0) {
      return res.status(400).json({ error: "Cette recette n'a aucun ingrédient — rien à transformer." });
    }

    let lotsEntrantsValides = [];
    if (Array.isArray(lotsEntrantsIds) && lotsEntrantsIds.length > 0) {
      const lots = await pool.query(
        `SELECT id, numero_lot AS "numeroLot" FROM stock_lots WHERE id = ANY($1::int[]) AND entreprise_id = $2`,
        [lotsEntrantsIds, req.user.entrepriseId]
      );
      lotsEntrantsValides = lots.rows;
    }

    const ratio = quantite / rec.quantiteProduite;
    const ctx = { userId: req.user.sub, documentType: 'ordre_transformation', raison: `Transformation — ${rec.nom}` };

    const ordreInsert = await pool.query(
      `INSERT INTO ordres_transformation
         (entreprise_id, user_id, recette_id, recette_nom, produit_sortie_id, produit_sortie_nom,
          quantite_produite, date_transformation, operateur, notes)
       VALUES ($1, $2, $3, $4, $5, $6, $7, COALESCE($8, date_entreprise($1)), $9, $10)
       RETURNING id`,
      [req.user.entrepriseId, req.user.sub, recetteId, rec.nom, rec.produitSortieId, rec.produitSortieNom,
        quantite, dateTransformation || null, operateur || null, notes || null]
    );
    const ordreId = ordreInsert.rows[0].id;
    ctx.documentId = ordreId;

    for (const ligne of lignesRecette.rows) {
      const quantiteConsommee = Math.round(ligne.quantite * ratio * 1000) / 1000;
      await consommerIngredientTransformation(req.user.entrepriseId, {
        stockId: ligne.produitId, produitNom: ligne.produitNom, quantite: quantiteConsommee,
      }, ctx);
      await pool.query(
        `INSERT INTO ordres_transformation_lignes (ordre_id, produit_id, produit_nom, quantite_consommee)
         VALUES ($1, $2, $3, $4)`,
        [ordreId, ligne.produitId, ligne.produitNom, quantiteConsommee]
      );
    }

    await produireSortieTransformation(req.user.entrepriseId, {
      stockId: rec.produitSortieId, produitNom: rec.produitSortieNom, quantite,
    }, ctx);

    const numeroLot = (numeroLotSortie && numeroLotSortie.trim()) || `TR-${ordreId}`;
    const lot = await pool.query(
      `INSERT INTO stock_lots (entreprise_id, produit_id, user_id, numero_lot, quantite_initiale, quantite_restante, notes)
       VALUES ($1, $2, $3, $4, $5, $5, $6) RETURNING id`,
      [req.user.entrepriseId, rec.produitSortieId, req.user.sub, numeroLot, quantite, `Issu de l'ordre de transformation #${ordreId} (${rec.nom})`]
    );
    await pool.query(
      `UPDATE ordres_transformation SET lot_sortie_id = $1, numero_lot_sortie = $2 WHERE id = $3`,
      [lot.rows[0].id, numeroLot, ordreId]
    );

    for (const l of lotsEntrantsValides) {
      await pool.query(
        `INSERT INTO ordres_transformation_lots_entrants (ordre_id, lot_id, numero_lot) VALUES ($1, $2, $3)`,
        [ordreId, l.id, l.numeroLot]
      );
    }

    const created = await pool.query(
      `SELECT ${ORDRE_COLUMNS} FROM ordres_transformation o WHERE o.id = $1`,
      [ordreId]
    );
    return res.status(201).json({ ordre: created.rows[0] });
  } catch (err) {
    console.error('[POST /ordres-transformation]', err);
    return res.status(500).json({ error: "Erreur lors de l'exécution de l'ordre de transformation." });
  }
});

// Annule un ordre : restitue les ingrédients consommés, retire l'article produit, supprime le
// lot de sortie (rien d'autre ne peut encore le référencer, la déplétion FIFO étant hors
// périmètre de ce projet — voir la note sur stock_lots dans migrate.js).
router.delete('/:id', authRequired, async (req, res) => {
  try {
    const ordre = await pool.query(
      `SELECT ${ORDRE_COLUMNS} FROM ordres_transformation o WHERE o.id = $1 AND o.entreprise_id = $2`,
      [req.params.id, req.user.entrepriseId]
    );
    if (ordre.rows.length === 0) {
      return res.status(404).json({ error: 'Ordre de transformation introuvable.' });
    }
    const o = ordre.rows[0];
    const lignes = await pool.query(
      `SELECT produit_id AS "produitId", produit_nom AS "produitNom", quantite_consommee::float8 AS "quantiteConsommee"
       FROM ordres_transformation_lignes WHERE ordre_id = $1`,
      [req.params.id]
    );
    const ctx = { userId: req.user.sub, documentType: 'ordre_transformation', documentId: o.id, raison: `Annulation transformation — ${o.recetteNom}` };

    for (const ligne of lignes.rows) {
      if (!ligne.produitId) continue;
      await restituerIngredientTransformation(req.user.entrepriseId, {
        stockId: ligne.produitId, produitNom: ligne.produitNom, quantite: ligne.quantiteConsommee,
      }, ctx);
    }
    if (o.produitSortieId) {
      await retirerSortieTransformation(req.user.entrepriseId, {
        stockId: o.produitSortieId, produitNom: o.produitSortieNom, quantite: o.quantiteProduite,
      }, ctx);
    }
    if (o.lotSortieId) {
      await pool.query('DELETE FROM stock_lots WHERE id = $1 AND entreprise_id = $2', [o.lotSortieId, req.user.entrepriseId]);
    }
    await pool.query('DELETE FROM ordres_transformation WHERE id = $1 AND entreprise_id = $2', [req.params.id, req.user.entrepriseId]);
    return res.json({ success: true });
  } catch (err) {
    console.error('[DELETE /ordres-transformation/:id]', err);
    return res.status(500).json({ error: "Erreur lors de l'annulation de l'ordre." });
  }
});

export default router;
