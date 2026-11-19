// Fil de messages en texte libre attaché à une ressource — équivalent minimal du
// "Envoyer un message"/"Log note" du chatter d'un ERP de référence. Voir server/src/db/socle.js pour le
// schéma et pourquoi c'est distinct de journal_modifications/activites.
import express from 'express';
import { authRequired } from '../middleware/auth.js';
import { pool } from '../db.js';

const router = express.Router();

const RESSOURCES_VALIDES = ['devis', 'contact', 'salarie'];

router.get('/', authRequired, async (req, res) => {
  const { ressourceType, ressourceId } = req.query;
  if (!RESSOURCES_VALIDES.includes(ressourceType) || !ressourceId) {
    return res.status(400).json({ error: 'ressourceType et ressourceId sont requis.' });
  }
  try {
    const result = await pool.query(
      `SELECT m.id, m.ressource_type AS "ressourceType", m.ressource_id AS "ressourceId",
              m.contenu, m.created_at AS "createdAt", u.email AS "userEmail"
       FROM messages m LEFT JOIN users u ON u.id = m.user_id
       WHERE m.entreprise_id = $1 AND m.ressource_type = $2 AND m.ressource_id = $3
       ORDER BY m.created_at DESC`,
      [req.user.entrepriseId, ressourceType, ressourceId]
    );
    return res.json({ messages: result.rows });
  } catch (err) {
    console.error('[GET /messages]', err);
    return res.status(500).json({ error: 'Erreur lors de la récupération des messages.' });
  }
});

router.post('/', authRequired, async (req, res) => {
  const { ressourceType, ressourceId, contenu } = req.body;
  if (!RESSOURCES_VALIDES.includes(ressourceType) || !ressourceId) {
    return res.status(400).json({ error: 'ressourceType et ressourceId sont requis.' });
  }
  if (!contenu || !contenu.trim()) {
    return res.status(400).json({ error: 'Le message ne peut pas être vide.' });
  }
  try {
    const result = await pool.query(
      `INSERT INTO messages (entreprise_id, ressource_type, ressource_id, user_id, contenu)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, ressource_type AS "ressourceType", ressource_id AS "ressourceId", contenu, created_at AS "createdAt"`,
      [req.user.entrepriseId, ressourceType, ressourceId, req.user.sub, contenu.trim()]
    );
    return res.status(201).json({ message: { ...result.rows[0], userEmail: req.user.email } });
  } catch (err) {
    console.error('[POST /messages]', err);
    return res.status(500).json({ error: "Erreur lors de l'envoi du message." });
  }
});

export default router;
