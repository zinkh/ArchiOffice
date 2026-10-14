// Dossier de références : mise en forme, gabarit HTML et — surtout — garantie
// qu'une image d'un autre projet ou d'un autre cabinet n'est jamais embarquée.
import { beforeAll, describe, expect, it } from 'vitest';
import { Jimp, JimpMime } from 'jimp';
import { fakeSupabaseAdmin, makeTenant } from './testServer';
import {
  agencyAcronym, classeNbImages, deriveCityDept, nc, pageLabel, parseAmount, sheetTitle, surfaceBudgetLine,
} from '../server/referencesDossier/format';
import { buildDossierHtml, imagesBlock } from '../server/referencesDossier/template';
import { loadAgency, resolveReferences } from '../server/referencesDossier/data';
import type { DossierAgency, ReferenceSheetData, SheetImage } from '../server/referencesDossier/types';

let jpegDataUrl = '';
beforeAll(async () => {
  const im = new Jimp({ width: 40, height: 30, color: 0x808080ff });
  jpegDataUrl = `data:image/jpeg;base64,${(await im.getBuffer(JimpMime.jpeg)).toString('base64')}`;
});

const agency: DossierAgency = {
  name: 'AAZS', acronym: 'AAZS', manager: 'Khaldoun SEKTAOUI', address: '23 Bd de l’Europe', phone: '0684016633',
  email: 'contact@aazs.fr', siret: '102 663 416 00018', oaNumber: null, vatNumber: null, logoDataUrl: null,
};
const imgs = (n: number): SheetImage[] => Array.from({ length: n }, (_, i) => ({ id: `i${i}`, dataUrl: 'data:image/jpeg;base64,AAAA' }));
const sheet = (over: Partial<ReferenceSheetData> = {}): ReferenceSheetData => ({
  key: 'project:1', name: 'Projet', nature: null, city: null, department: null, programme: null, labels: null,
  maitreOuvrage: null, maitreOeuvre: null, mission: null, phase: null, surface: null, amountText: null, amount: null,
  year: null, images: [], ...over,
});

describe('mise en forme', () => {
  it('nc() : toute donnée vide devient « NC »', () => {
    expect(nc(null)).toBe('NC');
    expect(nc('   ')).toBe('NC');
    expect(nc('SAS 3B')).toBe('SAS 3B');
  });
  it('ne devine ni la ville ni le département sans code postal', () => {
    expect(deriveCityDept('Rue de la République')).toEqual({ city: null, department: null });
    expect(deriveCityDept('54000 Nancy')).toEqual({ city: 'Nancy', department: '54' });
    expect(deriveCityDept('3T Rue Georges Bizet 54500 Vandœuvre-lès-Nancy')).toEqual({ city: 'Vandœuvre-lès-Nancy', department: '54' });
    expect(deriveCityDept('Impasse du Chenet 74100 Vétraz-Monthoux').department).toBe('74');
    expect(deriveCityDept('Quai 97400 Saint-Denis').department).toBe('974');
    expect(deriveCityDept('Rue X 20000 Ajaccio').department).toBeNull();
  });
  it('un montant à zéro ou illisible est une donnée absente', () => {
    expect(parseAmount('0')).toBeNull();
    expect(parseAmount('')).toBeNull();
    expect(parseAmount('8 120')).toBe(8120);
    expect(parseAmount('1 200,5')).toBe(1200.5);
    expect(parseAmount('abc')).toBeNull();
  });
  it('titre « NATURE — Ville (Dépt) » en majuscules, éléments inconnus omis', () => {
    expect(sheetTitle({ name: 'X', nature: 'Construction de 113 logements', city: 'Malzéville', department: '54' }))
      .toBe('CONSTRUCTION DE 113 LOGEMENTS — MALZÉVILLE (54)');
    expect(sheetTitle({ name: 'Villa Martin', nature: null, city: null, department: null })).toBe('VILLA MARTIN');
  });
  it('Surface / Budget : parties connues, « NC » sinon, jamais inventé', () => {
    expect(surfaceBudgetLine({ surface: 8120, amount: 10889185, amountText: null })).toBe('8 120 m² — 10 889 185 € HT travaux');
    expect(surfaceBudgetLine({ surface: null, amount: null, amountText: null })).toBe('NC — NC');
  });
  it('sigle du cabinet et pagination', () => {
    expect(agencyAcronym('Atelier d’Architecture Zomeno Sektaoui')).toBe('AAZS');
    expect(agencyAcronym('AAZS')).toBe('AAZS');
    expect(pageLabel(1, 1)).toBe('01 / 01');
    expect(pageLabel(3, 120)).toBe('003 / 120');
  });
  it('classeNbImages : n1..n6, vide sans image, plafonné à 6', () => {
    expect(classeNbImages(0)).toBe('');
    expect(classeNbImages(3)).toBe('n3');
    expect(classeNbImages(9)).toBe('n6');
  });
});

