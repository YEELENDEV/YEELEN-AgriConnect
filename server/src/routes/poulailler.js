import express from 'express';
import { authRequired } from '../middleware/auth.js';
import { pool } from '../db.js';
import { syncFinanceEntry, removeFinanceEntry, updateFinanceEntry } from '../utils/financeSync.js';
import { logMouvementHistorique, getMouvementHistorique, getAllMouvementHistorique } from '../utils/mouvementHistorique.js';
import { log } from '../utils/journal.js';

const router = express.Router();

const MOUVEMENT_COLUMNS = `
  id, type, date, partenaire, produit,
  quantite::float8 AS quantite,
  prix_unitaire::float8 AS "prixUnitaire",
  remise::float8 AS remise,
  created_at AS "createdAt"
`;
const LIVRAISON_COLUMNS = `id, date, client, produit, quantite::float8 AS quantite, statut, created_at AS "createdAt"`;
const SUIVI_COLUMNS = `id, date, type, quantite::float8 AS quantite, detail, created_at AS "createdAt"`;

// Stocks : voir routes/produits.js (fusionné avec Cultures dans la table produits,
// 2026-08-18 — historiquement /poulailler/stocks* vivait ici).

// ═══════════════════════════════════════════════════════════
//  VENTES / ACHATS (mouvements)
// ═══════════════════════════════════════════════════════════

router.get('/mouvements', authRequired, async (req, res) => {
  const { type } = req.query;
  try {
    const result = type
      ? await pool.query(`SELECT ${MOUVEMENT_COLUMNS} FROM poulailler_mouvements WHERE entreprise_id = $1 AND type = $2 ORDER BY date DESC, created_at DESC`, [req.user.entrepriseId, type])
      : await pool.query(`SELECT ${MOUVEMENT_COLUMNS} FROM poulailler_mouvements WHERE entreprise_id = $1 ORDER BY date DESC, created_at DESC`, [req.user.entrepriseId]);
    return res.json({ mouvements: result.rows });
  } catch (err) {
    log.error('[GET /poulailler/mouvements]', err);
    return res.status(500).json({ error: 'Erreur lors de la récupération des mouvements.' });
  }
});

router.post('/mouvements', authRequired, async (req, res) => {
  const { type, date, partenaire, produit, quantite, prixUnitaire, remise } = req.body;
  if (!type || !['vente', 'achat'].includes(type) || !partenaire || !produit) {
    return res.status(400).json({ error: 'type (vente/achat), partenaire et produit sont requis.' });
  }
  try {
    const result = await pool.query(
      `INSERT INTO poulailler_mouvements (entreprise_id, user_id, type, date, partenaire, produit, quantite, prix_unitaire, remise)
       VALUES ($1, $2, $3, COALESCE($4, date_entreprise($1)), $5, $6, $7, $8, $9)
       RETURNING ${MOUVEMENT_COLUMNS}`,
      [req.user.entrepriseId, req.user.sub, type, date || null, partenaire, produit, Number(quantite) || 0, Number(prixUnitaire) || 0, Number(remise) || 0]
    );

    await syncFinanceEntry(req.user.entrepriseId, req.user.sub, {
      type,
      module: 'Poulailler',
      produit,
      partenaire,
      quantite: Number(quantite) || 0,
      prixUnitaire: Number(prixUnitaire) || 0,
      remise: Number(remise) || 0,
      mouvementId: result.rows[0].id,
    });

    return res.status(201).json({ mouvement: result.rows[0] });
  } catch (err) {
    log.error('[POST /poulailler/mouvements]', err);
    return res.status(500).json({ error: "Erreur lors de l'enregistrement du mouvement." });
  }
});


