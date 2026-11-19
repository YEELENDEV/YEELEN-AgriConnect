import express from 'express';
import { authRequired } from '../middleware/auth.js';
import { pool } from '../db.js';
import { syncFinanceEntry, removeFinanceEntry, updateFinanceEntry } from '../utils/financeSync.js';
import { logMouvementHistorique, getMouvementHistorique, getAllMouvementHistorique } from '../utils/mouvementHistorique.js';
import { supprimerPolygone } from '../utils/agroPolygon.js';
import { analyserContour, ContourInvalideError } from '../utils/geoParcelle.js';
import { log } from '../utils/journal.js';

const router = express.Router();

const PARCELLE_COLUMNS = `
  id, nom, culture,
  humidite::float8 AS humidite,
  temperature::float8 AS temperature,
  mode,
  vanne_ouverte AS "vanneOuverte",
  seuil::float8 AS seuil,
  pos_x::float8 AS x, pos_y::float8 AS y,
  superficie, localisation, created_at AS "createdAt",
  to_char(date_semis, 'YYYY-MM-DD') AS "dateSemis",
  ville, latitude::float8 AS latitude, longitude::float8 AS longitude,
  contour
`;

const HISTORIQUE_COLUMNS = `
  ph.id, p.nom AS parcelle, ph.action, ph.created_at AS date
`;

const MOUVEMENT_COLUMNS = `
  id, type, date, partenaire, produit,
  quantite::float8 AS quantite,
  prix_unitaire::float8 AS "prixUnitaire",
  remise::float8 AS remise,
  created_at AS "createdAt"
`;

// ═══════════════════════════════════════════════════════════
//  PARCELLES
// ═══════════════════════════════════════════════════════════

