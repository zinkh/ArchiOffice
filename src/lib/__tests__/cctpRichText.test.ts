import { describe, it, expect } from 'vitest';
import {
  analyserRiche, appliquerCouleur, basculerBalise, contientMiseEnForme, mettreEnLignes, paragraphesRiches, texteBrut,
} from '../cctpRichText';

describe('analyserRiche', () => {
  it('lit gras, italique, souligné et couleur', () => {
    const segs = analyserRiche('a [b]gras[/b] [i]ital[/i] [u]sou[/u] [c=#B2242A]rouge[/c]');
    expect(segs.map(s => s.text).join('')).toBe('a gras ital sou rouge');
    expect(segs.find(s => s.text === 'gras')?.b).toBe(true);
    expect(segs.find(s => s.text === 'ital')?.i).toBe(true);
    expect(segs.find(s => s.text === 'sou')?.u).toBe(true);
    expect(segs.find(s => s.text === 'rouge')?.color).toBe('#b2242a');
  });

  it('empile les styles imbriqués', () => {
    const segs = analyserRiche('[b]a [i]b[/i] c[/b]');
    expect(segs).toEqual([
      { text: 'a ', b: true },
      { text: 'b', b: true, i: true },
      { text: ' c', b: true },
    ]);
  });

  it('laisse en texte une balise fermante sans ouverture, une couleur invalide ou inconnue', () => {
    expect(texteBrut('x [/b] y')).toBe('x [/b] y');
    expect(texteBrut('[c=rouge]x[/c]')).toBe('[c=rouge]x[/c]');
    expect(texteBrut('[z]x[/z]')).toBe('[z]x[/z]');
    expect(texteBrut('[b=#111111]x')).toBe('[b=#111111]x');
  });

  it("applique une balise jamais refermée jusqu'à la fin", () => {
    expect(analyserRiche('[b]fin')).toEqual([{ text: 'fin', b: true }]);
  });

  it('remplace la couleur au lieu de l’empiler', () => {
    const segs = analyserRiche('[c=#111111]a[c=#b2242a]b[/c]c');
    expect(segs.find(s => s.text === 'b')?.color).toBe('#b2242a');
  });

  it('ne touche pas les variables {{…}} ni les crochets ordinaires', () => {
    expect(texteBrut('{{adresse}} [adresse à renseigner] [1]')).toBe('{{adresse}} [adresse à renseigner] [1]');
  });
});

describe('paragraphesRiches', () => {
  it('garde le style d’une balise qui traverse un retour à la ligne', () => {
    const p = paragraphesRiches('[b]un\ndeux[/b]\ntrois');
    expect(p).toHaveLength(3);
    expect(p[0]).toEqual([{ text: 'un', b: true }]);
    expect(p[1]).toEqual([{ text: 'deux', b: true }]);
    expect(p[2]).toEqual([{ text: 'trois' }]);
  });
});

describe('contientMiseEnForme', () => {
  it('distingue un texte formaté d’un texte à crochets', () => {
    expect(contientMiseEnForme('[b]x[/b]')).toBe(true);
    expect(contientMiseEnForme('[note] x')).toBe(false);
    expect(contientMiseEnForme('')).toBe(false);
  });
});

describe('basculerBalise', () => {
  it('entoure la sélection', () => {
    const r = basculerBalise('un mot ici', 3, 6, 'b');
    expect(r.texte).toBe('un [b]mot[/b] ici');
    expect(r.texte.slice(r.debut, r.fin)).toBe('mot');
  });

  it('retire la balise quand la sélection est déjà entourée', () => {
    const r = basculerBalise('un [b]mot[/b] ici', 6, 9, 'b');
    expect(r.texte).toBe('un mot ici');
    expect(r.texte.slice(r.debut, r.fin)).toBe('mot');
  });

  it('retire la balise quand la sélection la contient', () => {
    const r = basculerBalise('un [i]mot[/i] ici', 3, 13, 'i');
    expect(r.texte).toBe('un mot ici');
  });

  it('insère la paire sans sélection et place le curseur entre', () => {
    const r = basculerBalise('ab', 1, 1, 'u');
    expect(r.texte).toBe('a[u][/u]b');
    expect(r.debut).toBe(4);
    expect(r.fin).toBe(4);
  });
});

describe('appliquerCouleur', () => {
  it('colore la sélection', () => {
    const r = appliquerCouleur('un mot', 3, 6, '#B2242A');
    expect(r.texte).toBe('un [c=#b2242a]mot[/c]');
    expect(r.texte.slice(r.debut, r.fin)).toBe('mot');
  });

  it('remplace une couleur déjà posée autour', () => {
    const r = appliquerCouleur('un [c=#b2242a]mot[/c]', 14, 17, '#15803d');
    expect(r.texte).toBe('un [c=#15803d]mot[/c]');
  });

  it('retire la couleur avec null', () => {
    const r = appliquerCouleur('un [c=#b2242a]mot[/c]', 14, 17, null);
    expect(r.texte).toBe('un mot');
  });

  it('ignore une couleur invalide', () => {
    expect(appliquerCouleur('un mot', 3, 6, 'red').texte).toBe('un mot');
  });

  it('nettoie les couleurs intérieures avant de colorer', () => {
    const source = '[c=#111111]a[/c] b';
    const r = appliquerCouleur(source, 0, source.length, '#1d4ed8');
    expect(texteBrut(r.texte)).toBe('a b');
    expect(analyserRiche(r.texte).every(s => s.color === '#1d4ed8')).toBe(true);
  });
});

describe('mettreEnLignes', () => {
  const mesurer = (t: string) => t.length;

  it('coupe aux espaces sans dépasser la largeur', () => {
    const lignes = mettreEnLignes([{ text: 'aaa bbb ccc ddd' }], 7, mesurer);
    expect(lignes.map(l => l.map(m => m.text).join(''))).toEqual(['aaa bbb', 'ccc ddd']);
  });

  it('garde le style par morceau et la somme des largeurs', () => {
    const lignes = mettreEnLignes([{ text: 'un ' }, { text: 'deux', b: true }], 20, mesurer);
    expect(lignes).toHaveLength(1);
    expect(lignes[0].map(m => [m.text, !!m.b])).toEqual([['un ', false], ['deux', true]]);
    expect(lignes[0].reduce((s, m) => s + m.largeur, 0)).toBe(7);
  });

  it('dépose seul un mot plus large que la ligne', () => {
    const lignes = mettreEnLignes([{ text: 'xx demesurement' }], 5, mesurer);
    expect(lignes.map(l => l.map(m => m.text).join(''))).toEqual(['xx', 'demesurement']);
  });

  it('rend une ligne vide pour un paragraphe vide', () => {
    expect(mettreEnLignes([], 10, mesurer)).toEqual([[]]);
  });
});
