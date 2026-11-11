// Intégration météo (Open-Meteo, https://open-meteo.com — gratuite, sans clé, CC BY 4.0).
// Toujours appelée côté serveur (jamais depuis le frontend), même posture que
// utils/recaptcha.js pour le seul autre appel HTTP externe du projet — sauf que la météo n'a
// pas d'action primaire à protéger : contrairement à recaptcha.js, un échec d'appel externe
// renvoie ici une vraie erreur (502), jamais un repli silencieux avec des données inventées.
import express from 'express';
import { authRequired } from '../middleware/auth.js';
import { pool } from '../db.js';
import { DELAI_API_EXTERNE_MS } from '../config/env.js';

const router = express.Router();

const FORECAST_URL = 'https://api.open-meteo.com/v1/forecast';
const GEOCODING_URL = 'https://geocoding-api.open-meteo.com/v1/search';

const DAILY_PARAMS = [
  'temperature_2m_max', 'temperature_2m_min', 'precipitation_sum',
  'precipitation_probability_max', 'uv_index_max', 'sunrise', 'sunset',
  'daylight_duration', 'et0_fao_evapotranspiration', 'wind_speed_10m_max',
].join(',');
const CURRENT_PARAMS = ['temperature_2m', 'relative_humidity_2m', 'precipitation', 'wind_speed_10m'].join(',');
// Horaire : seule la moyenne des 24 premières heures (aujourd'hui) est utilisée, comme
// indicateur du sol — voir calculerMoyennesSol ci-dessous.
const HOURLY_PARAMS = [
  'soil_temperature_0cm', 'soil_temperature_6cm',
  'soil_moisture_0_to_1cm', 'soil_moisture_3_to_9cm',
  'dew_point_2m', 'vapour_pressure_deficit',
].join(',');

router.get('/villes', authRequired, async (req, res) => {
  const q = (req.query.q || '').trim();
  if (q.length < 2) {
    return res.status(400).json({ error: 'Recherche trop courte (2 caractères minimum).' });
  }
  try {
    const response = await fetch(`${GEOCODING_URL}?name=${encodeURIComponent(q)}&count=5&language=fr`, { signal: AbortSignal.timeout(DELAI_API_EXTERNE_MS) });
    if (!response.ok) throw new Error(`geocoding-api a répondu ${response.status}`);
    const data = await response.json();
    const villes = (data.results || []).map((r) => ({
      nom: r.name,
      pays: r.country || null,
      region: r.admin1 || null,
      latitude: r.latitude,
      longitude: r.longitude,
    }));
    return res.json({ villes });
  } catch (err) {
    console.error('[GET /meteo/villes]', err);
    return res.status(502).json({ error: 'Recherche de ville indisponible pour le moment.' });
  }
});

