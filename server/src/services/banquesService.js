// CRUD des comptes bancaires (banques), utilisé par routes/banques.js — routes/entreprise.js
// lit aussi directement la table `banques` pour le compte bancaire principal de l'entreprise,
// sans passer par ce service.
import { pool } from '../db.js';
import { log } from '../utils/journal.js';

// Non appelée ailleurs dans le code actuellement (routes/banques.js fait son propre
// SELECT inline pour la liste) — gardée telle quelle mais son alias `nom_banque AS
// nomBanque` (sans guillemets) est probablement un bug latent : sans guillemets,
// PostgreSQL renvoie la colonne en minuscules ("nombanque"), pas en camelCase comme
// createBanque/updateBanque juste en dessous, qui eux utilisent `AS "nomBanque"`.
async function getBanque(id, entrepriseId) {
  const query = `
    SELECT b.id, b.nom_banque AS nomBanque, b.iban, b.type_compte AS typeCompte, b.solde
    FROM banques b
    WHERE b.id = $1 AND b.entreprise_id = $2;
  `;
  const result = await pool.query(query, [id, entrepriseId]);
  return result.rows.length > 0 ? result.rows[0] : null;
}

// Appelée depuis POST /banques — crée un compte rattaché à l'entreprise de l'appelant.
async function createBanque(nomBanque, iban, typeCompte, solde, entrepriseId) {
  const query = `
    INSERT INTO banques (entreprise_id, nom_banque, iban, type_compte, solde)
    VALUES ($1, $2, $3, $4, $5)
    RETURNING id, nom_banque AS "nomBanque", iban, type_compte AS "typeCompte", solde;
  `;
  const result = await pool.query(query, [entrepriseId, nomBanque, iban, typeCompte, solde]);
  return result.rows[0];
}

// COALESCE sur chaque champ : un appelant peut passer `undefined`/`null` pour ne
// modifier qu'un sous-ensemble des colonnes sans écraser les autres avec `null`.
async function updateBanque(id, nomBanque, iban, typeCompte, solde, entrepriseId) {
  const query = `
    UPDATE banques b
    SET nom_banque = COALESCE($2, b.nom_banque),
        iban = COALESCE($3, b.iban),
        type_compte = COALESCE($4, b.type_compte),
        solde = COALESCE($5, b.solde)
    WHERE id = $1 AND entreprise_id = $6
    RETURNING id, nom_banque AS "nomBanque", iban, type_compte AS "typeCompte", solde;
  `;
  const result = await pool.query(query, [id, nomBanque, iban, typeCompte, solde, entrepriseId]);
  return result.rows.length > 0 ? result.rows[0] : null;
}

// Transaction explicite même pour une suppression simple : garde la même forme que les
// autres opérations d'écriture de ce service, prêt à accueillir une suppression en
// cascade future (ex: mouvements liés) sans changer la structure de la fonction.
async function deleteBanque(id, entrepriseId) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await client.query('DELETE FROM banques WHERE id = $1 AND entreprise_id = $2', [id, entrepriseId]);
    await client.query('COMMIT');
    // false si 0 ligne (id inexistant ou appartenant à une autre entreprise) — la route
    // en fait un 404, cohérent avec PUT et les autres modules.
    return result.rowCount > 0;
  } catch (err) {
    await client.query('ROLLBACK');
    log.error('[deleteBanque]', err);
    throw err;
  } finally {
    client.release();
  }
}

export default { getBanque, createBanque, updateBanque, deleteBanque };
