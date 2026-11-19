// Journal des modifications (chatter) — voir server/src/db/socle.js pour le schéma et
// le contexte (inspiré d'un suivi de champ standard, en plus simple : une ligne par
// mise à jour listant tous les champs changés, pas une ligne par champ).
import { pool } from '../db.js';

// Compare oldRow/newRow sur les seuls champs listés dans trackedFields, insère une ligne
// dans journal_modifications uniquement si au moins un a réellement changé. Catch-and-log
// plutôt que de faire échouer l'action métier appelante — même posture que financeSync.js
// et stockSync.js : le journal est un à-côté, pas une condition de succès de l'action.
export async function logFieldChanges(entrepriseId, ressourceType, ressourceId, userId, oldRow, newRow, trackedFields) {
  try {
    const changements = [];
    for (const champ of trackedFields) {
      const ancienne = oldRow[champ] ?? null;
      const nouvelle = newRow[champ] ?? null;
      if (String(ancienne) !== String(nouvelle)) {
        changements.push({ champ, ancienne, nouvelle });
      }
    }
    if (changements.length === 0) return;

    await pool.query(
      `INSERT INTO journal_modifications (entreprise_id, ressource_type, ressource_id, user_id, changements)
       VALUES ($1, $2, $3, $4, $5)`,
      [entrepriseId, ressourceType, ressourceId, userId, JSON.stringify(changements)]
    );
  } catch (err) {
    console.error('[logFieldChanges]', err);
  }
}

export async function getJournal(ressourceType, ressourceId, entrepriseId) {
  const result = await pool.query(
    `SELECT jm.id, jm.changements, jm.created_at AS "createdAt", u.email AS "userEmail"
     FROM journal_modifications jm
     LEFT JOIN users u ON u.id = jm.user_id
     WHERE jm.ressource_type = $1 AND jm.ressource_id = $2 AND jm.entreprise_id = $3
     ORDER BY jm.created_at DESC`,
    [ressourceType, ressourceId, entrepriseId]
  );
  return result.rows;
}
