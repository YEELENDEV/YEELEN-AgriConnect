// Recherche globale (Ctrl+K) — inspirée d'une palette de commandes de référence
// (addons/web/static/src/core/commands côté client web open source), version
// minimale : cherche par nom dans les 3 ressources les plus consultées au
// quotidien (contacts, produits, devis), scopée par entreprise_id comme
// partout ailleurs dans l'app.
//
// La route interroge trois ressources d'un coup : elle est donc hors du catalogue de
// permissions (une seule ressource par route), mais CHAQUE groupe de résultats est filtré selon
// le droit « lire » de sa ressource. Sans ce filtre, un rôle privé de la lecture des devis les
// retrouvait par la recherche.
import express from 'express';
import { authRequired } from '../middleware/auth.js';
import { pool } from '../db.js';
import { restrictionsUtilisateur, autoriseUtilisateur } from '../utils/rolesService.js';

const router = express.Router();
const AUCUN = { rows: [] };

router.get('/', authRequired, async (req, res) => {
  const q = String(req.query.q || '').trim().slice(0, 100);
  if (q.length < 2) {
    return res.json({ contacts: [], produits: [], devis: [] });
  }
  // Les jokers ILIKE saisis par l'utilisateur sont traités comme du texte.
  const like = `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
  try {
    const resolution = await restrictionsUtilisateur(req.user.entrepriseId, req.user.sub);
    const peutLire = (ressource) => autoriseUtilisateur(resolution, ressource, 'lire');

    const [contacts, produits, devis] = await Promise.all([
      !peutLire('contacts') ? AUCUN : pool.query(
        `SELECT id, nom, prenom, email, telephone, est_client AS "estClient", est_fournisseur AS "estFournisseur"
         FROM contacts
         WHERE entreprise_id = $1 AND (nom ILIKE $2 OR prenom ILIKE $2 OR email ILIKE $2 OR telephone ILIKE $2)
         ORDER BY nom ASC LIMIT 8`,
        [req.user.entrepriseId, like]
      ),
      !peutLire('produits') ? AUCUN : pool.query(
        `SELECT id, module, nom FROM produits WHERE entreprise_id = $1 AND nom ILIKE $2 ORDER BY nom ASC LIMIT 8`,
        [req.user.entrepriseId, like]
      ),
      !peutLire('devis') ? AUCUN : pool.query(
        `SELECT d.id, d.numero, d.statut, d.total::float8 AS total, d.client_id AS "clientId",
                c.nom AS "clientNom", c.prenom AS "clientPrenom"
         FROM devis d LEFT JOIN contacts c ON c.id = d.client_id
         WHERE d.entreprise_id = $1 AND (d.numero ILIKE $2 OR c.nom ILIKE $2 OR c.prenom ILIKE $2)
         ORDER BY d.id DESC LIMIT 8`,
        [req.user.entrepriseId, like]
      ),
    ]);
    return res.json({ contacts: contacts.rows, produits: produits.rows, devis: devis.rows });
  } catch (err) {
    console.error('[GET /recherche]', err);
    return res.status(500).json({ error: 'Erreur lors de la recherche.' });
  }
});

export default router;
