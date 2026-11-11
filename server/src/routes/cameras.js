// Surveillance — registre des caméras de l'exploitation.
//
// Ce module ne stocke AUCUNE vidéo et n'en relaie aucune : le serveur ne fait que garder la
// liste des caméras et la façon dont chacune s'affiche. C'est le navigateur de l'utilisateur
// qui va chercher l'image directement auprès de la caméra — l'enregistrement et la
// conservation restent du ressort du matériel ou du NVR de l'entreprise.
//
// Conséquence à connaître : une caméra sur le réseau local n'est joignable que depuis ce
// réseau. L'application n'y peut rien, c'est une question d'accès réseau, pas de code.
import crypto from 'crypto';
import express from 'express';
import { authRequired } from '../middleware/auth.js';
import { pool } from '../db.js';

const router = express.Router();

const CAMERA_COLUMNS = `
  id, entreprise_id AS "entrepriseId", nom, emplacement,
  emplacement_type AS "emplacementType", emplacement_id AS "emplacementId",
  type_flux AS "typeFlux", url, rafraichissement, actif, notes,
  token_alerte AS "tokenAlerte", created_at AS "createdAt"
`;

const TYPES_FLUX = ['snapshot', 'mjpeg', 'hls', 'lien'];
const TYPES_EMPLACEMENT = ['cultures', 'poulailler', 'pisciculture', 'parcelle', 'autre'];

// Une URL de caméra est saisie à la main et finit dans un <img src>. On refuse tout ce qui
// n'est pas http(s) : `javascript:` ou `data:` y seraient une injection, et `rtsp://` ne
// s'affiche dans aucun navigateur — mieux vaut le dire à la saisie qu'afficher un cadre vide.
// Intervalle de rafraîchissement. Bornes larges mais réelles : sous 2 s on martèle la
// caméra, au-delà de 5 min ce n'est plus de la surveillance. Un champ absent retombe sur le
// défaut ; une valeur hors bornes est ramenée dans les bornes — deux cas distincts, que
// `Number(x) || defaut` confondait puisque 0 est falsy.
function normaliserRafraichissement(valeur, defaut = 10) {
  if (valeur === undefined || valeur === null || valeur === '') return defaut;
  const n = Number(valeur);
  if (!Number.isFinite(n)) return defaut;
  return Math.min(300, Math.max(2, Math.round(n)));
}

function verifierUrl(url) {
  if (!url || !String(url).trim()) return 'L’adresse de la caméra est requise.';
  let parsed;
  try {
    parsed = new URL(String(url).trim());
  } catch {
    return 'L’adresse de la caméra n’est pas une URL valide.';
  }
  if (parsed.protocol === 'rtsp:') {
    return 'Le RTSP ne peut pas s’afficher dans un navigateur. Utilisez l’adresse d’image (snapshot), MJPEG ou HLS de la caméra.';
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return 'Seules les adresses http:// et https:// sont acceptées.';
  }
  return null;
}

