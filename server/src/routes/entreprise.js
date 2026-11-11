import express from 'express';
import { authRequired } from '../middleware/auth.js';
import { pool } from '../db.js';
import { logAuditEvent } from '../utils/auditLog.js';
import { MODULES_TARIFES, calculerPrixUSD } from '../utils/tarificationModules.js';
import { invaliderCacheModules } from '../middleware/moduleGuard.js';

const router = express.Router();

const MODULES_CONNUS = [...MODULES_TARIFES, 'clients', 'fournisseurs', 'employees', 'finances', 'notifications'];

router.get('/', authRequired, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, nom, siret, adresse, secteur, devise, locale, created_at AS "createdAt",
              ville, latitude::float8 AS latitude, longitude::float8 AS longitude,
              telephone, pays, numero_tva AS "numeroTva", fuseau
       FROM entreprises WHERE id = $1`,
      [req.user.entrepriseId]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Entreprise introuvable.' });
    }
    return res.json({ entreprise: result.rows[0] });
  } catch (err) {
    console.error('[GET /entreprise]', err);
    return res.status(500).json({ error: "Erreur lors de la récupération de l'entreprise." });
  }
});

router.put('/', authRequired, async (req, res) => {
  const { nom, siret, adresse, secteur, devise, locale, ville, latitude, longitude, telephone, pays, numeroTva, fuseau } = req.body;
  try {
    // Le fuseau sert à dater les pièces (fonction SQL date_entreprise) : une valeur invalide
    // ferait retomber toutes les dates sur UTC en silence, donc on la refuse ici plutôt que
    // de laisser passer. C'est aussi ce qui permet à date_entreprise de ne pas revalider à
    // chaque appel.
    if (fuseau != null && fuseau !== '') {
      const connu = await pool.query('SELECT 1 FROM pg_timezone_names WHERE name = $1', [fuseau]);
      if (connu.rowCount === 0) {
        return res.status(400).json({ error: 'Fuseau horaire inconnu.' });
      }
    }
    const result = await pool.query(
      `UPDATE entreprises SET
         nom = COALESCE($1, nom),
         siret = COALESCE($2, siret),
         adresse = COALESCE($3, adresse),
         secteur = COALESCE($4, secteur),
         devise = COALESCE($5, devise),
         locale = COALESCE($6, locale),
         ville = COALESCE($7, ville),
         latitude = COALESCE($8, latitude),
         longitude = COALESCE($9, longitude),
         telephone = COALESCE($10, telephone),
         pays = COALESCE($11, pays),
         numero_tva = COALESCE($12, numero_tva),
         fuseau = COALESCE($13, fuseau)
       WHERE id = $14
       RETURNING id, nom, siret, adresse, secteur, devise, locale, created_at AS "createdAt",
                 ville, latitude::float8 AS latitude, longitude::float8 AS longitude,
                 telephone, pays, numero_tva AS "numeroTva", fuseau`,
      [nom, siret, adresse, secteur, devise, locale, ville, latitude, longitude, telephone, pays, numeroTva, fuseau || null, req.user.entrepriseId]
    );
    await logAuditEvent({
      entrepriseId: req.user.entrepriseId, userId: req.user.sub, email: req.user.email,
      action: 'entreprise_updated', req, details: { nom, siret, adresse, secteur, devise, locale, ville, latitude, longitude, telephone, pays, numeroTva },
    });
    return res.json({ entreprise: result.rows[0] });
  } catch (err) {
    console.error('[PUT /entreprise]', err);
    return res.status(500).json({ error: 'Erreur lors de la mise à jour.' });
  }
});

// Récupère le compte bancaire principal actuel de l'entreprise
router.get('/banque-principale', authRequired, async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT banque_principale_id AS "banquePrincipaleId" FROM entreprises WHERE id = $1',
      [req.user.entrepriseId]
    );
    return res.json(result.rows[0]);
  } catch (err) {
    console.error('[GET /entreprise/banque-principale]', err);
    return res.status(500).json({ error: 'Erreur lors de la récupération.' });
  }
});

// Définit le compte bancaire principal, réservé à l'admin
router.put('/banque-principale', authRequired, async (req, res) => {
  const { banqueId } = req.body;
  try {
    await pool.query(
      'UPDATE entreprises SET banque_principale_id = $1 WHERE id = $2',
      [banqueId || null, req.user.entrepriseId]
    );
    await logAuditEvent({
      entrepriseId: req.user.entrepriseId, userId: req.user.sub, email: req.user.email,
      action: 'banque_principale_updated', req, details: { banqueId: banqueId || null },
    });
    return res.json({ success: true, banquePrincipaleId: banqueId || null });
  } catch (err) {
    console.error('[PUT /entreprise/banque-principale]', err);
    return res.status(500).json({ error: 'Erreur lors de la mise à jour.' });
  }
});

// Calcule si l'assistant "Configurer votre entreprise" (banque + salarié) peut être considéré comme fait :
// soit une vraie donnée existe, soit l'utilisateur a explicitement confirmé qu'il n'en a pas besoin.
router.get('/onboarding-status', authRequired, async (req, res) => {
  try {
    const [entrepriseResult, banqueResult, salarieResult] = await Promise.all([
      pool.query('SELECT banque_non_requise AS "banqueNonRequise", salarie_non_requis AS "salarieNonRequis" FROM entreprises WHERE id = $1', [req.user.entrepriseId]),
      pool.query('SELECT EXISTS(SELECT 1 FROM banques WHERE entreprise_id = $1) AS "hasBanque"', [req.user.entrepriseId]),
      pool.query("SELECT EXISTS(SELECT 1 FROM salaries WHERE entreprise_id = $1 AND statut != 'Inactif') AS \"hasSalarie\"", [req.user.entrepriseId]),
    ]);
    if (entrepriseResult.rows.length === 0) {
      return res.status(404).json({ error: 'Entreprise introuvable.' });
    }
    const { banqueNonRequise, salarieNonRequis } = entrepriseResult.rows[0];
    const { hasBanque } = banqueResult.rows[0];
    const { hasSalarie } = salarieResult.rows[0];
    return res.json({
      banqueOk: hasBanque || banqueNonRequise,
      salarieOk: hasSalarie || salarieNonRequis,
    });
  } catch (err) {
    console.error('[GET /entreprise/onboarding-status]', err);
    return res.status(500).json({ error: "Erreur lors de la récupération du statut de configuration." });
  }
});

// Réservé à admin/directeur : ce sont eux qui confirment que la config est volontairement incomplète.
router.put('/onboarding-status', authRequired, async (req, res) => {
  const { banqueNonRequise, salarieNonRequis } = req.body;
  try {
    await pool.query(
      `UPDATE entreprises SET
         banque_non_requise = COALESCE($1, banque_non_requise),
         salarie_non_requis = COALESCE($2, salarie_non_requis)
       WHERE id = $3`,
      [banqueNonRequise ?? null, salarieNonRequis ?? null, req.user.entrepriseId]
    );
    return res.json({ success: true });
  } catch (err) {
    console.error('[PUT /entreprise/onboarding-status]', err);
    return res.status(500).json({ error: 'Erreur lors de la mise à jour.' });
  }
});

// ─── Modules activés (tarification par module, 2026-09-06) ────────────────
// Jusqu'ici, quel module est « activé » n'existait qu'en localStorage côté navigateur (voir
// App.jsx:toggleModule) — jamais scopé par entreprise_id côté serveur, donc impossible d'en
// tirer un prix fiable. GET ouvert à tout rôle authentifié (comme le reste de cette route),
// PUT réservé admin/directeur car ça a désormais une vraie conséquence financière (voir
// routes/billing.js pour le calcul du montant suggéré).
router.get('/modules', authRequired, async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT modules_actifs FROM entreprises WHERE id = $1', [req.user.entrepriseId]);
    if (rows.length === 0) return res.status(404).json({ error: 'Entreprise introuvable.' });
    return res.json({ modules: rows[0].modules_actifs || {} });
  } catch (err) {
    console.error('[GET /entreprise/modules]', err);
    return res.status(500).json({ error: 'Erreur lors de la récupération des modules.' });
  }
});

router.put('/modules', authRequired, async (req, res) => {
  const { modules } = req.body;
  if (!modules || typeof modules !== 'object' || Array.isArray(modules)) {
    return res.status(400).json({ error: 'modules doit être un objet { cle: booléen }.' });
  }
  // Ne garde que des clés de modules connus et des valeurs booléennes — un objet arbitraire
  // envoyé par un client ne doit pas pouvoir écrire n'importe quoi dans la colonne JSONB.
  const filtre = {};
  for (const cle of MODULES_CONNUS) {
    if (cle in modules) filtre[cle] = !!modules[cle];
  }
  try {
    const { rows } = await pool.query(
      'UPDATE entreprises SET modules_actifs = $1::jsonb WHERE id = $2 RETURNING modules_actifs, pays',
      [JSON.stringify(filtre), req.user.entrepriseId]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Entreprise introuvable.' });
    invaliderCacheModules(req.user.entrepriseId);
    await logAuditEvent({
      entrepriseId: req.user.entrepriseId, userId: req.user.sub, email: req.user.email,
      action: 'modules_actifs_updated', req, details: filtre,
    });
    const prix = calculerPrixUSD(rows[0].pays, rows[0].modules_actifs);
    return res.json({ modules: rows[0].modules_actifs, prix });
  } catch (err) {
    console.error('[PUT /entreprise/modules]', err);
    return res.status(500).json({ error: 'Erreur lors de la mise à jour des modules.' });
  }
});

export default router;