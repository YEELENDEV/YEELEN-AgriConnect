import express from 'express';
import { authRequired } from '../middleware/auth.js';
import { pool } from '../db.js';

const router = express.Router();

// Clients/Fournisseurs : voir routes/contacts.js (fusionnés en une table contacts,
// 2026-08-18 — historiquement /clients* et /fournisseurs* vivaient ici).

// ═══════════════════════════════════════════════════════════
//  FINANCES
// ═══════════════════════════════════════════════════════════

// Récupère toutes les transactions financières de l'entreprise,
// avec le nom de la banque associée si la transaction y est liée
router.get('/finances', authRequired, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT f.id, f.type AS categorie, f.montant::float8 AS montant, f.description,
              f.created_at AS date, f.banque_id AS "banqueId", b.nom_banque AS "banqueNom"
       FROM finances f
       LEFT JOIN banques b ON b.id = f.banque_id
       WHERE f.entreprise_id = $1
       ORDER BY f.created_at DESC`,
      [req.user.entrepriseId]
    );
    return res.json({ finances: result.rows });
  } catch (err) {
    console.error('[GET /finances]', err);
    return res.status(500).json({ error: 'Erreur lors de la récupération des finances.' });
  }
});

// Crée une nouvelle transaction. Si categorie === 'Banque', banqueId est requis
// pour savoir sur quel compte précis l'opération a eu lieu.
// Réservé à admin/directeur : seule la direction peut engager une écriture financière manuelle.
router.post('/finances', authRequired, async (req, res) => {
  const { categorie = 'Caisse', montant, description = '', banqueId } = req.body;

  if (montant === undefined || montant === null) {
    return res.status(400).json({ error: 'Le montant est requis.' });
  }
  if (categorie === 'Banque' && !banqueId) {
    return res.status(400).json({ error: 'Veuillez sélectionner un compte bancaire.' });
  }

  try {
    const result = await pool.query(
      `INSERT INTO finances (entreprise_id, user_id, type, montant, description, banque_id)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, type AS categorie, montant::float8 AS montant, description, created_at AS date, banque_id AS "banqueId"`,
      [req.user.entrepriseId, req.user.sub, categorie, Number(montant), description, categorie === 'Banque' ? banqueId : null]
    );
    return res.status(201).json({ entry: result.rows[0] });
  } catch (err) {
    console.error('[POST /finances]', err);
    return res.status(500).json({ error: "Erreur lors de l'enregistrement de la transaction." });
  }
});

// Réservé à admin/directeur : seule la direction peut supprimer une écriture financière.
router.delete('/finances/:id', authRequired, async (req, res) => {
  try {
    const result = await pool.query('DELETE FROM finances WHERE id = $1 AND entreprise_id = $2', [req.params.id, req.user.entrepriseId]);
    // 0 ligne = id inexistant ou d'une autre entreprise → 404, cohérent avec le reste des routes DELETE.
    if (result.rowCount === 0) return res.status(404).json({ error: 'Écriture financière introuvable.' });
    return res.json({ success: true });
  } catch (err) {
    console.error('[DELETE /finances]', err);
    return res.status(500).json({ error: 'Erreur lors de la suppression.' });
  }
});

export default router;