// Multi-devise réel, étape 1 : taux de change quotidiens, pivot USD (voir migrate.js pour
// le schéma de currency_rates). API gratuite, sans clé — voir le plan/journal pour la
// vérification en direct (couverture XOF/XAF confirmée, mise à jour une fois par jour).
// Attribution requise par les conditions d'utilisation : à afficher dès qu'une UI montre un
// taux/une conversion (pas encore le cas à cette étape, purement backend).
import { pool } from '../db.js';
import { DELAI_API_EXTERNE_MS } from '../config/env.js';

const RATES_URL = 'https://open.er-api.com/v6/latest/USD';

export class DeviseInconnueError extends Error {}

export async function rafraichirTauxDuJour() {
  const response = await fetch(RATES_URL, { signal: AbortSignal.timeout(DELAI_API_EXTERNE_MS) });
  if (!response.ok) throw new Error(`open.er-api.com a répondu ${response.status}`);
  const data = await response.json();
  if (data.result !== 'success' || !data.rates) throw new Error('Réponse open.er-api.com inattendue.');

  const today = new Date().toISOString().slice(0, 10);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const [devise, taux] of Object.entries(data.rates)) {
      await client.query(
        `INSERT INTO currency_rates (devise, taux_vs_usd, date)
         VALUES ($1, $2, $3)
         ON CONFLICT (devise, date) DO UPDATE SET taux_vs_usd = EXCLUDED.taux_vs_usd`,
        [devise, taux, today]
      );
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
  return today;
}

// Taux vs USD le plus récent à la date donnée (ou avant) — repli naturel les jours où
// l'API n'a pas republié (weekends, jours fériés côté fournisseur).
async function tauxVsUsd(devise, date) {
  const { rows } = await pool.query(
    `SELECT taux_vs_usd::float8 AS taux, to_char(date, 'YYYY-MM-DD') AS date FROM currency_rates
     WHERE devise = $1 AND date <= $2
     ORDER BY date DESC LIMIT 1`,
    [devise, date]
  );
  return rows[0] || null;
}

export async function obtenirTaux(devise, date = new Date().toISOString().slice(0, 10)) {
  let row = await tauxVsUsd(devise, date);
  if (!row) {
    // Rien en base pour cette devise à cette date (première utilisation, ou base jamais
    // rafraîchie) : un seul essai de rafraîchissement paresseux, pas de boucle.
    await rafraichirTauxDuJour();
    row = await tauxVsUsd(devise, date);
  }
  if (!row) throw new DeviseInconnueError(`Devise inconnue ou non couverte : ${devise}.`);
  return row;
}

export async function convertir(montant, deviseSource, deviseCible, date = new Date().toISOString().slice(0, 10)) {
  if (deviseSource === deviseCible) return { montant, taux: 1, date };
  const [source, cible] = await Promise.all([obtenirTaux(deviseSource, date), obtenirTaux(deviseCible, date)]);
  const taux = cible.taux / source.taux;
  return { montant: Math.round(montant * taux * 100) / 100, taux, date: source.date < cible.date ? source.date : cible.date };
}
