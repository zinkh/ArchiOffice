import { describe, expect, it } from 'vitest';
import { tenantScopedFrom } from '../server/tenantScopedFrom';
import { FakeSupabaseAdmin } from './fakeSupabaseAdmin';

describe('tenantScopedFrom', () => {
  it('select() only ever returns rows for the given tenant', async () => {
    const db = new FakeSupabaseAdmin();
    db.seed('widgets', [
      { id: 'w1', tenant_id: 'tenant-a', name: 'A widget' },
      { id: 'w2', tenant_id: 'tenant-b', name: 'B widget' },
    ]);

    const { data } = await tenantScopedFrom(db, 'tenant-a', 'widgets').select('*');
    expect(data).toEqual([{ id: 'w1', tenant_id: 'tenant-a', name: 'A widget' }]);
  });

  it('update() cannot touch another tenant\'s row even if the caller only filters by id', async () => {
    const db = new FakeSupabaseAdmin();
    db.seed('widgets', [{ id: 'w1', tenant_id: 'tenant-b', name: 'Untouched' }]);

    // Simulates the exact bug class from Phase 2: caller only knows the id,
    // not which tenant owns it — tenantScopedFrom makes it structurally
    // impossible for that update to reach another tenant's row.
    await tenantScopedFrom(db, 'tenant-a', 'widgets').update({ name: 'Hacked' });

    expect(db.getTable('widgets')[0].name).toBe('Untouched');
  });

  it('delete() only removes rows belonging to the given tenant', async () => {
    const db = new FakeSupabaseAdmin();
    db.seed('widgets', [
      { id: 'w1', tenant_id: 'tenant-a' },
      { id: 'w2', tenant_id: 'tenant-b' },
    ]);

    await tenantScopedFrom(db, 'tenant-a', 'widgets').delete();

    const remaining = db.getTable('widgets');
    expect(remaining).toHaveLength(1);
    expect(remaining[0].tenant_id).toBe('tenant-b');
  });

  it('insert() always stamps tenant_id onto every row, overriding anything the caller passed', async () => {
    const db = new FakeSupabaseAdmin();

    await tenantScopedFrom(db, 'tenant-a', 'widgets').insert({ id: 'w1', tenant_id: 'tenant-spoofed', name: 'x' });
    await tenantScopedFrom(db, 'tenant-a', 'widgets').insert([{ id: 'w2', name: 'y' }, { id: 'w3', name: 'z' }]);

    const rows = db.getTable('widgets');
    expect(rows.every(r => r.tenant_id === 'tenant-a')).toBe(true);
  });
});