router.get('/', authRequired, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT ${CAMERA_COLUMNS} FROM cameras WHERE entreprise_id = $1 ORDER BY nom ASC`,
      [req.user.entrepriseId]
    );
    return res.json({ cameras: rows });
  } catch (err) {
    console.error('[GET /cameras]', err);
    return res.status(500).json({ error: 'Erreur lors de la récupération des caméras.' });
  }
});

router.post('/', authRequired, async (req, res) => {
  const { nom, emplacement, emplacementType, emplacementId, typeFlux, url, rafraichissement, notes } = req.body;
  if (!nom || !String(nom).trim()) return res.status(400).json({ error: 'Le nom de la caméra est requis.' });
  const erreurUrl = verifierUrl(url);
  if (erreurUrl) return res.status(400).json({ error: erreurUrl });
  if (typeFlux && !TYPES_FLUX.includes(typeFlux)) return res.status(400).json({ error: 'Type de flux invalide.' });
  if (emplacementType && !TYPES_EMPLACEMENT.includes(emplacementType)) {
    return res.status(400).json({ error: 'Type d’emplacement invalide.' });
  }
  try {
    const { rows } = await pool.query(
      `INSERT INTO cameras (entreprise_id, user_id, nom, emplacement, emplacement_type, emplacement_id,
                            type_flux, url, rafraichissement, notes, token_alerte)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING ${CAMERA_COLUMNS}`,
      [req.user.entrepriseId, req.user.sub, String(nom).trim(), emplacement || null,
       emplacementType || null, emplacementId || null, typeFlux || 'snapshot', String(url).trim(),
       normaliserRafraichissement(rafraichissement), notes || null, crypto.randomBytes(24).toString('hex')]
    );
    return res.status(201).json({ camera: rows[0] });
  } catch (err) {
    console.error('[POST /cameras]', err);
    return res.status(500).json({ error: 'Erreur lors de la création de la caméra.' });
  }
});

router.put('/:id', authRequired, async (req, res) => {
  const { nom, emplacement, emplacementType, emplacementId, typeFlux, url, rafraichissement, actif, notes } = req.body;
  if (url !== undefined) {
    const erreurUrl = verifierUrl(url);
    if (erreurUrl) return res.status(400).json({ error: erreurUrl });
  }
  if (typeFlux && !TYPES_FLUX.includes(typeFlux)) return res.status(400).json({ error: 'Type de flux invalide.' });
  try {
    const { rows } = await pool.query(
      `UPDATE cameras SET
         nom = COALESCE($1, nom), emplacement = COALESCE($2, emplacement),
         emplacement_type = COALESCE($3, emplacement_type), emplacement_id = COALESCE($4, emplacement_id),
         type_flux = COALESCE($5, type_flux), url = COALESCE($6, url),
         rafraichissement = COALESCE($7, rafraichissement), actif = COALESCE($8, actif),
         notes = COALESCE($9, notes)
       WHERE id = $10 AND entreprise_id = $11 RETURNING ${CAMERA_COLUMNS}`,
      [nom || null, emplacement || null, emplacementType || null, emplacementId || null,
       typeFlux || null, url || null,
       rafraichissement == null ? null : normaliserRafraichissement(rafraichissement),
       actif == null ? null : !!actif, notes || null, req.params.id, req.user.entrepriseId]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Caméra introuvable.' });
    return res.json({ camera: rows[0] });
  } catch (err) {
    console.error('[PUT /cameras/:id]', err);
    return res.status(500).json({ error: 'Erreur lors de la mise à jour de la caméra.' });
  }
});

router.delete('/:id', authRequired, async (req, res) => {
  try {
    const { rowCount } = await pool.query(
      'DELETE FROM cameras WHERE id = $1 AND entreprise_id = $2',
      [req.params.id, req.user.entrepriseId]
    );
    if (rowCount === 0) return res.status(404).json({ error: 'Caméra introuvable.' });
    return res.json({ success: true });
  } catch (err) {
    console.error('[DELETE /cameras/:id]', err);
    return res.status(500).json({ error: 'Erreur lors de la suppression de la caméra.' });
  }
});

// ─── Alertes de mouvement ──────────────────────────────────────────────────
//
// POST /api/cameras/alertes/:token — appelé par la CAMÉRA, pas par un utilisateur. Aucune
// authentification classique n'est possible ici : une caméra ne porte pas de JWT. Le secret
// est donc le token de l'URL — 24 octets aléatoires, propre à chaque caméra et régénérable,
// pour pouvoir en révoquer une seule sans toucher aux autres.
//
// GET est accepté autant que POST : beaucoup de caméras grand public ne savent appeler
// qu'une URL, sans choisir la méthode ni envoyer de corps.
//
// Regroupement : une caméra en détection continue peut émettre des dizaines d'appels par
// minute. Plutôt qu'une ligne par appel, on incrémente la dernière alerte de la même caméra
// tant qu'elle est récente — une nuit de vent ne noie pas le journal, et le nombre réel de
// détections reste visible.
const FENETRE_REGROUPEMENT_SECONDES = 120;

async function enregistrerAlerte(req, res) {
  const { token } = req.params;
  if (!token || token.length < 20) return res.status(404).json({ error: 'Caméra inconnue.' });
  try {
    const cam = await pool.query(
      'SELECT id, entreprise_id AS \"entrepriseId\", actif FROM cameras WHERE token_alerte = $1',
      [token]
    );
    if (cam.rows.length === 0) return res.status(404).json({ error: 'Caméra inconnue.' });
    const camera = cam.rows[0];
    // Une caméra désactivée cesse d'alimenter le journal sans qu'il faille toucher à sa
    // configuration ni révoquer son token.
    if (!camera.actif) return res.json({ ignoree: true });

    const type = String(req.query.type || req.body?.type || 'mouvement').slice(0, 40);
    const message = req.query.message || req.body?.message || null;

    const recente = await pool.query(
      `SELECT id FROM camera_alertes
        WHERE camera_id = $1 AND type = $2
          AND derniere_occurrence > now() - make_interval(secs => $3)
        ORDER BY derniere_occurrence DESC LIMIT 1`,
      [camera.id, type, FENETRE_REGROUPEMENT_SECONDES]
    );
    if (recente.rows.length > 0) {
      await pool.query(
        `UPDATE camera_alertes SET occurrences = occurrences + 1,
                derniere_occurrence = now(), vue = FALSE WHERE id = $1`,
        [recente.rows[0].id]
      );
      return res.json({ regroupee: true });
    }

    await pool.query(
      `INSERT INTO camera_alertes (entreprise_id, camera_id, type, message)
       VALUES ($1,$2,$3,$4)`,
      [camera.entrepriseId, camera.id, type, message ? String(message).slice(0, 500) : null]
    );
    // Purge à l'insertion plutôt que par une tâche planifiée : le journal ne doit pas croître
    // indéfiniment, et la requête est indexée et bornée à cette seule caméra.
    await pool.query(
      `DELETE FROM camera_alertes WHERE camera_id = $1
        AND created_at < now() - interval '90 days'`,
      [camera.id]
    );
    return res.status(201).json({ enregistree: true });
  } catch (err) {
    console.error('[alerte caméra]', err);
    return res.status(500).json({ error: 'Erreur lors de l’enregistrement de l’alerte.' });
  }
}

router.post('/alertes/:token', enregistrerAlerte);
router.get('/alertes/:token', enregistrerAlerte);

// Journal côté utilisateur. Déclaré APRÈS /alertes/:token, qui est plus spécifique.
router.get('/alertes', authRequired, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT a.id, a.camera_id AS \"cameraId\", c.nom AS \"cameraNom\",
              c.emplacement, c.emplacement_type AS \"emplacementType\",
              a.type, a.message, a.occurrences, a.vue,
              a.created_at AS \"createdAt\", a.derniere_occurrence AS \"derniereOccurrence\"
       FROM camera_alertes a JOIN cameras c ON c.id = a.camera_id
       WHERE a.entreprise_id = $1
       ORDER BY a.derniere_occurrence DESC LIMIT 200`,
      [req.user.entrepriseId]
    );
    return res.json({ alertes: rows });
  } catch (err) {
    console.error('[GET /cameras/alertes]', err);
    return res.status(500).json({ error: 'Erreur lors de la récupération des alertes.' });
  }
});

