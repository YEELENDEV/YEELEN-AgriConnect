// Résolution des restrictions d'un utilisateur.
//
// L'application ne définit AUCUNE politique. Trois règles, et rien d'autre :
//   1. Le propriétaire — le compte qui a ouvert l'entreprise — garde tout, définitivement.
//      Aucune restriction ne lui est opposable, sinon une entreprise peut se verrouiller dehors.
//   2. Un utilisateur sans rôle n'a aucune restriction : tout est ouvert.
//   3. Un rôle est ouvert lui aussi, et ne restreint que ce que l'entreprise lui a retiré.
//
// Depuis la bascule en refus (2026-11-11), la résolution sert aussi à vérifier que le compte
// est toujours ACTIF dans l'entreprise : le JWT reste cryptographiquement valide jusqu'à son
// expiration (7 jours), et sans cette vérification un salarié désactivé gardait un accès
// complet à l'API avec le jeton déjà émis.
//
// Le JWT porte le rôle sous forme de texte figé à la connexion ; il est sans valeur
// décisionnelle ici, puisqu'une entreprise renomme et redéfinit ses rôles quand elle veut. Tout
// se lit en base, avec un cache à TTL court — même patron que moduleGuard.
import { pool } from '../db.js';

const cache = new Map(); // `${entrepriseId}:${userId}` -> { valeur, t }
const TTL = 60_000;

async function lireEnBase(entrepriseId, userId) {
  const { rows } = await pool.query(
    `SELECT e.proprietaire_user_id AS proprietaire,
            eu.role_id             AS "roleId",
            eu.statut,
            rr.ressource,
            rr.action
       FROM entreprises e
       JOIN entreprise_utilisateurs eu ON eu.entreprise_id = e.id AND eu.user_id = $2
       LEFT JOIN role_restrictions rr ON rr.role_id = eu.role_id
      WHERE e.id = $1`,
    [entrepriseId, userId]
  );

  // Aucune ligne : l'utilisateur n'est (plus) rattaché à cette entreprise — son jeton ne doit
  // plus rien ouvrir.
  if (rows.length === 0) return { rattache: false, actif: false, proprietaire: false, roleId: null, restrictions: {} };

  const restrictions = {};
  for (const { ressource, action } of rows) {
    if (!ressource || !action) continue;
    (restrictions[ressource] ||= new Set()).add(action);
  }

  return {
    rattache: true,
    actif: rows[0].statut === 'Actif',
    proprietaire: rows[0].proprietaire === userId,
    roleId: rows[0].roleId,
    restrictions,
  };
}

export async function restrictionsUtilisateur(entrepriseId, userId) {
  const cle = `${entrepriseId}:${userId}`;
  const hit = cache.get(cle);
  if (hit && Date.now() - hit.t < TTL) return hit.valeur;

  try {
    const valeur = await lireEnBase(entrepriseId, userId);
    cache.set(cle, { valeur, t: Date.now() });
    return valeur;
  } catch (err) {
    // Base illisible : on REFUSE (fail closed) — accorder des droits faute de pouvoir les lire
    // serait le contraire du but. Le résultat n'est pas mis en cache, pour qu'une erreur
    // passagère ne bloque pas l'utilisateur pendant toute la durée du TTL.
    console.error('[rolesService] lecture des restrictions', err.message);
    return { rattache: false, actif: false, proprietaire: false, roleId: null, restrictions: {}, erreur: true };
  }
}

// Autorisé sauf restriction explicite. C'est l'inverse d'une liste de permissions, et c'est
// voulu : l'entreprise retire, elle n'accorde pas. Une résolution absente ou en erreur refuse.
export function autoriseUtilisateur(resolution, ressource, action) {
  if (!resolution || resolution.erreur) return false;
  if (resolution.proprietaire) return true;
  return !resolution.restrictions?.[ressource]?.has(action);
}

// À appeler depuis toute route qui modifie un rôle, ses restrictions, l'affectation ou le statut
// d'un utilisateur — sinon le changement resterait sans effet jusqu'à 60 secondes.
export function invaliderCacheRoles(entrepriseId, userId = null) {
  if (userId !== null) { cache.delete(`${entrepriseId}:${userId}`); return; }
  for (const cle of cache.keys()) {
    if (cle.startsWith(`${entrepriseId}:`)) cache.delete(cle);
  }
}

export function viderCacheRoles() {
  cache.clear();
}
