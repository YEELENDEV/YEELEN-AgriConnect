// Authentification : la seule barrière d'identité de l'app (pas de session serveur, tout repose
// sur un JWT signé). Les droits fins sont ensuite décidés par permissionGuard (restrictions de
// l'entreprise) ; le rôle texte du jeton ne décide plus rien côté serveur.
//
// Lot 2b de l'audit (S4) — deux façons de présenter le jeton :
//   - le navigateur : cookie `agri_session` HttpOnly (le JavaScript de la page ne peut pas le
//     lire, donc une faille XSS ne peut plus voler la session), SameSite=Strict, Secure en
//     production. Comme un cookie part tout seul, toute requête qui modifie quelque chose doit
//     porter l'en-tête `X-Requested-With: AgriConnect` (protection CSRF : un site tiers ne peut
//     pas ajouter d'en-tête personnalisé sans un pré-vol CORS, que notre liste d'origines refuse).
//   - un client d'API ou les tests : en-tête `Authorization: Bearer <jeton>`, prioritaire, et
//     exempté de l'en-tête CSRF (un site tiers ne peut pas poser d'en-tête Authorization).
//
// Durées : le jeton est court (JWT_EXPIRES_IN, 2 h par défaut) et renouvelé dans le cookie tant
// que l'utilisateur est actif ; au-delà de SESSION_MAX_JOURS depuis la connexion (claim `at`,
// conservé à chaque renouvellement), il faut se reconnecter.
import jwt from 'jsonwebtoken';
import { env, IS_PRODUCTION } from '../config/env.js';

// Algorithme figé : jsonwebtoken refuse déjà `none`, mais épingler HS256 ferme aussi toute
// confusion d'algorithme si une clé asymétrique venait un jour à être configurée.
const ALGORITHME = 'HS256';

export const COOKIE_SESSION = 'agri_session';
export const ENTETE_CSRF = 'x-requested-with';
export const VALEUR_CSRF = 'AgriConnect';
// Un jeton de cookie plus vieux que ça est remplacé par un neuf à la requête suivante.
const RENOUVELER_APRES_S = 15 * 60;
const METHODES_SURES = new Set(['GET', 'HEAD', 'OPTIONS']);

const maintenantS = () => Math.floor(Date.now() / 1000);
const sessionMaxS = () => env.SESSION_MAX_JOURS * 24 * 3600;

// Émet le jeton de session. `at` (heure de connexion, en secondes) borne la durée totale :
// passé tel quel lors d'un renouvellement, il vaut « maintenant » pour une nouvelle connexion.
// Le payload est figé jusqu'à expiration : une bascule de rôle en base ne prend effet qu'à la
// prochaine connexion (voir requirePlatformAdmin.js) — sauf la révocation (`tv`, permissionGuard).
export function signerToken(payload) {
  const { iat: _iat, exp: _exp, ...reste } = payload;
  const at = reste.at ?? maintenantS();
  return jwt.sign({ ...reste, at }, env.JWT_SECRET, { algorithm: ALGORITHME, expiresIn: env.JWT_EXPIRES_IN });
}

// `Secure` (cookie envoyé seulement en HTTPS) en production. COOKIE_SECURE=false le désactive
// pour un test de production sans TLS — jamais sur un serveur exposé : le navigateur refuserait
// sinon le cookie et personne ne pourrait se connecter en HTTP simple.
function optionsCookie() {
  const secure = process.env.COOKIE_SECURE ? process.env.COOKIE_SECURE === 'true' : IS_PRODUCTION;
  return { httpOnly: true, sameSite: 'strict', secure, path: '/api' };
}

// Pose le cookie de session. Sa durée de vie navigateur suit celle du jeton : sans activité, il
// disparaît en même temps que le jeton expire.
export function poserCookieSession(res, token) {
  const { exp } = jwt.decode(token);
  res.cookie(COOKIE_SESSION, token, { ...optionsCookie(), maxAge: Math.max(0, exp * 1000 - Date.now()) });
}

export function effacerCookieSession(res) {
  res.clearCookie(COOKIE_SESSION, optionsCookie());
}

