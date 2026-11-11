// Journal d'audit générique — table `audit_log`, distincte de `mouvements_historique`
// (qui trace uniquement les modifications/suppressions de mouvements ventes/achats
// avec des valeurs avant/après). Pensé pour des événements qui n'ont pas forcément de
// ligne "avant/après" à comparer : connexions, création/désactivation de compte, etc.
// `entrepriseId`/`userId` sont nullable exprès : une tentative de connexion avec un
// email inconnu n'a ni l'un ni l'autre.
import { pool } from '../db.js';

// IP du client telle que résolue par Express selon le réglage `trust proxy` (app.js) : seul
// un proxy de confiance (Caddy, réseau privé) peut fournir X-Forwarded-For. Lire cet en-tête
// brut, comme avant, laissait n'importe quel client choisir son IP — et donc contourner la
// limite d'inscriptions par IP. Utilisé par logAuditEvent, routes/auth.js et utils/mfaCode.js.
export function extraireIp(req) {
  return req?.ip || null;
}

// Enregistre un événement du journal d'audit (connexions, puis actions sensibles
// à venir) sans jamais faire échouer l'appelant si l'écriture échoue — le journal
// d'audit est un outil de diagnostic, pas une dépendance critique du chemin
// fonctionnel (ex: une connexion réussie ne doit jamais échouer à cause d'un souci
// d'écriture dans `audit_log`).
export async function logAuditEvent({ entrepriseId = null, userId = null, email = null, action, req, details = null }) {
  try {
    const ipAddress = extraireIp(req);
    const userAgent = req?.headers?.['user-agent'] || null;

    // `details` est stocké en JSONB : on sérialise nous-mêmes en JSON.stringify plutôt
    // que de laisser `pg` le faire, pour distinguer explicitement "pas de détails" (null)
    // de "détails vides" (objet/array vide) transmis par l'appelant.
    await pool.query(
      `INSERT INTO audit_log (entreprise_id, user_id, email, action, ip_address, user_agent, details)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [entrepriseId, userId, email, action, ipAddress, userAgent, details ? JSON.stringify(details) : null]
    );
  } catch (err) {
    console.error('[logAuditEvent]', err);
  }
}

// Compte les événements récents d'un email pour un ensemble d'actions donné — sert à
// limiter le débit d'envoi/vérification des codes 2FA par email (cf. routes/auth.js,
// routes/mfa.js). En cas d'erreur SQL on renvoie 0 : le rate-limiting ne doit jamais
// empêcher une connexion légitime à cause d'un souci d'écriture/lecture du journal.
export async function countRecentAuditEvents(email, actions, sinceMinutes = 60) {
  try {
    const result = await pool.query(
      `SELECT COUNT(*)::int AS n FROM audit_log
       WHERE LOWER(email) = LOWER($1)
         AND action = ANY($2)
         AND created_at > now() - ($3 || ' minutes')::interval`,
      [email, actions, String(sinceMinutes)]
    );
    return result.rows[0]?.n ?? 0;
  } catch (err) {
    console.error('[countRecentAuditEvents]', err);
    return 0;
  }
}

// Même principe que countRecentAuditEvents mais par IP plutôt que par email — sert à limiter
// le nombre d'inscriptions abouties (`trial_started`) depuis une même adresse (abonnement
// Phase 1, anti-abus). IP null (jamais capturée) ne compte jamais rien : `WHERE ip_address = $1`
// avec $1=null ne matche aucune ligne en SQL, donc pas de faux-blocage si l'IP est indisponible.
export async function countRecentAuditEventsByIp(ipAddress, actions, sinceMinutes = 60) {
  if (!ipAddress) return 0;
  try {
    const result = await pool.query(
      `SELECT COUNT(*)::int AS n FROM audit_log
       WHERE ip_address = $1
         AND action = ANY($2)
         AND created_at > now() - ($3 || ' minutes')::interval`,
      [ipAddress, actions, String(sinceMinutes)]
    );
    return result.rows[0]?.n ?? 0;
  } catch (err) {
    console.error('[countRecentAuditEventsByIp]', err);
    return 0;
  }
}

// Récupère le journal d'audit d'une entreprise, du plus récent au plus ancien.
// Utilisé par GET /api/auth/audit-log (réservé aux admins) — `limit` évite de charger
// un historique potentiellement énorme d'un coup.
export async function getAuditLog(entrepriseId, { limit = 100 } = {}) {
  const result = await pool.query(
    `SELECT id, action, email, ip_address AS "ipAddress", user_agent AS "userAgent",
            details, created_at AS date
     FROM audit_log
     WHERE entreprise_id = $1
     ORDER BY created_at DESC
     LIMIT $2`,
    [entrepriseId, limit]
  );
  return result.rows;
}
