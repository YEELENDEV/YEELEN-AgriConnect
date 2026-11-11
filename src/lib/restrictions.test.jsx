import { creerVerificateur, ongletVisible, exigencesSatisfaites, RESSOURCES_ONGLETS } from './restrictions.jsx';

describe('creerVerificateur', () => {
  test('non chargé : tout est ouvert (le serveur reste la barrière)', () => {
    const v = creerVerificateur(null);
    expect(v.charge).toBe(false);
    expect(v.peutLire('devis')).toBe(true);
  });

  test('seule une action retirée est fermée', () => {
    const v = creerVerificateur({ proprietaire: false, restrictions: { devis: ['lire'], contacts: ['creer'] } });
    expect(v.peutLire('devis')).toBe(false);
    expect(v.peut('contacts', 'creer')).toBe(false);
    expect(v.peutLire('contacts')).toBe(true);
    expect(v.peutLire('produits')).toBe(true);
  });

  test('le propriétaire n’a aucune restriction', () => {
    const v = creerVerificateur({ proprietaire: true, restrictions: { devis: ['lire'] } });
    expect(v.peutLire('devis')).toBe(true);
  });
});

describe('ongletVisible', () => {
  const v = creerVerificateur({ proprietaire: false, restrictions: { contacts: ['lire'], parcelles: ['lire'], devis: ['lire'] } });

  test('un écran à ressource unique est masqué si sa lecture est retirée', () => {
    expect(ongletVisible({ id: 'clients' }, v)).toBe(false);
    expect(ongletVisible({ id: 'fournisseurs' }, v)).toBe(false);
    expect(ongletVisible({ id: 'factures' }, v)).toBe(true);
  });

  test('un écran qui dépend de plusieurs ressources est masqué dès qu’une manque', () => {
    expect(ongletVisible({ id: 'reports' }, v)).toBe(false);
  });

  test('un module composé reste visible tant qu’un de ses onglets est lisible', () => {
    // parcelles et devis retirés, mais produits/achats/registre restent lisibles.
    expect(ongletVisible({ id: 'cultures' }, v)).toBe(true);
    const tout = creerVerificateur({ restrictions: Object.fromEntries(
      RESSOURCES_ONGLETS.cultures.uneParmi.map((r) => [r, ['lire']])
    ) });
    expect(ongletVisible({ id: 'cultures' }, tout)).toBe(false);
  });

  test('un écran sans exigence n’est jamais masqué', () => {
    expect(ongletVisible({ id: 'profil' }, v)).toBe(true);
    expect(ongletVisible({ id: 'monrh' }, v)).toBe(true);
  });
});

describe('exigencesSatisfaites (onglets internes des modules)', () => {
  const v = creerVerificateur({ proprietaire: false, restrictions: { devis: ['lire'] } });
  test('lit les exigences portées par l’onglet, jamais la table de navigation', () => {
    expect(exigencesSatisfaites({ id: 'ventes', ressources: ['devis'] }, v)).toBe(false);
    expect(exigencesSatisfaites({ id: 'stocks', ressources: ['produits'] }, v)).toBe(true);
    expect(exigencesSatisfaites({ id: 'comptabilite', ressources: ['devis', 'achats'] }, v)).toBe(false);
    // Un onglet interne sans exigence (simulation locale, carte…) reste visible.
    expect(exigencesSatisfaites({ id: 'clients' }, v)).toBe(true);
    expect(exigencesSatisfaites(undefined, v)).toBe(true);
  });
});
