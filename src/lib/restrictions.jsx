// Restrictions de l'utilisateur connecté, côté interface : masquer les écrans qu'il ne peut pas
// consulter. PUR CONFORT D'AFFICHAGE — la barrière réelle est côté serveur (permissionGuard
// refuse en 403). Tant que les restrictions ne sont pas chargées, tout reste affiché : le
// serveur refusera de toute façon ce qui doit l'être.
//
// Modèle identique au serveur (server/src/utils/rolesService.js) : tout est ouvert, seule une
// action explicitement retirée par l'entreprise est fermée, et le propriétaire n'a aucune
// restriction.
import { createContext, useContext } from 'react';

// Écran (id d'onglet de navigation) → ressources du catalogue serveur
// (server/src/permissions/catalogue.js) dont la LECTURE conditionne son affichage.
//   ressources : TOUTES doivent être lisibles (écran qui dépend de chacune) ;
//   uneParmi   : AU MOINS UNE doit être lisible (module composé d'onglets internes, chacun
//                filtré à son tour par ModuleTabBar).
// Un écran absent de cette table n'est jamais masqué (accueil, préférences, aide, mon espace RH…).
export const RESSOURCES_ONGLETS = {
  calendar: { ressources: ['calendrier'] },
  recoltes: { ressources: ['recoltes'] },
  reports: { ressources: ['devis', 'achats', 'recoltes'] },
  cultures: { uneParmi: ['parcelles', 'produits', 'devis', 'achats', 'applications_intrants'] },
  poulailler: { uneParmi: ['poulailler', 'produits', 'devis', 'achats'] },
  pisciculture: { uneParmi: ['pisciculture', 'produits', 'devis', 'achats'] },
  clients: { ressources: ['contacts'] },
  fournisseurs: { ressources: ['contacts'] },
  employees: { ressources: ['salaries'] },
  finances: { ressources: ['finances'] },
  factures: { ressources: ['factures'] },
  observations: { ressources: ['observations'] },
  meteo: { ressources: ['meteo'] },
  surveillance: { ressources: ['cameras'] },
  equipements: { ressources: ['equipements'] },
};

// Construit un vérificateur à partir de la réponse de GET /api/roles/mes-restrictions
// ({ proprietaire, restrictions: { ressource: [actions] } }) — ou de null (pas encore chargé).
export function creerVerificateur(donnees) {
  const peut = (ressource, action = 'lire') => {
    if (!donnees || donnees.proprietaire) return true;
    return !(donnees.restrictions?.[ressource] || []).includes(action);
  };
  return {
    charge: Boolean(donnees),
    peut,
    peutLire: (ressource) => peut(ressource, 'lire'),
    toutesLisibles: (ressources = []) => ressources.every((r) => peut(r, 'lire')),
    uneLisible: (ressources = []) => ressources.length === 0 || ressources.some((r) => peut(r, 'lire')),
  };
}

// Vrai si les exigences `{ ressources?, uneParmi? }` sont satisfaites. Sert directement aux
// onglets internes des modules (ModuleTabBar), qui portent leurs exigences eux-mêmes.
export function exigencesSatisfaites(exigences, verificateur) {
  if (!exigences) return true;
  if (exigences.ressources && !verificateur.toutesLisibles(exigences.ressources)) return false;
  if (exigences.uneParmi && !verificateur.uneLisible(exigences.uneParmi)) return false;
  return true;
}

// Écran de la navigation principale : exigences lues dans RESSOURCES_ONGLETS par son id.
export function ongletVisible(onglet, verificateur) {
  return exigencesSatisfaites(RESSOURCES_ONGLETS[onglet.id], verificateur);
}

const VERIFICATEUR_OUVERT = creerVerificateur(null);

export const RestrictionsContext = createContext(VERIFICATEUR_OUVERT);

// Hors fournisseur (tests de composants isolés), tout est ouvert.
export function useRestrictions() {
  return useContext(RestrictionsContext) || VERIFICATEUR_OUVERT;
}
