import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { UndoableDeleteQueue } from '../undoableDelete';

function item(commitResult: boolean | Error = true) {
  return {
    commit: vi.fn(async () => {
      if (commitResult instanceof Error) throw commitResult;
      return commitResult;
    }),
    restore: vi.fn(),
    onFailure: vi.fn(),
  };
}

describe('UndoableDeleteQueue', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it("n'envoie la suppression qu'à la fin du délai", async () => {
    const q = new UndoableDeleteQueue(6000);
    const a = item();
    q.schedule(a);
    await vi.advanceTimersByTimeAsync(5999);
    expect(a.commit).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(a.commit).toHaveBeenCalledOnce();
    expect(a.restore).not.toHaveBeenCalled();
    expect(q.hasPending).toBe(false);
  });

  it('annuler remet l’élément sans jamais envoyer la requête', async () => {
    const q = new UndoableDeleteQueue(6000);
    const a = item();
    q.schedule(a);
    expect(q.undo()).toBe(true);
    await vi.advanceTimersByTimeAsync(10000);
    expect(a.restore).toHaveBeenCalledOnce();
    expect(a.commit).not.toHaveBeenCalled();
    expect(q.undo()).toBe(false);
  });

  it('une seconde suppression envoie la première tout de suite', async () => {
    const q = new UndoableDeleteQueue(6000);
    const a = item();
    const b = item();
    q.schedule(a);
    q.schedule(b);
    await vi.advanceTimersByTimeAsync(0);
    expect(a.commit).toHaveBeenCalledOnce();
    expect(b.commit).not.toHaveBeenCalled();
    // « Annuler » ne vise plus que la seconde.
    q.undo();
    expect(b.restore).toHaveBeenCalledOnce();
    expect(a.restore).not.toHaveBeenCalled();
  });

  it('un refus du serveur remet l’élément et prévient', async () => {
    const q = new UndoableDeleteQueue(6000);
    const refused = item(false);
    q.schedule(refused);
    await vi.advanceTimersByTimeAsync(6000);
    expect(refused.restore).toHaveBeenCalledOnce();
    expect(refused.onFailure).toHaveBeenCalledOnce();
  });

  it('une coupure réseau est traitée comme un refus', async () => {
    const q = new UndoableDeleteQueue(6000);
    const broken = item(new Error('réseau'));
    q.schedule(broken);
    await q.flush();
    expect(broken.restore).toHaveBeenCalledOnce();
    expect(broken.onFailure).toHaveBeenCalledOnce();
  });

  it('flush envoie sans attendre (fermeture de la page, démontage)', async () => {
    const q = new UndoableDeleteQueue(6000);
    const a = item();
    q.schedule(a);
    await q.flush();
    expect(a.commit).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(6000);
    expect(a.commit).toHaveBeenCalledOnce();
  });
});
