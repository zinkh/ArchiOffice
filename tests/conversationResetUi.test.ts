// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useConversationReset } from '../packages/archioffice-agents/src/client/useConversationReset';
const mocks = vi.hoisted(() => ({ request: vi.fn(), cleared: vi.fn(), error: vi.fn() }));
vi.mock('../src/lib/api', () => ({ apiFetch: mocks.request }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
let root: Root;
let container: HTMLDivElement;
function Harness({ agentId = 'a1' }: { agentId?: string }) {
  const { resetConversation, resetBusy, resetDialog } = useConversationReset(agentId, false, mocks.cleared, mocks.error);
  return React.createElement(React.Fragment, null, resetDialog, React.createElement('button', { onClick: resetConversation, disabled: resetBusy }, 'reset'));
}
async function mount() {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  mocks.request.mockReset(); mocks.cleared.mockReset(); mocks.error.mockReset();
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
  await act(async () => root.render(React.createElement(Harness)));
}
const button = (text: string) => [...container.querySelectorAll('button')].find(b => b.textContent === text)!;
afterEach(async () => { if (root) await act(async () => root.unmount()); container?.remove(); vi.unstubAllGlobals(); });
describe('confirmed conversation reset', () => {
  it('does not send a deletion before explicit confirmation, and supports cancel', async () => {
    await mount();
    await act(async () => button('reset').click());
    expect(mocks.request).not.toHaveBeenCalled();
    expect(container.querySelector('[role="alertdialog"]')).not.toBeNull();
    expect(document.activeElement).toBe(button('projectdetail_dialog_cancel'));
    await act(async () => button('projectdetail_dialog_cancel').click());
    expect(mocks.request).not.toHaveBeenCalled(); expect(mocks.cleared).not.toHaveBeenCalled();
  });
  it('retains displayed history on a server failure and permits retry', async () => {
    await mount(); mocks.request.mockRejectedValue(new Error('Offline'));
    await act(async () => button('reset').click());
    await act(async () => button('agent_chat_clear').click());
    expect(mocks.cleared).not.toHaveBeenCalled();
    expect(mocks.error).toHaveBeenCalledWith('agent_chat_clear_failed');
    expect(button('reset').disabled).toBe(false);
  });
  it('only clears after server success, preventing a second deletion while pending', async () => {
    await mount(); let finish!: () => void;
    mocks.request.mockImplementation(() => new Promise<void>(resolve => { finish = resolve; }));
    await act(async () => button('reset').click());
    await act(async () => button('agent_chat_clear').click());
    expect(mocks.cleared).not.toHaveBeenCalled();
    await act(async () => button('reset').click()); expect(mocks.request).toHaveBeenCalledTimes(1);
    await act(async () => finish()); expect(mocks.cleared).toHaveBeenCalledOnce();
  });
  it('does not clear a different agent opened while deletion was pending', async () => {
    await mount(); let finish!: () => void;
    mocks.request.mockImplementation(() => new Promise<void>(resolve => { finish = resolve; }));
    await act(async () => button('reset').click());
    await act(async () => button('agent_chat_clear').click());
    await act(async () => root.render(React.createElement(Harness, { agentId: 'a2' })));
    await act(async () => finish()); expect(mocks.cleared).not.toHaveBeenCalled();
  });
});