router.get('/parcelles', authRequired, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT ${PARCELLE_COLUMNS} FROM parcelles WHERE entreprise_id = $1 ORDER BY id ASC`,
      [req.user.entrepriseId]
    );
    return res.json({ parcelles: result.rows });
  } catch (err) {
    log.error('[GET /parcelles]', err);
    return res.status(500).json({ error: 'Erreur lors de la récupération des parcelles.' });
  }
});

router.post('/parcelles', authRequired, async (req, res) => {
  const { nom, culture, humidite = 50, temperature = 25, mode = 'auto', vanneOuverte = false, seuil = 35, x = 50, y = 50, superficie, localisation, dateSemis, ville, latitude, longitude, contour } = req.body;
  if (!nom) {
    return res.status(400).json({ error: 'Le nom de la parcelle est requis.' });
  }
  try {
    // Un contour tracé est plus fiable qu'une superficie tapée au clavier : il impose la surface
    // et, à défaut de coordonnées explicites, le point de référence (météo, sol, satellite).
    const geo = analyserContour(contour);
    const superficieFinale = geo.contour ? geo.superficieHa : (superficie || null);
    const latFinale = latitude ?? (geo.centre ? geo.centre.latitude : null);
    const lonFinale = longitude ?? (geo.centre ? geo.centre.longitude : null);
    const result = await pool.query(
      `INSERT INTO parcelles (entreprise_id, user_id, nom, culture, humidite, temperature, mode, vanne_ouverte, seuil, pos_x, pos_y, superficie, localisation, date_semis, ville, latitude, longitude, contour)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)
       RETURNING ${PARCELLE_COLUMNS}`,
      [req.user.entrepriseId, req.user.sub, nom, culture || null, humidite, temperature, mode, vanneOuverte, seuil, x, y, superficieFinale, localisation || null, dateSemis || null, ville || null, latFinale, lonFinale, geo.contour ? JSON.stringify(geo.contour) : null]
    );
    return res.status(201).json({ parcelle: result.rows[0] });
  } catch (err) {
    if (err instanceof ContourInvalideError) return res.status(400).json({ error: err.message });
    log.error('[POST /parcelles]', err);
    return res.status(500).json({ error: 'Erreur lors de la création de la parcelle.' });
  }
});

router.put('/parcelles/:id', authRequired, async (req, res) => {
  const { nom, culture, humidite, temperature, mode, vanneOuverte, seuil, x, y, superficie, dateSemis, ville, latitude, longitude, contour } = req.body;
  const contourFourni = contour !== undefined;
  try {
    const geo = analyserContour(contour);
    // Avant écriture : la localisation/superficie actuelle sert à savoir si le polygone
    // Agromonitoring (agro_polygon_id, voir routes/precisionAgricole.js) doit être invalidé —
    // il ne représente plus la bonne zone dès que l'un des trois change.
    const avant = await pool.query(
      'SELECT latitude::float8 AS latitude, longitude::float8 AS longitude, superficie::float8 AS superficie, agro_polygon_id AS "agroPolygonId" FROM parcelles WHERE id = $1 AND entreprise_id = $2',
      [req.params.id, req.user.entrepriseId]
    );
    if (avant.rows.length === 0) {
      return res.status(404).json({ error: 'Parcelle introuvable.' });
    }
    // Un contour redessiné change la zone observée par le satellite autant qu'un déplacement
    // de coordonnées : il invalide le polygone Agromonitoring de la même façon.
    const localisationChangee =
      contourFourni ||
      (latitude !== undefined && Number(latitude) !== avant.rows[0].latitude) ||
      (longitude !== undefined && Number(longitude) !== avant.rows[0].longitude) ||
      (superficie !== undefined && Number(superficie) !== avant.rows[0].superficie);
    if (localisationChangee && avant.rows[0].agroPolygonId) {
      supprimerPolygone(avant.rows[0].agroPolygonId, process.env.AGRO_API_KEY);
    }

    const result = await pool.query(
      `UPDATE parcelles SET
         nom = COALESCE($1, nom),
         culture = COALESCE($2, culture),
         humidite = COALESCE($3, humidite),
         temperature = COALESCE($4, temperature),
         mode = COALESCE($5, mode),
         vanne_ouverte = COALESCE($6, vanne_ouverte),
         seuil = COALESCE($7, seuil),
         pos_x = COALESCE($8, pos_x),
         pos_y = COALESCE($9, pos_y),
         superficie = COALESCE($10, superficie),
         date_semis = COALESCE($11, date_semis),
         ville = COALESCE($12, ville),
         latitude = COALESCE($13, latitude),
         longitude = COALESCE($14, longitude),
         agro_polygon_id = CASE WHEN $15 THEN NULL ELSE agro_polygon_id END,
         contour = CASE WHEN $18 THEN $19::jsonb ELSE contour END
       WHERE id = $16 AND entreprise_id = $17
       RETURNING ${PARCELLE_COLUMNS}`,
      // $10/$13/$14 : un contour fourni impose la superficie et, sauf saisie explicite, le centre.
      [nom, culture, humidite, temperature, mode, vanneOuverte, seuil, x, y,
        geo.contour ? geo.superficieHa : superficie,
        dateSemis, ville,
        latitude ?? (geo.centre ? geo.centre.latitude : undefined),
        longitude ?? (geo.centre ? geo.centre.longitude : undefined),
        localisationChangee, req.params.id, req.user.entrepriseId,
        contourFourni, geo.contour ? JSON.stringify(geo.contour) : null]
    );
    return res.json({ parcelle: result.rows[0] });
  } catch (err) {
    if (err instanceof ContourInvalideError) return res.status(400).json({ error: err.message });
    log.error('[PUT /parcelles]', err);
    return res.status(500).json({ error: 'Erreur lors de la mise à jour de la parcelle.' });
  }
});

router.delete('/parcelles/:id', authRequired, async (req, res) => {
  try {
    const result = await pool.query('DELETE FROM parcelles WHERE id = $1 AND entreprise_id = $2', [req.params.id, req.user.entrepriseId]);
    // 0 ligne = id inexistant ou d'une autre entreprise → 404, cohérent avec PUT /:id.
    if (result.rowCount === 0) return res.status(404).json({ error: 'Parcelle introuvable.' });
    return res.json({ success: true });
  } catch (err) {
    log.error('[DELETE /parcelles]', err);
    return res.status(500).json({ error: 'Erreur lors de la suppression.' });
  }
});

// ═══════════════════════════════════════════════════════════
//  HISTORIQUE DES VANNES
// ═══════════════════════════════════════════════════════════

router.get('/historique', authRequired, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT ${HISTORIQUE_COLUMNS}
       FROM parcelles_historique ph
       JOIN parcelles p ON p.id = ph.parcelle_id
       WHERE ph.entreprise_id = $1
       ORDER BY ph.created_at DESC LIMIT 40`,
      [req.user.entrepriseId]
    );
    return res.json({ historique: result.rows });
  } catch (err) {
    log.error('[GET /historique]', err);
    return res.status(500).json({ error: "Erreur lors de la récupération de l'historique." });
  }
});

