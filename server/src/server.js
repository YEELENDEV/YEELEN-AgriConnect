// Point d'entrée réel du backend Express — celui que docker-compose et `npm run dev`/
// `npm start` lancent. Le montage des routes vit dans ./app.js (source unique, partagée
// avec la suite de tests d'intégration) ; ce fichier se limite à vérifier la base puis
// à ouvrir le port.
import app from "./app.js";
import { env } from "./config/env.js";
import { testDatabase, pool } from "./db.js";
import { migrationsEnAttente } from "./db/migrations.js";

// Bloque le démarrage tant que la connexion PostgreSQL n'est pas confirmée — mieux
// vaut un conteneur qui ne démarre pas du tout (et que `restart: unless-stopped` relance)
// qu'un serveur qui répond 200 sur "/" mais 500 sur toutes les vraies routes.
try {
  await testDatabase();
} catch (err) {
  console.error("❌ PostgreSQL injoignable — arrêt du serveur.", err.message);
  process.exit(1);
}

// Les migrations ne s'appliquent pas toutes seules au démarrage (voir docs/deploiement.md) :
// on prévient bruyamment si le code attend des migrations que la base n'a pas encore, plutôt
// que de laisser des routes échouer une à une. Avertissement seulement, pas d'arrêt.
try {
  const attente = await migrationsEnAttente(pool);
  if (attente.length) {
    console.warn(`⚠️  Migrations en attente sur cette base : ${attente.join(", ")} — lancer « node src/db/migrate.js ».`);
  }
} catch (err) {
  console.warn("⚠️  Impossible de vérifier les migrations en attente :", err.message);
}

app.listen(env.PORT, () => {
  console.log(`✅ Serveur démarré sur le port ${env.PORT}`);
});
