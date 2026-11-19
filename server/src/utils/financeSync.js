// Point unique de synchronisation automatique vers la table `finances` : chaque vente,
// achat ou paiement de facture enregistré ailleurs dans l'app (Cultures, Poulailler,
// Devis, Achats) passe par une des fonctions de ce fichier pour se refléter dans
// Finances. Il n'existe aucun trigger PostgreSQL pour ça — la cohérence financière
// entre modules dépend entièrement du fait que chaque route appelle bien la bonne
// fonction ici au bon moment.
//
// Convention de signe pour `montant` : positif pour une vente/un paiement reçu, négatif
// pour un achat — c'est ce signe (et non `categorie`, qui vaut toujours "Banque" ou
// "Caisse" ici) qui distingue une dépense d'un revenu pour les entrées auto-synchronisées.
// Différent de la convention des lignes saisies manuellement dans Finances, où `montant`
// est toujours positif et c'est `categorie` qui porte l'information dépense/revenu — voir
// `isDepenseEntry` dans src/modules/finances.jsx, qui doit gérer les deux conventions à
// la fois pour classer correctement l'affichage.
//
// Toutes les fonctions ci-dessous avalent leurs erreurs (try/catch + log.error sans
// relancer) : un échec de synchronisation financière ne doit jamais faire échouer
// l'opération métier principale (créer l'achat/la vente reste prioritaire), mais cela
// signifie aussi qu'un échec silencieux peut désynchroniser Finances sans que personne
// ne le remarque — pas d'alerte automatique en place à ce jour.
import { pool } from '../db.js';
import { log } from './journal.js';

