// Middlewares transverses de durcissement HTTP, montés une fois pour toutes dans app.js :
// en-têtes de sécurité, limitation de débit, enveloppe des middlewares async, 404 et
// gestionnaire d'erreurs final. Volontairement sans dépendance externe (pas de helmet ni
// d'express-rate-limit) : le besoin est simple, et chaque paquet en moins est un risque de
// chaîne d'approvisionnement en moins.

// En-têtes de sécurité pour une API JSON. Les en-têtes propres aux pages HTML (CSP, HSTS…)
// sont posés par Caddy/nginx devant le frontend — voir Caddyfile et nginx.conf.
export function enTetesSecurite(req, res, next) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Cross-Origin-Resource-Policy', 'same-site');
  // Une réponse d'API ne doit jamais être interprétée comme un document actif.
  res.setHeader('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'");
  // Les réponses d'API contiennent des données métier par tenant : jamais en cache partagé.
  if (req.path.startsWith('/api/')) res.setHeader('Cache-Control', 'no-store');
  next();
}

// Limiteur de débit en mémoire (fenêtre fixe par clé). Suffisant pour un backend mono-process
// comme celui-ci ; à remplacer par un stockage partagé (Redis) si le backend passe un jour à
// plusieurs instances. Désactivé sous Jest (NODE_ENV=test) : la suite d'intégration enchaîne
// des centaines d'inscriptions/connexions depuis 127.0.0.1 — les limites métier fines
// (tentatives par email, inscriptions par IP) restent, elles, actives et testées.
export function creerLimiteur({ fenetreMs, max, prefixe = '', message = 'Trop de requêtes. Réessayez plus tard.', actifEnTest = false }) {
  const compteurs = new Map(); // clé -> { n, reset }
  let dernierNettoyage = Date.now();

  const middleware = function limiteur(req, res, next) {
    if (process.env.NODE_ENV === 'test' && !actifEnTest) return next();
    const maintenant = Date.now();

    // Nettoyage paresseux des fenêtres expirées : la Map ne grossit pas indéfiniment.
    if (maintenant - dernierNettoyage > fenetreMs) {
      for (const [cle, v] of compteurs) if (v.reset <= maintenant) compteurs.delete(cle);
      dernierNettoyage = maintenant;
    }

    const cle = `${prefixe}|${req.ip}`;
    let entree = compteurs.get(cle);
    if (!entree || entree.reset <= maintenant) {
      entree = { n: 0, reset: maintenant + fenetreMs };
      compteurs.set(cle, entree);
    }
    entree.n += 1;
    if (entree.n > max) {
      res.setHeader('Retry-After', String(Math.ceil((entree.reset - maintenant) / 1000)));
      return res.status(429).json({ error: message });
    }
    return next();
  };
  middleware.reinitialiser = () => compteurs.clear();
  return middleware;
}

// Express 4 ne capture pas les rejets de promesse d'un middleware async : sans cette
// enveloppe, une erreur SQL dans un garde global laisse la requête pendante (et produit un
// rejet non géré). L'erreur est transmise au gestionnaire d'erreurs final.
export function asyncMiddleware(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}

export function route404(req, res) {
  res.status(404).json({ error: 'Ressource introuvable.' });
}

// Gestionnaire d'erreurs final : jamais de pile d'appels ni de message interne renvoyé au
// client (fuite d'informations sur le schéma ou le code) — journalisé côté serveur seulement.
// eslint-disable-next-line no-unused-vars
export function gestionnaireErreurs(err, req, res, next) {
  if (res.headersSent) return next(err);
  if (err?.type === 'entity.parse.failed') {
    return res.status(400).json({ error: 'Corps de requête JSON invalide.' });
  }
  if (err?.type === 'entity.too.large') {
    return res.status(413).json({ error: 'Corps de requête trop volumineux.' });
  }
  if (err?.message === 'CORS_ORIGINE_REFUSEE') {
    return res.status(403).json({ error: 'Origine non autorisée.' });
  }
  console.error(`[erreur] ${req.method} ${req.originalUrl}`, err);
  return res.status(500).json({ error: 'Erreur interne du serveur.' });
}
