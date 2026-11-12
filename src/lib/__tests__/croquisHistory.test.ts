import { describe, expect, it } from 'vitest';
import {
  HISTORY_LIMIT,
  canRedo,
  canUndo,
  createHistory,
  pushHistory,
  redoHistory,
  undoHistory,
} from '../croquis/history';

describe('historique du croquis', () => {
  it('démarre sans rien à annuler ni à rétablir', () => {
    const h = createHistory<string[]>([]);
    expect(canUndo(h)).toBe(false);
    expect(canRedo(h)).toBe(false);
  });

  it('annule puis rétablit dans l\'ordre', () => {
    let h = createHistory(['a']);
    h = pushHistory(h, ['a', 'b']);
    h = pushHistory(h, ['a', 'b', 'c']);

    h = undoHistory(h);
    expect(h.present).toEqual(['a', 'b']);
    h = undoHistory(h);
    expect(h.present).toEqual(['a']);
    expect(canUndo(h)).toBe(false);

    h = redoHistory(h);
    expect(h.present).toEqual(['a', 'b']);
    h = redoHistory(h);
    expect(h.present).toEqual(['a', 'b', 'c']);
    expect(canRedo(h)).toBe(false);
  });

  it('vide le futur dès qu\'on dessine après une annulation', () => {
    let h = createHistory(['a']);
    h = pushHistory(h, ['a', 'b']);
    h = undoHistory(h);
    expect(canRedo(h)).toBe(true);

    h = pushHistory(h, ['a', 'x']);
    expect(canRedo(h)).toBe(false);
    expect(h.present).toEqual(['a', 'x']);
  });

  it('ne crée pas d\'étape quand l\'état est le même', () => {
    const h = createHistory(['a']);
    expect(pushHistory(h, h.present)).toBe(h);
  });

  it('ne fait rien quand il n\'y a rien à annuler ou à rétablir', () => {
    const h = createHistory(['a']);
    expect(undoHistory(h)).toBe(h);
    expect(redoHistory(h)).toBe(h);
  });

  it('plafonne le passé en gardant les étapes les plus récentes', () => {
    let h = createHistory(0);
    for (let i = 1; i <= HISTORY_LIMIT + 20; i++) h = pushHistory(h, i);
    expect(h.past).toHaveLength(HISTORY_LIMIT);
    expect(h.past[h.past.length - 1]).toBe(HISTORY_LIMIT + 19);
    expect(h.present).toBe(HISTORY_LIMIT + 20);
    expect(h.past[0]).toBe(20);
  });

  it('respecte une limite personnalisée', () => {
    let h = createHistory(0);
    for (let i = 1; i <= 10; i++) h = pushHistory(h, i, 3);
    expect(h.past).toEqual([7, 8, 9]);
  });

  it('ne modifie jamais l\'historique reçu', () => {
    const h = createHistory(['a']);
    const next = pushHistory(h, ['a', 'b']);
    expect(h.past).toHaveLength(0);
    expect(h.present).toEqual(['a']);
    expect(next.past).toHaveLength(1);
  });
});
