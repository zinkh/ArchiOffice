import { describe, it, expect } from 'vitest';
import { entierEnLettres, montantEnLettres } from '../numberToFrenchWords';

describe('entierEnLettres', () => {
  it('couvre les petits nombres et les irréguliers', () => {
    expect(entierEnLettres(0)).toBe('zéro');
    expect(entierEnLettres(7)).toBe('sept');
    expect(entierEnLettres(16)).toBe('seize');
    expect(entierEnLettres(17)).toBe('dix-sept');
    expect(entierEnLettres(19)).toBe('dix-neuf');
  });

  it('gère le « et » des dizaines', () => {
    expect(entierEnLettres(21)).toBe('vingt-et-un');
    expect(entierEnLettres(31)).toBe('trente-et-un');
    expect(entierEnLettres(22)).toBe('vingt-deux');
    expect(entierEnLettres(71)).toBe('soixante-et-onze');
    expect(entierEnLettres(70)).toBe('soixante-dix');
    expect(entierEnLettres(77)).toBe('soixante-dix-sept');
  });

  it('accorde quatre-vingts', () => {
    expect(entierEnLettres(80)).toBe('quatre-vingts');
    expect(entierEnLettres(81)).toBe('quatre-vingt-un');
    expect(entierEnLettres(90)).toBe('quatre-vingt-dix');
    expect(entierEnLettres(91)).toBe('quatre-vingt-onze');
    expect(entierEnLettres(99)).toBe('quatre-vingt-dix-neuf');
  });

  it('accorde cent', () => {
    expect(entierEnLettres(100)).toBe('cent');
    expect(entierEnLettres(101)).toBe('cent-un');
    expect(entierEnLettres(200)).toBe('deux-cents');
    expect(entierEnLettres(201)).toBe('deux-cent-un');
    expect(entierEnLettres(380)).toBe('trois-cent-quatre-vingts');
  });

  it('laisse mille invariable', () => {
    expect(entierEnLettres(1000)).toBe('mille');
    expect(entierEnLettres(1234)).toBe('mille deux-cent-trente-quatre');
    expect(entierEnLettres(2000)).toBe('deux mille');
    expect(entierEnLettres(80000)).toBe('quatre-vingts mille');
  });

  it('accorde millions et milliards', () => {
    expect(entierEnLettres(1_000_000)).toBe('un million');
    expect(entierEnLettres(2_000_000)).toBe('deux millions');
    expect(entierEnLettres(1_000_000_000)).toBe('un milliard');
    expect(entierEnLettres(1_234_567)).toBe('un million deux-cent-trente-quatre mille cinq-cent-soixante-sept');
  });
});

describe('montantEnLettres', () => {
  it('rend un montant complet', () => {
    expect(montantEnLettres(1234.56)).toBe('mille deux-cent-trente-quatre euros et cinquante-six centimes');
    expect(montantEnLettres(1)).toBe('un euro');
    expect(montantEnLettres(0)).toBe('zéro euro');
    expect(montantEnLettres(0.01)).toBe('zéro euro et un centime');
  });

  it('arrondit les centimes comme le montant en chiffres', () => {
    expect(montantEnLettres(12.345)).toBe('douze euros et trente-cinq centimes');
    expect(montantEnLettres(12.999)).toBe('treize euros');
  });

  it('gère les valeurs hors domaine sans exploser', () => {
    expect(montantEnLettres(NaN)).toBe('');
    expect(montantEnLettres(-5.5)).toBe('moins cinq euros et cinquante centimes');
  });
});
