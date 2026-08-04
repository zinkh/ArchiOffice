// A minimal in-memory stand-in for the Supabase JS client, used to drive
// Supertest integration tests against createApp() (see testServer.ts).
//
// The originally-planned approach (Phase 2 of the engineering-maturity plan)
// was to run these tests against a real embedded-postgres instance fronted by
// a real PostgREST binary — mirroring electron/pgBootstrap.cjs, which already
// does exactly that for the offline desktop build. That's not viable in this
// sandbox: PostgREST has no npm-packaged binary, pgBootstrap.cjs downloads it
// from GitHub Releases at build time, and this environment's network policy
// blocks github.com (confirmed: `curl https://github.com/...` → 403). Rather
// than skip Phase 2's regression tests entirely, this fake reimplements just
// enough of the PostgREST-flavored query-builder surface (`.from().select()
// .eq().single()` etc.) that server.ts's route handlers actually use, backed
// by plain in-memory tables. It intentionally does NOT implement embedded
// relations (`select('*, table(*)')` joins resolve to the flat row only,
// missing the joined sub-object) — the tenant-isolation tests here only
// assert on top-level fields and HTTP status, which this covers correctly.
//
// Swap-in path for a real CI environment with network access: vendor the
// PostgREST binary per electron/pgBootstrap.cjs's own TODO, then replace this
// fake with electron/pgBootstrap.cjs's startOfflineDataStack() and point
// SUPABASE_URL at its postgrestUrl — no changes needed on the server.ts side,
// since both speak the same createClient(url, key) interface.

type Row = Record<string, any>;

// Shallow-clones what execute() hands back to callers — see the "select"
// comment below for why this matters. Rows in this fake are flat DB records
// (no nested objects of our own besides embedded-relation stand-ins, which
// this fake doesn't populate anyway — see the file-level comment), so a
// shallow clone is enough to break aliasing with the stored row.
function clone<T>(value: T): T {
  if (Array.isArray(value)) return value.map(v => ({ ...v })) as any;
  if (value && typeof value === 'object') return { ...value } as any;
  return value;
}

interface FakeUser {
  id: string;
  email: string;
}

export class FakeSupabaseAdmin {
  private tables = new Map<string, Row[]>();
  private tokenToUser = new Map<string, FakeUser>();

  private adminUsers = new Map<string, { id: string; email: string }>();

  auth = {
    getUser: async (token: string) => {
      const user = this.tokenToUser.get(token);
      if (!user) return { data: { user: null }, error: { message: 'invalid token' } };
      return { data: { user }, error: null };
    },
    // Minimal stand-in for the Supabase Auth admin API, used by
    // server/routes/superAdmin.ts to provision/deprovision tenant owner
    // accounts. Real supabase-js also lets any caller with a service-role
    // key manage auth.users this way — this fake just tracks ids in memory.
    admin: {
      createUser: async (attrs: { email: string; password?: string; user_metadata?: Record<string, any>; email_confirm?: boolean }) => {
        const id = crypto.randomUUID();
        const user = { id, email: attrs.email };
        this.adminUsers.set(id, user);
        return { data: { user }, error: null };
      },
      deleteUser: async (id: string) => {
        this.adminUsers.delete(id);
        return { data: {}, error: null };
      },
      // Used by server/routes/agencySetup.ts to pull the auth user's
      // display name (falls back to the email's local part when absent, so
      // an empty user_metadata here is a valid, commonly-exercised case).
      getUserById: async (id: string) => {
        return { data: { user: this.adminUsers.get(id) ?? { id, user_metadata: {} } }, error: null };
      },
      generateLink: async (attrs: { type: string; email: string; password?: string; options?: Record<string, any> }) => {
        const id = crypto.randomUUID();
        const user = { id, email: attrs.email };
        this.adminUsers.set(id, user);
        return { data: { user, properties: { action_link: `https://fake.supabase.test/verify?type=${attrs.type}&email=${encodeURIComponent(attrs.email)}` } }, error: null };
      },
    },
  };

  // Minimal stand-in for supabaseAdmin.rpc(fnName, params) — only
  // 'increment_ai_credits' is called anywhere in this codebase.
  async rpc(fnName: string, params: Record<string, any>) {
    if (fnName === 'increment_ai_credits') {
      const tenants = this.tables.get('tenants') || [];
      const tenant = tenants.find(t => t.id === params.p_tenant_id);
      if (tenant) tenant.ai_credit_balance_eur_cents = (tenant.ai_credit_balance_eur_cents || 0) + params.p_amount_cents;
      return { data: null, error: null };
    }
    return { data: null, error: { message: `Unknown RPC function in FakeSupabaseAdmin: ${fnName}` } };
  }

