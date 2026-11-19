// Emplacements de stock par défaut créés pour chaque entreprise (à l'inscription via
// routes/auth.js, et rétroactivement par db/socle.js) — étape 3 de l'alignement Odoo
// produit/stock. Calqué sur les emplacements virtuels d'un ERP de référence (stock.location) : un seul
// emplacement interne réel (pas de multi-entrepôt dans cette version) + trois emplacements
// virtuels servant uniquement de source/destination dans le journal stock_moves — aucun quant
// n'est jamais suivi à leur niveau, voir server/src/utils/stockSync.js.
export const EMPLACEMENTS_STOCK_DEFAUT = [
  { nom: 'Emplacement principal', type: 'interne' },
  { nom: 'Clients', type: 'client' },
  { nom: 'Fournisseurs', type: 'fournisseur' },
  { nom: 'Pertes', type: 'perte' },
  // Transformation agroalimentaire, étape 2 (2026-09-06) : emplacement virtuel où transitent
  // les articles pendant un ordre de transformation — les ingrédients en sortent (consommation),
  // le produit fini en sort aussi (production), symétrique du couple perte/restitution déjà
  // en place pour les intrants phytosanitaires. Voir stockSync.js.
  { nom: 'Production', type: 'production' },
  // Ajustement d'inventaire et rebut (2026-09-10) : la contrepartie des écarts de comptage.
  // Distinct de « Pertes » à dessein — une perte est identifiée (un intrant épandu, une caisse
  // jetée), un écart d'inventaire ne l'est pas ; les confondre rendrait impossible de répondre
  // à « combien ai-je jeté ce mois-ci ? ». L'ERP de référence les sépare pour la même raison
  // (« Inventory adjustment » distinct de « Scrap »). Voir stockSync.js.
  { nom: "Ajustements d'inventaire", type: 'inventaire' },
];
