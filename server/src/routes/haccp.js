// Transformation agroalimentaire, étape 3 : registre HACCP — points de contrôle sanitaires
// liés à un ordre de transformation (étape 2). Journal réglementaire, même posture que
// applications_intrants (registre phytosanitaire) : ouvert en écriture à tout rôle
// authentifié, pas de gate admin/directeur — c'est un opérateur de terrain qui remplit ça,
// pas une action de configuration.
import express from 'express';
import { authRequired } from '../middleware/auth.js';
import { pool } from '../db.js';
import { log } from '../utils/journal.js';

const router = express.Router();

const TYPES_CONTROLE = ['temperature', 'hygiene', 'tracabilite', 'autre'];

const CONTROLE_COLUMNS = `
  h.id, h.ordre_transformation_id AS "ordreTransformationId",
  h.ordre_transformation_nom AS "ordreTransformationNom",
  h.type_controle AS "typeControle",
  h.valeur_mesuree::float8 AS "valeurMesuree", h.unite,
  h.seuil_min::float8 AS "seuilMin", h.seuil_max::float8 AS "seuilMax",
  h.conforme, h.action_corrective AS "actionCorrective",
  to_char(h.date_controle, 'YYYY-MM-DD') AS "dateControle",
  h.operateur, h.notes, h.created_at AS "createdAt"
`;

// ?module= filtre via l'ordre de transformation lié → son produit de sortie (comme
// GET /ordres-transformation?module=) ; un contrôle dont l'ordre a été supprimé (FK nullée)
// n'a plus de module résoluble et disparaît du filtre — acceptable, il reste visible sans filtre.
router.get('/', authRequired, async (req, res) => {
  const { ordreTransformationId, conforme, module } = req.query;
  const conditions = ['h.entreprise_id = $1'];
  const params = [req.user.entrepriseId];
  let joins = '';
  if (module) {
    joins = 'JOIN ordres_transformation o ON o.id = h.ordre_transformation_id JOIN produits p ON p.id = o.produit_sortie_id';
    params.push(module);
    conditions.push(`p.module = $${params.length}`);
  }
  if (ordreTransformationId) {
    params.push(ordreTransformationId);
    conditions.push(`h.ordre_transformation_id = $${params.length}`);
  }
  if (conforme === 'true' || conforme === 'false') {
    params.push(conforme === 'true');
    conditions.push(`h.conforme = $${params.length}`);
  }
  try {
    const result = await pool.query(
      `SELECT ${CONTROLE_COLUMNS} FROM haccp_controles h ${joins}
       WHERE ${conditions.join(' AND ')}
       ORDER BY h.date_controle DESC, h.id DESC`,
      params
    );
    return res.json({ controles: result.rows });
  } catch (err) {
    log.error('[GET /haccp]', err);
    return res.status(500).json({ error: 'Erreur lors de la récupération du registre HACCP.' });
  }
});

router.post('/', authRequired, async (req, res) => {
  const {
    ordreTransformationId, typeControle, valeurMesuree, unite, seuilMin, seuilMax,
    conforme, actionCorrective, dateControle, operateur, notes,
  } = req.body;
  if (!ordreTransformationId || !TYPES_CONTROLE.includes(typeControle)) {
    return res.status(400).json({ error: `ordreTransformationId et typeControle (${TYPES_CONTROLE.join('/')}) sont requis.` });
  }
  try {
    const ordre = await pool.query(
      `SELECT id, recette_nom AS "recetteNom", to_char(date_transformation, 'YYYY-MM-DD') AS "dateTransformation"
       FROM ordres_transformation WHERE id = $1 AND entreprise_id = $2`,
      [ordreTransformationId, req.user.entrepriseId]
    );
    if (ordre.rows.length === 0) {
      return res.status(400).json({ error: 'Ordre de transformation introuvable.' });
    }
    const o = ordre.rows[0];
    const ordreNom = `${o.recetteNom || 'Transformation'} — ${o.dateTransformation}`;

    const insert = await pool.query(
      `INSERT INTO haccp_controles
         (entreprise_id, user_id, ordre_transformation_id, ordre_transformation_nom, type_controle,
          valeur_mesuree, unite, seuil_min, seuil_max, conforme, action_corrective, date_controle, operateur, notes)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,COALESCE($12, date_entreprise($1)),$13,$14)
       RETURNING id`,
      [
        req.user.entrepriseId, req.user.sub, ordreTransformationId, ordreNom, typeControle,
        valeurMesuree === '' || valeurMesuree == null ? null : Number(valeurMesuree), unite || null,
        seuilMin === '' || seuilMin == null ? null : Number(seuilMin),
        seuilMax === '' || seuilMax == null ? null : Number(seuilMax),
        conforme !== false, actionCorrective || null, dateControle || null, operateur || null, notes || null,
      ]
    );
    const created = await pool.query(`SELECT ${CONTROLE_COLUMNS} FROM haccp_controles h WHERE h.id = $1`, [insert.rows[0].id]);
    return res.status(201).json({ controle: created.rows[0] });
  } catch (err) {
    log.error('[POST /haccp]', err);
    return res.status(500).json({ error: "Erreur lors de l'enregistrement du contrôle." });
  }
});

router.put('/:id', authRequired, async (req, res) => {
  const { valeurMesuree, unite, seuilMin, seuilMax, conforme, actionCorrective, dateControle, operateur, notes } = req.body;
  try {
    const result = await pool.query(
      `UPDATE haccp_controles SET
         valeur_mesuree = COALESCE($1, valeur_mesuree),
         unite = COALESCE($2, unite),
         seuil_min = COALESCE($3, seuil_min),
         seuil_max = COALESCE($4, seuil_max),
         conforme = COALESCE($5, conforme),
         action_corrective = COALESCE($6, action_corrective),
         date_controle = COALESCE($7, date_controle),
         operateur = COALESCE($8, operateur),
         notes = COALESCE($9, notes)
       WHERE id = $10 AND entreprise_id = $11
       RETURNING id`,
      [
        valeurMesuree === '' || valeurMesuree == null ? null : Number(valeurMesuree), unite || null,
        seuilMin === '' || seuilMin == null ? null : Number(seuilMin),
        seuilMax === '' || seuilMax == null ? null : Number(seuilMax),
        conforme == null ? null : conforme, actionCorrective || null, dateControle || null, operateur || null, notes || null,
        req.params.id, req.user.entrepriseId,
      ]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Contrôle introuvable.' });
    }
    const updated = await pool.query(`SELECT ${CONTROLE_COLUMNS} FROM haccp_controles h WHERE h.id = $1`, [req.params.id]);
    return res.json({ controle: updated.rows[0] });
  } catch (err) {
    log.error('[PUT /haccp/:id]', err);
    return res.status(500).json({ error: 'Erreur lors de la mise à jour.' });
  }
});

router.delete('/:id', authRequired, async (req, res) => {
  try {
    const result = await pool.query(
      'DELETE FROM haccp_controles WHERE id = $1 AND entreprise_id = $2 RETURNING id',
      [req.params.id, req.user.entrepriseId]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Contrôle introuvable.' });
    }
    return res.json({ success: true });
  } catch (err) {
    log.error('[DELETE /haccp/:id]', err);
    return res.status(500).json({ error: 'Erreur lors de la suppression.' });
  }
});

export default router;