router.put('/mouvements/:id', authRequired, async (req, res) => {
  const { type, date, partenaire, produit, quantite, prixUnitaire, remise, raison } = req.body;
  if (!raison) {
    return res.status(400).json({ error: 'La raison de la modification est requise.' });
  }
  try {
    // Récupère les valeurs actuelles avant modification, pour l'historique
    const before = await pool.query(`SELECT ${MOUVEMENT_COLUMNS} FROM poulailler_mouvements WHERE id = $1 AND entreprise_id = $2`, [req.params.id, req.user.entrepriseId]);
    if (before.rows.length === 0) {
      return res.status(404).json({ error: 'Mouvement introuvable.' });
    }

    const result = await pool.query(
      `UPDATE poulailler_mouvements SET
         type = COALESCE($1, type),
         date = COALESCE($2, date),
         partenaire = COALESCE($3, partenaire),
         produit = COALESCE($4, produit),
         quantite = COALESCE($5, quantite),
         prix_unitaire = COALESCE($6, prix_unitaire),
         remise = COALESCE($7, remise)
       WHERE id = $8 AND entreprise_id = $9
       RETURNING ${MOUVEMENT_COLUMNS}`,
      [type, date, partenaire, produit, quantite, prixUnitaire, remise, req.params.id, req.user.entrepriseId]
    );

    const updated = result.rows[0];

    await updateFinanceEntry(req.user.entrepriseId, 'Poulailler', req.params.id, {
      type: updated.type,
      produit: updated.produit,
      partenaire: updated.partenaire,
      quantite: updated.quantite,
      prixUnitaire: updated.prixUnitaire,
      remise: updated.remise,
    });

    // Trace la modification avec la raison, les valeurs avant et après
    await logMouvementHistorique(req.user.entrepriseId, req.user.sub, {
      module: 'Poulailler',
      mouvementId: req.params.id,
      action: 'modification',
      raison,
      anciennesValeurs: before.rows[0],
      nouvellesValeurs: updated,
    });

    return res.json({ mouvement: updated });
  } catch (err) {
    log.error('[PUT /poulailler/mouvements]', err);
    return res.status(500).json({ error: 'Erreur lors de la mise à jour du mouvement.' });
  }
});

// ═══════════════════════════════════════════════════════════
//  LIVRAISONS
// ═══════════════════════════════════════════════════════════

router.get('/livraisons', authRequired, async (req, res) => {
  try {
    const result = await pool.query(`SELECT ${LIVRAISON_COLUMNS} FROM poulailler_livraisons WHERE entreprise_id = $1 ORDER BY date DESC, created_at DESC`, [req.user.entrepriseId]);
    return res.json({ livraisons: result.rows });
  } catch (err) {
    log.error('[GET /poulailler/livraisons]', err);
    return res.status(500).json({ error: 'Erreur lors de la récupération des livraisons.' });
  }
});

router.post('/livraisons', authRequired, async (req, res) => {
  const { date, client, produit, quantite = 0 } = req.body;
  if (!client || !produit) return res.status(400).json({ error: 'client et produit sont requis.' });
  try {
    const result = await pool.query(
      `INSERT INTO poulailler_livraisons (entreprise_id, user_id, date, client, produit, quantite, statut)
       VALUES ($1, $2, COALESCE($3, date_entreprise($1)), $4, $5, $6, 'En attente')
       RETURNING ${LIVRAISON_COLUMNS}`,
      [req.user.entrepriseId, req.user.sub, date || null, client, produit, Number(quantite) || 0]
    );
    return res.status(201).json({ livraison: result.rows[0] });
  } catch (err) {
    log.error('[POST /poulailler/livraisons]', err);
    return res.status(500).json({ error: "Erreur lors de l'enregistrement de la livraison." });
  }
});

