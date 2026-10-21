// Panneau de chantier : adaptation au nombre de lots, logos (validation, niveaux
// de gris), résolution des entreprises depuis les marchés, et isolation entre cabinets.
import { beforeAll, describe, expect, it } from 'vitest';
import { Jimp } from 'jimp';
import { fakeSupabaseAdmin, makeTenant } from './testServer';
import { pageSpec } from '../server/panneaux/pageSpec';
import { buildChantierHtml, density, lotColumns } from '../server/panneaux/chantierTemplate';
import { compareLotNumbers, loadChantierPanel, normalizeLotNumber } from '../server/panneaux/chantierData';
import { logoDpi, prepareLogo } from '../server/panneaux/logos';
import { qrSvg } from '../server/panneaux/qr';
import { chantierPublicUrl, signChantierToken, verifyChantierToken } from '../server/panneaux/publicLink';
import type { ChantierPanelData, ChantierPanelOptions, PanelLot, PanelParty } from '../server/panneaux/types';

let pngDataUrl = '';
beforeAll(async () => {
  const im = new Jimp({ width: 60, height: 30, color: 0x336699ff });
  pngDataUrl = `data:image/png;base64,${(await im.getBuffer('image/png')).toString('base64')}`;
});

const agency = {
  name: 'AAZS', acronym: 'AAZS', manager: 'K. S.', address: '23 Bd de l’Europe', phone: '0684016633', email: 'contact@aazs.fr',
  siret: '102 663 416 00018', oaNumber: 'S26332', vatNumber: 'FR31102663416', logoDataUrl: null,
};
const lot = (i: number, over: Partial<PanelLot> = {}): PanelLot => ({
  key: `lot:${i}`, number: String(i).padStart(2, '0'), title: `Lot ${i}`, company: `ENTREPRISE ${i}`, address: ['1 rue X', '54000 NANCY'], logo: null, contactId: null, ...over,
});
const party = (key: string, name: string, over: Partial<PanelParty> = {}): PanelParty => ({ key, role: 'Rôle', name, address: [], logo: null, contactId: null, ...over });
const data = (lots: PanelLot[], over: Partial<ChantierPanelData> = {}): ChantierPanelData => ({
  agency, projectName: 'École VIP-TC', kicker: 'Chantier', facts: [], image: null,
  maitriseOuvrage: [party('moa', 'REVI')], maitriseOeuvre: [party('moe', 'AAZS')], lots, sousTraitants: [], warnings: [], ...over,
});
const opts = (over: Partial<ChantierPanelOptions> = {}): ChantierPanelOptions => ({
  page: pageSpec('A0', 'portrait'), logos: true, colorLogos: false, hidden: new Set(), hiddenLogos: new Set(), ...over,
});

describe('format et colonnes', () => {
  it('le nombre de colonnes de lots s’adapte au nombre de lots', () => {
    expect(lotColumns(10, 'portrait')).toBe(3);
    expect(lotColumns(27, 'portrait')).toBe(3);
    expect(lotColumns(28, 'portrait')).toBe(4);
    expect(lotColumns(40, 'paysage')).toBe(4);
    expect(lotColumns(41, 'paysage')).toBe(5);
    expect(density(3)).toBe('m');
    expect(density(5)).toBe('xs');
  });
  it('un A1 est un A0 réduit : même mise en page, zoom proportionnel', () => {
    const a1 = pageSpec('A1', 'portrait');
    expect(a1.widthMm).toBe(594);
    expect(a1.zoom).toBeCloseTo(594 / 841, 5);
    expect(Math.abs(a1.baseHeightMm - 1189)).toBeLessThan(3); // les formats A ne sont pas exactement homothétiques
    const land = pageSpec('A0', 'paysage');
    expect([land.widthMm, land.heightMm]).toEqual([1189, 841]);
  });
});

