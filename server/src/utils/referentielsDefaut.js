// Référentiels créés par défaut pour toute entreprise — source UNIQUE partagée entre
// routes/auth.js (amorçage à l'inscription) et db/migrate.js (rattrapage des entreprises
// existantes). Ces listes étaient auparavant recopiées à l'identique dans les deux fichiers,
// avec le risque qu'une modification n'en touche qu'un seul. Même idiome que
// comptaDefauts.js / unitesMesureDefaut.js / emplacementsStockDefaut.js.

// Catégories de produits. Sans elles, une entreprise ne peut ajouter aucun article de stock
// tant qu'un admin n'en crée pas une à la main via « Gérer les catégories ».
export const CATEGORIES_PRODUITS_DEFAUT = [
  { module: 'Cultures', nom: 'Semences', ordre: 0 },
  { module: 'Cultures', nom: 'Engrais', ordre: 1 },
  { module: 'Cultures', nom: 'Produits phytosanitaires', ordre: 2 },
  { module: 'Cultures', nom: 'Autre', ordre: 3 },
  { module: 'Poulailler', nom: 'Aliment', ordre: 0 },
  { module: 'Poulailler', nom: 'Œufs', ordre: 1 },
  { module: 'Poulailler', nom: 'Volailles vivantes', ordre: 2 },
  { module: 'Poulailler', nom: 'Autre', ordre: 3 },
  { module: 'Pisciculture', nom: 'Aliment', ordre: 0 },
  { module: 'Pisciculture', nom: 'Poissons vivants', ordre: 1 },
  { module: 'Pisciculture', nom: 'Alevins', ordre: 2 },
  { module: 'Pisciculture', nom: 'Autre', ordre: 3 },
];

// Types de congés.
export const CONGES_TYPES_DEFAUT = [
  { nom: 'Congés payés', paye: true, justificatif_requis: false, couleur: '#3F6B3B', ordre: 1 },
  { nom: 'Maladie', paye: true, justificatif_requis: true, couleur: '#C1861F', ordre: 2 },
  { nom: 'Sans solde', paye: false, justificatif_requis: false, couleur: '#5B6357', ordre: 3 },
  { nom: 'Événement familial', paye: true, justificatif_requis: false, couleur: '#2E6E8E', ordre: 4 },
];

// Conditions de paiement (étape 0 Comptabilité, modèle account.payment.term).
export const PAYMENT_TERMS_DEFAUT = [
  { name: 'Paiement immédiat', sequence: 10, lines: [{ value: 'balance', value_amount: 0, delay_type: 'days_after', nb_days: 0, ordre: 0 }] },
  { name: '30 jours', sequence: 20, lines: [{ value: 'balance', value_amount: 0, delay_type: 'days_after', nb_days: 30, ordre: 0 }] },
  { name: 'Fin de mois suivant', sequence: 30, lines: [{ value: 'balance', value_amount: 0, delay_type: 'days_after_end_of_month', nb_days: 0, ordre: 0 }] },
  { name: '30 % à la commande, solde à 30 jours', sequence: 40, lines: [
    { value: 'percent', value_amount: 30, delay_type: 'days_after', nb_days: 0, ordre: 0 },
    { value: 'balance', value_amount: 0, delay_type: 'days_after', nb_days: 30, ordre: 1 },
  ] },
];
