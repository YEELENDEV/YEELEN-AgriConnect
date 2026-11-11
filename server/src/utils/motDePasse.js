// Règles communes aux mots de passe et identifiants de connexion — partagées par
// l'inscription (routes/auth.js) et la création de compte salarié (routes/salaries.js), qui
// n'appliquaient jusqu'ici aucune règle (un mot de passe d'un seul caractère était accepté).
import bcrypt from 'bcryptjs';

// Coût bcrypt : 10 reste le minimum recommandé (OWASP) ; centralisé pour pouvoir le relever
// en un seul endroit. Les hachages existants restent vérifiables quel que soit le coût.
export const BCRYPT_COUT = 10;

// Hachage de référence (d'un mot de passe aléatoire jamais utilisé), comparé quand l'email est
// inconnu pour que la connexion prenne le même temps qu'avec un compte existant.
export const HASH_FACTICE = bcrypt.hashSync(`factice-${Math.random()}`, BCRYPT_COUT);

const LONGUEUR_MIN = 8;
// bcrypt ignore tout ce qui dépasse 72 octets : au-delà, deux mots de passe différents
// partageant les 72 premiers octets seraient acceptés indifféremment.
const OCTETS_MAX = 72;

// Renvoie un message d'erreur, ou null si le mot de passe est acceptable.
export function validerMotDePasse(motDePasse) {
  if (typeof motDePasse !== 'string' || motDePasse.length < LONGUEUR_MIN) {
    return `Le mot de passe doit contenir au moins ${LONGUEUR_MIN} caractères.`;
  }
  if (Buffer.byteLength(motDePasse, 'utf8') > OCTETS_MAX) {
    return `Le mot de passe ne doit pas dépasser ${OCTETS_MAX} octets.`;
  }
  if (!/[A-Za-zÀ-ÿ]/.test(motDePasse) || !/\d/.test(motDePasse)) {
    return 'Le mot de passe doit contenir au moins une lettre et un chiffre.';
  }
  return null;
}

// Validation volontairement simple (pas de RFC 5322 complète) : une forme x@y.z sans espace,
// longueur bornée — de quoi refuser les saisies absurdes ou les objets JSON injectés.
export function validerEmail(email) {
  if (typeof email !== 'string' || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return 'Adresse email invalide.';
  }
  return null;
}
