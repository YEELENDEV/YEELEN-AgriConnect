// Journal d'audit des mouvements ventes/achats — table `mouvements_historique`, distincte
// de `audit_log` (utils/auditLog.js), qui elle trace des événements sans avant/après
// (connexions, création de compte...). Historiquement écrit par MovementTab (le flux
// cultures_mouvements/poulailler_mouvements), qui est aujourd'hui du code mort — voir
// CLAUDE.md, section "Achats never synced to Finances" : ni les achats via AchatModule
// (achats_documents/achats_lignes) ni les ventes via DevisModule (devis/devis_lignes) ne
// journalisent leurs modifications/suppressions ici. Le bouton "Historique des
// modifications et suppressions" dans ComptabiliteTab lit toujours cette table mais elle
// reste donc vide dans les faits pour tout achat/vente créé après l'ancien flux.
import { pool } from '../db.js';
import { log } from './journal.js';

// Enregistre une action (modification ou suppression) sur un mouvement (vente/achat)
// dans la table d'historique, avec la raison fournie par l'utilisateur et les valeurs
// avant/après pour garder une trace complète en cas de litige ou de contrôle.
export async function logMouvementHistorique(entrepriseId, userId, { module, mouvementId, action, raison, anciennesValeurs, nouvellesValeurs }) {
  try {
    await pool.query(
      `INSERT INTO mouvements_historique (entreprise_id, user_id, module, mouvement_id, action, raison, anciennes_valeurs, nouvelles_valeurs)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [entrepriseId, userId, module, mouvementId, action, raison, JSON.stringify(anciennesValeurs || null), JSON.stringify(nouvellesValeurs || null)]
    );
  } catch (err) {
    log.error('[logMouvementHistorique]', err);
  }
}

// Récupère l'historique des modifications/suppressions pour un mouvement précis
export async function getMouvementHistorique(entrepriseId, module, mouvementId) {
  const result = await pool.query(
    `SELECT mh.id, mh.action, mh.raison, mh.anciennes_valeurs AS "anciennesValeurs",
            mh.nouvelles_valeurs AS "nouvellesValeurs", mh.created_at AS date,
            u.email AS "utilisateurEmail"
     FROM mouvements_historique mh
     LEFT JOIN users u ON u.id = mh.user_id
     WHERE mh.entreprise_id = $1 AND mh.module = $2 AND mh.mouvement_id = $3
     ORDER BY mh.created_at DESC`,
    [entrepriseId, module, mouvementId]
  );
  return result.rows;
}

// Récupère tout l'historique (modifications ET suppressions) d'un module entier,
// utile pour un journal global consultable depuis Comptabilité. Plafonné à 100 lignes
// (pas de pagination) — suffisant tant que la table reste peu alimentée, voir la note
// en tête de fichier sur le fait qu'elle ne l'est plus vraiment aujourd'hui.
export async function getAllMouvementHistorique(entrepriseId, module) {
  const result = await pool.query(
    `SELECT mh.id, mh.mouvement_id AS "mouvementId", mh.action, mh.raison,
            mh.anciennes_valeurs AS "anciennesValeurs", mh.nouvelles_valeurs AS "nouvellesValeurs",
            mh.created_at AS date, u.email AS "utilisateurEmail"
     FROM mouvements_historique mh
     LEFT JOIN users u ON u.id = mh.user_id
     WHERE mh.entreprise_id = $1 AND mh.module = $2
     ORDER BY mh.created_at DESC
     LIMIT 100`,
    [entrepriseId, module]
  );
  return result.rows;
}
