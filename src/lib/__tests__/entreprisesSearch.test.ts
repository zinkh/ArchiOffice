import { describe, it, expect } from 'vitest';
import { formaterSiret, libelleEffectif, rueSeule } from '../entreprisesSearch';

describe('formaterSiret', () => {
  it('groupe 3-3-3-5', () => {
    expect(formaterSiret('55208131700018')).toBe('552 081 317 00018');
    expect(formaterSiret('552 081 317 00018')).toBe('552 081 317 00018');
  });
  it('laisse tel quel un numéro incomplet', () => {
    expect(formaterSiret('123')).toBe('123');
    expect(formaterSiret('')).toBe('');
  });
});

describe('libelleEffectif', () => {
  it('traduit les tranches INSEE', () => {
    expect(libelleEffectif('11')).toBe('10 à 19 salariés');
    expect(libelleEffectif('nn')).toContain('Sans salarié');
  });
  it('rend null pour un code inconnu ou absent', () => {
    expect(libelleEffectif('99')).toBeNull();
    expect(libelleEffectif(null)).toBeNull();
  });
});

describe('rueSeule', () => {
  it('retire le code postal et la commune répétés', () => {
    expect(rueSeule('1 rue des Lilas 54000 NANCY', '54000', 'NANCY')).toBe('1 rue des Lilas');
  });
  it('laisse une adresse qui ne les répète pas', () => {
    expect(rueSeule('1 rue des Lilas', '54000', 'NANCY')).toBe('1 rue des Lilas');
  });
});