router.post('/historique', authRequired, async (req, res) => {
  const { parcelleId, action } = req.body;
  if (!parcelleId || !action) {
    return res.status(400).json({ error: 'parcelleId et action sont requis.' });
  }
  try {
    const owned = await pool.query('SELECT id FROM parcelles WHERE id = $1 AND entreprise_id = $2', [parcelleId, req.user.entrepriseId]);
    if (owned.rows.length === 0) {
      return res.status(404).json({ error: 'Parcelle introuvable.' });
    }
    const insert = await pool.query(
      `INSERT INTO parcelles_historique (entreprise_id, user_id, parcelle_id, action) VALUES ($1, $2, $3, $4) RETURNING id`,
      [req.user.entrepriseId, req.user.sub, parcelleId, action]
    );
    const result = await pool.query(
      `SELECT ${HISTORIQUE_COLUMNS} FROM parcelles_historique ph JOIN parcelles p ON p.id = ph.parcelle_id WHERE ph.id = $1`,
      [insert.rows[0].id]
    );
    return res.status(201).json({ entry: result.rows[0] });
  } catch (err) {
    log.error('[POST /historique]', err);
    return res.status(500).json({ error: "Erreur lors de l'enregistrement de l'historique." });
  }
});

// ═══════════════════════════════════════════════════════════
//  VENTES / ACHATS (mouvements)
// ═══════════════════════════════════════════════════════════

router.get('/mouvements', authRequired, async (req, res) => {
  const { type } = req.query;
  try {
    const result = type
      ? await pool.query(`SELECT ${MOUVEMENT_COLUMNS} FROM cultures_mouvements WHERE entreprise_id = $1 AND type = $2 ORDER BY date DESC, created_at DESC`, [req.user.entrepriseId, type])
      : await pool.query(`SELECT ${MOUVEMENT_COLUMNS} FROM cultures_mouvements WHERE entreprise_id = $1 ORDER BY date DESC, created_at DESC`, [req.user.entrepriseId]);
    return res.json({ mouvements: result.rows });
  } catch (err) {
    log.error('[GET /mouvements]', err);
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
      `INSERT INTO cultures_mouvements (entreprise_id, user_id, type, date, partenaire, produit, quantite, prix_unitaire, remise)
       VALUES ($1, $2, $3, COALESCE($4, date_entreprise($1)), $5, $6, $7, $8, $9)
       RETURNING ${MOUVEMENT_COLUMNS}`,
      [req.user.entrepriseId, req.user.sub, type, date || null, partenaire, produit, Number(quantite) || 0, Number(prixUnitaire) || 0, Number(remise) || 0]
    );

    await syncFinanceEntry(req.user.entrepriseId, req.user.sub, {
      type,
      module: 'Cultures',
      produit,
      partenaire,
      quantite: Number(quantite) || 0,
      prixUnitaire: Number(prixUnitaire) || 0,
      remise: Number(remise) || 0,
      mouvementId: result.rows[0].id,
    });

    return res.status(201).json({ mouvement: result.rows[0] });
  } catch (err) {
    log.error('[POST /mouvements]', err);
    return res.status(500).json({ error: "Erreur lors de l'enregistrement du mouvement." });
  }
});

