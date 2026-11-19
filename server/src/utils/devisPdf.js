// Génération du PDF de devis/facture, en streaming direct vers la réponse HTTP (pas de
// fichier temporaire sur disque). Appelé depuis routes/devis.js pour le PDF "propriétaire"
// (authentifié) et pour la route publique par token (/devis/public/:token/pdf) — même
// fonction pour les deux, le contrôle d'accès est fait par l'appelant, pas ici.
// Seul test unitaire du projet côté backend : server/src/test/devisPdf.test.js.
import PDFDocument from 'pdfkit';
import { appliquerTaxesLigne } from './taxeCompute.js';
import { log } from './journal.js';

// Devises sans sous-unité parmi celles proposées par l'app (DEVISES dans src/lib/locale.jsx) :
// toutes les autres s'affichent avec 2 décimales. Arrondir un montant en euros à l'entier,
// comme le faisait la version précédente pour toute devise, perdait les centimes sur un
// document commercial (25,50 € imprimé « 26 »).
const DEVISES_SANS_DECIMALES = new Set(['XOF', 'XAF']);

// Libellé imprimé à côté des montants. On imprime le code ISO plutôt qu'un symbole : la
// police par défaut de PDFKit (WinAnsi) n'a pas de glyphe pour « F CFA » et rendrait mal
// plusieurs symboles. Seul XOF garde son libellé usuel « FCFA », déjà présent sur tous les
// documents émis jusqu'ici — le changer ferait régresser l'existant sans rien corriger.
export function libelleDevise(devise) {
  if (!devise || devise === 'XOF') return 'FCFA';
  return devise;
}

// Formate un nombre avec des espaces comme séparateurs de milliers (ex: 1 234 567) et le
// nombre de décimales de la devise. Séparateurs posés à la main plutôt que via Intl, dont
// l'espace insécable s'affiche mal dans PDFKit.
export function formatMontant(n, devise) {
  const decimales = DEVISES_SANS_DECIMALES.has(devise || 'XOF') ? 0 : 2;
  const [entier, frac] = Math.abs(Number(n) || 0).toFixed(decimales).split('.');
  const signe = Number(n) < 0 ? '-' : '';
  const groupe = entier.replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  return signe + groupe + (frac ? ',' + frac : '');
}

// Génère le PDF d'un devis/facture et l'envoie directement dans la réponse HTTP (streaming).
// Identité du document : un devis facturé N'EST PLUS un devis. Il porte alors le numéro de sa
// facture comptable (FAC/2026/0001) et non celui du devis (DEV-2026-0001) — deux pièces, deux
// numéros, comme dans l'ERP de référence où un bon de commande et sa facture ne partagent pas
// leur numérotation. Le numéro du devis reste cité en référence, comme invoice_origin.
//
// La présence d'une facture liée fait foi, PAS le statut : « Facturé » n'est qu'un état parmi
// « Non payé », « Payé partiellement » et « Payé », et se fier au seul « Facturé » imprimait
// « DEVIS » sur une facture déjà payée.
export function identiteDocument(devis) {
  const numeroFacture = devis.factureNom || (devis.move && devis.move.name) || null;
  return numeroFacture
    ? { estFacture: true, titre: 'FACTURE', numero: numeroFacture, reference: devis.numero }
    : { estFacture: false, titre: 'DEVIS', numero: devis.numero, reference: null };
}