describe('gabarit HTML', () => {
  it('.thumbs n’existe qu’à partir de 4 images', () => {
    for (const n of [1, 2, 3]) expect(imagesBlock(imgs(n), 'portrait', 'x')).not.toContain('class="thumbs"');
    for (const n of [4, 5, 6]) expect(imagesBlock(imgs(n), 'portrait', 'x')).toContain('class="thumbs"');
  });
  it('n’imprime que les figures qui ont une image, et au plus 6', () => {
    expect((imagesBlock(imgs(9), 'landscape', 'x').match(/<figure>/g) || []).length).toBe(6);
    expect(imagesBlock([], 'portrait', 'x')).not.toContain('<figure>');
  });
  it('portrait : 1 grande image puis vignettes ; paysage : 2 grandes puis vignettes', () => {
    expect(imagesBlock(imgs(5), 'portrait', 'x')).toMatch(/^<div class="images n5 o-portrait"><figure>.*<\/figure><div class="thumbs">(<figure>.*?<\/figure>){4}<\/div><\/div>$/);
    expect(imagesBlock(imgs(5), 'landscape', 'x')).toMatch(/o-landscape"><figure>.*?<\/figure><figure>.*?<\/figure><div class="thumbs">(<figure>.*?<\/figure>){3}<\/div>/);
  });
  it('toute donnée manquante est « NC » ; le texte est échappé', () => {
    const html = buildDossierHtml({ agency, orientation: 'portrait', references: [sheet({ name: 'A <b>&', images: imgs(1) })] });
    expect(html).toContain('NC');
    expect(html).not.toContain('<b>&');
    expect(html).toContain('A &lt;b&gt;&amp;');
    expect(html).toContain('03 / 03'); // couverture + liste + fiche
  });
  it('couleur d’accent unique #b2242a, ni dégradé ni emoji', () => {
    const html = buildDossierHtml({ agency, orientation: 'landscape', references: [sheet({ images: imgs(2) })] });
    expect(html).toContain('#b2242a');
    expect(html).not.toMatch(/gradient\(/);
    expect(html).not.toMatch(/\p{Extended_Pictographic}/u);
  });
});

describe('résolution des données : aucune image d’un autre projet', () => {
  it('ignore une image appartenant à un autre projet ou à un autre cabinet', async () => {
    const tenantA = makeTenant();
    const tenantB = makeTenant();
    fakeSupabaseAdmin.seed('settings', [{ tenant_id: tenantA, agency_name: 'AAZS', architect_name: 'K. S.' }]);
    fakeSupabaseAdmin.seed('projects', [
      { id: 'pA', tenant_id: tenantA, name: 'Projet A', client: 'MOA A', image_url: jpegDataUrl, address: '54000 Nancy' },
      { id: 'pB', tenant_id: tenantA, name: 'Projet B', client: 'MOA B', image_url: null },
      { id: 'pX', tenant_id: tenantB, name: 'Projet X', client: 'MOA X', image_url: null },
    ]);
    fakeSupabaseAdmin.seed('documents', [
      { id: 'dA', tenant_id: tenantA, project_id: 'pA', name: 'a.jpg', category: 'Photos', file_url: jpegDataUrl },
      { id: 'dB', tenant_id: tenantA, project_id: 'pB', name: 'b.jpg', category: 'Photos', file_url: jpegDataUrl },
      { id: 'dX', tenant_id: tenantB, project_id: 'pX', name: 'x.jpg', category: 'Photos', file_url: jpegDataUrl },
    ]);
    const ag = await loadAgency(fakeSupabaseAdmin, tenantA);
    const { references, warnings } = await resolveReferences(fakeSupabaseAdmin, tenantA, ag, [
      { source: 'project', id: 'pA', imageIds: ['cover', 'doc:dA', 'doc:dB', 'doc:dX'] },
    ]);
    expect(references).toHaveLength(1);
    expect(references[0].images.map(i => i.id)).toEqual(['cover', 'doc:dA']);
    expect(warnings.filter(w => w.includes('doc:dB') || w.includes('doc:dX'))).toHaveLength(2);
    // Ville et département déduits de l'adresse, jamais inventés ailleurs.
    expect(references[0].city).toBe('Nancy');
    expect(references[0].department).toBe('54');
    expect(references[0].labels).toBeNull();
    expect(references[0].maitreOuvrage).toBe('MOA A');
  });
  it('refuse une référence d’un autre cabinet', async () => {
    const tenantA = makeTenant();
    const tenantB = makeTenant();
    fakeSupabaseAdmin.seed('projects', [{ id: 'pZ', tenant_id: tenantB, name: 'Autre', client: 'c', image_url: jpegDataUrl }]);
    const ag = await loadAgency(fakeSupabaseAdmin, tenantA);
    const { references, warnings } = await resolveReferences(fakeSupabaseAdmin, tenantA, ag, [{ source: 'project', id: 'pZ' }]);
    expect(references).toHaveLength(0);
    expect(warnings[0]).toContain('introuvable');
  });
  it('le texte du programme modifié à l’export ne touche pas la base', async () => {
    const tenant = makeTenant();
    fakeSupabaseAdmin.seed('projects', [{ id: 'pP', tenant_id: tenant, name: 'P', client: 'c', programme: 'Original' }]);
    const ag = await loadAgency(fakeSupabaseAdmin, tenant);
    const { references } = await resolveReferences(fakeSupabaseAdmin, tenant, ag, [{ source: 'project', id: 'pP', programOverride: 'Texte d’export' }]);
    expect(references[0].programme).toBe('Texte d’export');
    expect(fakeSupabaseAdmin.getTable('projects').find((p: any) => p.id === 'pP')?.programme).toBe('Original');
  });
});
