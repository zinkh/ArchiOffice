// @vitest-environment jsdom
import React, { act, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
vi.mock('../src/hooks/useMediaQuery', () => ({ useMediaQuery: () => true }));
vi.mock('../src/lib/supabase', () => ({ supabase: { auth: { onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }) } } }));
vi.mock('../src/components/EntrepriseAutocomplete', () => ({ EntrepriseAutocomplete: () => null }));
vi.mock('../src/components/MultiSelectDropdown', () => ({ MultiSelectDropdown: () => null }));
import ACTEntreprisesTable from '../src/components/ACTEntreprisesTable';

it('affecte un rendez-vous, pointe la présence et protège un créneau utilisé', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const host = document.createElement('div'); document.body.append(host);
  const root = createRoot(host);
  const lots = [{ id: 'go', lot_number: '01', lot_title: 'Gros œuvre' }];
  function Harness() {
    const [entreprises, setEntreprises] = useState<any[]>([{ id: 'a', nom: 'Entreprise A', lots_ids: ['go'], envoyer_dce: false }]);
    const [creneaux, setCreneaux] = useState([{ id: 'slot', date_heure: '2026-11-23T09:30' }]);
    return React.createElement(ACTEntreprisesTable, {
      projectName: 'Projet', lots: lots as any, entreprises, onChange: setEntreprises,
      creneauxVisite: creneaux, onChangeCreneaux: setCreneaux, dcePieces: [], entrepriseContacts: [], corpsEtatOptions: [], lotOptions: [],
      onChangeCorpsEtat: () => {}, onSelectContact: () => {}, onCreateContact: () => {}, corpsEtatCodesFromContact: () => [],
    });
  }
  try {
    await act(async () => root.render(React.createElement(Harness)));
    const select = host.querySelector<HTMLSelectElement>('[aria-label="Rendez-vous de visite de Entreprise A"]')!;
    await act(async () => { select.value = 'slot'; select.dispatchEvent(new Event('change', { bubbles: true })); });
    expect(host.textContent).toContain('1 entreprise inscrite · 0 présente');
    const presence = host.querySelector<HTMLSelectElement>('[aria-label="Présence à la visite de Entreprise A"]')!;
    await act(async () => { presence.value = 'presente'; presence.dispatchEvent(new Event('change', { bubbles: true })); });
    expect(host.textContent).toContain('Lot 01 — Gros œuvre : 1 présente / 1 inscrite');
    const remove = [...host.querySelectorAll('button')].find(b => b.getAttribute('aria-label')?.startsWith('Supprimer le créneau'))!;
    await act(async () => remove.click());
    expect(host.querySelector('[role="alert"]')?.textContent).toContain('Réaffectez');
    expect(host.querySelector('[aria-label="Rendez-vous de visite de Entreprise A"]')).not.toBeNull();
  } finally { await act(async () => root.unmount()); host.remove(); }
});
afterEach(() => vi.unstubAllGlobals());
