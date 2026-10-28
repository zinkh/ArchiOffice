// Rendu réel par Chromium : une seule page à la bonne taille, quels que soient le format,
// l'orientation et le nombre de lots, et débordement détecté plutôt que rogné en silence.
// Ignoré quand aucun Chromium n'est installé (poste de développement sans navigateur).
import { beforeAll, describe, expect, it } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import { resolveChromiumPath, renderHtmlToPdf } from '../server/referencesDossier/render';
import { pageSpec, type PanneauFormat, type PanneauOrientation } from '../server/panneaux/pageSpec';
import { buildChantierHtml } from '../server/panneaux/chantierTemplate';
import { buildPermisHtml } from '../server/panneaux/permisTemplate';
import type { ChantierPanelData, PermisPanelData } from '../server/panneaux/types';

const chromium = await resolveChromiumPath();
const agency = { name: 'AAZS', acronym: 'AAZS', manager: 'K. S.', address: '23 Bd de l’Europe', phone: '0684016633', email: 'contact@aazs.fr', siret: '1', oaNumber: 'S26332', vatNumber: 'FR3', logoDataUrl: null };
const chantier = (n: number): ChantierPanelData => ({
  agency, projectName: 'École VIP-TC', kicker: 'Chantier', facts: [], image: null,
  maitriseOuvrage: [{ key: 'moa', role: 'Maître d’ouvrage', name: 'REVI', address: [], logo: null, contactId: null }],
  maitriseOeuvre: [{ key: 'moe', role: 'Architecte', name: 'AAZS', address: [], logo: null, contactId: null }],
  lots: Array.from({ length: n }, (_, i) => ({ key: `lot:${i}`, number: String(i), title: 'Couverture tuiles, zinc, étanchéité', company: `ENTREPRISE ${i}`, address: ['1 rue X', '54000 NANCY'], logo: null, contactId: null })),
  sousTraitants: [], warnings: [],
});
const permis: PermisPanelData = {
  agency, permitType: 'PC', etat: 'brouillon', beneficiaire: 'REVI', architecte: 'K. S.', numero: 'PC 1', dateDelivrance: null, natureProjet: 'École',
  adresseTerrain: null, superficieTerrainM2: 100, surfacePlancherM2: null, nombreLogements: null, hauteurM: null, mairieNom: null, mairieAdresse: null, missingRequired: [], warnings: [],
};

async function render(html: string, f: PanneauFormat, o: PanneauOrientation) {
  const spec = pageSpec(f, o);
  const { pdf, overflow } = await renderHtmlToPdf(html, { width: `${spec.widthMm}mm`, height: `${spec.heightMm}mm` });
  const doc = await PDFDocument.load(pdf);
  const { width, height } = doc.getPage(0).getSize();
  return { pages: doc.getPageCount(), overflow, widthMm: (width / 72) * 25.4, heightMm: (height / 72) * 25.4 };
}

// Chaque rendu lance son propre Chromium : sur un exécuteur de CI lent, le démarrage à froid
// s'ajoutait au rendu A0 du premier cas et dépassait les 60 s (échec sans rapport avec le code).
const RENDER_TIMEOUT_MS = 180_000;

describe.skipIf(!chromium)('rendu Chromium des panneaux', () => {
  // Rendu minimal pour amorcer Chromium (disque, bibliothèques) avant les cas qui mesurent un vrai panneau.
  beforeAll(async () => {
    await renderHtmlToPdf('<!doctype html><html><body><div class="body">amorce</div></body></html>', { width: '50mm', height: '50mm' });
  }, RENDER_TIMEOUT_MS);

  const cases: Array<[string, number, PanneauFormat, PanneauOrientation]> = [
    ['25 lots A0 portrait', 25, 'A0', 'portrait'],
    ['27 lots A0 paysage', 27, 'A0', 'paysage'],
    ['48 lots A0 portrait', 48, 'A0', 'portrait'],
    ['25 lots A1 portrait', 25, 'A1', 'portrait'],
  ];
  for (const [name, n, f, o] of cases) {
    it(`panneau de chantier, ${name} : une page, à la bonne taille, sans débordement`, async () => {
      const spec = pageSpec(f, o);
      const r = await render(buildChantierHtml(chantier(n), { page: spec, logos: true, colorLogos: false, hidden: new Set(), hiddenLogos: new Set(), qrUrl: 'https://app.test/chantier/abcdefghijklmnopqrstuv.wxyz0123456789' }), f, o);
      expect(r.pages).toBe(1);
      expect(r.overflow).toBe(false);
      expect(Math.abs(r.widthMm - spec.widthMm)).toBeLessThan(2);
      expect(Math.abs(r.heightMm - spec.heightMm)).toBeLessThan(2);
    }, RENDER_TIMEOUT_MS);
  }
  it('un contenu trop long est signalé comme débordement, jamais rogné en silence', async () => {
    const r = await render(buildChantierHtml(chantier(120), { page: pageSpec('A2', 'portrait'), logos: true, colorLogos: false, hidden: new Set(), hiddenLogos: new Set() }), 'A2', 'portrait');
    expect(r.overflow).toBe(true);
  }, RENDER_TIMEOUT_MS);
  for (const [f, o] of [['A0', 'portrait'], ['A0', 'paysage'], ['80x120', 'portrait'], ['A4', 'portrait']] as Array<[PanneauFormat, PanneauOrientation]>) {
    it(`panneau de permis ${f} ${o} : une page, sans débordement`, async () => {
      const spec = pageSpec(f, o);
      const r = await render(buildPermisHtml(permis, spec), f, o);
      expect(r.pages).toBe(1);
      expect(r.overflow).toBe(false);
      expect(Math.abs(r.widthMm - spec.widthMm)).toBeLessThan(2);
    }, RENDER_TIMEOUT_MS);
  }
});
