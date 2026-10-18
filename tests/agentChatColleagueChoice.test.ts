// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { expect, it, vi } from 'vitest';
import { AgentChatProvider, useAgentChat } from '../packages/archioffice-agents/src/client/AgentChat';
const mocks = vi.hoisted(() => ({ request: vi.fn(), t: (key: string, opts?: any) => opts?.name ? `${key} ${opts.name}` : key,
  speech: { stop: vi.fn(), toggle: vi.fn(), activeId: null }, dictation: { status: 'idle', supported: false } }));
vi.mock('../src/lib/api', () => ({ apiFetch: mocks.request }));
vi.mock('../src/lib/openProjectTabs', () => ({ projectIdFromPath: () => null, useOpenProjectTabs: () => [] }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: mocks.t, i18n: { language: 'fr' } }) }));
vi.mock('../packages/archioffice-agents/src/client/useSpeech', () => ({ useSpeech: () => mocks.speech }));
vi.mock('../packages/archioffice-agents/src/client/useDictation', () => ({ useDictation: () => mocks.dictation }));
vi.mock('../packages/archioffice-agents/src/client/ChatMarkdown', () => ({ ChatMarkdown: ({ content }: any) => React.createElement('p', null, content) }));
function Launcher() {
  const { openChat } = useAgentChat();
  return React.createElement('button', { onClick: () => openChat('a1') }, 'open');
}
it('does not switch the floating chat automatically after a colleague consultation', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  Object.defineProperty(Element.prototype, 'scrollIntoView', { configurable: true, value: vi.fn() });
  localStorage.clear();
  mocks.request.mockImplementation(async (url: string) => {
    if (url === '/api/agents') return [{ id: 'a1', name: 'Alex', is_active: true }, { id: 'a2', name: 'Sophie', is_active: true }];
    if (url.endsWith('/conversation')) return { messages: [{ id: url, role: 'assistant', content: url.includes('a1') ? 'Historique Alex' : 'Historique Sophie', created_at: '2026-10-01' }] };
    if (url.endsWith('/chat')) return { reply: 'Réponse Alex', consulted: [{ id: 'a2', name: 'Sophie' }] };
    if (url.endsWith('token-balance')) return { balance: 100 };
    return [];
  });
  const container = document.createElement('div'); document.body.append(container); const root = createRoot(container);
  try {
    await act(async () => root.render(React.createElement(MemoryRouter, null, React.createElement(AgentChatProvider, null, React.createElement(Launcher)))));
    const button = (text: string) => [...container.querySelectorAll('button')].find(b => b.textContent === text)!;
    await act(async () => button('open').click());
    const field = container.querySelector('textarea')!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(field, 'Demander conseil à Sophie');
      field.dispatchEvent(new Event('input', { bubbles: true }));
    });
    vi.useFakeTimers();
    await act(async () => (container.querySelector('button[title="agent_chat_send (Ctrl+Entrée)"]') as HTMLButtonElement).click());
    await act(async () => vi.advanceTimersByTime(2000));
    expect(container.textContent).toContain('Réponse Alex');
    expect(mocks.request.mock.calls.some(([url]) => url === '/api/agents/a2/conversation')).toBe(false);
    await act(async () => button('agent_chat_view_colleague Sophie').click());
    expect(container.textContent).toContain('Historique Sophie');
    expect(mocks.request).toHaveBeenCalledWith('/api/agents/a2/conversation');
  } finally {
    await act(async () => root.unmount()); container.remove(); vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllGlobals();
  }
});
