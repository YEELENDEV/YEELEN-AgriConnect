// CRUD des comptes bancaires — la liste (GET) fait sa propre requête inline (avec un
// alias camelCase soigné, BANQUE_COLUMNS), tandis que POST/PUT/DELETE délèguent à
// banquesService.js. getBanque (dans le service) n'est jamais appelé ici : la lecture
// passe uniquement par ce GET / inline.
import express from 'express';
import { authRequired } from '../middleware/auth.js';
import { pool } from '../db.js';
import banquesService from '../services/banquesService.js';

// Les écritures (création/édition/suppression d'un compte bancaire) sont réservées à
// admin/directeur — même posture que les écritures financières de business.js. La
// lecture (GET /) reste ouverte à tous les rôles authentifiés.
const ecriture = [authRequired];

const router = express.Router();

// Alias explicitement entre guillemets pour préserver le camelCase attendu par le
// frontend (sans guillemets, PostgreSQL renvoie les alias en minuscules).
const BANQUE_COLUMNS = `
  id, nom_banque AS "nomBanque", iban, type_compte AS "typeCompte",
  solde::float8 AS solde, created_at AS "createdAt"
`;

// Liste toutes les banques de l'entreprise de l'appelant — pas de pagination, le
// nombre de comptes bancaires d'une entreprise reste toujours faible.
router.get('/', authRequired, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT ${BANQUE_COLUMNS} FROM banques WHERE entreprise_id = $1 ORDER BY id ASC`,
      [req.user.entrepriseId]
    );
    return res.json({ banques: result.rows });
  } catch (err) {
    console.error('[GET /banques]', err);
    return res.status(500).json({ error: 'Erreur lors de la récupération des banques.' });
  }
});

router.post('/', ...ecriture, async (req, res) => {
  const { nomBanque, iban, typeCompte, solde = 0 } = req.body;
  if (!nomBanque) {
    return res.status(400).json({ error: 'Le nom de la banque est requis.' });
  }
  try {
    const newBanque = await banquesService.createBanque(nomBanque, iban, typeCompte, solde, req.user.entrepriseId);
    return res.status(201).json({ banque_id: newBanque.id });
  } catch (err) {
    console.error('[POST /banques]', err);
    return res.status(500).json({ error: 'Erreur lors de la création.' });
  }
});

// Non exercée depuis l'UI actuellement (updateBanque n'a pas encore d'appelant côté
// frontend — voir CLAUDE.md) : son RETURNING renvoie les colonnes en snake_case brut
// (nom_banque, type_compte), pas en camelCase — inoffensif tant que rien ne consomme
// updatedBanque, mais à corriger dans banquesService.js si un formulaire d'édition de
// compte bancaire est construit un jour dessus.
router.put('/:id', ...ecriture, async (req, res) => {
  const { nomBanque, iban, typeCompte, solde } = req.body;
  try {
    const updatedBanque = await banquesService.updateBanque(req.params.id, nomBanque, iban, typeCompte, solde, req.user.entrepriseId);
    if (!updatedBanque) return res.status(404).json({ error: 'Compte bancaire introuvable.' });
    return res.json({ banque: updatedBanque });
  } catch (err) {
    console.error('[PUT /banques]', err);
    return res.status(500).json({ error: 'Erreur lors de la mise à jour.' });
  }
});

router.delete('/:id', ...ecriture, async (req, res) => {
  try {
    const deleted = await banquesService.deleteBanque(req.params.id, req.user.entrepriseId);
    if (!deleted) return res.status(404).json({ error: 'Compte bancaire introuvable.' });
    return res.json({ success: true });
  } catch (err) {
    console.error('[DELETE /banques]', err);
    return res.status(500).json({ error: 'Erreur lors de la suppression.' });
  }
});

export default router;
