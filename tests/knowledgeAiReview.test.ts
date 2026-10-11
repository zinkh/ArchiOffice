// Relecture IA : server/knowledge/aiReview.ts. Le modèle ne réécrit rien ; on ne lui fait
// confiance que pour DÉSIGNER des passages exacts, que le code masque lui-même.
import { describe, expect, it } from 'vitest';
import { applyFindings, parseAiReview } from '../server/knowledge/aiReview';

const CHUNK = 'Pose par Durand Bâtiment sur la parcelle du Clos des Tilleuls, entraxe 600 mm.';

describe('parseAiReview', () => {
  it('lit une réponse valide', () => {
    const raw = JSON.stringify({ identifiants: [{ texte: 'Durand Bâtiment', categorie: 'entreprise' }], risque_residuel: 'faible' });
    expect(parseAiReview(raw, CHUNK)).toEqual({ findings: [{ text: 'Durand Bâtiment', category: 'ENTREPRISE' }], risk: 'faible' });
  });

  it('retrouve le JSON au milieu d’un texte', () => {
    const raw = 'Voici mon analyse :\n```json\n{"identifiants":[],"risque_residuel":"aucun"}\n```';
    expect(parseAiReview(raw, CHUNK)).toEqual({ findings: [], risk: 'aucun' });
  });

  it('ignore un passage qui n’est pas dans le texte (invention du modèle)', () => {
    const raw = JSON.stringify({ identifiants: [{ texte: 'Entreprise Inventée', categorie: 'entreprise' }, { texte: 'Clos des Tilleuls', categorie: 'operation' }], risque_residuel: 'aucun' });
    expect(parseAiReview(raw, CHUNK).findings.map(f => f.text)).toEqual(['Clos des Tilleuls']);
  });

  it('ignore les passages trop courts ou trop longs et les doublons', () => {
    const raw = JSON.stringify({
      identifiants: [{ texte: 'ab', categorie: 'autre' }, { texte: 'Durand Bâtiment', categorie: 'x' }, { texte: 'Durand Bâtiment', categorie: 'x' }, { texte: CHUNK + CHUNK, categorie: 'autre' }],
      risque_residuel: 'aucun',
    });
    const result = parseAiReview(raw, CHUNK);
    expect(result.findings).toEqual([{ text: 'Durand Bâtiment', category: 'AUTRE' }]);
  });

  it.each([
    ['pas de JSON', 'Je ne peux pas répondre.'],
    ['JSON invalide', '{"identifiants": [,}'],
    ['risque absent', '{"identifiants":[]}'],
    ['risque inconnu', '{"identifiants":[],"risque_residuel":"moyen"}'],
    ['liste absente', '{"risque_residuel":"aucun"}'],
  ])('échoue plutôt que d’interpréter : %s', (_label, raw) => {
    expect(() => parseAiReview(raw, CHUNK)).toThrow(/Réponse de relecture/);
  });
});

describe('applyFindings', () => {
  it('masque toutes les occurrences, du passage le plus long au plus court', () => {
    const out = applyFindings('Durand Bâtiment et Durand. Durand Bâtiment.', [
      { text: 'Durand', category: 'PERSONNE' }, { text: 'Durand Bâtiment', category: 'ENTREPRISE' },
    ]);
    expect(out.text).toBe('[ENTREPRISE] et [PERSONNE]. [ENTREPRISE].');
    expect(out.count).toBe(3);
    expect(out.byCategory).toEqual({ ENTREPRISE: 2, PERSONNE: 1 });
  });

  it('ne change rien sans passage signalé', () => {
    expect(applyFindings(CHUNK, [])).toEqual({ text: CHUNK, count: 0, byCategory: {} });
  });
});