// Crée automatiquement une entrée dans "finances" pour une vente ou un achat
// enregistré depuis Poulailler ou Cultures (mécanisme ligne-par-ligne, via
// cultures_mouvements/poulailler_mouvements — voir syncAchatDocumentFinance
// ci-dessous pour l'équivalent "document multi-lignes" utilisé par AchatModule).
// L'argent est désormais versé directement sur le compte bancaire principal de
// l'entreprise (défini par l'admin), au lieu d'aller systématiquement en Caisse.
export async function syncFinanceEntry(entrepriseId, userId, { type, module, produit, partenaire, quantite, prixUnitaire, remise, mouvementId }) {
  const total = Math.max(0, Number(quantite) * Number(prixUnitaire) - (Number(remise) || 0));
  const montant = type === 'vente' ? total : -total;
  const description = `${type === 'vente' ? 'Vente' : 'Achat'} ${produit} — ${partenaire} (${module})`;

  try {
    // Récupère le compte bancaire principal défini par l'admin de l'entreprise
    const entrepriseResult = await pool.query(
      'SELECT banque_principale_id FROM entreprises WHERE id = $1',
      [entrepriseId]
    );
    const banquePrincipaleId = entrepriseResult.rows[0]?.banque_principale_id || null;

    // Si un compte principal est défini, la transaction est catégorisée "Banque"
    // et rattachée à ce compte. Sinon (aucun compte configuré), on retombe sur
    // "Caisse" comme avant, pour ne rien casser tant que l'admin n'a rien choisi.
    const categorie = banquePrincipaleId ? 'Banque' : 'Caisse';

    await pool.query(
      `INSERT INTO finances (entreprise_id, user_id, type, montant, description, source_module, source_mouvement_id, banque_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [entrepriseId, userId, categorie, montant, description, module, mouvementId, banquePrincipaleId]
    );
  } catch (err) {
    log.error('[syncFinanceEntry]', err);
  }
}

// Met à jour l'entrée "finances" existante liée à un mouvement (vente/achat)
// déjà corrigé, au lieu de la supprimer et recréer — préserve l'historique.
// Retrouve la ligne via le couple (source_module, source_mouvement_id), pas par
// un id propre à `finances` : c'est cette paire qui fait office de clé de rapprochement.
export async function updateFinanceEntry(entrepriseId, module, mouvementId, { type, produit, partenaire, quantite, prixUnitaire, remise }) {
  const total = Math.max(0, Number(quantite) * Number(prixUnitaire) - (Number(remise) || 0));
  const montant = type === 'vente' ? total : -total;
  const description = `${type === 'vente' ? 'Vente' : 'Achat'} ${produit} — ${partenaire} (${module})`;

  try {
    await pool.query(
      `UPDATE finances SET montant = $1, description = $2
       WHERE entreprise_id = $3 AND source_module = $4 AND source_mouvement_id = $5`,
      [montant, description, entrepriseId, module, mouvementId]
    );
  } catch (err) {
    log.error('[updateFinanceEntry]', err);
  }
}

// Version "document multi-lignes" de syncFinanceEntry, pour les achats enregistrés via
// AchatModule (achats_documents/achats_lignes) — le montant est déjà le total du document,
// pas à recalculer depuis une seule ligne quantite/prixUnitaire (un document peut avoir
// plusieurs lignes de produits différents, il n'y a donc pas de quantite/prixUnitaire
// unique à ce niveau).
export async function syncAchatDocumentFinance(entrepriseId, userId, { module, total, fournisseurNom, documentId }) {
  const montant = -Math.max(0, Number(total) || 0);
  const description = `Achat — ${fournisseurNom || 'Fournisseur'} (${module})`;

  try {
    const entrepriseResult = await pool.query(
      'SELECT banque_principale_id FROM entreprises WHERE id = $1',
      [entrepriseId]
    );
    const banquePrincipaleId = entrepriseResult.rows[0]?.banque_principale_id || null;
    const categorie = banquePrincipaleId ? 'Banque' : 'Caisse';

    await pool.query(
      `INSERT INTO finances (entreprise_id, user_id, type, montant, description, source_module, source_mouvement_id, banque_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [entrepriseId, userId, categorie, montant, description, module, documentId, banquePrincipaleId]
    );
  } catch (err) {
    log.error('[syncAchatDocumentFinance]', err);
  }
}

// Pendant de updateFinanceEntry pour le flux "document multi-lignes" : appelée quand un
// achats_documents existant est modifié (PUT /api/achats/:id), pour garder l'entrée
// finances correspondante en phase avec le nouveau total plutôt que de la dupliquer.
export async function updateAchatDocumentFinance(entrepriseId, module, documentId, { total, fournisseurNom }) {
  const montant = -Math.max(0, Number(total) || 0);
  const description = `Achat — ${fournisseurNom || 'Fournisseur'} (${module})`;

  try {
    await pool.query(
      `UPDATE finances SET montant = $1, description = $2
       WHERE entreprise_id = $3 AND source_module = $4 AND source_mouvement_id = $5`,
      [montant, description, entrepriseId, module, documentId]
    );
  } catch (err) {
    log.error('[updateAchatDocumentFinance]', err);
  }
}

// Supprime l'entrée finances liée à un mouvement/document quand celui-ci est
// lui-même supprimé (DELETE achat/vente) — sert aussi bien au flux ligne-par-ligne
// qu'au flux document multi-lignes, la clé de rapprochement (module + mouvementId)
// étant la même dans les deux cas.
export async function removeFinanceEntry(entrepriseId, module, mouvementId) {
  try {
    await pool.query(
      `DELETE FROM finances WHERE entreprise_id = $1 AND source_module = $2 AND source_mouvement_id = $3`,
      [entrepriseId, module, mouvementId]
    );
  } catch (err) {
    log.error('[removeFinanceEntry]', err);
  }
}

// Enregistre le paiement d'une échéance de devis dans Finances, au moment où elle est
// effectivement réglée (pas à la facturation), pour rester cohérent avec la logique
// de trésorerie déjà utilisée dans l'application — une facture "Facturé échelonné" non
// encore payée ne doit pas apparaître comme un revenu déjà encaissé.
export async function syncDevisPaiement(entrepriseId, userId, { montant, modePaiement, numero, clientNom, devisId, echeanceId }) {
  try {
    let categorie = 'Caisse';
    let banqueId = null;

    // Seul un paiement en espèces reste en "Caisse" — tout autre mode (virement,
    // chèque, etc.) est considéré comme passant par le compte bancaire principal.
    if (modePaiement !== 'Espèces') {
      categorie = 'Banque';
      const entrepriseResult = await pool.query('SELECT banque_principale_id FROM entreprises WHERE id = $1', [entrepriseId]);
      banqueId = entrepriseResult.rows[0]?.banque_principale_id || null;
    }

    const description = `Facture ${numero} — ${clientNom} (${modePaiement})`;

    // source_mouvement_id pointe ici sur l'id de l'échéance (pas du devis) : un devis
    // "Facturé échelonné" a plusieurs échéances, chacune doit produire sa propre
    // entrée finances au moment de son propre paiement.
    await pool.query(
      `INSERT INTO finances (entreprise_id, user_id, type, montant, description, source_module, source_mouvement_id, banque_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [entrepriseId, userId, categorie, montant, description, 'Devis', echeanceId, banqueId]
    );
  } catch (err) {
    log.error('[syncDevisPaiement]', err);
  }
}

// Étape 3 Comptabilité : miroir Finances d'un paiement enregistré sur une facture
// (account.move). `journalType` = type du journal de trésorerie du paiement ('bank' → Banque,
// 'cash' → Caisse). `montant` signé comme partout : positif pour un encaissement client
// (inbound), négatif pour un décaissement fournisseur (outbound). source_mouvement_id =
// l'id de l'account_payment, pour pouvoir retirer l'entrée si le paiement est annulé.
export async function syncFacturePaiement(entrepriseId, userId, { montant, journalType, numero, partenaireNom, paymentId }) {
  try {
    let banqueId = null;
    const categorie = journalType === 'cash' ? 'Caisse' : 'Banque';
    if (categorie === 'Banque') {
      const e = await pool.query('SELECT banque_principale_id FROM entreprises WHERE id = $1', [entrepriseId]);
      banqueId = e.rows[0]?.banque_principale_id || null;
    }
    const description = `Règlement facture ${numero} — ${partenaireNom || 'Partenaire'}`;
    await pool.query(
      `INSERT INTO finances (entreprise_id, user_id, type, montant, description, source_module, source_mouvement_id, banque_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [entrepriseId, userId, categorie, montant, description, 'Facture', paymentId, banqueId]
    );
  } catch (err) {
    log.error('[syncFacturePaiement]', err);
  }
}
