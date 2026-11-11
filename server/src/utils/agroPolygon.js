// Polygone Agromonitoring pour une parcelle — l'app n'a aucune brique cartographique pour
// dessiner le contour réel d'un champ (voir la note sur ParcelMapTab dans le plan), donc un
// carré approximatif est construit à partir de latitude/longitude/superficie de la parcelle
// (projection équirectangulaire, valable pour la petite échelle d'un champ). Créé une seule
// fois par parcelle et mis en cache dans parcelles.agro_polygon_id — voir routes/cultures.js
// (PUT /parcelles/:id) pour l'invalidation quand la localisation/superficie change.
import { DELAI_API_EXTERNE_MS } from '../config/env.js';

// HTTPS obligatoire : la clé AGRO_API_KEY voyage dans l'URL (paramètre appid).
const POLYGONS_URL = 'https://api.agromonitoring.com/agro/1.0/polygons';
const KM_PAR_DEGRE_LAT = 111.32;
const SUPERFICIE_MIN_HA = 1;
const SUPERFICIE_MAX_HA = 3000;

export class SuperficieHorsBornesError extends Error {}

// Anneau fermé (5 points, sens antihoraire) approximant un carré de `superficieHa` hectares
// centré sur (latitude, longitude).
export function construirePolygoneCarre(latitude, longitude, superficieHa) {
  const coteKm = Math.sqrt(superficieHa * 0.01);
  const demiCote = coteKm / 2;
  const dLat = demiCote / KM_PAR_DEGRE_LAT;
  const dLon = demiCote / (KM_PAR_DEGRE_LAT * Math.cos((latitude * Math.PI) / 180));
  return [
    [longitude - dLon, latitude - dLat],
    [longitude + dLon, latitude - dLat],
    [longitude + dLon, latitude + dLat],
    [longitude - dLon, latitude + dLat],
    [longitude - dLon, latitude - dLat],
  ];
}

// Crée le polygone côté Agromonitoring et renvoie son polyid — n'écrit PAS en base,
// l'appelant (routes/precisionAgricole.js) est responsable de mettre à jour
// parcelles.agro_polygon_id une fois la création confirmée.
export async function creerPolygone({ nom, latitude, longitude, superficieHa, appid, contour }) {
  if (!superficieHa || superficieHa < SUPERFICIE_MIN_HA || superficieHa > SUPERFICIE_MAX_HA) {
    throw new SuperficieHorsBornesError(
      `La superficie doit être renseignée et comprise entre ${SUPERFICIE_MIN_HA} et ${SUPERFICIE_MAX_HA} ha pour l'imagerie satellite.`
    );
  }
  // Le contour tracé prime : c'est la parcelle réelle. Le carré approximatif ne subsiste que
  // pour les parcelles jamais dessinées, où il reste préférable à pas d'imagerie du tout.
  const anneau = contour?.coordinates?.[0];
  const coordinates = anneau?.length
    ? [anneau]
    : [construirePolygoneCarre(latitude, longitude, superficieHa)];
  const response = await fetch(`${POLYGONS_URL}?appid=${encodeURIComponent(appid)}`, {
    method: 'POST',
    signal: AbortSignal.timeout(DELAI_API_EXTERNE_MS),
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: nom,
      geo_json: { type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates } },
    }),
  });
  if (!response.ok) throw new Error(`Agromonitoring (création polygone) a répondu ${response.status}`);
  const data = await response.json();
  return data.id;
}

// Suppression best-effort — un polygone orphelin côté Agromonitoring n'a aucun impact
// fonctionnel côté YEELEN, ne jamais faire échouer l'appelant pour ça.
export async function supprimerPolygone(polyid, appid) {
  if (!polyid || !appid) return;
  try {
    await fetch(`${POLYGONS_URL}/${encodeURIComponent(polyid)}?appid=${encodeURIComponent(appid)}`, {
      method: 'DELETE', signal: AbortSignal.timeout(DELAI_API_EXTERNE_MS),
    });
  } catch (err) {
    console.error('[agroPolygon] suppression best-effort échouée', err.message);
  }
}
