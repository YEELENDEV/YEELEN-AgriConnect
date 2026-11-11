// Point d'accès unique à PostgreSQL pour tout le backend : chaque fichier de routes/
// services importe `pool` d'ici plutôt que de créer sa propre connexion.
import pg from "pg";
// Chargement des variables d'environnement centralisé dans config/env.js (server/.env puis
// .env racine) — importé ici pour garantir que DB_* sont posées avant la création du pool.
import "./config/env.js";

const { Pool } = pg;

// Pool de connexions PostgreSQL partagé — pg gère lui-même l'ouverture/fermeture
// des connexions individuelles ; on ne se connecte jamais "à la main" ailleurs.
export const pool = new Pool({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT),
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  // Une base injoignable doit faire échouer la requête rapidement plutôt que de bloquer
  // indéfiniment un worker HTTP.
  connectionTimeoutMillis: 10_000,
});

// Une connexion inactive du pool peut être coupée côté serveur (redémarrage de Postgres) :
// sans ce handler, l'événement 'error' non écouté ferait tomber tout le process Node.
pool.on("error", (err) => {
  console.error("[pg pool] connexion inactive en erreur", err.message);
});

// Vérifie au démarrage du serveur que la connexion PostgreSQL fonctionne réellement
// (pas seulement que les variables d'environnement sont présentes). Lève une erreur en cas
// d'échec : server.js s'arrête alors plutôt que de répondre 500 sur toutes les routes.
export async function testDatabase() {
  console.log(`Connexion PostgreSQL : ${process.env.DB_HOST}:${process.env.DB_PORT}/${process.env.DB_NAME}`);
  await pool.query("SELECT 1");
  console.log("✅ PostgreSQL connecté");
}
