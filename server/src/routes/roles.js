// Gestion des rôles et de leurs restrictions par l'entreprise elle-même.
//
// Une seule règle d'accès, et elle vient de l'utilisateur : le compte qui a ouvert l'entreprise
// en est le maître, et lui seul administre les rôles. Ce n'est pas une politique imposée sur les
// sections métier — c'est la propriété du compte.
import express from 'express';
import { pool } from '../db.js';
import { authRequired } from '../middleware/auth.js';
import { RESSOURCES, ACTIONS, ACTIONS_SENSIBLES, TOUTES_ACTIONS } from '../permissions/catalogue.js';
import { invaliderCacheRoles, restrictionsUtilisateur } from '../utils/rolesService.js';
import { logAuditEvent } from '../utils/auditLog.js';

const router = express.Router();

async function estProprietaire(entrepriseId, userId) {
  const { rows } = await pool.query('SELECT proprietaire_user_id FROM entreprises WHERE id = $1', [entrepriseId]);
  return rows[0]?.proprietaire_user_id === userId;
}

// Garde de propriété. Distincte du garde de permissions : celui-ci protège la serrure elle-même.
async function proprietaireRequis(req, res, next) {
  if (await estProprietaire(req.user.entrepriseId, req.user.sub)) return next();
  return res.status(403).json({
    error: "Seul le compte qui a ouvert l'entreprise peut gérer les rôles.",
  });
}

// Le vocabulaire, pour que l'écran puisse dessiner la matrice sans le recopier.
router.get('/catalogue', authRequired, (req, res) => {
  const sections = {};
  for (const [nom, def] of Object.entries(RESSOURCES)) {
    (sections[def.section] ||= []).push({ nom, libelle: def.libelle });
  }
  return res.json({
    sections,
    actions: ACTIONS,
    actionsSensibles: ACTIONS_SENSIBLES,
  });
});

// Les restrictions de l'utilisateur CONNECTÉ, pour que l'interface masque les écrans qu'il ne
// peut pas consulter. Pur confort d'affichage : la vraie barrière reste permissionGuard, qui
// refuse côté serveur. Hors catalogue (voir HORS_PERIMETRE) — sinon un rôle privé de
// « roles/lire » ne pourrait même plus connaître ses propres restrictions.
router.get('/mes-restrictions', authRequired, async (req, res) => {
  const resolution = await restrictionsUtilisateur(req.user.entrepriseId, req.user.sub);
  if (resolution.erreur) return res.status(503).json({ error: 'Restrictions momentanément indisponibles.' });
  const restrictions = {};
  for (const [ressource, actions] of Object.entries(resolution.restrictions || {})) {
    restrictions[ressource] = [...actions].sort();
  }
  let roleNom = null;
  if (resolution.roleId) {
    const { rows } = await pool.query('SELECT nom FROM roles WHERE id = $1 AND entreprise_id = $2', [resolution.roleId, req.user.entrepriseId]);
    roleNom = rows[0]?.nom || null;
  }
  return res.json({
    proprietaire: resolution.proprietaire,
    roleId: resolution.roleId,
    roleNom,
    restrictions: resolution.proprietaire ? {} : restrictions,
  });
});

// Liste des rôles avec leurs restrictions et le nombre de personnes concernées.
router.get('/', authRequired, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT r.id, r.nom, r.description,
              COALESCE(json_agg(DISTINCT jsonb_build_object('ressource', rr.ressource, 'action', rr.action))
                       FILTER (WHERE rr.ressource IS NOT NULL), '[]') AS restrictions,
              (SELECT count(*)::int FROM entreprise_utilisateurs eu WHERE eu.role_id = r.id) AS "nbUtilisateurs"
         FROM roles r
         LEFT JOIN role_restrictions rr ON rr.role_id = r.id
        WHERE r.entreprise_id = $1
        GROUP BY r.id
        ORDER BY r.nom`,
      [req.user.entrepriseId]
    );
    return res.json({
      roles: rows,
      proprietaire: await estProprietaire(req.user.entrepriseId, req.user.sub),
    });
  } catch (err) {
    console.error('[GET /roles]', err);
    return res.status(500).json({ error: 'Erreur lors de la récupération des rôles.' });
  }
});

// Les utilisateurs de l'entreprise et leur rôle, pour l'affectation.
router.get('/utilisateurs', authRequired, proprietaireRequis, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT u.id, u.email, eu.role_id AS "roleId",
              (e.proprietaire_user_id = u.id) AS proprietaire
         FROM entreprise_utilisateurs eu
         JOIN users u ON u.id = eu.user_id
         JOIN entreprises e ON e.id = eu.entreprise_id
        WHERE eu.entreprise_id = $1 AND eu.statut = 'Actif'
        ORDER BY proprietaire DESC, u.email`,
      [req.user.entrepriseId]
    );
    return res.json({ utilisateurs: rows });
  } catch (err) {
    console.error('[GET /roles/utilisateurs]', err);
    return res.status(500).json({ error: 'Erreur lors de la récupération des utilisateurs.' });
  }
});

router.post('/', authRequired, proprietaireRequis, async (req, res) => {
  const { nom, description } = req.body;
  if (!nom || !nom.trim()) return res.status(400).json({ error: 'Le nom du rôle est requis.' });
  try {
    const { rows } = await pool.query(
      'INSERT INTO roles (entreprise_id, nom, description) VALUES ($1, $2, $3) RETURNING id, nom, description',
      [req.user.entrepriseId, nom.trim(), description || null]
    );
    await logAuditEvent({
      entrepriseId: req.user.entrepriseId, userId: req.user.sub, email: req.user.email,
      action: 'role_cree', req, details: { roleId: rows[0].id, nom: rows[0].nom },
    });
    return res.status(201).json({ role: { ...rows[0], restrictions: [], nbUtilisateurs: 0 } });
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'Un rôle porte déjà ce nom.' });
    console.error('[POST /roles]', err);
    return res.status(500).json({ error: 'Erreur lors de la création du rôle.' });
  }
});

