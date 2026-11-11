// Codes 2FA envoyés par email — inspiré de l'approche du module auth_totp_mail de l'ERP
// de référence : le code n'est jamais stocké en base. Il est *dérivé* à la demande d'une
// clé secrète serveur + de l'identité de l'utilisateur, sur un pas de temps de 10 min,
// puis recalculé et comparé à la vérification. Conséquences :
//   - aucune colonne `mfa_email_code` / `mfa_email_code_expires`, aucun nettoyage d'expiration ;
//   - le code devient automatiquement invalide au bout de 10-20 min (pas courant + précédent) ;
//   - changer JWT_SECRET invalide tous les codes en circulation.
// La méthode TOTP (application d'authentification) reste gérée par otplib dans routes/mfa.js
// et n'a rien à voir avec ce fichier.
import crypto from 'crypto';
import { env } from '../config/env.js';
import { extraireIp } from './auditLog.js';

const STEP_MS = 10 * 60 * 1000; // fenêtre de 10 minutes par pas
const DIGITS = 6;

// Clé HOTP propre à (utilisateur, email) — dérivée du secret serveur, jamais exposée.
function keyFor(userId, email) {
  return crypto
    .createHmac('sha256', env.JWT_SECRET)
    .update(`mfa-email:${userId}:${String(email).toLowerCase()}`)
    .digest();
}

// HOTP façon RFC 4226 mais sur HMAC-SHA256 — clé générée et vérifiée uniquement côté
// serveur, l'écart au standard (SHA-256 au lieu de SHA-1) est donc sans conséquence
// d'interopérabilité.
function hotp(key, counter) {
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64BE(BigInt(counter));
  const hmac = crypto.createHmac('sha256', key).update(buf).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const bin =
    ((hmac[offset] & 0x7f) << 24) |
    (hmac[offset + 1] << 16) |
    (hmac[offset + 2] << 8) |
    hmac[offset + 3];
  return String(bin % 10 ** DIGITS).padStart(DIGITS, '0');
}

// Code à communiquer à l'utilisateur maintenant.
export function generateEmailCode(userId, email) {
  return hotp(keyFor(userId, email), Math.floor(Date.now() / STEP_MS));
}

// Vrai si `token` correspond au pas courant ou au précédent (tolérance horloge/latence
// d'acheminement de l'email) — validité effective 10 à 20 min.
export function verifyEmailCode(userId, email, token) {
  const candidate = String(token ?? '').trim();
  if (!/^\d{6}$/.test(candidate)) return false;
  const key = keyFor(userId, email);
  const now = Math.floor(Date.now() / STEP_MS);
  return [now, now - 1].some(c =>
    crypto.timingSafeEqual(Buffer.from(hotp(key, c)), Buffer.from(candidate))
  );
}

// Décrit sommairement la requête (navigateur / OS / IP) pour l'email de code 2FA —
// sniff minimal du User-Agent, sans dépendance. Renvoie des champs `undefined` si rien
// n'est reconnaissable plutôt que des libellés fourre-tout.
export function requestContext(req) {
  const ua = req?.headers?.['user-agent'] || '';
  const ip = extraireIp(req) || undefined;
  const browser =
    /Edg\//.test(ua) ? 'Edge'
    : /OPR\/|Opera/.test(ua) ? 'Opera'
    : /Firefox\//.test(ua) ? 'Firefox'
    : /Chrome\//.test(ua) ? 'Chrome'
    : /Safari\//.test(ua) ? 'Safari'
    : undefined;
  const device =
    /Android/.test(ua) ? 'Android'
    : /iPhone|iPad|iPod/.test(ua) ? 'iOS'
    : /Windows/.test(ua) ? 'Windows'
    : /Mac OS X/.test(ua) ? 'macOS'
    : /Linux/.test(ua) ? 'Linux'
    : undefined;
  return { device, browser, ip };
}

// Masque un email pour l'affichage : « ousmane@iprec.fr » -> « o******@iprec.fr ».
export function maskEmail(email) {
  const [local, domain] = String(email ?? '').split('@');
  if (!domain) return email;
  const head = local.length <= 1 ? local : local[0];
  return `${head}${'*'.repeat(Math.max(1, local.length - 1))}@${domain}`;
}