describe('gabarit du panneau de chantier', () => {
  it('une carte par lot, entreprise à désigner si vide, texte échappé', () => {
    const html = buildChantierHtml(data([lot(1, { company: 'A <b>&' }), lot(2, { company: null, address: [] })]), opts());
    expect((html.match(/class="lot"/g) || []).length).toBe(2);
    expect(html).toContain('Entreprise à désigner');
    expect(html).toContain('A &lt;b&gt;&amp;');
    expect(html).not.toContain('A <b>&');
  });
  it('masque les lignes désignées', () => {
    const html = buildChantierHtml(data([lot(1), lot(2)]), opts({ hidden: new Set(['lot:2', 'moa']) }));
    expect(html).toContain('ENTREPRISE 1');
    expect(html).not.toContain('ENTREPRISE 2');
    expect(html).not.toContain('REVI');
  });
  it('logos : niveaux de gris par défaut, couleur sur option, masquables par ligne ou en bloc', () => {
    const logo = { dataUrl: pngDataUrl, widthPx: 60, heightPx: 30 };
    const lots = [lot(1, { logo }), lot(2, { logo })];
    const gris = buildChantierHtml(data(lots), opts());
    expect((gris.match(/class="llogo"/g) || []).length).toBe(2);
    expect(gris).toContain('grayscale(1)');
    expect(buildChantierHtml(data(lots), opts({ colorLogos: true }))).not.toContain('grayscale(1)');
    expect((buildChantierHtml(data(lots), opts({ hiddenLogos: new Set(['lot:1']) })).match(/class="llogo"/g) || []).length).toBe(1);
    expect(buildChantierHtml(data(lots), opts({ logos: false }))).not.toContain('class="llogo"');
  });
  it('une entreprise sans logo n’a aucune image ni espace réservé', () => {
    const html = buildChantierHtml(data([lot(1)]), opts());
    expect(html).not.toContain('<img class="llogo"');
  });
  it('paysage : même contenu, structure en deux colonnes ; ni pied de page ni pagination', () => {
    const html = buildChantierHtml(data([lot(1)]), opts({ page: pageSpec('A0', 'paysage') }));
    expect(html).toContain('class="body ls"');
    expect(html).not.toContain('P1|1');
    expect(html).not.toContain('class="foot"');
    expect(html).not.toContain('contact@aazs.fr');
    expect(html).toContain('size:1189mm 841mm');
  });
  it('titre libre prioritaire sur le nom de l’affaire', () => {
    expect(buildChantierHtml(data([lot(1)]), opts({ title: 'Mon titre' }))).toContain('Mon titre');
  });
  it('charte sobre : ni dégradé ni emoji', () => {
    const html = buildChantierHtml(data([lot(1)]), opts());
    expect(html).not.toMatch(/gradient\(/);
    expect(html).not.toMatch(/\p{Extended_Pictographic}/u);
  });
});

describe('logos', () => {
  it('accepte un PNG et mesure sa définition', async () => {
    const res = await prepareLogo(pngDataUrl);
    expect(res.logo).not.toBeNull();
    expect(res.logo!.heightPx).toBe(30);
    expect(logoDpi(res.logo!, 22)).toBeLessThan(100);
  });
  it('refuse un SVG, même annoncé comme une image', async () => {
    const svg = `data:image/svg+xml;base64,${Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>').toString('base64')}`;
    expect((await prepareLogo(svg)).logo).toBeNull();
    const lying = `data:image/png;base64,${Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>').toString('base64')}`;
    expect((await prepareLogo(lying)).logo).toBeNull();
  });
  it('refuse une donnée malformée, vide ou trop volumineuse', async () => {
    expect((await prepareLogo('pas une data url')).logo).toBeNull();
    expect((await prepareLogo(null)).logo).toBeNull();
    expect((await prepareLogo(`data:image/png;base64,${Buffer.alloc(2 * 1024 * 1024).toString('base64')}`)).logo).toBeNull();
  });
});

describe('numéros de lot', () => {
  it('« 02 » et « 2 », « 08.1 » et « 8.1 » désignent le même lot', () => {
    expect(normalizeLotNumber('02')).toBe('2');
    expect(normalizeLotNumber(' 08.1 ')).toBe('8.1');
    expect(normalizeLotNumber('00')).toBe('0');
  });
  it('tri naturel : 2 avant 10, 5.1 avant 5.2', () => {
    expect(['10', '2', '5.2', '5.1', '08.1'].sort(compareLotNumbers)).toEqual(['2', '5.1', '5.2', '08.1', '10']);
  });
});

describe('résolution depuis l’affaire', () => {
  it('prend l’entreprise du marché, à défaut de la fiche du lot, ordre naturel, logo de la fiche contact', async () => {
    const tenant = makeTenant();
    const other = makeTenant();
    fakeSupabaseAdmin.seed('settings', [{ tenant_id: tenant, agency_name: 'AAZS' }]);
    fakeSupabaseAdmin.seed('projects', [{ id: 'p1', tenant_id: tenant, name: 'École', client: 'REVI', client_id: 'cMoa' }]);
    fakeSupabaseAdmin.seed('contacts', [
      { id: 'cMoa', tenant_id: tenant, first_name: 'R', last_name: 'EVI', company_name: 'REVI', logo: pngDataUrl },
      { id: 'cLot2', tenant_id: tenant, first_name: 'A', last_name: 'B', company_name: 'HCT', address_work_street: '5 Allée des Prunus', address_work_zip: '54180', address_work_city: 'HOUDEMONT', logo: pngDataUrl },
      { id: 'cForeign', tenant_id: other, first_name: 'X', last_name: 'Y', company_name: 'AUTRE CABINET', logo: pngDataUrl },
    ]);
    fakeSupabaseAdmin.seed('project_lots', [
      { id: 'l10', tenant_id: tenant, project_id: 'p1', lot_number: '10', lot_title: 'Menuiseries', contact_id: null },
      { id: 'l2', tenant_id: tenant, project_id: 'p1', lot_number: '02', lot_title: 'Démolition', contact_id: 'cLot2' },
      { id: 'l4', tenant_id: tenant, project_id: 'p1', lot_number: '04', lot_title: 'Gros œuvre', contact_id: 'cForeign' },
    ]);
    fakeSupabaseAdmin.seed('marches_entreprises', [
      { id: 'm1', tenant_id: tenant, project_id: 'p1', entreprise_nom: 'BONECHER', lot_numero: '10', contact_id: null },
      { id: 'm2', tenant_id: tenant, project_id: 'p1', entreprise_nom: 'SOUS-TRAITANT SUBSEQUENT', lot_numero: '2', type_marche: 'subsequent' },
    ]);
    const panel = await loadChantierPanel(fakeSupabaseAdmin, tenant, 'p1', { withImage: false });
    expect(panel).not.toBeNull();
    expect(panel!.lots.map(l => l.number)).toEqual(['02', '04', '10']);
    expect(panel!.lots[0]).toMatchObject({ company: 'HCT', address: ['5 Allée des Prunus', '54180 HOUDEMONT'] });
    expect(panel!.lots[0].logo).not.toBeNull();
    expect(panel!.lots[2].company).toBe('BONECHER'); // marché de la consultation
    expect(panel!.maitriseOuvrage[0].logo).not.toBeNull();
    // Contact d'un autre cabinet : jamais relu, ni nom ni logo.
    expect(panel!.lots[1].company).toBeNull();
    expect(panel!.lots[1].logo).toBeNull();
    expect(JSON.stringify(panel)).not.toContain('AUTRE CABINET');
  });
  it('une affaire d’un autre cabinet est introuvable', async () => {
    const tenant = makeTenant();
    const other = makeTenant();
    fakeSupabaseAdmin.seed('projects', [{ id: 'pForeign', tenant_id: other, name: 'Autre', client: 'X' }]);
    expect(await loadChantierPanel(fakeSupabaseAdmin, tenant, 'pForeign', { withImage: false })).toBeNull();
  });
  it('un logo invalide est ignoré et signalé, sans faire échouer', async () => {
    const tenant = makeTenant();
    fakeSupabaseAdmin.seed('projects', [{ id: 'p2', tenant_id: tenant, name: 'X', client: 'C' }]);
    fakeSupabaseAdmin.seed('contacts', [{ id: 'cBad', tenant_id: tenant, first_name: 'A', last_name: 'B', company_name: 'SVG SA', logo: 'data:image/svg+xml;base64,PHN2Zy8+' }]);
    fakeSupabaseAdmin.seed('project_lots', [{ id: 'l1', tenant_id: tenant, project_id: 'p2', lot_number: '01', lot_title: 'T', contact_id: 'cBad' }]);
    const panel = await loadChantierPanel(fakeSupabaseAdmin, tenant, 'p2', { withImage: false });
    expect(panel!.lots[0].company).toBe('SVG SA');
    expect(panel!.lots[0].logo).toBeNull();
    expect(panel!.warnings.join(' ')).toContain('Logo ignoré');
  });
});

describe('QR code de la liste des entreprises', () => {
  beforeAll(() => { process.env.MAIL_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString('base64'); });

  it('sans pied de page : ni coordonnées de l’agence ni pagination, QR code en bas à droite avec son texte', () => {
    const html = buildChantierHtml(data([lot(1)]), opts({ qrUrl: 'https://app.test/chantier/abc' }));
    expect(html).not.toContain('class="foot"');
    expect(html).not.toContain('P1|1');
    expect(html).not.toContain('SIRET');
    expect(html).toContain('class="qr"');
    expect(html).toContain('<svg');
    expect(html).toContain('Flashez ce code');
  });
  it('sans adresse publique, pas de QR code', () => {
    expect(buildChantierHtml(data([lot(1)]), opts())).not.toContain('class="qr"');
  });
  it('le QR code est un SVG vectoriel noir sur blanc avec sa zone de silence', () => {
    const svg = qrSvg('https://app.test/chantier/abc');
    expect(svg).toMatch(/^<svg[^>]+viewBox="0 0 \d+ \d+"/);
    expect(svg).toContain('fill="#fff"');
    expect(svg).toContain('fill="#000"');
  });
  it('le jeton public est stable, lié à l’affaire et infalsifiable', () => {
    const t = signChantierToken('proj-0001-abcd');
    expect(signChantierToken('proj-0001-abcd')).toBe(t);
    expect(verifyChantierToken(t)).toBe('proj-0001-abcd');
    expect(verifyChantierToken(signChantierToken('proj-0002-abcd'))).toBe('proj-0002-abcd');
    const [body, tag] = t.split('.');
    expect(verifyChantierToken(`${body}.${tag.slice(0, -1)}A`)).toBeNull();
    expect(verifyChantierToken(`${Buffer.from('proj-0002-abcd').toString('base64url')}.${tag}`)).toBeNull();
    expect(verifyChantierToken('n’importe quoi')).toBeNull();
    expect(verifyChantierToken(undefined)).toBeNull();
    expect(chantierPublicUrl('https://app.test/', 'proj-0001-abcd')).toBe(`https://app.test/chantier/${t}`);
  });
});
