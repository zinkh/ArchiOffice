// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import AgentChatPage from '../packages/archioffice-agents/src/client/AgentChatPage';

const mocks = vi.hoisted(() => ({ request: vi.fn(), saveDraft: vi.fn(), speech: { stop: vi.fn() } }));
vi.mock('../src/lib/api', () => ({ apiFetch: mocks.request }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string, opts?: any) => opts?.name ? `${key} ${opts.name}` : key, i18n: { language: 'fr' } }) }));
vi.mock('../packages/archioffice-agents/src/client/useSpeech', () => ({ useSpeech: () => mocks.speech }));
vi.mock('../packages/archioffice-agents/src/client/useDictation', () => ({ useDictation: () => ({ status: 'idle', supported: false }) }));
vi.mock('../packages/archioffice-agents/src/client/AgentChat', () => ({
  AgentAvatar: () => null,
  MessageBubble: ({ msg }: any) => React.createElement('p', null, msg.content),
  DocumentPicker: ({ attached, onAttach }: any) => React.createElement('div', null,
    React.createElement('button', { onClick: () => onAttach({ id: 'd1', name: 'Plan' }) }, 'attach'),
    React.createElement('span', null, attached.map((d: any) => d.name).join(', '))),
  downloadArtifact: vi.fn(), ARTIFACT_TYPE_LABELS: {}, loadDraft: () => '', saveDraft: mocks.saveDraft, appendDictated: (a: string, b: string) => a + b,
}));
let root: Root;
let container: HTMLDivElement;
function Probe() {
  const location = useLocation(), navigate = useNavigate();
  return React.createElement(React.Fragment, null, React.createElement('output', null, location.pathname),
    React.createElement('button', { onClick: () => navigate('/agents/a2/chat') }, 'navigate'));
}
async function mount(chat: (init: any) => Promise<any>) {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  Object.defineProperty(Element.prototype, 'scrollIntoView', { configurable: true, value: vi.fn() });
  mocks.saveDraft.mockClear();
  mocks.request.mockImplementation(async (url: string, init: any) => {
    if (url === '/api/agents') return [{ id: 'a1', name: 'Alex', is_active: true }, { id: 'a2', name: 'Sophie', is_active: true }];
    if (url.endsWith('/conversation')) return { messages: [{ id: url, role: 'assistant', content: `Historique ${url.includes('a1') ? 'a1' : 'a2'}`, created_at: '2026-10-01' }] };
    if (url.endsWith('/chat')) return chat(init);
    return { balance: 100 };
  });
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
  await act(async () => root.render(React.createElement(MemoryRouter, { initialEntries: ['/agents/a1/chat'] },
    React.createElement(Probe), React.createElement(Routes, null,
      React.createElement(Route, { path: '/agents/:id/chat', element: React.createElement(AgentChatPage) })))));
}
const button = (text: string) => [...container.querySelectorAll('button')].find(b => b.textContent === text)!;
async function send() {
  const field = container.querySelector('textarea')!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(field, 'Préparer le compte rendu');
    field.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await act(async () => (container.querySelector('[aria-label="agent_chat_send"]') as HTMLButtonElement).click());
}
afterEach(async () => { if (root) await act(async () => root.unmount()); container?.remove(); vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllGlobals(); });
describe('agent chat wait and colleague controls', () => {
  it('stops waiting and restores the request and attached documents', async () => {
    await mount(init => new Promise((_resolve, reject) => init.signal.addEventListener('abort', () => reject(new DOMException('Stopped', 'AbortError')))));
    await act(async () => button('attach').click());
    await send();
    expect(container.querySelector('textarea')!.value).toBe('');
    await act(async () => button('agent_chat_stop_waiting').click());
    expect(container.querySelector('textarea')!.value).toBe('Préparer le compte rendu');
    expect(container.textContent).toContain('Plan');
    expect(container.textContent).toContain('Historique a1');
    expect(container.textContent).toContain('agent_chat_cancelled');
    expect(mocks.saveDraft).toHaveBeenCalledWith('a1', 'Préparer le compte rendu');
  });
  it('shows elapsed waiting time and a long-wait message without inventing progress', async () => {
    await mount(init => new Promise((_resolve, reject) => init.signal.addEventListener('abort', () => reject(new DOMException('Stopped', 'AbortError')))));
    vi.useFakeTimers();
    await send();
    await act(async () => vi.advanceTimersByTime(21000));
    expect(container.querySelector('[role="status"]')!.textContent).toBe('agent_chat_waiting_long');
    expect(container.textContent).toContain('21 s');
    await act(async () => button('agent_chat_stop_waiting').click());
  });
  it('keeps the current response visible until the user opens the colleague explicitly', async () => {
    await mount(async () => ({ reply: 'Réponse Alex', consulted: [{ id: 'a2', name: 'Sophie' }] }));
    await send();
    expect(container.textContent).toContain('Réponse Alex');
    expect(container.querySelector('output')!.textContent).toBe('/agents/a1/chat');
    await act(async () => button('agent_chat_view_colleague Sophie').click());
    expect(container.querySelector('output')!.textContent).toBe('/agents/a2/chat');
    expect(container.textContent).toContain('Historique a2');
  });
  it('does not append a late response to another agent conversation', async () => {
    let resolve!: (value: any) => void;
    await mount(() => new Promise(done => { resolve = done; }));
    await send();
    await act(async () => button('navigate').click());
    await act(async () => resolve({ reply: 'Ancienne réponse' }));
    expect(container.textContent).toContain('Historique a2');
    expect(container.textContent).not.toContain('Ancienne réponse');
  });
});
