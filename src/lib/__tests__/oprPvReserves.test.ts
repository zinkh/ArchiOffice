import { describe, expect, it } from 'vitest';
import { reserveAppartientAuPv, reservesDuPv, type ReserveDuPv } from '../oprPvReserves';

const marche = { entreprise_nom: 'Plâtres Martin', lot_numero: '02', lot_titre: 'PLATRERIE' };
const r = (id: string, number: number, extra: Partial<ReserveDuPv> = {}): ReserveDuPv => ({ id, number, ...extra });

describe('reservesDuPv', () => {
  it('reprend les réserves dont l’entreprise du marché est en charge', () => {
    const liste = [
      r('a', 2, { entreprises: '["plâtres martin"]', lots: '["PEINTURE"]' }),
      r('b', 1, { entreprises: '["Peintures Durand"]', lots: '["PLATRERIE"]' }),
    ];
    expect(reservesDuPv(liste, marche).map(x => x.id)).toEqual(['a']);
  });

  it('chaque entreprise a son PV : deux marchés, deux jeux de réserves', () => {
    const liste = [r('a', 1, { entreprises: '["Plâtres Martin"]' }), r('b', 2, { entreprises: '["Peintures Durand"]' })];
    expect(reservesDuPv(liste, marche).map(x => x.id)).toEqual(['a']);
    expect(reservesDuPv(liste, { entreprise_nom: 'Peintures Durand', lot_numero: '10', lot_titre: 'PEINTURE' }).map(x => x.id)).toEqual(['b']);
  });

  it('une réserve sans entreprise suit le lot du marché, écrit de plusieurs façons', () => {
    const liste = [
      r('a', 1, { lots: '["PLATRERIE"]' }), r('b', 2, { lots: '["02 · PLATRERIE"]' }), r('c', 3, { lots: '["2"]' }),
      r('d', 4, { lots: '["PEINTURE"]' }), r('e', 5),
    ];
    expect(reservesDuPv(liste, marche).map(x => x.id)).toEqual(['a', 'b', 'c']);
  });

  it('une réserve rattachée à une autre entreprise ne revient pas par son lot', () => {
    expect(reserveAppartientAuPv(r('a', 1, { lots: '["PLATRERIE"]', entreprises: '["Autre SARL"]' }), marche)).toBe(false);
  });

  it('garde les réserves déjà rattachées au PV (PV antérieurs)', () => {
    const liste = [r('a', 1, { reception_id: 'pv-1' }), r('b', 2, { reception_id: 'pv-2' })];
    expect(reservesDuPv(liste, marche, 'pv-1').map(x => x.id)).toEqual(['a']);
  });

  it('sans marché, rien n’est rattaché (sauf à un PV existant)', () => {
    expect(reservesDuPv([r('a', 1, { lots: '["PLATRERIE"]' })], null)).toEqual([]);
  });
});
