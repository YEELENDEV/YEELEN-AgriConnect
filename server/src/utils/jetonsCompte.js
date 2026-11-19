// Liens à usage unique pour définir un mot de passe (lot 2a de l'audit, S6) :
//   - « activation » : créé par l'entreprise pour un salarié (nouveau compte, ou accès perdu).
//     Remplace l'ancien envoi du mot de passe EN CLAIR par email. Valable 72 h, le temps de le
//     transmettre (email, ou WhatsApp quand l'envoi d'email n'est pas configuré).
//   - « reinitialisation » : demandé par l'utilisateur lui-même (« mot de passe oublié »).
//     Valable 1 h.
//
// Le jeton (32 octets aléatoires) n'est jamais stocké : seule son empreinte SHA-256 l'est, si
// bien qu'une copie de la base ne donne aucun lien utilisable. Il voyage dans le fragment de
// l'URL (#jeton=…), que le navigateur n'envoie jamais au serveur : il n'apparaît donc ni dans les
// journaux d'accès du proxy, ni dans l'en-tête Referer.
import crypto from 'node:crypto';
import { pool } from '../db.js';

export const DUREES_MS = {
  activation: 72 * 3600 * 1000,
  reinitialisation: 3600 * 1000,
};
const CHEMINS = { activation: '/activer-compte', reinitialisation: '/reinitialiser-mot-de-passe' };

const empreinte = (jeton) => crypto.createHash('sha256').update(String(jeton)).digest('hex');

export function lienCompte(objet, jeton) {
  const base = (process.env.FRONTEND_URL || 'http://localhost:8090').replace(/\/$/, '');
  return `${base}${CHEMINS[objet]}#jeton=${jeton}`;
}

// Crée un jeton et renvoie sa valeur en clair (à mettre dans le lien, jamais stockée). Les
// jetons encore valides du même utilisateur et du même objet sont supprimés : seul le dernier
// lien fonctionne, un ancien lien égaré ne sert plus à rien.
export async function creerJetonCompte(q, { userId, objet, creePar = null }) {
  if (!DUREES_MS[objet]) throw new Error(`objet de jeton inconnu : ${objet}`);
  const jeton = crypto.randomBytes(32).toString('base64url');
  await q.query('DELETE FROM jetons_compte WHERE user_id = $1 AND objet = $2 AND utilise_le IS NULL', [userId, objet]);
  await q.query(
    `INSERT INTO jetons_compte (user_id, objet, token_hash, expire_le, cree_par)
     VALUES ($1, $2, $3, now() + make_interval(secs => $4), $5)`,
    [userId, objet, empreinte(jeton), DUREES_MS[objet] / 1000, creePar]
  );
  return jeton;
}

// Consomme un jeton DANS la transaction du client fourni : renvoie { userId, objet } s'il est
// valide (bon format, non expiré, jamais utilisé), sinon null. Le verrou de ligne (FOR UPDATE)
// empêche deux requêtes simultanées d'utiliser le même lien.
export async function consommerJetonCompte(client, jeton) {
  if (typeof jeton !== 'string' || !/^[A-Za-z0-9_-]{30,60}$/.test(jeton)) return null;
  const { rows } = await client.query(
    `SELECT id, user_id, objet FROM jetons_compte
      WHERE token_hash = $1 AND utilise_le IS NULL AND expire_le > now()
      FOR UPDATE`,
    [empreinte(jeton)]
  );
  if (!rows[0]) return null;
  await client.query('UPDATE jetons_compte SET utilise_le = now() WHERE id = $1', [rows[0].id]);
  return { userId: rows[0].user_id, objet: rows[0].objet };
}

// Nettoyage paresseux (appelé à la création d'un jeton) : rien ne sert de garder des jetons
// expirés ou consommés depuis plus de 30 jours.
export async function purgerJetonsCompte() {
  await pool.query(
    `DELETE FROM jetons_compte WHERE (utilise_le IS NOT NULL OR expire_le < now()) AND created_at < now() - interval '30 days'`
  );
}