router.post('/alertes/:id/vue', authRequired, async (req, res) => {
  try {
    const { rowCount } = await pool.query(
      'UPDATE camera_alertes SET vue = TRUE WHERE id = $1 AND entreprise_id = $2',
      [req.params.id, req.user.entrepriseId]
    );
    if (rowCount === 0) return res.status(404).json({ error: 'Alerte introuvable.' });
    return res.json({ success: true });
  } catch (err) {
    console.error('[POST /cameras/alertes/:id/vue]', err);
    return res.status(500).json({ error: 'Erreur lors de la mise à jour de l’alerte.' });
  }
});

// Régénérer le token révoque immédiatement l’ancienne URL : à utiliser si elle a fuité.
router.post('/:id/regenerer-token', authRequired, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `UPDATE cameras SET token_alerte = $1 WHERE id = $2 AND entreprise_id = $3
       RETURNING ${CAMERA_COLUMNS}`,
      [crypto.randomBytes(24).toString('hex'), req.params.id, req.user.entrepriseId]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Caméra introuvable.' });
    return res.json({ camera: rows[0] });
  } catch (err) {
    console.error('[POST /cameras/:id/regenerer-token]', err);
    return res.status(500).json({ error: 'Erreur lors de la régénération du token.' });
  }
});

export default router;
