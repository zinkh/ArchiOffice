// Bug réel : un message "71 BLANDAN Devis signe" ne remontait pas via
// search_emails query="Blandan" en IMAP (Infomaniak), alors que subject=
// "Blandan" le trouvait — buildImapSearchCriteria posait `q` sur `body`
// (corps seul) plutôt que sur `text` (IMAP SEARCH TEXT, objet ET corps).
import { describe, expect, it } from 'vitest';
import { buildImapSearchCriteria } from '../server/routes/imapMailSync';

describe('buildImapSearchCriteria', () => {
  it('pose q sur le critère text (objet ET corps), jamais sur body seul', () => {
    const criteria = buildImapSearchCriteria({ q: 'Blandan' });
    expect(criteria.text).toBe('Blandan');
    expect(criteria.body).toBeUndefined();
  });

  it('combine q avec from', () => {
    const criteria = buildImapSearchCriteria({ q: 'devis', from: 'client@example.test' });
    expect(criteria.text).toBe('devis');
    expect(criteria.from).toBe('client@example.test');
  });

  it('combine q avec les dates', () => {
    const criteria = buildImapSearchCriteria({ q: 'devis', dateFrom: '2026-01-01', dateTo: '2026-02-01' });
    expect(criteria.text).toBe('devis');
    expect(criteria.since).toEqual(new Date('2026-01-01'));
    expect(criteria.before).toEqual(new Date('2026-02-01'));
  });

  it('ne pose aucun critère sans paramètre', () => {
    const criteria = buildImapSearchCriteria({});
    expect(criteria).toEqual({});
  });

  it('email seul cherche from OU to', () => {
    const criteria = buildImapSearchCriteria({ email: 'x@y.test' });
    expect(criteria.or).toEqual([{ from: 'x@y.test' }, { to: 'x@y.test' }]);
  });

  it('subject reste indépendant de q', () => {
    const criteria = buildImapSearchCriteria({ subject: 'Blandan' });
    expect(criteria.subject).toBe('Blandan');
    expect(criteria.text).toBeUndefined();
  });
});
