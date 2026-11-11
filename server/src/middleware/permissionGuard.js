// Garde des restrictions — MODE REFUS (bascule de l'étape 3b, 2026-11-11).
//
// L'application n'apporte AUCUNE politique : tout est ouvert, et seule une restriction posée par
// l'entreprise peut fermer quelque chose. Le propriétaire du compte n'en subit aucune. Une route
// absente de la carte est autorisée (le test de couverture du catalogue interdit d'en ajouter).
//
// Ce garde applique aussi deux règles de sécurité transverses, pour toute requête authentifiée :
//   - compte désactivé ou détaché de l'entreprise → 401, même avec un jeton encore valide ;
//   - restrictions illisibles (base indisponible) → 503 : on ne devine pas des droits.
//
// Interrupteur de repli : PERMISSIONS_MODE=observation remet l'ancien comportement (journalise
// sans refuser les restrictions). Prévu pour un retour arrière d'urgence, pas pour durer. Les
// deux règles de sécurité ci-dessus restent actives dans les deux modes.
import { creerAppariementChemin } from '../permissions/inventaireRoutes.js';
import { resoudrePermission, RESSOURCES } from '../permissions/catalogue.js';
import { restrictionsUtilisateur, autoriseUtilisateur } from '../utils/rolesService.js';
import { logAuditEvent } from '../utils/auditLog.js';

const LIBELLES_ACTIONS = {
  lire: 'consulter', creer: 'créer', modifier: 'modifier', supprimer: 'supprimer',
  valider: 'valider', facturer: 'facturer', receptionner: 'réceptionner', encaisser: 'encaisser',
};

// Routes publiques d'authentification : un jeton périmé resté dans le navigateur (compte
// désactivé) ne doit pas empêcher quelqu'un d'autre de se connecter depuis ce poste.
const AUTH_PUBLIQUE = /^\/api\/auth\/(login|register|confirmer-inscription|renvoyer-code-inscription)$/;

// Lu à chaque requête (et non figé au chargement) pour que les tests puissent le basculer.
function modeObservation() {
  return process.env.PERMISSIONS_MODE === 'observation';
}

// Anti-inondation : un écran qui boucle sur une route refusée écrirait des milliers de lignes
// d'audit identiques. On ne journalise qu'une fois par (entreprise, rôle, permission) et par
// process — assez pour voir le refus, pas assez pour noyer le journal.
const dejaVus = new Set();

export function creerPermissionGuard(app) {
  // Appariement construit à la PREMIÈRE REQUÊTE, pas à la création : le garde doit être monté
  // avant les routes pour les intercepter, mais il lui faut les routes déjà montées pour les
  // inventorier. Au premier appel, `app.use(...)` a fini de tout enregistrer.
  let apparier = null;

  return async function permissionGuard(req, res, next) {
    if (!apparier) apparier = creerAppariementChemin(app);
    if (!req.path.startsWith('/api/')) return next();
    if (!req.user?.entrepriseId) return next(); // non authentifié : authRequired s'en charge
    if (AUTH_PUBLIQUE.test(req.path)) return next();

    const resolution = await restrictionsUtilisateur(req.user.entrepriseId, req.user.sub);
    if (resolution.erreur) {
      return res.status(503).json({ error: 'Vérification des droits momentanément impossible. Réessayez.' });
    }
    if (!resolution.rattache || !resolution.actif) {
      // 401 (et non 403) : le frontend déconnecte alors l'utilisateur (src/lib/api.js).
      return res.status(401).json({ error: 'Ce compte a été désactivé. Contactez votre administrateur.', reason: 'compte_desactive' });
    }

    let permission;
    try {
      const motif = apparier(req.method, req.originalUrl || req.url);
      // Aucun motif : l'URL ne correspond à aucune route montée, le 404 viendra tout seul.
      if (!motif) return next();
      permission = resoudrePermission(req.method, motif);
    } catch (err) {
      // Route non couverte par la carte. Le test d'intégration l'interdit, donc c'est
      // improbable ; dans le modèle « tout ouvert », une route inconnue reste autorisée.
      journaliser(req, { raison: 'route_non_couverte', detail: err.message });
      return next();
    }

    if (!permission) return next(); // hors périmètre, assumé

    // Tout est ouvert par défaut : on ne cherche pas une permission accordée, on cherche une
    // restriction posée par l'entreprise. Le propriétaire n'en subit aucune (voir rolesService).
    if (autoriseUtilisateur(resolution, permission.ressource, permission.action)) return next();

    const observation = modeObservation();
    // Attendu : la ligne d'audit existe quand la réponse part (lisible aussitôt par l'écran
    // du journal, et par les tests).
    await journaliser(req, {
      raison: 'restriction_entreprise',
      ressource: permission.ressource,
      action: permission.action,
      roleId: resolution.roleId,
    }, observation ? 'permission_observee' : 'permission_refusee');
    if (observation) return next();

    const libelleRessource = RESSOURCES[permission.ressource]?.libelle || permission.ressource;
    const libelleAction = LIBELLES_ACTIONS[permission.action] || permission.action;
    return res.status(403).json({
      error: `Votre rôle ne vous permet pas de ${libelleAction} : ${libelleRessource}.`,
      reason: 'restriction',
      ressource: permission.ressource,
      action: permission.action,
    });
  };
}

async function journaliser(req, details, action = 'permission_observee') {
  const cle = `${req.user.entrepriseId}|${details.roleId || '-'}|${details.ressource || '?'}|${details.action || '?'}|${details.raison}|${action}`;
  if (dejaVus.has(cle)) return;
  dejaVus.add(cle);

  // logAuditEvent ne lève jamais (il journalise lui-même ses échecs).
  await logAuditEvent({
    entrepriseId: req.user.entrepriseId,
    userId: req.user.sub,
    email: req.user.email,
    action,
    req,
    details: { ...details, methode: req.method, chemin: req.originalUrl || req.url },
  });
}
