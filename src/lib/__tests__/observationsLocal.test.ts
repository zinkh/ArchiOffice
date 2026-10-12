import { describe, expect, it } from 'vitest';
import { reconcileRemote, upsertById } from '../observationsLocal';

const o = (id: string, texte = '') => ({ id, texte });

describe('observationsLocal', () => {
  it('upsertById n\'ajoute jamais deux fois le même identifiant', () => {
    const l1 = upsertById([o('a')], o('b'));
    const l2 = upsertById(l1, o('b', 'réponse du serveur'));
    expect(l2.map(r => r.id)).toEqual(['a', 'b']);
    expect(l2[1].texte).toBe('réponse du serveur');
  });
  it('une relecture en retard ne ressuscite pas une ligne supprimée', () => {
    const out = reconcileRemote([o('a'), o('b')], [o('a')], new Set(['b']), new Set());
    expect(out.map(r => r.id)).toEqual(['a']);
  });
  it('une ligne créée ici et pas encore connue du serveur est conservée', () => {
    const out = reconcileRemote([o('a')], [o('a'), o('n')], new Set(), new Set(['n']));
    expect(out.map(r => r.id)).toEqual(['a', 'n']);
  });
  it('un identifiant renvoyé deux fois par le serveur n\'apparaît qu\'une fois', () => {
    const out = reconcileRemote([o('a'), o('a')], [], new Set(), new Set());
    expect(out).toHaveLength(1);
  });
  it('la ligne créée ici n\'est pas dupliquée quand le serveur la connaît déjà', () => {
    const out = reconcileRemote([o('n', 'serveur')], [o('n', 'local')], new Set(), new Set(['n']));
    expect(out).toEqual([o('n', 'serveur')]);
  });
});
