import { echapperHtml, ligneEntete } from '../utils/html.js';

describe('echapperHtml', () => {
  test('neutralise balises, liens et guillemets d’un nom saisi par une entreprise', () => {
    const nom = 'Ferme <a href="https://piege.example">Cliquez ici</a> & Cie';
    expect(echapperHtml(nom)).toBe('Ferme &lt;a href=&quot;https://piege.example&quot;&gt;Cliquez ici&lt;/a&gt; &amp; Cie');
  });
  test('valeurs vides ou non textuelles', () => {
    expect(echapperHtml(null)).toBe('');
    expect(echapperHtml(undefined)).toBe('');
    expect(echapperHtml(123456)).toBe('123456');
  });
});

describe('ligneEntete', () => {
  test('supprime les retours à la ligne (injection d’en-têtes) et borne la longueur', () => {
    expect(ligneEntete('Devis\r\nBcc: victime@example.com')).toBe('Devis Bcc: victime@example.com');
    expect(ligneEntete('x'.repeat(300)).length).toBe(150);
  });
});
