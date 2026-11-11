// Assainissement des données utilisateur avant de les écrire dans un contexte qui n'est PAS
// protégé par React : HTML construit à la main (fenêtres d'impression via document.write) et
// fichiers CSV ouverts dans un tableur.

// Échappe une valeur pour l'insérer dans du HTML. Indispensable dans les fenêtres d'impression :
// window.open('') ouvre une page de MÊME origine que l'application, donc un nom de produit ou
// de fournisseur contenant `<img src=x onerror=…>` y exécutait du script capable de lire le
// jeton de session dans localStorage (XSS stockée).
export function escapeHtml(valeur) {
  return String(valeur ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Cellule CSV sûre : entre guillemets (guillemets internes doublés) ET neutralisée contre
// l'injection de formules — une valeur commençant par = + - @ (ou tabulation / retour chariot)
// serait sinon exécutée comme formule par Excel/LibreOffice à l'ouverture du fichier
// (ex. =HYPERLINK(...) pour exfiltrer des données). Les nombres restent intacts.
export function celluleCsv(valeur) {
  if (typeof valeur === 'number') return `"${valeur}"`;
  let texte = String(valeur ?? '');
  // Un nombre sous forme de texte (« -1500.50 », typique d'une colonne NUMERIC) reste un nombre.
  const estNombre = /^-?\d+([.,]\d+)?$/.test(texte);
  if (!estNombre && /^[=+\-@\t\r]/.test(texte)) texte = `'${texte}`;
  return `"${texte.replace(/"/g, '""')}"`;
}
