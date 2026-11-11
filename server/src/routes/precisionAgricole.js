// Agriculture de précision — analyse de sol (SoilGrids/ISRIC, gratuit, sans clé) et NDVI
// satellite (Agromonitoring, clé optionnelle AGRO_API_KEY — même posture de repli gracieux
// que recaptcha.js). Toujours côté serveur, jamais d'appel direct depuis le frontend.
import express from 'express';
import { authRequired } from '../middleware/auth.js';
import { pool } from '../db.js';
import { DELAI_API_EXTERNE_MS } from '../config/env.js';
import { classifierTexture, suggererCultures } from '../utils/solAgronomie.js';
import { creerPolygone, SuperficieHorsBornesError } from '../utils/agroPolygon.js';

const router = express.Router();
// HTTPS obligatoire : la clé AGRO_API_KEY voyage dans l'URL (paramètre appid).
const NDVI_HISTORY_URL = 'https://api.agromonitoring.com/agro/1.0/ndvi/history';
const NDVI_HISTORIQUE_JOURS = 90;

const SOILGRIDS_URL = 'https://rest.isric.org/soilgrids/v2.0/properties/query';
const SOIL_PROPERTIES = ['phh2o', 'soc', 'clay', 'sand', 'silt', 'nitrogen', 'cec'];

// d_factor varie par propriété (10 pour la plupart, 100 pour nitrogen — vérifié en direct,
// jamais supposé constant) : toujours lu dans la réponse, jamais codé en dur par propriété.
function extraireValeur(layers, nom) {
  const layer = layers.find((l) => l.name === nom);
  const depth = layer?.depths?.[0];
  const mean = depth?.values?.mean;
  const dFactor = layer?.unit_measure?.d_factor;
  if (mean == null || !dFactor) return null;
  return Math.round((mean / dFactor) * 100) / 100;
}

router.get('/sol', authRequired, async (req, res) => {
  const parcelleId = req.query.parcelleId ? Number(req.query.parcelleId) : null;
  if (!parcelleId) return res.status(400).json({ error: 'parcelleId est requis.' });

  try {
    const parcelle = await pool.query(
      `SELECT latitude::float8 AS latitude, longitude::float8 AS longitude
       FROM parcelles WHERE id = $1 AND entreprise_id = $2`,
      [parcelleId, req.user.entrepriseId]
    );
    if (parcelle.rows.length === 0) return res.status(404).json({ error: 'Parcelle introuvable.' });
    const { latitude, longitude } = parcelle.rows[0];
    if (latitude == null || longitude == null) {
      return res.status(404).json({ error: 'Aucune localisation configurée pour cette parcelle (voir Cultures & irrigation).' });
    }

    const params = SOIL_PROPERTIES.map((p) => `property=${p}`).join('&');
    const url = `${SOILGRIDS_URL}?lon=${longitude}&lat=${latitude}&${params}&depth=0-5cm&value=mean`;
    const response = await fetch(url, { signal: AbortSignal.timeout(DELAI_API_EXTERNE_MS) });
    if (!response.ok) throw new Error(`SoilGrids a répondu ${response.status}`);
    const data = await response.json();
    const layers = data.properties?.layers || [];

    const ph = extraireValeur(layers, 'phh2o');
    const argile = extraireValeur(layers, 'clay');
    const sable = extraireValeur(layers, 'sand');
    const limon = extraireValeur(layers, 'silt');
    const carboneOrganique = extraireValeur(layers, 'soc');
    const azote = extraireValeur(layers, 'nitrogen');
    const cec = extraireValeur(layers, 'cec');

    // SoilGrids répond 200 avec des `mean` à null sur un pixel sans donnée (plan d'eau,
    // zone non couverte) — constaté en réel sur les coordonnées de Bamako (probablement le
    // fleuve Niger, qui la traverse). À distinguer d'un vrai succès, sinon l'UI affiche des
    // tirets vides sans explication.
    if (ph == null && argile == null && sable == null && limon == null) {
      return res.status(404).json({ error: "Aucune donnée de sol disponible à cet endroit précis (probablement un plan d'eau ou une zone non couverte par SoilGrids)." });
    }

    const classe = (argile != null && sable != null && limon != null)
      ? classifierTexture(sable, limon, argile)
      : null;

    return res.json({
      ph,
      texture: { argile, sable, limon, classe },
      carboneOrganique,
      azote,
      cec,
      culturesSuggerees: classe ? suggererCultures(ph, classe) : [],
    });
  } catch (err) {
    console.error('[GET /precision/sol]', err);
    return res.status(502).json({ error: 'Analyse de sol indisponible pour le moment.' });
  }
});

