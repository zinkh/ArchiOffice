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
  const syncTelephone = vi.fn();
  function Harness() {
    const [entreprises, setEntreprises] = useState<any[]>([{ id: 'a', contact_id: 'contact-a', nom: 'Entreprise A', email: 'a@example.fr', lots_ids: ['go'], envoyer_dce: false }]);
    const [creneaux, setCreneaux] = useState([{ id: 'slot', date_heure: '2026-11-23T09:30' }]);
    return React.createElement(ACTEntreprisesTable, {
      projectName: 'Projet', lots: lots as any, entreprises, onChange: setEntreprises,
      creneauxVisite: creneaux, onChangeCreneaux: setCreneaux, dcePieces: [], entrepriseContacts: [], corpsEtatOptions: [], lotOptions: [],
      contactsTelephone: [{ id: 'contact-a', phone_work: '03 83 00 00 01' }], onSyncTelephone: syncTelephone,
      onChangeCorpsEtat: () => {}, onSelectContact: () => {}, onCreateContact: () => {}, corpsEtatCodesFromContact: () => [],
    });
  }
  try {
    await act(async () => root.render(React.createElement(Harness)));
    // Le téléphone vient de la fiche contact et la saisie y est reportée à la sortie du champ.
    const telephone = host.querySelector<HTMLInputElement>('input[aria-label="Téléphone de Entreprise A"]')!;
    expect(telephone.value).toBe('03 83 00 00 01');
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(telephone, '03 83 00 00 02');
      telephone.dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect(syncTelephone).not.toHaveBeenCalled();
    await act(async () => { telephone.dispatchEvent(new FocusEvent('focusout', { bubbles: true })); });
    expect(syncTelephone).toHaveBeenCalledWith(expect.objectContaining({ id: 'a' }), '03 83 00 00 02');
    const visiteButton = host.querySelector<HTMLButtonElement>('button[aria-label^="Gérer la visite de Entreprise A"]')!;
    await act(async () => visiteButton.click());
    const select = host.querySelector<HTMLSelectElement>('[aria-label="Rendez-vous de visite de Entreprise A"]')!;
    await act(async () => { select.value = 'slot'; select.dispatchEvent(new Event('change', { bubbles: true })); });
    expect(host.textContent).toContain('1 entreprise inscrite · 0 présente');
    const presence = host.querySelector<HTMLSelectElement>('[aria-label="Présence à la visite de Entreprise A"]')!;
    await act(async () => { presence.value = 'presente'; presence.dispatchEvent(new Event('change', { bubbles: true })); });
    expect(host.textContent).toContain('Lot 01 — Gros œuvre : 1 présente / 1 inscrite');
    await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="Fermer la visite"]')!.click());
    expect(host.querySelector('[role="dialog"]')).toBeNull();
    expect(visiteButton.getAttribute('aria-label')).toContain('Présente');
    const remove = [...host.querySelectorAll('button')].find(b => b.getAttribute('aria-label')?.startsWith('Supprimer le créneau'))!;
    await act(async () => remove.click());
    expect(host.querySelector('[role="alert"]')?.textContent).toContain('Réaffectez');
    expect(host.querySelector('button[aria-label^="Gérer la visite de Entreprise A"]')).not.toBeNull();
    const observation = host.querySelector<HTMLTextAreaElement>('[aria-label="Observation pour Entreprise A"]')!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(observation, 'Rappeler lundi');
      observation.dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect(observation.value).toBe('Rappeler lundi');
    await act(async () => visiteButton.click());
    expect(host.querySelector<HTMLTextAreaElement>('[aria-label="Observation pour Entreprise A"]')?.value).toBe('Rappeler lundi');
  } finally { await act(async () => root.unmount()); host.remove(); }
});
afterEach(() => vi.unstubAllGlobals());
