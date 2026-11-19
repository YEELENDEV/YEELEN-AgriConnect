// Attributs de produit réutilisables (product.attribute / product.attribute.value) — étape 2
// de l'alignement Odoo produit/stock. Scopés par entreprise seulement, pas par module (voir
// socle.js) : ouvert à tout rôle authentifié, comme produits/produit_categories — le domaine
// "catalogue" n'est pas gated admin/directeur dans ce projet, contrairement au domaine comptable.
import express from 'express';
import { authRequired } from '../middleware/auth.js';
import { pool } from '../db.js';

const router = express.Router();

const VALEUR_COLUMNS = `v.id, v.attribut_id AS "attributId", v.valeur, v.ordre`;

async function chargerValeurs(entrepriseId, attributIds) {
  if (attributIds.length === 0) return new Map();
  const { rows } = await pool.query(
    `SELECT ${VALEUR_COLUMNS} FROM attributs_produit_valeurs v
     WHERE v.entreprise_id = $1 AND v.attribut_id = ANY($2::int[])
     ORDER BY v.ordre ASC, v.id ASC`,
    [entrepriseId, attributIds]
  );
  const parAttribut = new Map();
  for (const r of rows) {
    if (!parAttribut.has(r.attributId)) parAttribut.set(r.attributId, []);
    parAttribut.get(r.attributId).push(r);
  }
  return parAttribut;
}

router.get('/', authRequired, async (req, res) => {
  try {
    const { rows: attributs } = await pool.query(
      'SELECT id, nom FROM attributs_produit WHERE entreprise_id = $1 ORDER BY nom ASC',
      [req.user.entrepriseId]
    );
    const valeursParAttribut = await chargerValeurs(req.user.entrepriseId, attributs.map((a) => a.id));
    return res.json({ attributs: attributs.map((a) => ({ ...a, valeurs: valeursParAttribut.get(a.id) || [] })) });
  } catch (err) {
    console.error('[GET /attributs-produit]', err);
    return res.status(500).json({ error: 'Erreur lors de la récupération des attributs.' });
  }
});

// { nom, valeurs: [string, ...] } — crée l'attribut et ses valeurs initiales en un seul appel,
// pour éviter d'imposer une deuxième étape à l'utilisateur pour le cas courant.
router.post('/', authRequired, async (req, res) => {
  const nom = String(req.body.nom || '').trim();
  if (!nom) return res.status(400).json({ error: 'Le nom est requis.' });
  const valeurs = Array.isArray(req.body.valeurs)
    ? [...new Set(req.body.valeurs.map((v) => String(v || '').trim()).filter(Boolean))]
    : [];
  try {
    const { rows: [attribut] } = await pool.query(
      'INSERT INTO attributs_produit (entreprise_id, nom) VALUES ($1, $2) RETURNING id, nom',
      [req.user.entrepriseId, nom]
    );
    for (let i = 0; i < valeurs.length; i++) {
      await pool.query(
        `INSERT INTO attributs_produit_valeurs (entreprise_id, attribut_id, valeur, ordre)
         VALUES ($1, $2, $3, $4) ON CONFLICT (attribut_id, valeur) DO NOTHING`,
        [req.user.entrepriseId, attribut.id, valeurs[i], i]
      );
    }
    const valeursCreees = await chargerValeurs(req.user.entrepriseId, [attribut.id]);
    return res.status(201).json({ attribut: { ...attribut, valeurs: valeursCreees.get(attribut.id) || [] } });
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'Cet attribut existe déjà.' });
    console.error('[POST /attributs-produit]', err);
    return res.status(500).json({ error: "Erreur lors de la création de l'attribut." });
  }
});

router.post('/:id/valeurs', authRequired, async (req, res) => {
  const valeur = String(req.body.valeur || '').trim();
  if (!valeur) return res.status(400).json({ error: 'La valeur est requise.' });
  try {
    const attribut = await pool.query(
      'SELECT id FROM attributs_produit WHERE id = $1 AND entreprise_id = $2',
      [req.params.id, req.user.entrepriseId]
    );
    if (attribut.rows.length === 0) return res.status(404).json({ error: 'Attribut introuvable.' });
    const { rows: [max] } = await pool.query(
      'SELECT COALESCE(MAX(ordre), -1) + 1 AS ordre FROM attributs_produit_valeurs WHERE attribut_id = $1',
      [req.params.id]
    );
    const { rows } = await pool.query(
      `INSERT INTO attributs_produit_valeurs (entreprise_id, attribut_id, valeur, ordre)
       VALUES ($1, $2, $3, $4) RETURNING id, attribut_id AS "attributId", valeur, ordre`,
      [req.user.entrepriseId, req.params.id, valeur, max.ordre]
    );
    return res.status(201).json({ valeur: rows[0] });
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'Cette valeur existe déjà pour cet attribut.' });
    console.error('[POST /attributs-produit/:id/valeurs]', err);
    return res.status(500).json({ error: "Erreur lors de l'ajout de la valeur." });
  }
});

// gabarit_attributs_lignes.valeur_id et variante_attributs_valeurs.valeur_id sont tous deux
// ON DELETE CASCADE — supprimer une valeur retire silencieusement les gabarits/variantes qui
// s'appuyaient dessus pour leur génération, sans bloquer (les variantes déjà créées, elles,
// ne sont jamais supprimées : seul le lien de traçabilité vers cette valeur disparaît).
router.delete('/valeurs/:valeurId', authRequired, async (req, res) => {
  try {
    const result = await pool.query(
      'DELETE FROM attributs_produit_valeurs WHERE id = $1 AND entreprise_id = $2',
      [req.params.valeurId, req.user.entrepriseId]
    );
    if (result.rowCount === 0) return res.status(404).json({ error: 'Valeur introuvable.' });
    return res.json({ success: true });
  } catch (err) {
    console.error('[DELETE /attributs-produit/valeurs/:valeurId]', err);
    return res.status(500).json({ error: 'Erreur lors de la suppression.' });
  }
});

router.delete('/:id', authRequired, async (req, res) => {
  try {
    const result = await pool.query(
      'DELETE FROM attributs_produit WHERE id = $1 AND entreprise_id = $2',
      [req.params.id, req.user.entrepriseId]
    );
    if (result.rowCount === 0) return res.status(404).json({ error: 'Attribut introuvable.' });
    return res.json({ success: true });
  } catch (err) {
    console.error('[DELETE /attributs-produit/:id]', err);
    return res.status(500).json({ error: 'Erreur lors de la suppression.' });
  }
});

export default router;
