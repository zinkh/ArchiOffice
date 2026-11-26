import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  SENT_VISIBLE_MS, dismissSend, getSendJobs, hasRunningSends, resetSendsForTests, retrySend, startBackgroundSend,
} from '../backgroundSend';

describe('envois en arrière-plan', () => {
  beforeEach(() => { vi.useFakeTimers(); resetSendsForTests(); });
  afterEach(() => { resetSendsForTests(); vi.useRealTimers(); });

  it("suit l'avancement, puis marque l'envoi réussi, prévient le rappel et se retire seul", async () => {
    let finir: () => void = () => {};
    const onSent = vi.fn();
    const id = startBackgroundSend({
      label: 'Consultation', step: 'Préparation…', onSent, describeError: () => 'erreur',
      run: async progress => {
        progress('Pièces (1/2)', 1, 4);
        await new Promise<void>(resolve => { finir = resolve; });
      },
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(getSendJobs().find(j => j.id === id)).toMatchObject({ status: 'running', step: 'Pièces (1/2)', done: 1, total: 4 });
    expect(hasRunningSends()).toBe(true);

    finir();
    await vi.advanceTimersByTimeAsync(0);
    expect(getSendJobs().find(j => j.id === id)).toMatchObject({ status: 'sent', done: 4, total: 4 });
    expect(onSent).toHaveBeenCalledTimes(1);
    expect(hasRunningSends()).toBe(false);

    await vi.advanceTimersByTimeAsync(SENT_VISIBLE_MS);
    expect(getSendJobs()).toEqual([]);
  });

  it("garde l'échec visible avec son message, et le relance à l'identique", async () => {
    let tentative = 0;
    const onSent = vi.fn();
    const id = startBackgroundSend({
      label: 'Objet', step: 'Préparation…', onSent,
      describeError: (err: any) => `Échec : ${err.message}`,
      run: async () => { tentative += 1; if (tentative === 1) throw new Error('413'); },
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(getSendJobs().find(j => j.id === id)).toMatchObject({ status: 'error', error: 'Échec : 413' });
    expect(onSent).not.toHaveBeenCalled();

    retrySend(id);
    await vi.advanceTimersByTimeAsync(0);
    expect(tentative).toBe(2);
    expect(getSendJobs().find(j => j.id === id)?.status).toBe('sent');
    expect(onSent).toHaveBeenCalledTimes(1);
  });

  it('ne retire pas un envoi en cours, mais retire un envoi en échec', async () => {
    let finir: () => void = () => {};
    const enCours = startBackgroundSend({
      label: 'A', step: '…', describeError: () => 'x',
      run: () => new Promise<void>(resolve => { finir = resolve; }),
    });
    const echoue = startBackgroundSend({ label: 'B', step: '…', describeError: () => 'x', run: async () => { throw new Error('non'); } });
    await vi.advanceTimersByTimeAsync(0);

    dismissSend(enCours);
    dismissSend(echoue);
    expect(getSendJobs().map(j => j.id)).toEqual([enCours]);
    finir();
    await vi.advanceTimersByTimeAsync(0);
  });

  it("un rappel onSent qui échoue ne fait pas passer l'envoi pour un échec", async () => {
    const id = startBackgroundSend({
      label: 'A', step: '…', describeError: () => 'x', run: async () => {},
      onSent: () => { throw new Error('rappel défaillant'); },
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(getSendJobs().find(j => j.id === id)?.status).toBe('sent');
  });
});
