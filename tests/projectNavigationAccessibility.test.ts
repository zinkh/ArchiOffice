// @vitest-environment jsdom
import React, { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ProjectTabBar } from '../src/components/projectDetail/ProjectTabBar';
import { AutosaveIndicator } from '../src/components/projectDetail/AutosaveIndicator';
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
let root: Root;
let container: HTMLDivElement;
afterEach(async () => { if (root) await act(async () => root.unmount()); container?.remove(); vi.unstubAllGlobals(); });
async function mount(element: React.ReactElement) {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('matchMedia', () => ({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
  await act(async () => root.render(element));
}
function Tabs() {
  const [activeTab, onChange] = useState('DIAG');
  return React.createElement(ProjectTabBar, { activeTab, onChange, isChantier: true, chantierTabState: {}, panelId: 'project-panel' });
}
describe('project navigation accessibility', () => {
  it('moves and wraps focus with arrows, Home and End in secondary tabs', async () => {
    await mount(React.createElement(Tabs));
    const list = container.querySelectorAll('[role="tablist"]')[1];
    const buttons = [...list.querySelectorAll<HTMLButtonElement>('[role="tab"]')];
    const key = async (name: string) => { await act(async () => list.dispatchEvent(new KeyboardEvent('keydown', { key: name, bubbles: true, cancelable: true }))); };
    await key('ArrowRight');
    expect(document.activeElement).toBe(buttons[2]);
    expect(buttons[2].getAttribute('aria-selected')).toBe('true');
    expect(buttons.filter(b => b.tabIndex === 0)).toEqual([buttons[2]]);
    expect(buttons[2].getAttribute('aria-controls')).toBe('project-panel');
    expect(buttons[2].getAttribute('aria-label')).toBe('project_tab_title_ct');
    await key('End'); expect(document.activeElement).toBe(buttons.at(-1));
    await key('ArrowRight'); expect(document.activeElement).toBe(buttons[0]);
    await key('ArrowLeft'); expect(document.activeElement).toBe(buttons.at(-1));
    await key('Home'); expect(document.activeElement).toBe(buttons[0]);
  });
  it('keeps invalid-autosave alert text accessible at mobile widths', async () => {
    await mount(React.createElement(AutosaveIndicator, { status: 'invalid', onRetry: vi.fn() }));
    const alert = container.querySelector('[role="alert"]')!;
    const label = alert.querySelector('span')!;
    expect(label.textContent).toBe('projectdetail_autosave_name_required');
    expect(label.classList.contains('sr-only')).toBe(true);
    expect(label.classList.contains('hidden')).toBe(false);
  });
});
