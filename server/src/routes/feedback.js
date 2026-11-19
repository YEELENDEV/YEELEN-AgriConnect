// Forum de feedback (MVP minimal — un simple formulaire + triage, pas un vrai forum
// public avec fils de discussion) : la seule route de tout le projet où la lecture
// (GET, ci-dessous) traverse volontairement toutes les entreprises au lieu d'être
// cloisonnée — voir CLAUDE.md, section "Forum de feedback", pour la justification.
import express from 'express';
import { pool } from '../db.js';
import { authRequired } from '../middleware/auth.js';
import { requirePlatformAdmin } from '../middleware/requirePlatformAdmin.js';
import { log } from '../utils/journal.js';

const router = express.Router();

const TYPES = ['Suggestion', 'Frustration', 'Bug', 'Autre'];
const STATUTS = ['Nouveau', 'Lu', 'Traité'];

const FEEDBACK_COLUMNS = `
  f.id, f.type, f.message, f.statut, f.created_at AS "createdAt",
  f.entreprise_id AS "entrepriseId", e.nom AS "entrepriseNom",
  f.user_id AS "userId", u.email AS "userEmail"
`;

// POST /api/feedback — tout utilisateur connecté peut envoyer un retour sur l'app
router.post('/', authRequired, async (req, res) => {
  const { type, message } = req.body;
  if (!message || !message.trim()) {
    return res.status(400).json({ error: 'Le message est requis.' });
  }
  const typeFinal = TYPES.includes(type) ? type : 'Autre';

  try {
    await pool.query(
      `INSERT INTO feedback (entreprise_id, user_id, type, message) VALUES ($1, $2, $3, $4)`,
      [req.user.entrepriseId, req.user.sub, typeFinal, message.trim()]
    );
    return res.status(201).json({ ok: true });
  } catch (err) {
    log.error('[POST /feedback]', err);
    return res.status(500).json({ error: "Erreur lors de l'envoi du retour." });
  }
});

// GET /api/feedback — tous les retours, toutes entreprises confondues
// (pas de cloisonnement par entreprise_id ici : c'est le propriétaire de la
// plateforme qui doit voir le feedback de tous ses clients, pas un admin d'entreprise)
router.get('/', authRequired, requirePlatformAdmin, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT ${FEEDBACK_COLUMNS} FROM feedback f
       JOIN entreprises e ON e.id = f.entreprise_id
       LEFT JOIN users u ON u.id = f.user_id
       ORDER BY f.created_at DESC`
    );
    return res.json({ feedback: result.rows });
  } catch (err) {
    log.error('[GET /feedback]', err);
    return res.status(500).json({ error: 'Erreur lors de la récupération des retours.' });
  }
});

// PATCH /api/feedback/:id — changer le statut de triage (Nouveau/Lu/Traité)
router.patch('/:id', authRequired, requirePlatformAdmin, async (req, res) => {
  const { statut } = req.body;
  if (!STATUTS.includes(statut)) {
    return res.status(400).json({ error: 'Statut invalide.' });
  }

  try {
    const result = await pool.query(
      `UPDATE feedback SET statut = $1 WHERE id = $2 RETURNING id, statut`,
      [statut, req.params.id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Retour introuvable.' });
    }
    return res.json({ feedback: result.rows[0] });
  } catch (err) {
    log.error('[PATCH /feedback/:id]', err);
    return res.status(500).json({ error: 'Erreur lors de la mise à jour du retour.' });
  }
});

export default router;
