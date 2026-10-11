import { describe, expect, it, vi } from 'vitest';
import { tenantScopedFrom } from '../server/tenantScopedFrom';

describe('knowledge sharing tenant isolation', () => {
  it('forces the active tenant for inserts', () => {
    const insert = vi.fn().mockReturnValue({ ok: true });
    const db = { from: vi.fn().mockReturnValue({ insert }) };
    tenantScopedFrom(db, 'tenant-a', 'knowledge_contributions')
      .insert({ tenant_id: 'tenant-b', document_id: 'doc-1' });
    expect(insert).toHaveBeenCalledWith({ tenant_id: 'tenant-a', document_id: 'doc-1' });
  });

  it('rejects upserts without tenant-scoped conflict keys', () => {
    const upsert = vi.fn();
    const db = { from: vi.fn().mockReturnValue({ upsert }) };
    expect(() => tenantScopedFrom(db, 'tenant-a', 'knowledge_contributions')
      .upsert({ document_id: 'doc-1' }, { onConflict: 'document_id' }))
      .toThrow(/tenant_id/);
    expect(upsert).not.toHaveBeenCalled();
  });

  it('forces the tenant on a scoped upsert', () => {
    const upsert = vi.fn().mockReturnValue({ ok: true });
    const db = { from: vi.fn().mockReturnValue({ upsert }) };
    tenantScopedFrom(db, 'tenant-a', 'knowledge_sharing_preferences')
      .upsert({ tenant_id: 'tenant-b', opted_in: true }, { onConflict: 'tenant_id' });
    expect(upsert).toHaveBeenCalledWith(
      { tenant_id: 'tenant-a', opted_in: true }, { onConflict: 'tenant_id' },
    );
  });
});