// Le navigateur a-t-il demandé une session par cookie ? (en-tête posé par src/lib/api.js). Dans
// ce cas le jeton n'est PAS renvoyé dans le corps de la réponse : le JavaScript n'en a pas
// besoin, et une XSS ne doit pas pouvoir le récupérer en rappelant la route.
export function clientNavigateur(req) {
  return req.headers[ENTETE_CSRF] === VALEUR_CSRF;
}

// Réponse commune des routes qui ouvrent ou renouvellent une session.
export function repondreAvecSession(req, res, token, corps) {
  poserCookieSession(res, token);
  return res.json(clientNavigateur(req) ? corps : { ...corps, token });
}

function lireCookie(req, nom) {
  const brut = req.headers.cookie;
  if (!brut) return null;
  for (const morceau of brut.split(';')) {
    const i = morceau.indexOf('=');
    if (i > 0 && morceau.slice(0, i).trim() === nom) {
      try { return decodeURIComponent(morceau.slice(i + 1).trim()); } catch { return null; }
    }
  }
  return null;
}

// Renvoie { token, payload, source }. Bearer d'abord (choix explicite du client), cookie sinon.
// payload vaut null si la signature est fausse, le jeton expiré ou la session trop ancienne.
function lireTokenVerifie(req) {
  const header = req.headers.authorization || '';
  let token = header.startsWith('Bearer ') ? header.slice(7) : null;
  let source = token ? 'bearer' : null;
  if (!token) {
    token = lireCookie(req, COOKIE_SESSION);
    source = token ? 'cookie' : null;
  }
  if (!token) return { token: null, payload: null, source: null };
  try {
    // jwt.verify vérifie à la fois la signature ET l'expiration du token.
    const payload = jwt.verify(token, env.JWT_SECRET, { algorithms: [ALGORITHME] });
    // Jeton antérieur au lot 2b (sans `at`) : on borne à partir de son émission.
    const at = payload.at ?? payload.iat;
    if (maintenantS() - at > sessionMaxS()) return { token, payload: null, source };
    return { token, payload, source };
  } catch {
    return { token, payload: null, source };
  }
}

export function authRequired(req, res, next) {
  // Déjà vérifié par verifierTokenSiPresent (monté globalement) : inutile de recommencer.
  if (req.user) return next();
  const { token, payload, source } = lireTokenVerifie(req);
  if (!token) {
    return res.status(401).json({ error: 'Token d’authentification requis.' });
  }
  if (!payload) {
    if (source === 'cookie') effacerCookieSession(res);
    // Signature invalide, token expiré, ou payload corrompu — dans tous les cas la
    // réponse est identique (401 générique) pour ne pas donner d'indice à un attaquant.
    return res.status(401).json({ error: 'Token invalide.' });
  }
  req.user = payload;
  req.sourceJeton = source;
  next();
}

// Variante d'authRequired qui ne rejette JAMAIS sur l'identité — pose req.user quand un jeton
// valide est présent, laisse passer sinon (authRequired, posé route par route, s'occupera du
// 401). Montée globalement dans app.js, avant subscriptionGuard et permissionGuard.
//
// C'est aussi là que vivent les deux règles propres au cookie : la protection CSRF (403 sur une
// écriture sans l'en-tête attendu) et le renouvellement glissant du jeton.
export function verifierTokenSiPresent(req, res, next) {
  const { payload, source } = lireTokenVerifie(req);
  if (source === 'cookie' && !METHODES_SURES.has(req.method) && !clientNavigateur(req)) {
    return res.status(403).json({ error: 'Requête refusée (protection CSRF).', reason: 'csrf' });
  }
  if (!payload) return next();
  req.user = payload;
  req.sourceJeton = source;
  // Renouvellement : seulement pour le cookie (un client Bearer gère son jeton lui-même), et en
  // gardant `at` — la durée absolue de la session ne s'allonge pas. La révocation (`tv`) reste
  // vérifiée par permissionGuard juste après, qui efface le cookie s'il refuse.
  if (source === 'cookie' && maintenantS() - payload.iat > RENOUVELER_APRES_S) {
    poserCookieSession(res, signerToken({ ...payload, at: payload.at ?? payload.iat }));
  }
  next();
}
