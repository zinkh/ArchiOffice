import { describe, it, expect } from 'vitest';
import { SourceCorpus, checkSource, normalizeForMatch } from '../packages/archioffice-agents/src/server/provenance.js';
import { executeAgentAction } from '../packages/archioffice-agents/src/server/tools.js';

const caps: any = { actionScopes: ['tasks'] };
const doc = 'Maçonnerie / Gros œuvre | Extérieurs / Cheminement extérieur | Escalier non conforme : absence de bande d\'éveil';

function corpus() {
  const c = new SourceCorpus();
  c.addUserText('Voici le fichier Excel');
  c.addDocumentText(doc);
  return c;
}

describe('pas de création sans source', () => {
  it('normalise casse, accents, ligatures et ponctuation', () => {
    expect(normalizeForMatch("Gros ŒUVRE : Éveil !")).toBe('gros oeuvre eveil');
  });

  it('accepte une citation exacte du document lu', () => {
    const r = checkSource({ source: { type: 'document_joint', citation: "escalier non conforme : absence de bande d'éveil" } }, corpus());
    expect(r.ok).toBe(true);
  });

  it('refuse une citation inventée (le cas Sophie)', () => {
    const r = checkSource({ source: { type: 'document_joint', citation: 'Levée de réserve - Électricité : Remplacement des interrupteurs défectueux' } }, corpus());
    expect(r.ok).toBe(false);
    expect((r.response as any).code).toBe('SOURCE_NON_VERIFIEE');
  });

  it('accepte une source sans location : le champ est facultatif et jamais vérifié', () => {
    const citation = "escalier non conforme : absence de bande d'éveil";
    expect(checkSource({ source: { type: 'document_joint', citation } }, corpus()).ok).toBe(true);
    expect(checkSource({ source: { type: 'document_joint', citation, location: 'x' } }, corpus()).ok).toBe(true);
  });

  it('refuse l\'absence de source et les citations trop courtes', () => {
    expect(checkSource({}, corpus()).ok).toBe(false);
    expect(checkSource({ source: { type: 'demande_utilisateur', citation: 'Gros œuvre' } }, corpus()).ok).toBe(false);
  });

  it('ne laisse pas l\'agent se citer lui-même ni citer un résultat d\'écriture', () => {
    const c = corpus();
    c.addToolResult('create_record', { record: { title: 'Remplacement des interrupteurs défectueux' } });
    c.addToolResult('consulter_agent', { reponse: 'Remplacement des interrupteurs défectueux' });
    expect(c.contains('Remplacement des interrupteurs défectueux')).toBe(false);
    c.addToolResult('read_document', { text: 'Remplacement des interrupteurs défectueux' });
    expect(c.contains('Remplacement des interrupteurs défectueux')).toBe(true);
  });

  it('retrouve une citation multiligne dans une page lue (cas SIBE)', () => {
    const c = corpus();
    c.addToolResult('fetch_url', {
      url: 'https://exemple.fr',
      text: "SIBE Bureau d'études VRD\n7 chemin de la Moselle\n57160 SCY-CHAZELLES\nTél. 03.87.18.11.40",
    });
    const citation = "SIBE Bureau d'études VRD\n7 chemin de la Moselle\n57160 SCY-CHAZELLES";
    expect(checkSource({ source: { type: 'web', citation } }, c).ok).toBe(true);
  });

  it('accepte plusieurs passages séparés par « … », chacun vérifié', () => {
    const c = corpus();
    c.addToolResult('fetch_url', { text: "SIBE Bureau d'études VRD\n7 chemin de la Moselle\nTél. 03.87.18.11.40" });
    c.addUserText("Je confirme que betsibe@orange.fr est l'email de SIBE Bureau d'études VRD à Scy-Chazelles.");
    const mixte = "7 chemin de la Moselle … betsibe@orange.fr est l'email de SIBE";
    expect(checkSource({ source: { type: 'web', citation: mixte } }, c).ok).toBe(true);
    const invente = '7 chemin de la Moselle … fax 03.87.18.19.37 du bureau';
    expect(checkSource({ source: { type: 'web', citation: invente } }, c).ok).toBe(false);
  });

  it('image_jointe n\'est acceptée que si une image est jointe', () => {
    const c = corpus();
    expect(checkSource({ source: { type: 'image_jointe', citation: '' } }, c).ok).toBe(false);
    c.hasImages = true;
    expect(checkSource({ source: { type: 'image_jointe', citation: '' } }, c).ok).toBe(true);
  });

  it('sans corpus (liaison MCP) aucun contrôle', () => {
    expect(checkSource({}, undefined).ok).toBe(true);
  });

  it('executeAgentAction refuse la création avant tout appel réseau', async () => {
    const res = await executeAgentAction('http://127.0.0.1:1', { authorization: 'x', tenantId: 't' } as any, caps,
      { name: 'create_record', args: { resource: 'tasks', data: { title: 'x' }, source: { type: 'document_joint', citation: 'phrase totalement inventée ici' } } } as any,
      undefined, corpus());
    expect((res.response as any).code).toBe('SOURCE_NON_VERIFIEE');
  });
});
