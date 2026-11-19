// Contexte de requête (lot 3b de l'audit, A3) — premier middleware monté dans app.js.
//
// - Donne à chaque requête un identifiant court (12 caractères hexadécimaux), renvoyé dans
//   l'en-tête X-Request-Id. Un identifiant fourni en amont (proxy, client d'API) est repris
//   s'il a une forme sûre, pour suivre une même requête d'un bout à l'autre.
// - Ouvre le contexte du journal : toute ligne écrite pendant la requête porte cet identifiant,
//   l'utilisateur et l'entreprise (utils/journal.js).
// - Ajoute `requestId` au corps JSON de toute réponse 5xx : l'utilisateur peut citer la
//   référence affichée, et on retrouve l'erreur exacte dans les journaux.
// - Écrit une ligne de journal d'accès à la fin de chaque requête (méthode, chemin sans la
//   query string, statut, durée, utilisateur). Les jetons présents dans le chemin (lien public
//   de devis, alerte caméra) sont masqués.
import crypto from 'crypto';
import { log, avecContexte } from '../utils/journal.js';

const ID_ENTRANT = /^[A-Za-z0-9_-]{8,64}$/;
const JETON_DANS_CHEMIN = /\/(devis\/public|cameras\/alertes)\/[^/]+/;

export function nouvelIdRequete() {
  return crypto.randomBytes(6).toString('hex');
}

export function cheminJournalisable(req) {
  const chemin = (req.originalUrl || req.url || '').split('?')[0];
  return chemin.replace(JETON_DANS_CHEMIN, '/$1/:jeton');
}

export function contexteRequete(req, res, next) {
  const entrant = req.headers['x-request-id'];
  const requestId = typeof entrant === 'string' && ID_ENTRANT.test(entrant) ? entrant : nouvelIdRequete();
  req.requestId = requestId;
  res.setHeader('X-Request-Id', requestId);

  const json = res.json.bind(res);
  res.json = (corps) => {
    if (res.statusCode >= 500 && corps && typeof corps === 'object' && !Array.isArray(corps) && !('requestId' in corps)) {
      return json({ ...corps, requestId });
    }
    return json(corps);
  };

  const debut = process.hrtime.bigint();
  res.on('finish', () => {
    const chemin = cheminJournalisable(req);
    const duree = Number((process.hrtime.bigint() - debut) / 1_000_000n);
    // Le contrôle de santé Docker frappe toutes les 30 s : en debug seulement.
    const niveau = chemin === '/api/health' ? 'debug' : res.statusCode >= 500 ? 'error' : 'info';
    avecContexte({ requestId, req }, () => log[niveau](`${req.method} ${chemin} ${res.statusCode} ${duree} ms`, {
      type: 'acces', methode: req.method, chemin, statut: res.statusCode, duree_ms: duree,
    }));
  });

  req.contexteJournal = { requestId, req };
  avecContexte(req.contexteJournal, next);
}

// À monter juste après express.json() : la lecture du corps passe par des événements de flux
// (body-parser), après lesquels Node ne garantit pas de retrouver le contexte AsyncLocalStorage.
// On le rouvre explicitement pour la suite de la chaîne (gardes, routes).
export function retablirContexte(req, res, next) {
  if (!req.contexteJournal) return next();
  avecContexte(req.contexteJournal, next);
}