  // createApp() eagerly calls ensureStorageBuckets() at startup (unrelated to
  // the tenant-isolation routes under test) — a no-op stub is enough for it
  // to complete without touching real Supabase Storage.
  private buckets = new Set<string>();
  // In-memory object store backing `.storage.from(bucket)`, used by
  // server.ts's uploadToStorage/deleteFromStorage/resolveFileUrl
  // (documents.ts, plans.ts, visas.ts, meetings.ts, ...). Objects aren't
  // retained for assertions — routes only ever pass the stored path/signed
  // URL back around — so a Set of "uploaded" paths per bucket is enough to
  // make delete/remove meaningful.
  private storageObjects = new Map<string, Set<string>>();
  storage = {
    getBucket: async (name: string) => ({ data: this.buckets.has(name) ? { name } : null, error: null }),
    createBucket: async (name: string, _opts?: any) => { this.buckets.add(name); return { data: { name }, error: null }; },
    from: (bucket: string) => ({
      upload: async (path: string, _buffer: Buffer, _opts?: any) => {
        if (!this.storageObjects.has(bucket)) this.storageObjects.set(bucket, new Set());
        this.storageObjects.get(bucket)!.add(path);
        return { data: { path }, error: null };
      },
      getPublicUrl: (path: string) => ({ data: { publicUrl: `https://fake.supabase.test/storage/v1/object/public/${bucket}/${path}` } }),
      createSignedUrl: async (path: string, expiresIn: number) => ({
        data: { signedUrl: `https://fake.supabase.test/storage/v1/object/sign/${bucket}/${path}?token=fake&expiresIn=${expiresIn}` },
        error: null,
      }),
      remove: async (paths: string[]) => {
        const set = this.storageObjects.get(bucket);
        if (set) paths.forEach(p => set.delete(p));
        return { data: null, error: null };
      },
    }),
  };

  /** Test setup: makes `Authorization: Bearer <token>` resolve to this user in the auth middleware. */
  registerUser(token: string, user: FakeUser) {
    this.tokenToUser.set(token, user);
  }

  /** Test setup: seeds rows directly, bypassing the query builder. */
  seed(table: string, rows: Row[]) {
    this.tables.set(table, [...(this.tables.get(table) || []), ...rows.map(r => ({ ...r }))]);
  }

  /** Test assertions: reads the current state of a table directly. */
  getTable(table: string): Row[] {
    return this.tables.get(table) || [];
  }

  from(table: string) {
    return new FakeQueryBuilder(this.tables, table);
  }
}

type Op = 'select' | 'insert' | 'update' | 'delete' | 'upsert';

class FakeQueryBuilder implements PromiseLike<{ data: any; error: any; count?: number }> {
  private op: Op = 'select';
  private payload: Row | Row[] | undefined;
  private upsertOpts: { onConflict?: string; ignoreDuplicates?: boolean } | undefined;
  private filters: ((row: Row) => boolean)[] = [];
  private wantSingle = false;
  private wantMaybeSingle = false;

  constructor(private tables: Map<string, Row[]>, private table: string) {}

  select(_columns?: string, _opts?: { count?: string; head?: boolean }) {
    return this;
  }

  insert(payload: Row | Row[]) {
    this.op = 'insert';
    this.payload = payload;
    return this;
  }

  update(payload: Row) {
    this.op = 'update';
    this.payload = payload;
    return this;
  }

  // Minimal PostgREST-style `.upsert(rows, { onConflict, ignoreDuplicates })`
  // — matches existing rows by the onConflict column(s); on a match, either
  // merges the new fields in or, with ignoreDuplicates, leaves the row
  // untouched (the only mode this codebase's routes actually use).
  upsert(payload: Row | Row[], opts?: { onConflict?: string; ignoreDuplicates?: boolean }) {
    this.op = 'upsert';
    this.payload = payload;
    this.upsertOpts = opts;
    return this;
  }

  delete() {
    this.op = 'delete';
    return this;
  }

  eq(col: string, val: any) {
    this.filters.push(row => row[col] === val);
    return this;
  }

  neq(col: string, val: any) {
    this.filters.push(row => row[col] !== val);
    return this;
  }

  in(col: string, vals: any[]) {
    this.filters.push(row => vals.includes(row[col]));
    return this;
  }

  gt(col: string, val: any) {
    this.filters.push(row => row[col] > val);
    return this;
  }

  gte(col: string, val: any) {
    this.filters.push(row => row[col] >= val);
    return this;
  }

  lt(col: string, val: any) {
    this.filters.push(row => row[col] < val);
    return this;
  }

  lte(col: string, val: any) {
    this.filters.push(row => row[col] <= val);
    return this;
  }

  is(col: string, val: any) {
    this.filters.push(row => (row[col] ?? null) === val);
    return this;
  }

  ilike(col: string, pattern: string) {
    const needle = pattern.replace(/^%|%$/g, '').toLowerCase();
    this.filters.push(row => String(row[col] ?? '').toLowerCase().includes(needle));
    return this;
  }

