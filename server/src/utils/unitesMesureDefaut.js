// Unités de mesure par défaut créées pour chaque entreprise (à l'inscription via
// routes/auth.js, et rétroactivement par db/socle.js) — étape 1 de l'alignement Odoo
// produit/stock. Portée délibérément réduite aux catégories utiles à une exploitation
// agricole (pas de longueur/temps/etc. comme le uom.category d'Odoo) : Poids, Volume,
// Unité. « facteur » = combien d'unités de référence (estReference: true) pour 1 unité
// de cette ligne — voir le commentaire dans db/socle.js pour la convention complète.
export const UNITES_MESURE_DEFAUT = [
  {
    categorie: 'Poids',
    unites: [
      { nom: 'Kilogramme', symbole: 'kg', facteur: 1, estReference: true },
      { nom: 'Gramme', symbole: 'g', facteur: 0.001, estReference: false },
      { nom: 'Tonne', symbole: 't', facteur: 1000, estReference: false },
    ],
  },
  {
    categorie: 'Volume',
    unites: [
      { nom: 'Litre', symbole: 'L', facteur: 1, estReference: true },
      { nom: 'Millilitre', symbole: 'mL', facteur: 0.001, estReference: false },
      { nom: 'Mètre cube', symbole: 'm³', facteur: 1000, estReference: false },
    ],
  },
  {
    categorie: 'Unité',
    unites: [
      { nom: 'Unité', symbole: 'u', facteur: 1, estReference: true },
    ],
  },
];
