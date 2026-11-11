// Échappement des valeurs insérées dans du HTML construit côté serveur (emails). Toute donnée
// saisie par un utilisateur — nom d'entreprise, prénom, nom de client — passe par ici : sans
// cela, une entreprise pouvait glisser des balises et des liens dans les devis envoyés à SES
// clients, depuis l'adresse d'expédition de la plateforme (hameçonnage, audit S7).
export function echapperHtml(valeur) {
  return String(valeur ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Valeur destinée à un en-tête d'email (sujet, nom d'expéditeur) : une seule ligne, sans
// retour chariot qui permettrait d'injecter d'autres en-têtes.
export function ligneEntete(valeur, longueurMax = 150) {
  return String(valeur ?? '').replace(/[\r\n\t]+/g, ' ').trim().slice(0, longueurMax);
}