router.put('/livraisons/:id', authRequired, async (req, res) => {
  const { statut } = req.body;
  if (!statut) return res.status(400).json({ error: 'statut est requis.' });
  try {
    const result = await pool.query(
      `UPDATE poulailler_livraisons SET statut = $1 WHERE id = $2 AND entreprise_id = $3 RETURNING ${LIVRAISON_COLUMNS}`,
      [statut, req.params.id, req.user.entrepriseId]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Livraison introuvable.' });
    return res.json({ livraison: result.rows[0] });
  } catch (err) {
    log.error('[PUT /poulailler/livraisons]', err);
    return res.status(500).json({ error: 'Erreur lors de la mise à jour.' });
  }
});

router.delete('/livraisons/:id', authRequired, async (req, res) => {
  try {
    const result = await pool.query('DELETE FROM poulailler_livraisons WHERE id = $1 AND entreprise_id = $2', [req.params.id, req.user.entrepriseId]);
    // 0 ligne = id inexistant ou d'une autre entreprise → 404, cohérent avec PUT /:id.
    if (result.rowCount === 0) return res.status(404).json({ error: 'Livraison introuvable.' });
    return res.json({ success: true });
  } catch (err) {
    log.error('[DELETE /poulailler/livraisons]', err);
    return res.status(500).json({ error: 'Erreur lors de la suppression.' });
  }
});

// ═══════════════════════════════════════════════════════════
//  SUIVI QUOTIDIEN
// ═══════════════════════════════════════════════════════════

router.get('/suivi', authRequired, async (req, res) => {
  try {
    const result = await pool.query(`SELECT ${SUIVI_COLUMNS} FROM poulailler_suivi WHERE entreprise_id = $1 ORDER BY date DESC, created_at DESC`, [req.user.entrepriseId]);
    return res.json({ suivi: result.rows });
  } catch (err) {
    log.error('[GET /poulailler/suivi]', err);
    return res.status(500).json({ error: 'Erreur lors de la récupération du suivi.' });
  }
});

router.post('/suivi', authRequired, async (req, res) => {
  const { date, type, quantite, detail = '' } = req.body;
  if (!type || quantite === undefined) return res.status(400).json({ error: 'type et quantite sont requis.' });
  try {
    const result = await pool.query(
      `INSERT INTO poulailler_suivi (entreprise_id, user_id, date, type, quantite, detail)
       VALUES ($1, $2, COALESCE($3, date_entreprise($1)), $4, $5, $6)
       RETURNING ${SUIVI_COLUMNS}`,
      [req.user.entrepriseId, req.user.sub, date || null, type, Number(quantite) || 0, detail]
    );
    return res.status(201).json({ entry: result.rows[0] });
  } catch (err) {
    log.error('[POST /poulailler/suivi]', err);
    return res.status(500).json({ error: "Erreur lors de l'enregistrement." });
  }
});

router.delete('/mouvements/:id', authRequired, async (req, res) => {
  const { raison } = req.body;
  if (!raison) {
    return res.status(400).json({ error: 'La raison de la suppression est requise.' });
  }
  try {
    const before = await pool.query(`SELECT ${MOUVEMENT_COLUMNS} FROM poulailler_mouvements WHERE id = $1 AND entreprise_id = $2`, [req.params.id, req.user.entrepriseId]);
    if (before.rows.length === 0) {
      return res.status(404).json({ error: 'Mouvement introuvable.' });
    }

    await pool.query('DELETE FROM poulailler_mouvements WHERE id = $1 AND entreprise_id = $2', [req.params.id, req.user.entrepriseId]);
    await removeFinanceEntry(req.user.entrepriseId, 'Poulailler', req.params.id);

    // Trace la suppression avec la raison et les valeurs avant suppression
    await logMouvementHistorique(req.user.entrepriseId, req.user.sub, {
      module: 'Poulailler',
      mouvementId: req.params.id,
      action: 'suppression',
      raison,
      anciennesValeurs: before.rows[0],
      nouvellesValeurs: null,
    });

    return res.json({ success: true });
  } catch (err) {
    log.error('[DELETE /poulailler/mouvements]', err);
    return res.status(500).json({ error: 'Erreur lors de la suppression.' });
  }
});

router.get('/mouvements/:id/historique', authRequired, async (req, res) => {
  try {
    const historique = await getMouvementHistorique(req.user.entrepriseId, 'Poulailler', req.params.id);
    return res.json({ historique });
  } catch (err) {
    log.error('[GET /poulailler/mouvements/historique]', err);
    return res.status(500).json({ error: "Erreur lors de la récupération de l'historique." });
  }
});

router.get('/historique', authRequired, async (req, res) => {
  try {
    const historique = await getAllMouvementHistorique(req.user.entrepriseId, 'Poulailler');
    return res.json({ historique });
  } catch (err) {
    log.error('[GET /poulailler/historique]', err);
    return res.status(500).json({ error: "Erreur lors de la récupération de l'historique." });
  }
});

export default router;