// Un numéro de pièce comptable contient des « / » (FAC/2026/0001), interdits dans un nom de
// fichier : le téléchargement casserait. On les remplace, sans toucher au numéro affiché.
export function nomFichier(numero) {
  return String(numero || 'document').replace(/[\\/:*?"<>|]/g, '-');
}

// devis doit contenir : numero, statut, date, clientNom, clientPrenom, entrepriseNom,
// lignes (produit, quantite, prixUnitaire), total, notes, signataireNom, signatureData (base64 PNG), dateSignature
export function streamDevisPdf(res, devis) {
  const doc = new PDFDocument({ margin: 50 });

  // Devise du document : getDevisComplet la résout toujours (COALESCE sur celle de
  // l'entreprise), mais on retombe sur XOF si le PDF est généré depuis un objet devis
  // construit à la main — le comportement d'avant la prise en charge multi-devise.
  const dev = devis.devise || 'XOF';
  const lib = libelleDevise(dev);

  // `pipe` démarre le flux avant même que tout le contenu ait été décrit ci-dessous —
  // PDFKit écrit au fil de l'eau, la réponse HTTP se termine quand doc.end() est appelé.
  res.setHeader('Content-Type', 'application/pdf');
  const identite = identiteDocument(devis);
  res.setHeader('Content-Disposition', `inline; filename="${nomFichier(identite.numero)}.pdf"`);
  doc.pipe(res);

  // En-tête : société à gauche, informations client à droite. Positionnement par
  // coordonnées absolues (x, y) plutôt que par flux séquentiel — PDFKit place le texte
  // au fil de l'eau (doc.y avance automatiquement) sauf quand une position explicite
  // est donnée, ce qui est nécessaire ici pour faire coexister deux colonnes.
  const headerTop = doc.y;

  doc.fontSize(18).fillColor('#000').text(devis.entrepriseNom || 'Entreprise', 50, headerTop, { width: 250 });
  doc.fontSize(13).fillColor('#2d6a4f').text(identite.titre, 50, headerTop + 24);
  doc.fillColor('#000').fontSize(10);
  doc.text(`Numéro : ${identite.numero}`, 50, headerTop + 42);
  doc.text(`Date : ${new Date(devis.date).toLocaleDateString('fr-FR')}`, 50, headerTop + 56);
  // La référence du devis d'origine reste sur la facture : c'est elle que le client a
  // approuvée, et elle relie les deux pièces de son côté comme du nôtre.
  if (identite.reference) {
    doc.text(`Référence devis : ${identite.reference}`, 50, headerTop + 70);
  }

  doc.fontSize(11).text('Client', 350, headerTop, { width: 200, align: 'left' });
  doc.fontSize(10);
  doc.text(`${devis.clientPrenom || ''} ${devis.clientNom || ''}`.trim(), 350, headerTop + 16, { width: 200 });
  // Champs optionnels : chacun n'est rendu que s'il existe, à la position `doc.y`
  // courante (qui a avancé après le `text` précédent) — évite les lignes vides pour un
  // client sans email/téléphone/adresse renseigné.
  if (devis.clientEmail) doc.text(devis.clientEmail, 350, doc.y, { width: 200 });
  if (devis.clientTelephone) doc.text(devis.clientTelephone, 350, doc.y, { width: 200 });
  if (devis.clientAdresse) doc.text(devis.clientAdresse, 350, doc.y, { width: 200 });

  // Repositionne doc.y après les deux colonnes (dont les hauteurs diffèrent selon les
  // champs présents), pour que la suite du document reprenne un flux normal en dessous
  // du bloc le plus haut des deux, pas immédiatement après la colonne de gauche.
  doc.y = headerTop + 90;
  doc.moveDown(0.5);

  // Référentiel des taxes de l'entreprise (account.tax-like), indexé par id — sert à
  // afficher la colonne "Taxes" (noms) et le récapitulatif HT / par taxe / TTC en pied.
  const taxById = new Map((devis.taxes || []).map(t => [t.id, t]));

  // Tableau des lignes — en-têtes de colonnes à positions fixes.
  const tableTop = doc.y;
  doc.fontSize(10).font('Helvetica-Bold');
  doc.text('Produit', 50, tableTop);
  doc.text('Qté', 230, tableTop);
  doc.text('Prix unit.', 280, tableTop);
  doc.text('Remise', 360, tableTop);
  doc.text('Taxes', 415, tableTop);
  doc.text('Total HT', 490, tableTop, { width: 80, align: 'right' });
  doc.moveDown(0.5);
  doc.font('Helvetica');

  // Une ligne fixe de 20pt par produit — pas de retour à la ligne géré pour un nom de
  // produit très long (tronqué/débordant visuellement plutôt que redimensionné).
  let y = doc.y;
  let totalHT = 0;
  const totauxParTaxe = new Map(); // taxId -> montant cumulé
  (devis.lignes || []).forEach(l => {
    if (l.type === 'section') {
      // Une section n'a pas de quantité/prix — affichée en gras sur toute la largeur,
      // pas de colonnes numériques.
      doc.font('Helvetica-Bold').text(l.produit, 50, y, { width: 520 });
      doc.font('Helvetica');
      y += 22;
      return;
    }
    const pct = Number(l.remisePourcentage) || 0;
    const ligneHT = (l.quantite * l.prixUnitaire) * (1 - pct / 100);
    const taxesLigne = (l.taxIds || []).map(id => taxById.get(id)).filter(Boolean);
    const { base, parTaxe } = taxesLigne.length
      ? appliquerTaxesLigne(ligneHT, l.quantite, taxesLigne)
      : { base: ligneHT, parTaxe: new Map() };
    totalHT += base;
    for (const [taxId, montant] of parTaxe) {
      totauxParTaxe.set(taxId, (totauxParTaxe.get(taxId) || 0) + montant);
    }
    const libTaxes = taxesLigne.map(t => t.name).join(', ') || '—';
    doc.text(l.produit, 50, y, { width: 170 });
    doc.text(String(l.quantite), 230, y);
    doc.text(`${formatMontant(l.prixUnitaire, dev)}`, 280, y);
    doc.text(`${pct.toFixed(0)}%`, 360, y);
    doc.fontSize(8).text(libTaxes, 415, y, { width: 70 });
    doc.fontSize(10).text(`${formatMontant(base, dev)} ${lib}`, 490, y, { width: 80, align: 'right' });
    y += 20;
  });

  // Ligne de séparation puis récapitulatif HT / taxes / TTC, sous le tableau.
  doc.moveTo(50, y + 5).lineTo(550, y + 5).stroke();
  let yr = y + 14;
  doc.font('Helvetica').fontSize(10);
  doc.text('Total HT', 350, yr, { width: 120 });
  doc.text(`${formatMontant(totalHT, dev)} ${lib}`, 470, yr, { width: 100, align: 'right' });
  yr += 15;
  for (const [taxId, montant] of totauxParTaxe) {
    const nom = (taxById.get(taxId) || {}).name || 'Taxe';
    doc.text(nom, 350, yr, { width: 120 });
    doc.text(`${formatMontant(montant, dev)} ${lib}`, 470, yr, { width: 100, align: 'right' });
    yr += 15;
  }
  doc.font('Helvetica-Bold').fontSize(12);
  doc.text(`Total ${totauxParTaxe.size ? 'TTC' : ''} : ${formatMontant(devis.total, dev)} ${lib}`, 350, yr + 4, { width: 220, align: 'right' });
  doc.font('Helvetica');
  y = yr + 20;

  if (devis.notes) {
    doc.moveDown(2);
    doc.fontSize(10).text('Notes :', { underline: true });
    doc.text(devis.notes);
  }

  // Signature, si le devis a été signé — n'apparaît donc jamais sur un PDF généré
  // pendant que le devis est encore en Brouillon/Envoyé.
  if (devis.signatureData) {
    doc.moveDown(2);
    doc.fontSize(10).text(`Signé par ${devis.signataireNom} le ${new Date(devis.dateSignature).toLocaleString('fr-FR')}`);
    try {
      // signatureData est une image encodée en base64 (data URL) envoyée depuis le canvas de signature
      const base64Data = devis.signatureData.replace(/^data:image\/\w+;base64,/, '');
      const imgBuffer = Buffer.from(base64Data, 'base64');
      doc.image(imgBuffer, { width: 150 });
    } catch (err) {
      // Une image de signature corrompue/mal encodée ne doit pas faire échouer tout le
      // PDF — le reste du document (déjà streamé) reste valide, seule la signature manque.
      log.error('[streamDevisPdf] signature image error', err);
    }
  }

  doc.end();
}
