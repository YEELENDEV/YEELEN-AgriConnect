import { escapeHtml, celluleCsv } from './securite.js';

describe('escapeHtml', () => {
  test('neutralise les balises et attributs', () => {
    expect(escapeHtml('<img src=x onerror="alert(1)">')).toBe('&lt;img src=x onerror=&quot;alert(1)&quot;&gt;');
    expect(escapeHtml("L'Œuf & Cie")).toBe('L&#39;Œuf &amp; Cie');
  });
  test('valeurs vides et non textuelles', () => {
    expect(escapeHtml(null)).toBe('');
    expect(escapeHtml(undefined)).toBe('');
    expect(escapeHtml(42)).toBe('42');
  });
});

describe('celluleCsv', () => {
  test('met entre guillemets et double les guillemets internes', () => {
    expect(celluleCsv('Maïs "jaune"')).toBe('"Maïs ""jaune"""');
  });
  test('neutralise les formules de tableur', () => {
    expect(celluleCsv('=HYPERLINK("http://x")')).toBe('"\'=HYPERLINK(""http://x"")"');
    expect(celluleCsv('+1+1')).toBe('"\'+1+1"');
    expect(celluleCsv('@SUM(A1)')).toBe('"\'@SUM(A1)"');
    expect(celluleCsv('-2+3')).toBe('"\'-2+3"');
  });
  test('laisse les nombres intacts, y compris négatifs', () => {
    expect(celluleCsv(-1500)).toBe('"-1500"');
    expect(celluleCsv(0)).toBe('"0"');
    expect(celluleCsv('-1500.50')).toBe('"-1500.50"');
  });
  test('valeurs vides', () => {
    expect(celluleCsv(null)).toBe('""');
    expect(celluleCsv(undefined)).toBe('""');
  });
});
