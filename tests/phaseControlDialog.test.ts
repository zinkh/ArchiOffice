// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PhaseControlDialog } from '../src/components/projectDetail/PhaseControlDialog';
import defaults from '../server/config/phaseControls.json';
import { controlConfigSchema } from '../src/lib/phaseControls';

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
let root: Root | undefined;
let container: HTMLDivElement;
afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  container?.remove(); vi.unstubAllGlobals();
});
async function render(blocking = false) {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const config = controlConfigSchema.parse(defaults);
  config.rules = [config.rules.find(r => r.id === 'geotechnique')!];
  config.phaseDeadlines.ESQ = '2026-01-01';
  if (blocking) config.rules[0].severity = 'blocking';
  const preview = { config, context: {}, from: 'ESQ', to: 'APS', revision: 'a'.repeat(64), expectedCurrentId: 'esq', documents: [{ id: 'soil', name: 'Étude de sol' }] };
  const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => preview });
  vi.stubGlobal('fetch', fetchMock);
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
  const onComplete = vi.fn();
  await act(async () => root!.render(React.createElement(PhaseControlDialog, { projectId: 'p', phase: 'APS', members: [], canConfigure: true, onClose: vi.fn(), onComplete })));
  return { fetchMock, onComplete };
}
const button = (key: string) => [...container.querySelectorAll('button')].find(b => b.textContent === key)!;
describe('phase checklist dialog', () => {
  it('suggests evidence without selecting Done, and sends the explicit task creation action', async () => {
    const { fetchMock, onComplete } = await render();
    expect(container.querySelector('select')?.value).toBe('unchecked');
    expect(container.textContent).toContain('Étude de sol');
    await act(async () => button('pc_tasks_continue').click());
    const body = JSON.parse(fetchMock.mock.calls[1][1].body);
    expect(body.createTasks).toBe(true);
    expect(body.answers[0]).toMatchObject({ status: 'unchecked', documentId: null });
    expect(onComplete).toHaveBeenCalledOnce();
  });
  it('blocks continuation until a blocking check is done or justified', async () => {
    await render(true);
    expect(button('pc_tasks_continue').disabled).toBe(true);
    const status = container.querySelector('select')!;
    await act(async () => { status.value = 'not_required'; status.dispatchEvent(new Event('change', { bubbles: true })); });
    expect(button('pc_tasks_continue').disabled).toBe(true);
    await act(async () => { status.value = 'done'; status.dispatchEvent(new Event('change', { bubbles: true })); });
    expect(button('pc_continue').disabled).toBe(false);
  });
});
