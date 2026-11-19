// Catégories de produits (Cultures/Poulailler) — vraie ressource CRUD par entreprise,
// remplace le texte libre non validé qu'était cultures_stocks.categorie/poulailler_stocks.categorie
// avant la fusion en produits (2026-08-18). Modèle inspiré d'une inspection réelle d'un compte ERP (Inventaire > Configuration > Catégories de produits) : chaque entreprise gère sa propre
// liste, pas un catalogue figé partagé par tous — voir server/src/db/socle.js pour les 7
// catégories créées par défaut lors de la fusion.
//
// Hiérarchie (parent_id) ajoutée 2026-09-03, étape 0 de l'alignement Odoo produit/stock —
// voir server/src/db/socle.js pour le choix ON DELETE CASCADE. Le cloisonnement par
// module (un parent doit être du même module que son enfant) est validé ici, pas en base.
import express from 'express';
import { authRequired } from '../middleware/auth.js';
import { pool } from '../db.js';
import { log } from '../utils/journal.js';

const router = express.Router();

const CATEGORIE_COLUMNS = `id, module, nom, ordre, parent_id AS "parentId"`;

// Valide un parent_id proposé : doit exister, appartenir à la même entreprise, être du même
// module, ne pas être la catégorie elle-même, et ne pas créer de cycle (remonter la chaîne
// des parents du candidat et vérifier qu'on ne retombe pas sur ownId). Retourne null en
// silence plutôt que 400 sur une valeur invalide — même posture que resolveParentId dans
// contacts.js/resolveListePrixId.
async function resolveParentIdCategorie(entrepriseId, module, parentId, ownId) {
  if (parentId == null) return null;
  const parentIdNum = Number(parentId);
  if (ownId != null && parentIdNum === Number(ownId)) return null;

  const result = await pool.query(
    'SELECT id, parent_id FROM produit_categories WHERE id = $1 AND entreprise_id = $2 AND module = $3',
    [parentIdNum, entrepriseId, module]
  );
  const parentRow = result.rows[0];
  if (!parentRow) return null;

  if (ownId != null) {
    let cursor = parentRow.parent_id;
    const seen = new Set([parentIdNum]);
    while (cursor != null) {
      if (Number(cursor) === Number(ownId)) return null; // cycle détecté
      if (seen.has(Number(cursor))) break; // garde-fou, ne devrait pas arriver
      seen.add(Number(cursor));
      const next = await pool.query('SELECT parent_id FROM produit_categories WHERE id = $1', [cursor]);
      cursor = next.rows[0]?.parent_id ?? null;
    }
  }
  return parentRow.id;
}

// complete_name à la Odoo (product.category.complete_name) : concaténation récursive des
// noms depuis la racine, calculée à la lecture plutôt que stockée — une catégorie renommée
// n'a donc jamais de complete_name périmé ailleurs.
const COMPLETE_NAME_CTE = `
  WITH RECURSIVE chaine AS (
    SELECT id, nom, parent_id, nom AS complete_name
    FROM produit_categories WHERE parent_id IS NULL
    UNION ALL
    SELECT c.id, c.nom, c.parent_id, chaine.complete_name || ' / ' || c.nom
    FROM produit_categories c JOIN chaine ON c.parent_id = chaine.id
  )
`;

router.get('/', authRequired, async (req, res) => {
  const { module } = req.query;
  try {
    const result = module
      ? await pool.query(
          `${COMPLETE_NAME_CTE}
           SELECT pc.id, pc.module, pc.nom, pc.ordre, pc.parent_id AS "parentId", chaine.complete_name AS "completeName"
           FROM produit_categories pc JOIN chaine ON chaine.id = pc.id
           WHERE pc.entreprise_id = $1 AND pc.module = $2 ORDER BY chaine.complete_name ASC`,
          [req.user.entrepriseId, module]
        )
      : await pool.query(
          `${COMPLETE_NAME_CTE}
           SELECT pc.id, pc.module, pc.nom, pc.ordre, pc.parent_id AS "parentId", chaine.complete_name AS "completeName"
           FROM produit_categories pc JOIN chaine ON chaine.id = pc.id
           WHERE pc.entreprise_id = $1 ORDER BY pc.module ASC, chaine.complete_name ASC`,
          [req.user.entrepriseId]
        );
    return res.json({ categories: result.rows });
  } catch (err) {
    log.error('[GET /produit-categories]', err);
    return res.status(500).json({ error: 'Erreur lors de la récupération des catégories.' });
  }
});

