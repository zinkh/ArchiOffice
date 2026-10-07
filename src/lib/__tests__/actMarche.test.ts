import { describe, expect, it } from 'vitest';
import { POINTILLES, construireCCAP, construireRC, type ContexteMarche, type DocModele } from '../actMarche';

const ctx: ContexteMarche = {
  operation: { nom: 'Villa Martin', code: '26014', adresse: '1 rue des Lilas, Nancy' },
  params: { moa_nom: 'M. Martin', nature_travaux: 'la construction d\'une maison', retenue_garantie_pct: 5 },
  agence: { nom: 'AAZS', adresse: 'Nancy' },
};
const texte = (d: DocModele) => d.blocs.map(b => ('text' in b ? b.text : b.t === 'kv' ? b.rows.flat().join(' ') : '')).join('\n');

describe('documents du marché', () => {
  it('le CCAP reprend les 17 articles du modèle', () => {
    const titres = construireCCAP(ctx).blocs.filter(b => b.t === 'h').map(b => (b as { text: string }).text);
    expect(titres).toHaveLength(17);
    expect(titres[16]).toBe('17. Conditions diverses');
  });

  it('une valeur absente reste en pointillés, jamais inventée', () => {
    const t = texte(construireCCAP(ctx));
    expect(t).toContain(`pénalité forfaitaire de ${POINTILLES} € TTC`);
    expect(t).toContain('Retenue de garantie : elle correspond à 5 %');
  });

  it('le financement par prêt n\'apparaît que s\'il est activé', () => {
    expect(texte(construireCCAP(ctx))).toContain('Sans objet : le maître d\'ouvrage acquitte');
    const avec = texte(construireCCAP({ ...ctx, params: { ...ctx.params, financement_pret: true } }));
    expect(avec).toContain('12.1');
  });

  it('le CCAP renvoie à la norme NF P 03-001 et jamais au sigle CCAG', () => {
    const t = texte(construireCCAP(ctx));
    expect(t).not.toContain('CCAG');
    expect(t).toContain('article 9.5 de la norme NF P 03-001');
    expect(t).toContain('article 20.5 de la norme NF P 03-001');
  });

  it('le RC liste critères, pièces et lots de la consultation', () => {
    const rc = construireRC(ctx, {
      dce: [{ nom: 'CCTP', type_doc: 'CCTP' }], piecesAdmin: [{ id: 'k', nom: 'Extrait Kbis' }], piecesOffre: [{ id: 'a', nom: 'Acte d\'engagement' }],
      criteres: [{ nom: 'Prix', poids: 60 }, { nom: 'Technique', poids: 40 }], lots: [{ numero: '01', titre: 'Gros œuvre' }],
    });
    const t = texte(rc);
    expect(t).toContain('Prix : 60 %');
    expect(t).toContain('Extrait Kbis');
    expect(t).toContain('Lot 01 : Gros œuvre');
  });
});