  // SQL LIKE semantics (case-sensitive) — `%` → any run of characters,
  // `_` → any single character. Used for prefix patterns like
  // `${prefix}-${year}-%` (project_code auto-numbering).
  like(col: string, pattern: string) {
    const escaped = pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/%/g, '.*').replace(/_/g, '.');
    const re = new RegExp(`^${escaped}$`);
    this.filters.push(row => re.test(String(row[col] ?? '')));
    return this;
  }

  // Minimal `.not(col, 'is', null)` — the only form this codebase's routes
  // use (superpdp.ts/chorusPro.ts filtering to rows already linked to an
  // external facture).
  not(col: string, op: string, val: any) {
    if (op === 'is') {
      this.filters.push(row => (row[col] ?? null) !== val);
    }
    return this;
  }

  // Minimal PostgREST-style `.or("col.ilike.%x%,col2.ilike.%x%")` — only
  // `ilike` with leading/trailing `%` wildcards is supported, which is the
  // only form this codebase's search routes actually use.
  or(condition: string) {
    const clauses = condition.split(',').map(c => c.trim());
    this.filters.push(row => clauses.some(clause => {
      const [col, op, ...rest] = clause.split('.');
      const value = rest.join('.');
      if (op === 'ilike') {
        const pattern = value.replace(/^%|%$/g, '').toLowerCase();
        return String(row[col] ?? '').toLowerCase().includes(pattern);
      }
      // `col.is.null` — PostgREST's syntax for "column is NULL"
      if (op === 'is') return (row[col] ?? null) === (value === 'null' ? null : value);
      // `col.eq.` (empty value) — the `zoho_invoice_id.is.null,zoho_invoice_id.eq.`
      // pattern this codebase's Zoho sync routes use to also match empty strings.
      if (op === 'eq') return row[col] === value;
      return false;
    }));
    return this;
  }

  // No-op: none of this codebase's ~50 `.order(...)` call sites are tested
  // for actual sort order, only for which rows come back (tenant scoping,
  // filters) — implementing real sorting here would be pure scope creep for
  // a fake that's already just enough to drive these routes' own logic.
  order() {
    return this;
  }

  limit() {
    return this;
  }

  single() {
    this.wantSingle = true;
    return this.execute();
  }

  maybeSingle() {
    this.wantMaybeSingle = true;
    return this.execute();
  }

  // Makes `await builder` work for calls with no terminal `.single()`/`.maybeSingle()`
  // (i.e. list queries), matching postgrest-js's own thenable builder.
  then<TResult1 = any, TResult2 = never>(
    onfulfilled?: ((value: { data: any; error: any; count?: number }) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2> {
    return this.execute().then(onfulfilled, onrejected);
  }

  private getRows(): Row[] {
    if (!this.tables.has(this.table)) this.tables.set(this.table, []);
    return this.tables.get(this.table)!;
  }

  private async execute(): Promise<{ data: any; error: any; count?: number }> {
    const rows = this.getRows();

    if (this.op === 'insert') {
      const inserted = (Array.isArray(this.payload) ? this.payload : [this.payload!]).map(r => ({
        id: r.id ?? crypto.randomUUID(),
        ...r,
      }));
      rows.push(...inserted);
      const data = this.wantSingle || this.wantMaybeSingle ? inserted[0] ?? null : inserted;
      return { data: clone(data), error: null };
    }

    if (this.op === 'upsert') {
      const conflictCols = (this.upsertOpts?.onConflict || 'id').split(',').map(c => c.trim());
      const incoming = Array.isArray(this.payload) ? this.payload : [this.payload!];
      const result: Row[] = [];
      for (const row of incoming) {
        const match = rows.find(r => conflictCols.every(c => r[c] === row[c]));
        if (match) {
          if (!this.upsertOpts?.ignoreDuplicates) Object.assign(match, row);
          result.push(match);
        } else {
          const inserted = { id: row.id ?? crypto.randomUUID(), ...row };
          rows.push(inserted);
          result.push(inserted);
        }
      }
      const data = this.wantSingle || this.wantMaybeSingle ? result[0] ?? null : result;
      return { data: clone(data), error: null };
    }

    const matched = rows.filter(row => this.filters.every(f => f(row)));

    if (this.op === 'update') {
      matched.forEach(row => Object.assign(row, this.payload));
      return { data: clone(this.wantSingle || this.wantMaybeSingle ? matched[0] ?? null : matched), error: null };
    }

    if (this.op === 'delete') {
      const remaining = rows.filter(row => !this.filters.every(f => f(row)));
      this.tables.set(this.table, remaining);
      return { data: null, error: null };
    }

    // select — always return a copy, never the live row reference: a real
    // Supabase/PostgREST response is a freshly deserialized JSON object, so
    // a caller holding onto `data` (e.g. an "old value" read before a later
    // .update() on the same row, a pattern several routes use) must not see
    // that later mutation reflected back into what it already read.
    if (this.wantSingle) {
      if (matched.length !== 1) return { data: null, error: { message: 'no rows (or too many) returned', code: 'PGRST116' } };
      return { data: clone(matched[0]), error: null };
    }
    if (this.wantMaybeSingle) {
      return { data: clone(matched[0] ?? null), error: null };
    }
    return { data: clone(matched), error: null, count: matched.length };
  }
}
