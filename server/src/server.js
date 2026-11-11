// Point d'entrée réel du backend Express — celui que docker-compose et `npm run dev`/
// `npm start` lancent. Le montage des routes vit dans ./app.js (source unique, partagée
// avec la suite de tests d'intégration) ; ce fichier se limite à vérifier la base puis
// à ouvrir le port.
import app from "./app.js";
import { env } from "./config/env.js";
import { testDatabase } from "./db.js";

// Bloque le démarrage tant que la connexion PostgreSQL n'est pas confirmée — mieux
// vaut un conteneur qui ne démarre pas du tout (et que `restart: unless-stopped` relance)
// qu'un serveur qui répond 200 sur "/" mais 500 sur toutes les vraies routes.
try {
  await testDatabase();
} catch (err) {
  console.error("❌ PostgreSQL injoignable — arrêt du serveur.", err.message);
  process.exit(1);
}

app.listen(env.PORT, () => {
  console.log(`✅ Serveur démarré sur le port ${env.PORT}`);
});