router.put('/:id', authRequired, proprietaireRequis, async (req, res) => {
  const { nom, description } = req.body;
  try {
    const { rows } = await pool.query(
      `UPDATE roles SET nom = COALESCE($1, nom), description = COALESCE($2, description)
        WHERE id = $3 AND entreprise_id = $4 RETURNING id, nom, description`,
      [nom?.trim() || null, description, req.params.id, req.user.entrepriseId]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Rôle introuvable.' });
    invaliderCacheRoles(req.user.entrepriseId);
    return res.json({ role: rows[0] });
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'Un rôle porte déjà ce nom.' });
    console.error('[PUT /roles/:id]', err);
    return res.status(500).json({ error: 'Erreur lors de la mise à jour du rôle.' });
  }
});

router.delete('/:id', authRequired, proprietaireRequis, async (req, res) => {
  try {
    // Les utilisateurs rattachés perdent simplement leur rôle (ON DELETE SET NULL) : ils
    // redeviennent non restreints, ce qui est le défaut du produit. Personne n'est enfermé.
    const { rowCount } = await pool.query(
      'DELETE FROM roles WHERE id = $1 AND entreprise_id = $2',
      [req.params.id, req.user.entrepriseId]
    );
    if (rowCount === 0) return res.status(404).json({ error: 'Rôle introuvable.' });
    invaliderCacheRoles(req.user.entrepriseId);
    await logAuditEvent({
      entrepriseId: req.user.entrepriseId, userId: req.user.sub, email: req.user.email,
      action: 'role_supprime', req, details: { roleId: Number(req.params.id) },
    });
    return res.json({ success: true });
  } catch (err) {
    console.error('[DELETE /roles/:id]', err);
    return res.status(500).json({ error: 'Erreur lors de la suppression du rôle.' });
  }
});

// Remplace l'ensemble des restrictions d'un rôle. Remplacement et non ajout : l'écran envoie
// l'état complet des cases cochées, c'est plus simple à raisonner qu'un différentiel.
router.put('/:id/restrictions', authRequired, proprietaireRequis, async (req, res) => {
  const { restrictions } = req.body;
  if (!Array.isArray(restrictions)) {
    return res.status(400).json({ error: 'restrictions doit être une liste.' });
  }
  for (const r of restrictions) {
    if (!RESSOURCES[r?.ressource]) return res.status(400).json({ error: `Ressource inconnue : ${r?.ressource}` });
    if (!TOUTES_ACTIONS.includes(r?.action)) return res.status(400).json({ error: `Action inconnue : ${r?.action}` });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rowCount } = await client.query(
      'SELECT 1 FROM roles WHERE id = $1 AND entreprise_id = $2',
      [req.params.id, req.user.entrepriseId]
    );
    if (rowCount === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Rôle introuvable.' });
    }
    await client.query('DELETE FROM role_restrictions WHERE role_id = $1', [req.params.id]);
    for (const r of restrictions) {
      await client.query(
        'INSERT INTO role_restrictions (role_id, ressource, action) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING',
        [req.params.id, r.ressource, r.action]
      );
    }
    await client.query('COMMIT');
    invaliderCacheRoles(req.user.entrepriseId);
    await logAuditEvent({
      entrepriseId: req.user.entrepriseId, userId: req.user.sub, email: req.user.email,
      action: 'role_restrictions_modifiees', req,
      details: { roleId: Number(req.params.id), nombre: restrictions.length },
    });
    return res.json({ success: true, nombre: restrictions.length });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[PUT /roles/:id/restrictions]', err);
    return res.status(500).json({ error: 'Erreur lors de l\'enregistrement des restrictions.' });
  } finally {
    client.release();
  }
});

// Affecte un rôle à un utilisateur (ou le retire avec roleId: null).
router.put('/utilisateurs/:userId', authRequired, proprietaireRequis, async (req, res) => {
  const { roleId } = req.body;
  try {
    if (Number(req.params.userId) === req.user.sub && roleId) {
      // Le maître ne subit aucune restriction de toute façon (voir rolesService), mais lui poser
      // un rôle donnerait l'illusion du contraire à l'écran.
      return res.status(400).json({ error: "Le propriétaire du compte n'est soumis à aucun rôle." });
    }
    if (roleId) {
      const { rowCount } = await pool.query(
        'SELECT 1 FROM roles WHERE id = $1 AND entreprise_id = $2',
        [roleId, req.user.entrepriseId]
      );
      if (rowCount === 0) return res.status(400).json({ error: 'Rôle inconnu pour cette entreprise.' });
    }
    const { rowCount } = await pool.query(
      'UPDATE entreprise_utilisateurs SET role_id = $1 WHERE entreprise_id = $2 AND user_id = $3',
      [roleId || null, req.user.entrepriseId, req.params.userId]
    );
    if (rowCount === 0) return res.status(404).json({ error: 'Utilisateur introuvable dans cette entreprise.' });
    invaliderCacheRoles(req.user.entrepriseId, Number(req.params.userId));
    return res.json({ success: true });
  } catch (err) {
    console.error('[PUT /roles/utilisateurs/:userId]', err);
    return res.status(500).json({ error: "Erreur lors de l'affectation du rôle." });
  }
});

export default router;