router.put('/mouvements/:id', authRequired, async (req, res) => {
  const { type, date, partenaire, produit, quantite, prixUnitaire, remise, raison } = req.body;
  if (!raison) {
    return res.status(400).json({ error: 'La raison de la modification est requise.' });
  }
  try {
    const before = await pool.query(`SELECT ${MOUVEMENT_COLUMNS} FROM cultures_mouvements WHERE id = $1 AND entreprise_id = $2`, [req.params.id, req.user.entrepriseId]);
    if (before.rows.length === 0) {
      return res.status(404).json({ error: 'Mouvement introuvable.' });
    }

    const result = await pool.query(
      `UPDATE cultures_mouvements SET
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

    await updateFinanceEntry(req.user.entrepriseId, 'Cultures', req.params.id, {
      type: updated.type,
      produit: updated.produit,
      partenaire: updated.partenaire,
      quantite: updated.quantite,
      prixUnitaire: updated.prixUnitaire,
      remise: updated.remise,
    });

    await logMouvementHistorique(req.user.entrepriseId, req.user.sub, {
      module: 'Cultures',
      mouvementId: req.params.id,
      action: 'modification',
      raison,
      anciennesValeurs: before.rows[0],
      nouvellesValeurs: updated,
    });

    return res.json({ mouvement: updated });
  } catch (err) {
    log.error('[PUT /mouvements]', err);
    return res.status(500).json({ error: 'Erreur lors de la mise à jour du mouvement.' });
  }
});

router.delete('/mouvements/:id', authRequired, async (req, res) => {
  const { raison } = req.body;
  if (!raison) {
    return res.status(400).json({ error: 'La raison de la suppression est requise.' });
  }
  try {
    const before = await pool.query(`SELECT ${MOUVEMENT_COLUMNS} FROM cultures_mouvements WHERE id = $1 AND entreprise_id = $2`, [req.params.id, req.user.entrepriseId]);
    if (before.rows.length === 0) {
      return res.status(404).json({ error: 'Mouvement introuvable.' });
    }

    await pool.query('DELETE FROM cultures_mouvements WHERE id = $1 AND entreprise_id = $2', [req.params.id, req.user.entrepriseId]);
    await removeFinanceEntry(req.user.entrepriseId, 'Cultures', req.params.id);

    await logMouvementHistorique(req.user.entrepriseId, req.user.sub, {
      module: 'Cultures',
      mouvementId: req.params.id,
      action: 'suppression',
      raison,
      anciennesValeurs: before.rows[0],
      nouvellesValeurs: null,
    });

    return res.json({ success: true });
  } catch (err) {
    log.error('[DELETE /mouvements]', err);
    return res.status(500).json({ error: 'Erreur lors de la suppression.' });
  }
});

router.get('/mouvements/:id/historique', authRequired, async (req, res) => {
  try {
    const historique = await getMouvementHistorique(req.user.entrepriseId, 'Cultures', req.params.id);
    return res.json({ historique });
  } catch (err) {
    log.error('[GET /mouvements/historique]', err);
    return res.status(500).json({ error: "Erreur lors de la récupération de l'historique." });
  }
});

router.get('/historique-mouvements', authRequired, async (req, res) => {
  try {
    const historique = await getAllMouvementHistorique(req.user.entrepriseId, 'Cultures');
    return res.json({ historique });
  } catch (err) {
    log.error('[GET /cultures/historique-mouvements]', err);
    return res.status(500).json({ error: "Erreur lors de la récupération de l'historique." });
  }
});

// Stocks : voir routes/produits.js (fusionné avec Poulailler dans la table produits,
// 2026-08-18 — historiquement /cultures/stocks* vivait ici).

export default router;