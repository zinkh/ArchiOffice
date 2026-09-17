// write_dpgf_article (packages/archioffice-agents/src/server/projectDocTools.ts)
// est le seul moyen pour un agent d'écrire un CCTP/DPGF depuis que la
// ressource 'specifications' d'AGENT_RESOURCES a été signalée obsolète pour
// cet usage (CLAUDE.md, « Le CCTP n'est pas un document séparé » — voir aussi
// l'incident du 7 septembre 2026 sur cette même ressource). Comme le reste
// des outils d'agent, il dépend d'un aller-retour HTTP en boucle locale
// (voir tools.ts) : ces tests stubbent global.fetch plutôt que de faire
// tourner un vrai serveur, même parti que tests/agentInterop.test.ts.
import { afterEach, describe, expect, it, vi } from 'vitest';

import { buildAgentTools, executeAgentAction } from '../packages/archioffice-agents/src/server/tools';
import { capabilitiesFromAgent } from '../packages/archioffice-agents/src/types';

const NO_CAPS = { action_scopes: [], web_fetch_enabled: false, mail_enabled: false, mail_send_enabled: false, geo_enabled: false, docs_read_enabled: false };

afterEach(() => { vi.unstubAllGlobals(); });

describe('capabilitiesFromAgent — docsWrite', () => {
  it("n'accorde jamais l'écriture sans la lecture, même invariant que mailSend", () => {
    expect(capabilitiesFromAgent({ docs_read_enabled: false, docs_write_enabled: true }).docsWrite).toBe(false);
    expect(capabilitiesFromAgent({ docs_read_enabled: true, docs_write_enabled: false }).docsWrite).toBe(false);
    expect(capabilitiesFromAgent({ docs_read_enabled: true, docs_write_enabled: true }).docsWrite).toBe(true);
  });
});

describe('périmètre des outils — write_dpgf_article', () => {
  it("n'expose pas write_dpgf_article avec la seule lecture activée", () => {
    const names = buildAgentTools(capabilitiesFromAgent({ ...NO_CAPS, docs_read_enabled: true })).map(t => t.name);
    expect(names).toContain('read_dpgf');
    expect(names).not.toContain('write_dpgf_article');
  });

  it("expose write_dpgf_article quand lecture et écriture sont activées", () => {
    const names = buildAgentTools(capabilitiesFromAgent({ ...NO_CAPS, docs_read_enabled: true, docs_write_enabled: true })).map(t => t.name);
    expect(names).toContain('write_dpgf_article');
  });
});

describe('executeAgentAction — write_dpgf_article', () => {
  const caps = capabilitiesFromAgent({ ...NO_CAPS, docs_read_enabled: true, docs_write_enabled: true });
  const baseArgs = {
    project_id: 'proj-1',
    lot: { numero: '1', titre: 'Gros œuvre' },
    chapitre: { numero: '1.1', titre: 'Fondations' },
    article: { numero: '1.1.1', designation: 'Semelles filantes', unite: 'ml', quantite: 10, prix_unitaire: 120, cctp_description: 'Béton armé dosé à 350 kg/m³.' },
  };

  it("refuse l'appel sans docs_write_enabled, sans toucher le réseau", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const readOnlyCaps = capabilitiesFromAgent({ ...NO_CAPS, docs_read_enabled: true });
    const result = await executeAgentAction('http://127.0.0.1:1', { authorization: 'Bearer x' }, readOnlyCaps, {
      name: 'write_dpgf_article', args: baseArgs,
    });
    expect(result.response.error).toMatch(/écriture/i);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("crée un DPGF, son lot, son chapitre et son article quand rien n'existe encore", async () => {
    let posted: any = null;
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: any) => {
      if (init?.method !== 'POST') return { ok: false, status: 404, json: async () => ({ error: 'DPGF not found' }) } as any;
      posted = JSON.parse(init.body);
      return { ok: true, status: 200, json: async () => posted } as any;
    }));

    const result = await executeAgentAction('http://127.0.0.1:1', { authorization: 'Bearer x' }, caps, {
      name: 'write_dpgf_article', args: baseArgs,
    });

    expect(result.response.error).toBeUndefined();
    expect(posted.lots).toHaveLength(1);
    const lot = posted.lots[0];
    expect(lot.numero).toBe('1');
    expect(lot.titre).toBe('Gros œuvre');
    const chapitre = lot.chapitres[0];
    expect(chapitre.numero).toBe('1.1');
    const ligne = chapitre.lignes[0];
    expect(ligne.designation).toBe('Semelles filantes');
    expect(ligne.cctpDescription).toBe('Béton armé dosé à 350 kg/m³.');
    expect(ligne.prixTotal).toBe(1200);
    expect(lot.sousTotal).toBe(1200);
    expect(posted.totalHT).toBe(1200);
    expect(posted.totalTTC).toBe(1440); // TVA 20% par défaut pour un DPGF neuf
    expect((result.response as any).actions).toMatch(/DPGF créé/);
  });

  it('met à jour un article existant sans dupliquer le lot ni le chapitre', async () => {
    const existingDpgf = {
      id: 'dpgf-1', projectId: 'proj-1', titre: 'DPGF', version: '1.0', dateCreation: '2026-01-01', statut: 'draft', TVA: 20,
      lots: [{
        id: 'lot-1', numero: '1', titre: 'Gros œuvre', sousTotal: 500,
        chapitres: [{
          id: 'chap-1', numero: '1.1', titre: 'Fondations',
          lignes: [{ id: 'ligne-1', numero: '1.1.1', designation: 'Semelles filantes', unite: 'ml', quantite: 5, prixUnitaire: 100, prixTotal: 500, type: 'ouvrage' }],
        }],
      }],
      totalHT: 500, totalTTC: 600,
    };
    let posted: any = null;
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: any) => {
      if (init?.method !== 'POST') return { ok: true, status: 200, json: async () => existingDpgf } as any;
      posted = JSON.parse(init.body);
      return { ok: true, status: 200, json: async () => posted } as any;
    }));

    const result = await executeAgentAction('http://127.0.0.1:1', { authorization: 'Bearer x' }, caps, {
      name: 'write_dpgf_article',
      args: { project_id: 'proj-1', lot: { numero: '1' }, chapitre: { numero: '1.1' }, article: { numero: '1.1.1', quantite: 10 } },
    });

    expect(result.response.error).toBeUndefined();
    expect(posted.lots).toHaveLength(1);
    expect(posted.lots[0].chapitres).toHaveLength(1);
    expect(posted.lots[0].chapitres[0].lignes).toHaveLength(1);
    const ligne = posted.lots[0].chapitres[0].lignes[0];
    expect(ligne.designation).toBe('Semelles filantes'); // inchangé, non fourni
    expect(ligne.quantite).toBe(10); // mis à jour
    expect(ligne.prixUnitaire).toBe(100); // inchangé
    expect(ligne.prixTotal).toBe(1000);
    expect(posted.lots[0].sousTotal).toBe(1000);
    expect((result.response as any).actions).toMatch(/mis à jour/);
  });

  it("refuse de créer un lot inconnu sans titre", async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 404, json: async () => ({ error: 'DPGF not found' }) } as any)));
    const result = await executeAgentAction('http://127.0.0.1:1', { authorization: 'Bearer x' }, caps, {
      name: 'write_dpgf_article',
      args: { project_id: 'proj-1', lot: { numero: '9' }, chapitre: { numero: '9.1', titre: 'x' }, article: { numero: '9.1.1', designation: 'x' } },
    });
    expect(result.response.error).toMatch(/lot.titre/);
  });
});
