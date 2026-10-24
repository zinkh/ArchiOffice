// Garde de lecture seule : server/archivedProjectGuard.ts (résolution des cibles).
import { describe, expect, it } from 'vitest';
import { cibleDeLaRequete } from '../server/archivedProjectGuard';

describe('cibleDeLaRequete', () => {
  it('laisse passer toute lecture', () => {
    expect(cibleDeLaRequete('GET', '/projects/p1/full')).toBeNull();
    expect(cibleDeLaRequete('GET', '/tasks/t1')).toBeNull();
  });

  it('vise le projet pour une écriture imbriquée sous /projects/:id', () => {
    expect(cibleDeLaRequete('POST', '/projects/p1/phase-notes')).toEqual({ type: 'projet', id: 'p1' });
    expect(cibleDeLaRequete('PUT', '/projects/p1/lots/order')).toEqual({ type: 'projet', id: 'p1' });
  });

  it('exempte création, suppression, archivage, réouverture et génération de PDF', () => {
    expect(cibleDeLaRequete('POST', '/projects')).toBeNull();
    expect(cibleDeLaRequete('DELETE', '/projects/p1')).toBeNull();
    expect(cibleDeLaRequete('POST', '/projects/p1/archive')).toBeNull();
    expect(cibleDeLaRequete('POST', '/projects/p1/unarchive')).toBeNull();
    expect(cibleDeLaRequete('POST', '/projects/p1/panneau-chantier/pdf')).toBeNull();
  });

  it('lit le projet dans le corps pour une création, dans la ligne pour une modification', () => {
    expect(cibleDeLaRequete('POST', '/tasks')).toEqual({ type: 'corps' });
    expect(cibleDeLaRequete('PUT', '/tasks/t1')).toEqual({ type: 'ligne', table: 'tasks', id: 't1' });
    expect(cibleDeLaRequete('DELETE', '/gpa-reserves/g1')).toEqual({ type: 'ligne', table: 'gpa_reserves', id: 'g1' });
    expect(cibleDeLaRequete('PATCH', '/ordres_de_service/o1/status')).toEqual({ type: 'ligne', table: 'ordres_de_service', id: 'o1' });
  });

  it('ignore une ressource sans affaire rattachée', () => {
    expect(cibleDeLaRequete('POST', '/contacts')).toBeNull();
    expect(cibleDeLaRequete('PUT', '/settings')).toBeNull();
  });
});
