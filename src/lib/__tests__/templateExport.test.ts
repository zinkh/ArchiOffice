import { describe, expect, it } from 'vitest';
import { fillTemplate, missingRequiredVariables } from '../templateExport';
import type { DocumentTemplateVariable } from '../../types';

describe('fillTemplate', () => {
  it('substitutes every {{key}} occurrence with its value', () => {
    const content = 'Bonjour {{client_name}}, votre devis {{ref}} est prêt. Merci {{client_name}}.';
    const result = fillTemplate(content, { client_name: 'Dupont', ref: 'DEV-2026-042' });

    expect(result).toBe('Bonjour Dupont, votre devis DEV-2026-042 est prêt. Merci Dupont.');
  });

  it('replaces a key with an explicit empty/undefined value with an empty string', () => {
    const result = fillTemplate('Adresse : {{address}}', { address: '' });
    expect(result).toBe('Adresse : ');
  });

  it('leaves placeholders with no matching key untouched', () => {
    const result = fillTemplate('{{known}} / {{unknown}}', { known: 'X' });
    expect(result).toBe('X / {{unknown}}');
  });
});

describe('missingRequiredVariables', () => {
  const variables: DocumentTemplateVariable[] = [
    { key: 'client_name', label: 'Nom du client', type: 'text', required: true },
    { key: 'ref', label: 'Référence', type: 'text', required: true },
    { key: 'notes', label: 'Notes', type: 'textarea', required: false },
  ];

  it('reports the labels of required variables with no value', () => {
    const missing = missingRequiredVariables(variables, { client_name: 'Dupont' });
    expect(missing).toEqual(['Référence']);
  });

  it('treats whitespace-only values as missing', () => {
    const missing = missingRequiredVariables(variables, { client_name: '  ', ref: 'DEV-042' });
    expect(missing).toEqual(['Nom du client']);
  });

  it('does not flag optional variables', () => {
    const missing = missingRequiredVariables(variables, { client_name: 'Dupont', ref: 'DEV-042' });
    expect(missing).toEqual([]);
  });
});

describe('exportTemplatePdf / exportTemplateDocx (smoke tests)', () => {
  it('produces a non-empty PDF blob for mixed markdown-ish content', async () => {
    const { exportTemplatePdf } = await import('../templateExport');
    const blob = await exportTemplatePdf(
      'Contrat de maîtrise d\'œuvre',
      '# Objet\nLe présent contrat...\n\n## Honoraires\n- Base : 10%\n- Exécution : 3%\n',
      { agencyName: 'Atelier Test', address: '1 rue de la Paix, Lyon' },
    );

    expect(blob.size).toBeGreaterThan(0);
    expect(blob.type).toBe('application/pdf');
  });

  it('produces a non-empty DOCX blob for mixed markdown-ish content', async () => {
    const { exportTemplateDocx } = await import('../templateExport');
    const blob = await exportTemplateDocx(
      'Contrat de maîtrise d\'œuvre',
      '# Objet\nLe présent contrat...\n\n## Honoraires\n- Base : 10%\n',
      { agencyName: 'Atelier Test' },
    );

    expect(blob.size).toBeGreaterThan(0);
  });
});