// Parcelles de l'entreprise appelante ayant leur propre localisation — sert à peupler le
// sélecteur du frontend (MeteoModule).
router.get('/parcelles-localisees', authRequired, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, nom FROM parcelles
       WHERE entreprise_id = $1 AND latitude IS NOT NULL AND longitude IS NOT NULL
       ORDER BY nom`,
      [req.user.entrepriseId]
    );
    return res.json({ parcelles: result.rows });
  } catch (err) {
    console.error('[GET /meteo/parcelles-localisees]', err);
    return res.status(500).json({ error: 'Erreur lors de la récupération.' });
  }
});

// La parcelle (si fournie et qu'elle appartient bien à l'entreprise appelante ET a ses
// propres coordonnées) prime sur la localisation de l'entreprise ; sinon repli automatique.
// Renvoie null si aucune des deux n'est configurée.
async function resoudreLocalisation(entrepriseId, parcelleId) {
  if (parcelleId) {
    const p = await pool.query(
      `SELECT ville, latitude::float8 AS latitude, longitude::float8 AS longitude
       FROM parcelles WHERE id = $1 AND entreprise_id = $2`,
      [parcelleId, entrepriseId]
    );
    if (p.rows[0]?.latitude != null && p.rows[0]?.longitude != null) {
      return { ville: p.rows[0].ville, latitude: p.rows[0].latitude, longitude: p.rows[0].longitude, source: 'parcelle' };
    }
  }
  const e = await pool.query(
    `SELECT ville, latitude::float8 AS latitude, longitude::float8 AS longitude
     FROM entreprises WHERE id = $1`,
    [entrepriseId]
  );
  if (e.rows[0]?.latitude != null && e.rows[0]?.longitude != null) {
    return { ville: e.rows[0].ville, latitude: e.rows[0].latitude, longitude: e.rows[0].longitude, source: 'entreprise' };
  }
  return null;
}

function moyenne(valeurs) {
  const valides = (valeurs || []).filter((v) => typeof v === 'number');
  if (valides.length === 0) return null;
  return Math.round((valides.reduce((a, b) => a + b, 0) / valides.length) * 100) / 100;
}

// Alertes calculées à la volée à partir des 3 prochains jours — jamais persistées, même
// logique que la carte « Alertes importantes » déjà existante sur le tableau de bord (calcul
// live, pas un nouveau système de notifications). Seuils indicatifs et génériques, pas
// calibrés par culture ni par type de sol.
function calculerAlertes(daily, solMoyen) {
  const alertes = [];
  if ((daily.temperature_2m_min || []).slice(0, 3).some((t) => t <= 2)) {
    alertes.push({ type: 'gel', gravite: 'haute', message: 'Risque de gel dans les 3 prochains jours.' });
  }
  if ((daily.precipitation_sum || []).slice(0, 3).some((p) => p > 30)) {
    alertes.push({ type: 'pluie', gravite: 'moyenne', message: 'Fortes précipitations attendues (> 30 mm).' });
  }
  if ((daily.wind_speed_10m_max || []).slice(0, 3).some((v) => v > 50)) {
    alertes.push({ type: 'vent', gravite: 'moyenne', message: 'Vents forts attendus (> 50 km/h).' });
  }
  if ((daily.uv_index_max || []).slice(0, 3).some((u) => u > 8)) {
    alertes.push({ type: 'uv', gravite: 'basse', message: 'Indice UV élevé — protégez les travailleurs en extérieur.' });
  }
  if (solMoyen.soil_moisture_3_to_9cm != null && solMoyen.soil_moisture_3_to_9cm < 0.15) {
    alertes.push({ type: 'secheresse', gravite: 'moyenne', message: 'Sol sec en surface — irrigation à envisager (seuil indicatif).' });
  }
  return alertes;
}

router.get('/', authRequired, async (req, res) => {
  const parcelleId = req.query.parcelleId ? Number(req.query.parcelleId) : null;
  let localisation;
  try {
    localisation = await resoudreLocalisation(req.user.entrepriseId, parcelleId);
  } catch (err) {
    console.error('[GET /meteo] résolution localisation', err);
    return res.status(500).json({ error: 'Erreur lors de la résolution de la localisation.' });
  }
  if (!localisation) {
    return res.status(404).json({ error: "Aucune localisation configurée. Renseignez une ville dans Profil (ou sur la parcelle)." });
  }

  try {
    const url = `${FORECAST_URL}?latitude=${localisation.latitude}&longitude=${localisation.longitude}` +
      `&current=${CURRENT_PARAMS}&daily=${DAILY_PARAMS}&hourly=${HOURLY_PARAMS}` +
      `&forecast_days=14&timezone=auto`;
    const response = await fetch(url, { signal: AbortSignal.timeout(DELAI_API_EXTERNE_MS) });
    if (!response.ok) throw new Error(`Open-Meteo a répondu ${response.status}`);
    const data = await response.json();

    const humiditeRacinaire = moyenne((data.hourly?.soil_moisture_3_to_9cm || []).slice(0, 24));
    const solMoyen = {
      temperatureSurface: moyenne((data.hourly?.soil_temperature_0cm || []).slice(0, 24)),
      temperatureProfondeur: moyenne((data.hourly?.soil_temperature_6cm || []).slice(0, 24)),
      humiditeSurface: moyenne((data.hourly?.soil_moisture_0_to_1cm || []).slice(0, 24)),
      humiditeRacinaire,
    };

    const previsions = (data.daily?.time || []).map((date, i) => ({
      date,
      tempMax: data.daily.temperature_2m_max?.[i] ?? null,
      tempMin: data.daily.temperature_2m_min?.[i] ?? null,
      precipitation: data.daily.precipitation_sum?.[i] ?? null,
      probabilitePrecipitation: data.daily.precipitation_probability_max?.[i] ?? null,
      uvMax: data.daily.uv_index_max?.[i] ?? null,
      vitesseVentMax: data.daily.wind_speed_10m_max?.[i] ?? null,
      leverSoleil: data.daily.sunrise?.[i] ?? null,
      coucherSoleil: data.daily.sunset?.[i] ?? null,
      dureeJourSecondes: data.daily.daylight_duration?.[i] ?? null,
      et0: data.daily.et0_fao_evapotranspiration?.[i] ?? null,
    }));

    return res.json({
      ville: localisation.ville,
      coordonnees: { latitude: localisation.latitude, longitude: localisation.longitude },
      source: localisation.source,
      actuel: {
        temperature: data.current?.temperature_2m ?? null,
        humidite: data.current?.relative_humidity_2m ?? null,
        precipitation: data.current?.precipitation ?? null,
        vent: data.current?.wind_speed_10m ?? null,
      },
      sol: solMoyen,
      previsions,
      alertes: calculerAlertes(data.daily || {}, { soil_moisture_3_to_9cm: humiditeRacinaire }),
      // (calculerAlertes garde son propre nom de clé, indépendant de la forme exposée dans `sol`)
    });
  } catch (err) {
    console.error('[GET /meteo] appel Open-Meteo', err);
    return res.status(502).json({ error: 'Météo indisponible pour le moment.' });
  }
});

export default router;
