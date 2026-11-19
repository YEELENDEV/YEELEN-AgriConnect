// Relie les mouvements achats/ventes (achats_documents/achats_lignes, devis/devis_lignes)
// au stock réel (table produits, fusion Cultures+Poulailler depuis le 2026-08-18) :
// incrémente à l'achat, décrémente à la vente signée, journalise chaque ajustement dans
// stock_mouvements.
//
// Étape 3 alignement Odoo produit/stock (2026-09-04) : chaque ajustement crée aussi une ligne
// stock_moves (state confirme/fait/annule) et met à jour le stock_quants de l'emplacement
// interne de l'entreprise (quantite pour un mouvement physique, quantite_reservee pour une
// réservation de vente) — voir socle.js pour le schéma. produits.quantite (colonne pont)
// continue de représenter le DISPONIBLE (quantite - quantite_reservee côté quant interne), donc
// son comportement visible pour les lecteurs existants (StocksTab, alertes, etc.) est identique
// à avant cette étape : un devis signé décrémentait déjà produits.quantite immédiatement, ce
// n'est désormais plus un UPDATE brut mais une vraie réservation structurée en dessous.
// Décision de scope délibérée : la réservation créée à la signature d'un devis n'est jamais
// promue en mouvement "fait" à la facturation (pas de nouvel appel côté routes/devis.js) — le
// commentaire existant dans facturer() indique déjà que la signature est le seul événement de
// stock que l'app modélise ; ajouter cette transition n'aurait aucun effet visible (le
// disponible ne bouge pas) pour un risque réel sur une route déjà complexe (comptabilité,
// hash de sécurisation). Elle reste une piste pour une étape future si un vrai besoin émerge.
import { pool } from '../db.js';
import { log } from './journal.js';

// Résout la ligne de produit concernée par un identifiant (fiable) en priorité, avec un
// repli par nom (insensible à la casse) pour les lignes plus anciennes ou les produits
// non catalogués. Toujours scopé à l'entreprise appelante ; `module` filtre le repli par
// nom pour qu'un "Riz" Cultures ne matche jamais un "Riz" Poulailler — sauf quand `module`
// est null (ligne de vente plus ancienne sans stockModule connu), auquel cas la recherche
// par nom porte sur les deux modules à la fois.
async function findStockRow(entrepriseId, module, stockId, nom) {
  if (stockId) {
    const byId = await pool.query('SELECT id, nom, unite_id AS "uniteId" FROM produits WHERE id = $1 AND entreprise_id = $2', [stockId, entrepriseId]);
    if (byId.rows[0]) return byId.rows[0];
  }
  if (!nom) return null;
  const byName = module
    ? await pool.query('SELECT id, nom, unite_id AS "uniteId" FROM produits WHERE entreprise_id = $1 AND module = $2 AND LOWER(nom) = LOWER($3)', [entrepriseId, module, nom])
    : await pool.query('SELECT id, nom, unite_id AS "uniteId" FROM produits WHERE entreprise_id = $1 AND LOWER(nom) = LOWER($2)', [entrepriseId, nom]);
  return byName.rows[0] || null;
}

// Facteur = combien d'unités de référence de sa catégorie pour 1 unité de cette ligne (voir
// unitesMesureDefaut.js). Convertit `quantite` (exprimée dans l'unité de la ligne, `ligneUomId`)
// vers l'unité de base du produit (`produitUniteId`) en multipliant par le ratio des facteurs —
// no-op si l'une des deux unités est absente/introuvable ou si les catégories diffèrent (mieux
// vaut ne pas convertir que de calculer n'importe quoi entre deux grandeurs incompatibles).
async function getUniteInfo(entrepriseId, uniteId) {
  if (!uniteId) return null;
  const { rows } = await pool.query(
    'SELECT categorie_id AS "categorieId", facteur FROM unites_mesure WHERE id = $1 AND entreprise_id = $2',
    [uniteId, entrepriseId]
  );
  return rows[0] || null;
}

async function convertirQuantite(entrepriseId, quantite, produitUniteId, ligneUomId) {
  if (!ligneUomId || !produitUniteId || ligneUomId === produitUniteId) return quantite;
  const [produitUnite, ligneUnite] = await Promise.all([
    getUniteInfo(entrepriseId, produitUniteId),
    getUniteInfo(entrepriseId, ligneUomId),
  ]);
  if (!produitUnite || !ligneUnite || produitUnite.categorieId !== ligneUnite.categorieId) return quantite;
  return quantite * (Number(ligneUnite.facteur) / Number(produitUnite.facteur));
}