router.post('/', authRequired, async (req, res) => {
  const { module, nom, ordre = 0, parentId } = req.body;
  if (!module || !['Cultures', 'Poulailler', 'Pisciculture'].includes(module) || !nom) {
    return res.status(400).json({ error: 'module (Cultures/Poulailler) et nom sont requis.' });
  }
  try {
    const parentValide = await resolveParentIdCategorie(req.user.entrepriseId, module, parentId, null);
    const result = await pool.query(
      `INSERT INTO produit_categories (entreprise_id, module, nom, ordre, parent_id)
       VALUES ($1, $2, $3, $4, $5) RETURNING ${CATEGORIE_COLUMNS}`,
      [req.user.entrepriseId, module, nom, Number(ordre) || 0, parentValide]
    );
    return res.status(201).json({ categorie: result.rows[0] });
  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).json({ error: 'Cette catégorie existe déjà pour ce module.' });
    }
    log.error('[POST /produit-categories]', err);
    return res.status(500).json({ error: 'Erreur lors de la création de la catégorie.' });
  }
});

router.put('/:id', authRequired, async (req, res) => {
  const { nom, ordre } = req.body;
  const parentFourni = Object.prototype.hasOwnProperty.call(req.body, 'parentId');
  try {
    const existant = await pool.query(
      'SELECT module FROM produit_categories WHERE id = $1 AND entreprise_id = $2',
      [req.params.id, req.user.entrepriseId]
    );
    if (existant.rows.length === 0) {
      return res.status(404).json({ error: 'Catégorie introuvable.' });
    }
    const parentValide = parentFourni
      ? await resolveParentIdCategorie(req.user.entrepriseId, existant.rows[0].module, req.body.parentId, req.params.id)
      : null;
    const result = await pool.query(
      `UPDATE produit_categories SET
         nom = COALESCE($1, nom),
         ordre = COALESCE($2, ordre),
         parent_id = CASE WHEN $3 THEN $4 ELSE parent_id END
       WHERE id = $5 AND entreprise_id = $6
       RETURNING ${CATEGORIE_COLUMNS}`,
      [nom, ordre, parentFourni, parentValide, req.params.id, req.user.entrepriseId]
    );
    return res.json({ categorie: result.rows[0] });
  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).json({ error: 'Cette catégorie existe déjà pour ce module.' });
    }
    log.error('[PUT /produit-categories]', err);
    return res.status(500).json({ error: 'Erreur lors de la mise à jour.' });
  }
});

// Une catégorie référencée par un produit ne peut pas être supprimée (produits.categorie_id
// est NOT NULL, pas de suppression en cascade souhaitée d'un article suite à un simple
// ménage de catégories) — la contrainte FK renvoie une erreur Postgres 23503, traduite ici
// en message clair plutôt que de laisser remonter un 500 générique. Supprimer une catégorie
// avec des enfants supprime aussi ces enfants (ON DELETE CASCADE sur parent_id) — si un de
// ces enfants est lui-même référencé par un produit, la même 23503 protège la suppression.
router.delete('/:id', authRequired, async (req, res) => {
  try {
    const result = await pool.query(
      'DELETE FROM produit_categories WHERE id = $1 AND entreprise_id = $2 RETURNING id',
      [req.params.id, req.user.entrepriseId]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Catégorie introuvable.' });
    }
    return res.json({ success: true });
  } catch (err) {
    if (err.code === '23503') {
      return res.status(409).json({ error: 'Cette catégorie est utilisée par au moins un produit — impossible de la supprimer.' });
    }
    log.error('[DELETE /produit-categories]', err);
    return res.status(500).json({ error: 'Erreur lors de la suppression.' });
  }
});

export default router;
