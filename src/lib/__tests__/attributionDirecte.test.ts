import { describe, expect, it } from 'vitest';
import {
  attribuerSansOffre, avertitAttributionPublique, estAttributionDirecte, retirerAttribution,
  type AttributionDirecteBase, type EntrepriseDirecteBase,
} from '../attributionDirecte';

const contact = { id: 'c-1', company_name: 'Dupont SARL' };
const entreprise = (extra: Partial<EntrepriseDirecteBase> = {}): EntrepriseDirecteBase => ({
  id: 'E1', contact_id: 'c-1', nom: 'Dupont SARL', lots_ids: ['L1'], envoyer_dce: true, ...extra,
});
let n = 0;
const nouvelId = () => `nouveau-${++n}`;

describe('attribuerSansOffre', () => {
  it('crée l’entreprise consultée et une attribution sans montant', () => {
    const r = attribuerSansOffre({ attributions: [] as AttributionDirecteBase[], entreprises: [] as EntrepriseDirecteBase[] }, 'L2', contact, nouvelId);
    expect(r.entreprises).toHaveLength(1);
    expect(r.entreprises[0]).toMatchObject({ contact_id: 'c-1', nom: 'Dupont SARL', lots_ids: ['L2'], envoyer_dce: false });
    expect(r.attributions).toEqual([{ lot_id: 'L2', entreprise_id: r.entrepriseId, montant: 0, directe: true }]);
  });

  it('réutilise l’entreprise déjà consultée pour la même fiche et lui ajoute le lot', () => {
    const r = attribuerSansOffre({ attributions: [], entreprises: [entreprise()] }, 'L2', contact, nouvelId);
    expect(r.entreprises).toHaveLength(1);
    expect(r.entrepriseId).toBe('E1');
    expect(r.entreprises[0].lots_ids).toEqual(['L1', 'L2']);
    expect(r.entreprises[0].envoyer_dce).toBe(true);
  });

  it('ne duplique pas un lot déjà rattaché à l’entreprise', () => {
    const r = attribuerSansOffre({ attributions: [], entreprises: [entreprise({ lots_ids: ['L2'] })] }, 'L2', contact, nouvelId);
    expect(r.entreprises[0].lots_ids).toEqual(['L2']);
  });

  it('remplace l’attribution existante du lot, issue d’une offre, sans toucher aux autres lots', () => {
    const avant: AttributionDirecteBase[] = [
      { lot_id: 'L2', entreprise_id: 'E9', montant: 1200 },
      { lot_id: 'L3', entreprise_id: 'E9', montant: 800 },
    ];
    const r = attribuerSansOffre({ attributions: avant, entreprises: [entreprise()] }, 'L2', contact, nouvelId);
    expect(r.attributions).toHaveLength(2);
    expect(r.attributions.find(a => a.lot_id === 'L3')).toEqual(avant[1]);
    expect(r.attributions.find(a => a.lot_id === 'L2')).toMatchObject({ entreprise_id: 'E1', montant: 0, directe: true });
  });

  it('ne modifie pas la consultation reçue', () => {
    const attributions: AttributionDirecteBase[] = [];
    const entreprises = [entreprise()];
    attribuerSansOffre({ attributions, entreprises }, 'L2', contact, nouvelId);
    expect(attributions).toEqual([]);
    expect(entreprises[0].lots_ids).toEqual(['L1']);
  });

  it('nomme une entreprise sans raison sociale d’après la personne', () => {
    const r = attribuerSansOffre({ attributions: [], entreprises: [] as EntrepriseDirecteBase[] }, 'L2', { id: 'c-2', first_name: 'Anne', last_name: 'Martin' }, nouvelId);
    expect(r.entreprises[0].nom).toBe('Anne Martin');
  });
});

describe('retirerAttribution et indicateurs', () => {
  it('ne retire que l’attribution du lot visé', () => {
    const a: AttributionDirecteBase[] = [
      { lot_id: 'L2', entreprise_id: 'E1', montant: 0, directe: true },
      { lot_id: 'L3', entreprise_id: 'E1', montant: 10 },
    ];
    expect(retirerAttribution(a, 'L2')).toEqual([a[1]]);
  });

  it('reconnaît une attribution directe', () => {
    expect(estAttributionDirecte({ directe: true })).toBe(true);
    expect(estAttributionDirecte({})).toBe(false);
    expect(estAttributionDirecte(undefined)).toBe(false);
  });

  it('avertit seulement en marché public', () => {
    expect(avertitAttributionPublique(true)).toBe(true);
    expect(avertitAttributionPublique(false)).toBe(false);
    expect(avertitAttributionPublique(undefined)).toBe(false);
  });
});