// GREATEST(..., 0) empêche une quantité négative en cas de décrément supérieur au stock
// disponible (pas d'enforcement de quantité en amont, voir la note "Traçabilité" de
// CLAUDE.md sur le choix délibéré de ne pas construire un vrai suivi de lots/stock) —
// appliqué uniquement quand delta est négatif (une vente), un ajout ne risque jamais
// de passer sous zéro donc n'a pas besoin de la clause.
async function adjustStockRow(entrepriseId, stockRowId, delta) {
  const clause = delta > 0 ? 'quantite + $1' : 'GREATEST(quantite + $1, 0)';
  await pool.query(`UPDATE produits SET quantite = ${clause} WHERE id = $2 AND entreprise_id = $3`, [delta, stockRowId, entrepriseId]);
}

// Trace chaque ajustement de stock (delta signé : positif à l'achat, négatif à la
// vente) dans stock_mouvements — journal d'audit dédié aux stocks, distinct de
// mouvements_historique (édits/suppressions de mouvements ventes/achats) et de
// audit_log (connexions/actions de compte). stock_module reste renseigné (module du
// produit au moment du mouvement) même si la résolution ne s'appuie plus dessus.
async function logMouvement({ entrepriseId, stockModule, stockId, stockNom, delta, raison, documentType, documentId, userId }) {
  await pool.query(
    `INSERT INTO stock_mouvements (entreprise_id, stock_module, stock_id, stock_nom, delta, raison, document_type, document_id, user_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [entrepriseId, stockModule, stockId, stockNom, delta, raison, documentType, documentId, userId]
  );
}

// Emplacements de stock seedés d'une entreprise (utils/emplacementsStockDefaut.js), résolus à
// chaque appel (pas de cache global entre requêtes) — { interne, client, fournisseur, perte }.
// Depuis les transferts (2026-09-10), une entreprise peut avoir PLUSIEURS emplacements internes.
// L'ordre du tri n'est donc pas cosmétique : il décide où atterrit une réception d'achat.
// par_defaut d'abord, id ensuite (départage stable si le drapeau venait à manquer), et on garde
// la PREMIÈRE ligne de chaque type — la boucle d'origine gardait la dernière. Sans cela, une
// entreprise à deux entrepôts verrait son stock entrer au hasard, sans erreur ni trace.
async function resoudreEmplacements(entrepriseId) {
  const { rows } = await pool.query(
    `SELECT id, type FROM emplacements_stock
      WHERE entreprise_id = $1 AND type IN ('interne', 'client', 'fournisseur', 'perte', 'production', 'inventaire')
      ORDER BY par_defaut DESC, id ASC`,
    [entrepriseId]
  );
  const parType = {};
  for (const r of rows) if (parType[r.type] === undefined) parType[r.type] = r.id;
  return parType;
}

// Ajuste un seul quant (produit, emplacement interne) : `champ` vaut 'quantite' (mouvement
// physique) ou 'quantite_reservee' (réservation de vente) — toujours l'un des deux littéraux
// contrôlés en interne par CONFIG_MOUVEMENT ci-dessous, jamais une valeur venue de l'appelant,
// donc son interpolation directe dans la requête est sûre. GREATEST(..., 0) même logique de
// garde-fou qu'adjustStockRow : jamais de quantité négative.
async function ajusterQuant(entrepriseId, produitId, emplacementId, champ, delta) {
  await pool.query(
    `INSERT INTO stock_quants (entreprise_id, produit_id, emplacement_id, ${champ})
     VALUES ($1, $2, $3, GREATEST($4, 0))
     ON CONFLICT (produit_id, emplacement_id) DO UPDATE SET ${champ} = GREATEST(stock_quants.${champ} + $4, 0)`,
    [entrepriseId, produitId, emplacementId, delta]
  );
}

async function creerMove({ entrepriseId, userId, produitId, quantite, sourceId, destId, state, documentType, documentId, raison }) {
  await pool.query(
    `INSERT INTO stock_moves (entreprise_id, user_id, produit_id, quantite, emplacement_source_id, emplacement_dest_id, state, document_type, document_id, raison, date_fait)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, CASE WHEN $7 = 'fait' THEN now() ELSE NULL END)`,
    [entrepriseId, userId || null, produitId, quantite, sourceId, destId, state, documentType || null, documentId || null, raison || null]
  );
}

// Un seul quant réel suivi par produit : celui de l'emplacement interne. Les emplacements
// client/fournisseur/perte ne servent qu'à qualifier la source/destination du mouvement dans
// le journal stock_moves (traçabilité), jamais de quant à leur niveau — voir socle.js.
//   reception    : achat reçu.                quantite    += n  (fournisseur → interne, fait)
//   retour_achat : réception d'achat annulée. quantite    += n  (interne → fournisseur, annule)
//   reservation  : devis signé.               reservee    += n  (interne → client, confirme)
//   liberation   : devis remis en brouillon.  reservee    -= n  (interne → client, annule)
//   consommation : intrant appliqué au champ. quantite    -= n  (interne → perte, fait)
//   restitution  : application annulée.       quantite    += n  (perte → interne, annule)
// `champ` = quel champ du quant interne bouge ; `champDelta(delta)` = de combien, en fonction du
// delta signé déjà utilisé par produits.quantite (même convention que l'ancien adjustStockRow).
const CONFIG_MOUVEMENT = {
  reception: { champ: 'quantite', source: 'fournisseur', dest: 'interne', state: 'fait', champDelta: (d) => d },
  retour_achat: { champ: 'quantite', source: 'interne', dest: 'fournisseur', state: 'annule', champDelta: (d) => d },
  reservation: { champ: 'quantite_reservee', source: 'interne', dest: 'client', state: 'confirme', champDelta: (d) => -d },
  liberation: { champ: 'quantite_reservee', source: 'interne', dest: 'client', state: 'annule', champDelta: (d) => -d },
  consommation: { champ: 'quantite', source: 'interne', dest: 'perte', state: 'fait', champDelta: (d) => d },
  restitution: { champ: 'quantite', source: 'perte', dest: 'interne', state: 'annule', champDelta: (d) => d },
  // Transformation agroalimentaire, étape 2 (2026-09-06) : un ordre de transformation consomme
  // ses ingrédients (interne → production, comme consommation/perte) puis produit l'article
  // fini (production → interne, comme reception/fournisseur) — deux couples symétriques
  // fait/annule, mêmes conventions que ci-dessus.
  transformation_conso: { champ: 'quantite', source: 'interne', dest: 'production', state: 'fait', champDelta: (d) => d },
  transformation_restitution: { champ: 'quantite', source: 'production', dest: 'interne', state: 'annule', champDelta: (d) => d },
  transformation_prod: { champ: 'quantite', source: 'production', dest: 'interne', state: 'fait', champDelta: (d) => d },
  transformation_retrait: { champ: 'quantite', source: 'interne', dest: 'production', state: 'annule', champDelta: (d) => d },
  // Ajustement d'inventaire et rebut (2026-09-10). L'écart de comptage a son propre
  // emplacement : un écart n'est pas une perte identifiée, et les mélanger rendrait le
  // registre des mouvements inexploitable pour « combien ai-je jeté ? ».
  //   inventaire_entree : comptage supérieur au théorique. quantite += n (inventaire → interne)
  //   inventaire_sortie : comptage inférieur au théorique.  quantite -= n (interne → inventaire)
  //   rebut             : marchandise déclarée perdue.      quantite -= n (interne → perte)
  // Aucun inverse : l'ERP de référence interdit de supprimer un rebut validé, et une erreur de
  // comptage se corrige par un nouveau comptage, pas par un retour en arrière.
  inventaire_entree: { champ: 'quantite', source: 'inventaire', dest: 'interne', state: 'fait', champDelta: (d) => d },
  inventaire_sortie: { champ: 'quantite', source: 'interne', dest: 'inventaire', state: 'fait', champDelta: (d) => d },
  rebut: { champ: 'quantite', source: 'interne', dest: 'perte', state: 'fait', champDelta: (d) => d },
};

// Ajuste le produit correspondant (disponible, colonne pont) + le quant interne sous-jacent +
// journalise le mouvement structuré et l'entrée stock_mouvements. Aucune correspondance produit
// = no-op silencieux : un produit en texte libre non suivi en stock n'est pas une erreur, juste
// un article non catalogué (pas de mouvement à tracer). Emplacements absents (entreprise pas
// encore seedée) = même posture : on ajuste quand même produits.quantite (comportement
// pré-étape-3 préservé), mais on saute la partie quant/move plutôt que d'échouer bruyamment.
async function mouvementStock(kind, module, entrepriseId, stockId, nom, delta, ctx, uomId) {
  if (!nom || !delta) return;
  try {
    const row = await findStockRow(entrepriseId, module, stockId, nom);
    if (!row) return;
    const deltaConverti = await convertirQuantite(entrepriseId, delta, row.uniteId, uomId);
    if (!deltaConverti) return;

    await adjustStockRow(entrepriseId, row.id, deltaConverti);

    const cfg = CONFIG_MOUVEMENT[kind];
    const emplacements = await resoudreEmplacements(entrepriseId);
    const sourceId = emplacements[cfg.source];
    const destId = emplacements[cfg.dest];
    const emplacementInterneId = emplacements.interne;
    if (sourceId && destId && emplacementInterneId) {
      await ajusterQuant(entrepriseId, row.id, emplacementInterneId, cfg.champ, cfg.champDelta(deltaConverti));
      await creerMove({
        entrepriseId, userId: ctx.userId, produitId: row.id, quantite: Math.abs(deltaConverti),
        sourceId, destId, state: cfg.state, documentType: ctx.documentType, documentId: ctx.documentId, raison: ctx.raison,
      });
    }

    await logMouvement({ entrepriseId, stockModule: module, stockId: row.id, stockNom: row.nom, delta: deltaConverti, ...ctx });
  } catch (err) {
    log.error('[stockSync:produits]', err);
  }
}

// Achats : incrémente le stock du module du document (entrée en stock).
export async function applyAchatLignesToStock(entrepriseId, module, lignes, ctx) {
  if (!['Cultures', 'Poulailler', 'Pisciculture'].includes(module)) return;
  for (const ligne of lignes) {
    await mouvementStock('reception', module, entrepriseId, ligne.stockId, ligne.produit, Number(ligne.quantite) || 0, ctx, ligne.uomId);
  }
}

// Inverse d'applyAchatLignesToStock — utilisé à la suppression d'un achat, ou pour
// annuler l'ancien état avant d'appliquer les nouvelles lignes lors d'une modification.
export async function reverseAchatLignesFromStock(entrepriseId, module, lignes, ctx) {
  if (!['Cultures', 'Poulailler', 'Pisciculture'].includes(module)) return;
  for (const ligne of lignes) {
    await mouvementStock('retour_achat', module, entrepriseId, ligne.stockId, ligne.produit, -(Number(ligne.quantite) || 0), ctx, ligne.uomId);
  }
}

// Ventes (devis) : une ligne connaît généralement son propre stockModule (le devis lui-même
// n'est rattaché à aucun module) ; à défaut (lignes plus anciennes), findStockRow cherche
// l'article par nom dans les deux modules à la fois.

// Décrémente le disponible (réserve le stock) au moment où un devis passe "Signé" (le point de
// la vente qui devient réellement engagé — voir le cycle de vie documenté dans CLAUDE.md), pas
// dès la création en Brouillon : un devis non signé n'engage encore aucune marchandise.
export async function applyVenteLignesToStock(entrepriseId, lignes, ctx) {
  for (const ligne of lignes) {
    await mouvementStock('reservation', ligne.stockModule || null, entrepriseId, ligne.stockId, ligne.produit, -(Number(ligne.quantite) || 0), ctx, ligne.uomId);
  }
}

// Restitue le disponible (libère la réservation) quand un devis déjà signé/facturé est remis
// en brouillon — symétrique d'applyVenteLignesToStock (même delta, signe inversé).
export async function reverseVenteLignesToStock(entrepriseId, lignes, ctx) {
  for (const ligne of lignes) {
    await mouvementStock('liberation', ligne.stockModule || null, entrepriseId, ligne.stockId, ligne.produit, Number(ligne.quantite) || 0, ctx, ligne.uomId);
  }
}

// Consommation directe d'un seul produit catalogué (apport d'intrant au champ, étape C).
// delta négatif sur produits.quantite + trace stock_mouvements (raison passée dans ctx).
export async function consommerProduit(entrepriseId, { stockId, produitNom, stockModule, quantite, uomId }, ctx) {
  await mouvementStock('consommation', stockModule || null, entrepriseId, stockId, produitNom, -(Number(quantite) || 0), ctx, uomId);
}

// Inverse de consommerProduit — restitue le stock à la suppression d'une application.
export async function restituerProduit(entrepriseId, { stockId, produitNom, stockModule, quantite, uomId }, ctx) {
  await mouvementStock('restitution', stockModule || null, entrepriseId, stockId, produitNom, Number(quantite) || 0, ctx, uomId);
}

// Transformation agroalimentaire, étape 2 : un ingrédient consommé par un ordre de
// transformation (delta négatif sur produits.quantite) ; restituerIngredientTransformation
// inverse ça à la suppression de l'ordre.
export async function consommerIngredientTransformation(entrepriseId, { stockId, produitNom, quantite, uomId }, ctx) {
  await mouvementStock('transformation_conso', null, entrepriseId, stockId, produitNom, -(Number(quantite) || 0), ctx, uomId);
}

export async function restituerIngredientTransformation(entrepriseId, { stockId, produitNom, quantite, uomId }, ctx) {
  await mouvementStock('transformation_restitution', null, entrepriseId, stockId, produitNom, Number(quantite) || 0, ctx, uomId);
}

// Le produit fini d'un ordre de transformation (delta positif sur produits.quantite) ;
// retirerSortieTransformation inverse ça à la suppression de l'ordre.
export async function produireSortieTransformation(entrepriseId, { stockId, produitNom, quantite, uomId }, ctx) {
  await mouvementStock('transformation_prod', null, entrepriseId, stockId, produitNom, Number(quantite) || 0, ctx, uomId);
}

export async function retirerSortieTransformation(entrepriseId, { stockId, produitNom, quantite, uomId }, ctx) {
  await mouvementStock('transformation_retrait', null, entrepriseId, stockId, produitNom, -(Number(quantite) || 0), ctx, uomId);
}

// Ajustement d'inventaire (2026-09-10) : `delta` est l'écart signé entre la quantité comptée et
// la quantité théorique, déjà calculé par la route — elle seule sait ce qui a été compté, et
// c'est aussi elle qui a validé le produit. Le sens du mouvement suit le signe de l'écart.
//
// Contrairement aux autres appelants de ce module, la route ne peut pas se permettre le no-op
// silencieux de mouvementStock : un bouton qui ne fait rien sans rien dire n'est pas acceptable.
// Elle valide donc le produit en amont, ce qui garantit que findStockRow trouvera sa ligne.
export async function ajusterInventaire(entrepriseId, { stockId, produitNom, stockModule, delta, quantiteComptee, emplacementId, uomId }, ctx) {
  const kind = delta > 0 ? 'inventaire_entree' : 'inventaire_sortie';
  await mouvementStock(kind, stockModule || null, entrepriseId, stockId, produitNom, delta, ctx, uomId);

  // Un comptage POSE la quantité, il ne l'incrémente pas — c'est la sémantique de l'opération
  // (l'ERP de référence stocke une valeur absolue, inventory_quantity), et c'est ce qui rend
  // cet écran capable de réaligner le stock. Sans cela il ne réalignerait rien : un article
  // créé avec un stock initial ou corrigé via PUT /produits n'a jamais eu de stock_quants —
  // ni POST ni PUT n'en écrivent — donc appliquer un simple delta laisserait le quant à 0
  // pendant que produits.quantite affiche des centaines de kilos. Le comptage fait autorité :
  // le physique compté inclut le réservé, la colonne réservée du quant reste intacte.
  if (quantiteComptee != null) {
    try {
      const row = await findStockRow(entrepriseId, stockModule || null, stockId, produitNom);
      // L'emplacement compté est passé par la route (défaut : celui marqué par_defaut, résolu
      // là-bas). Depuis les transferts, retomber sur « l'emplacement interne » ne suffit plus.
      const emplacements = await resoudreEmplacements(entrepriseId);
      const cible = emplacementId || emplacements.interne;
      if (row && cible) {
        await pool.query(
          `INSERT INTO stock_quants (entreprise_id, produit_id, emplacement_id, quantite)
           VALUES ($1, $2, $3, GREATEST($4, 0))
           ON CONFLICT (produit_id, emplacement_id) DO UPDATE SET quantite = GREATEST($4, 0)`,
          [entrepriseId, row.id, cible, quantiteComptee]
        );
      }
    } catch (err) {
      log.error('[stockSync:inventaire]', err);
    }
  }
}

// Mise au rebut : sortie définitive vers l'emplacement « Pertes ». `quantite` est positive,
// le delta appliqué est négatif — même convention que consommerProduit.
export async function mettreAuRebut(entrepriseId, { stockId, produitNom, stockModule, quantite, uomId }, ctx) {
  await mouvementStock('rebut', stockModule || null, entrepriseId, stockId, produitNom, -(Number(quantite) || 0), ctx, uomId);
}
