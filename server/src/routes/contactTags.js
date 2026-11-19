// Tags de contact colorés (un widget de tags standard côté ERP de référence) — vraie ressource CRUD par
// entreprise, même posture que produit_categories/listes_prix : chaque entreprise gère
// sa propre liste de tags, pas un catalogue figé partagé par tous.
import express from 'express';
import { authRequired } from '../middleware/auth.js';
import { pool } from '../db.js';
import { log } from '../utils/journal.js';

const router = express.Router();

const TAG_COLUMNS = `id, nom, couleur`;

router.get('/', authRequired, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT ${TAG_COLUMNS} FROM contact_tags WHERE entreprise_id = $1 ORDER BY nom ASC`,
      [req.user.entrepriseId]
    );
    return res.json({ tags: result.rows });
  } catch (err) {
    log.error('[GET /contact-tags]', err);
    return res.status(500).json({ error: 'Erreur lors de la récupération des tags.' });
  }
});

router.post('/', authRequired, async (req, res) => {
  const { nom, couleur } = req.body;
  if (!nom) {
    return res.status(400).json({ error: 'nom est requis.' });
  }
  try {
    const result = await pool.query(
      `INSERT INTO contact_tags (entreprise_id, nom, couleur)
       VALUES ($1, $2, $3) RETURNING ${TAG_COLUMNS}`,
      [req.user.entrepriseId, nom, couleur || '#C1861F']
    );
    return res.status(201).json({ tag: result.rows[0] });
  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).json({ error: 'Ce tag existe déjà.' });
    }
    log.error('[POST /contact-tags]', err);
    return res.status(500).json({ error: 'Erreur lors de la création du tag.' });
  }
});

router.delete('/:id', authRequired, async (req, res) => {
  try {
    const result = await pool.query(
      'DELETE FROM contact_tags WHERE id = $1 AND entreprise_id = $2 RETURNING id',
      [req.params.id, req.user.entrepriseId]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Tag introuvable.' });
    }
    return res.json({ success: true });
  } catch (err) {
    log.error('[DELETE /contact-tags]', err);
    return res.status(500).json({ error: 'Erreur lors de la suppression.' });
  }
});

export default router;
