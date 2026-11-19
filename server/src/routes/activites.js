// Activités planifiées — équivalent simplifié d'un modèle d'activité standard (un rappel/tâche
// avec échéance, attaché à n'importe quelle ressource via ressource_type/ressource_id).
// Voir server/src/db/socle.js pour le schéma et le contexte.
import express from 'express';
import { authRequired } from '../middleware/auth.js';
import { pool } from '../db.js';
import { log } from '../utils/journal.js';

const router = express.Router();

const RESSOURCES_VALIDES = ['devis', 'contact', 'salarie', 'parcelle'];

// Sans préfixe d'alias : réutilisée telle quelle dans INSERT/UPDATE ... RETURNING (pas de
// jointure), qui n'ont pas d'alias "a" en portée — même précaution que DOCUMENT_COLUMNS
// dans achats.js (un préfixe d'alias y avait cassé l'INSERT ... RETURNING correspondant).
const ACTIVITE_COLUMNS_PLAIN = `
  id, ressource_type AS "ressourceType", ressource_id AS "ressourceId",
  titre, date_echeance AS "dateEcheance", termine,
  created_at AS "createdAt", terminee_at AS "termineeAt"
`;

router.get('/', authRequired, async (req, res) => {
  const { ressourceType, ressourceId } = req.query;
  if (!RESSOURCES_VALIDES.includes(ressourceType) || !ressourceId) {
    return res.status(400).json({ error: 'ressourceType et ressourceId sont requis.' });
  }
  try {
    const result = await pool.query(
      `SELECT a.id, a.ressource_type AS "ressourceType", a.ressource_id AS "ressourceId",
              a.titre, a.date_echeance AS "dateEcheance", a.termine,
              a.created_at AS "createdAt", a.terminee_at AS "termineeAt", u.email AS "userEmail"
       FROM activites a LEFT JOIN users u ON u.id = a.user_id
       WHERE a.entreprise_id = $1 AND a.ressource_type = $2 AND a.ressource_id = $3
       ORDER BY a.termine ASC, a.date_echeance ASC NULLS LAST, a.created_at DESC`,
      [req.user.entrepriseId, ressourceType, ressourceId]
    );
    return res.json({ activites: result.rows });
  } catch (err) {
    log.error('[GET /activites]', err);
    return res.status(500).json({ error: 'Erreur lors de la récupération des activités.' });
  }
});

router.post('/', authRequired, async (req, res) => {
  const { ressourceType, ressourceId, titre, dateEcheance } = req.body;
  if (!RESSOURCES_VALIDES.includes(ressourceType) || !ressourceId) {
    return res.status(400).json({ error: 'ressourceType et ressourceId sont requis.' });
  }
  if (!titre || !titre.trim()) {
    return res.status(400).json({ error: 'Le titre est requis.' });
  }
  try {
    const result = await pool.query(
      `INSERT INTO activites (entreprise_id, ressource_type, ressource_id, user_id, titre, date_echeance)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING ${ACTIVITE_COLUMNS_PLAIN}`,
      [req.user.entrepriseId, ressourceType, ressourceId, req.user.sub, titre.trim(), dateEcheance || null]
    );
    return res.status(201).json({ activite: { ...result.rows[0], userEmail: req.user.email } });
  } catch (err) {
    log.error('[POST /activites]', err);
    return res.status(500).json({ error: "Erreur lors de la création de l'activité." });
  }
});

// Bascule termine/non-termine plutôt que deux routes séparées — un simple oubli de case
// n'a pas besoin d'une route dédiée pour être annulé.
router.patch('/:id', authRequired, async (req, res) => {
  const { termine } = req.body;
  try {
    const result = await pool.query(
      `UPDATE activites SET termine = $1, terminee_at = CASE WHEN $1 THEN now() ELSE NULL END
       WHERE id = $2 AND entreprise_id = $3
       RETURNING ${ACTIVITE_COLUMNS_PLAIN}`,
      [Boolean(termine), req.params.id, req.user.entrepriseId]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Activité introuvable.' });
    return res.json({ activite: result.rows[0] });
  } catch (err) {
    log.error('[PATCH /activites/:id]', err);
    return res.status(500).json({ error: "Erreur lors de la mise à jour de l'activité." });
  }
});

router.delete('/:id', authRequired, async (req, res) => {
  try {
    const result = await pool.query(
      'DELETE FROM activites WHERE id = $1 AND entreprise_id = $2 RETURNING id',
      [req.params.id, req.user.entrepriseId]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Activité introuvable.' });
    return res.json({ success: true });
  } catch (err) {
    log.error('[DELETE /activites/:id]', err);
    return res.status(500).json({ error: "Erreur lors de la suppression de l'activité." });
  }
});

export default router;
