// Middleware Express posé sur toute route qui exige un utilisateur connecté — c'est
// la seule barrière d'authentification de l'app (pas de session serveur, tout repose
// sur ce token). Les droits fins sont ensuite décidés par permissionGuard (restrictions de
// l'entreprise) ; le rôle texte du jeton ne décide plus rien côté serveur.
import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';

// Algorithme figé : jsonwebtoken refuse déjà `none`, mais épingler HS256 ferme aussi toute
// confusion d'algorithme si une clé asymétrique venait un jour à être configurée.
const ALGORITHME = 'HS256';

// Émet le token de session. Le payload ({ sub, email, entrepriseId, role, isPlatformAdmin })
// est figé jusqu'à expiration : une bascule de rôle en base ne prend effet qu'à la
// prochaine connexion (voir requirePlatformAdmin.js).
export function signerToken(payload) {
  return jwt.sign(payload, env.JWT_SECRET, { algorithm: ALGORITHME, expiresIn: env.JWT_EXPIRES_IN });
}

// Le header attendu est "Authorization: Bearer <token>" — tout autre format (absent, mal
// formé) est traité comme "pas de token". Renvoie le payload vérifié, ou null.
function lireTokenVerifie(req) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return { token: null, payload: null };
  try {
    // jwt.verify vérifie à la fois la signature ET l'expiration du token.
    return { token, payload: jwt.verify(token, env.JWT_SECRET, { algorithms: [ALGORITHME] }) };
  } catch {
    return { token, payload: null };
  }
}

export function authRequired(req, res, next) {
  const { token, payload } = lireTokenVerifie(req);
  if (!token) {
    return res.status(401).json({ error: 'Token d’authentification requis.' });
  }
  if (!payload) {
    // Signature invalide, token expiré, ou payload corrompu — dans tous les cas la
    // réponse est identique (401 générique) pour ne pas donner d'indice à un attaquant.
    return res.status(401).json({ error: 'Token invalide.' });
  }
  req.user = payload;
  next();
}

// Variante d'authRequired qui ne rejette JAMAIS — pose req.user quand un token valide est
// présent, laisse passer sinon (authRequired, posé route par route, s'occupera du 401 sur les
// routes qui l'exigent réellement). Posé en middleware global dans app.js, juste avant
// subscriptionGuard, pour que ce dernier connaisse req.user.entrepriseId.
export function verifierTokenSiPresent(req, res, next) {
  const { payload } = lireTokenVerifie(req);
  if (payload) req.user = payload;
  next();
}