function bandeSante(ndvi) {
  if (ndvi == null) return null;
  if (ndvi < 0.2) return 'sol_nu';
  if (ndvi < 0.4) return 'clairsemee';
  if (ndvi < 0.6) return 'moderee';
  return 'dense';
}

router.get('/ndvi', authRequired, async (req, res) => {
  const parcelleId = req.query.parcelleId ? Number(req.query.parcelleId) : null;
  if (!parcelleId) return res.status(400).json({ error: 'parcelleId est requis.' });

  const appid = process.env.AGRO_API_KEY;
  if (!appid) return res.json({ configured: false });

  try {
    const parcelle = await pool.query(
      `SELECT nom, latitude::float8 AS latitude, longitude::float8 AS longitude,
              superficie::float8 AS superficie, agro_polygon_id AS "agroPolygonId",
              contour
       FROM parcelles WHERE id = $1 AND entreprise_id = $2`,
      [parcelleId, req.user.entrepriseId]
    );
    if (parcelle.rows.length === 0) return res.status(404).json({ error: 'Parcelle introuvable.' });
    const { nom, latitude, longitude, superficie, agroPolygonId, contour } = parcelle.rows[0];
    if (latitude == null || longitude == null) {
      return res.status(404).json({ error: 'Aucune localisation configurée pour cette parcelle (voir Cultures & irrigation).' });
    }

    let polyid = agroPolygonId;
    if (!polyid) {
      polyid = await creerPolygone({ nom, latitude, longitude, superficieHa: superficie, appid, contour });
      await pool.query('UPDATE parcelles SET agro_polygon_id = $1 WHERE id = $2', [polyid, parcelleId]);
    }

    const end = Math.floor(Date.now() / 1000);
    const start = end - NDVI_HISTORIQUE_JOURS * 86400;
    const response = await fetch(
      `${NDVI_HISTORY_URL}?polyid=${encodeURIComponent(polyid)}&start=${start}&end=${end}&appid=${encodeURIComponent(appid)}`,
      { signal: AbortSignal.timeout(DELAI_API_EXTERNE_MS) }
    );
    if (!response.ok) throw new Error(`Agromonitoring (NDVI) a répondu ${response.status}`);
    const lectures = await response.json();

    const historique = (lectures || [])
      .filter((l) => l.data?.mean != null)
      .sort((a, b) => a.dt - b.dt)
      .map((l) => ({
        label: new Date(l.dt * 1000).toISOString().slice(0, 10),
        value: Math.round(l.data.mean * 1000) / 1000,
        nebulosite: l.cl,
      }));
    const derniere = historique[historique.length - 1] || null;

    return res.json({
      configured: true,
      ndviActuel: derniere?.value ?? null,
      dateActuelle: derniere?.label ?? null,
      bande: bandeSante(derniere?.value ?? null),
      historique,
    });
  } catch (err) {
    if (err instanceof SuperficieHorsBornesError) {
      return res.status(400).json({ error: err.message });
    }
    console.error('[GET /precision/ndvi]', err);
    return res.status(502).json({ error: 'Imagerie satellite indisponible pour le moment.' });
  }
});

export default router;
