// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LONG_PRESS_MS, startPressDrag } from '../pressDrag';
function pointer(type: string, x: number, pointerType = 'mouse') {
  const event = new MouseEvent(type, { clientX: x, clientY: 10, button: 0, bubbles: true });
  Object.defineProperties(event, { pointerId: { value: 1 }, pointerType: { value: pointerType } });
  return event as PointerEvent;
}
function commencer(pointerType = 'mouse') {
  const host = document.createElement('button');
  const handlers = { onLift: vi.fn(), onMove: vi.fn(), onEnd: vi.fn() };
  const cancel = startPressDrag({ nativeEvent: pointer('pointerdown', 10, pointerType), currentTarget: host, target: host, button: 0 }, handlers);
  return { ...handlers, cancel };
}
afterEach(() => { vi.useRealTimers(); document.body.style.userSelect = ''; });
describe('cycle de vie du geste partagé', () => {
  it('préserve le clic simple et supprime les écouteurs avant un démontage', () => {
    const h = commencer(); h.cancel();
    window.dispatchEvent(pointer('pointermove', 40));
    window.dispatchEvent(pointer('pointerup', 40));
    expect(h.onLift).not.toHaveBeenCalled(); expect(h.onEnd).not.toHaveBeenCalled();
  });
  it('Échap annule exactement une fois et restaure la sélection de texte', () => {
    document.body.style.userSelect = 'text';
    const h = commencer(); window.dispatchEvent(pointer('pointermove', 30));
    expect(h.onLift).toHaveBeenCalledOnce();
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    h.cancel(); window.dispatchEvent(pointer('pointerup', 30));
    expect(h.onEnd).toHaveBeenCalledOnce(); expect(h.onEnd.mock.calls[0][0].cancelled).toBe(true);
    expect(document.body.style.userSelect).toBe('text');
  });
  it('interrompt le geste à la perte de focus de la fenêtre', () => {
    const h = commencer(); window.dispatchEvent(pointer('pointermove', 40)); window.dispatchEvent(new Event('blur'));
    expect(h.onEnd.mock.calls[0][0].cancelled).toBe(true);
  });
  it('Échap annule aussi un appui long encore en attente', () => {
    vi.useFakeTimers(); const h = commencer('touch');
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    vi.advanceTimersByTime(LONG_PRESS_MS + 1);
    expect(h.onLift).not.toHaveBeenCalled(); expect(h.onEnd).not.toHaveBeenCalled();
  });
  it('un mouvement tactile avant l’appui long laisse défiler, sans écriture', () => {
    vi.useFakeTimers(); const h = commencer('touch');
    window.dispatchEvent(pointer('pointermove', 30, 'touch')); vi.advanceTimersByTime(LONG_PRESS_MS + 1); h.cancel();
    expect(h.onLift).not.toHaveBeenCalled(); expect(h.onEnd).not.toHaveBeenCalled();
  });
});
