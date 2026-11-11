// Vérification reCAPTCHA v3 (inspiré du module Odoo google_recaptcha, voir
// docs/spec-abonnement-phase1.md et le plan Abonnement Phase 1). Repli gracieux total tant que
// RECAPTCHA_SECRET_KEY n'est pas configuré : ne bloque jamais une inscription légitime en dev
// ou avant que l'utilisateur ait créé ses clés Google — même posture que
// countRecentAuditEvents (une panne d'infra secondaire ne doit jamais bloquer une action
// principale).
import { DELAI_API_EXTERNE_MS } from '../config/env.js';

const SITEVERIFY_URL = 'https://www.google.com/recaptcha/api/siteverify';
const SEUIL_SCORE = 0.5;

export async function verifierRecaptcha(token, actionAttendue = 'register') {
  const secret = process.env.RECAPTCHA_SECRET_KEY;
  if (!secret) return { ok: true, skipped: true };
  if (!token) return { ok: false, skipped: false };

  try {
    const res = await fetch(SITEVERIFY_URL, {
      method: 'POST',
      signal: AbortSignal.timeout(DELAI_API_EXTERNE_MS),
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ secret, response: token }),
    });
    const data = await res.json();
    const ok = Boolean(data.success) && data.action === actionAttendue && (data.score ?? 0) >= SEUIL_SCORE;
    return { ok, skipped: false, score: data.score };
  } catch (err) {
    console.error('[recaptcha] siteverify indisponible, repli gracieux :', err.message);
    return { ok: true, skipped: true, erreur: true };
  }
}
