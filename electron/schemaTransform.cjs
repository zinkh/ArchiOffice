// Rewrites Supabase-flavoured SQL (schema.sql / migrate_*.sql) into something a
// vanilla local Postgres can apply: strips the auth.users FK + its signup
// trigger, and drops RLS/policies entirely (the app always connects with the
// service-role-equivalent local role, which bypasses RLS anyway — see the
// offline-mode plan for the research behind this).

/**
 * Splits a SQL file into top-level statements, respecting `$$ ... $$`
 * dollar-quoted function bodies (which may contain semicolons) and simple
 * '...'/"..." string/identifier quoting.
 * @param {string} sql
 * @returns {string[]} statements, each without the trailing semicolon
 */
function splitStatements(sql) {
  const statements = [];
  let current = '';
  let i = 0;
  const n = sql.length;
  let inSingleQuote = false;
  let inDoubleQuote = false;
  let dollarTag = null; // e.g. "$$" or "$tag$" when inside a dollar-quoted block

  while (i < n) {
    const ch = sql[i];

    if (dollarTag) {
      if (sql.startsWith(dollarTag, i)) {
        current += dollarTag;
        i += dollarTag.length;
        dollarTag = null;
        continue;
      }
      current += ch;
      i += 1;
      continue;
    }

    if (inSingleQuote) {
      current += ch;
      if (ch === "'" && sql[i + 1] === "'") {
        current += sql[i + 1];
        i += 2;
        continue;
      }
      if (ch === "'") inSingleQuote = false;
      i += 1;
      continue;
    }

    if (inDoubleQuote) {
      current += ch;
      if (ch === '"') inDoubleQuote = false;
      i += 1;
      continue;
    }

    // `--` line comments: an apostrophe inside French prose (e.g. "d'architecture")
    // must not be mistaken for the start of a string literal.
    if (ch === '-' && sql[i + 1] === '-') {
      const lineEnd = sql.indexOf('\n', i);
      const end = lineEnd === -1 ? n : lineEnd;
      current += sql.slice(i, end);
      i = end;
      continue;
    }

    if (ch === "'") {
      inSingleQuote = true;
      current += ch;
      i += 1;
      continue;
    }
    if (ch === '"') {
      inDoubleQuote = true;
      current += ch;
      i += 1;
      continue;
    }
    if (ch === '$') {
      const match = /^\$[a-zA-Z_]*\$/.exec(sql.slice(i));
      if (match) {
        dollarTag = match[0];
        current += dollarTag;
        i += dollarTag.length;
        continue;
      }
    }
    if (ch === ';') {
      statements.push(current);
      current = '';
      i += 1;
      continue;
    }
    current += ch;
    i += 1;
  }
  if (current.trim().length > 0) statements.push(current);
  return statements;
}

const DROP_PATTERNS = [
  /^\s*ALTER\s+TABLE\s+\S+\s+(ENABLE|DISABLE)\s+ROW\s+LEVEL\s+SECURITY/i,
  /^\s*(CREATE|DROP)\s+POLICY\b/i,
  /^\s*CREATE\s+(OR\s+REPLACE\s+)?FUNCTION\s+my_tenant_id\b/i,
  /^\s*CREATE\s+(OR\s+REPLACE\s+)?FUNCTION\s+handle_new_user\b/i,
  /^\s*DROP\s+TRIGGER\s+IF\s+EXISTS\s+on_auth_user_created\b/i,
  /^\s*CREATE\s+TRIGGER\s+on_auth_user_created\b/i,
];

/** Strips full-line `--` comments so DROP_PATTERNS can match the real leading keyword. */
function withoutCommentLines(stmt) {
  return stmt
    .split('\n')
    .filter((line) => !line.trim().startsWith('--'))
    .join('\n')
    .trim();
}

/**
 * @param {string} sql Raw SQL text (schema.sql or a migrate_*.sql file)
 * @returns {string[]} statements safe to run against a local, RLS-less Postgres
 */
function transformSql(sql) {
  return splitStatements(sql)
    .map((stmt) => stmt.replace(/REFERENCES\s+auth\.users\(id\)(\s+ON\s+DELETE\s+CASCADE)?/gi, ''))
    .filter((stmt) => withoutCommentLines(stmt).length > 0)
    .filter((stmt) => !DROP_PATTERNS.some((re) => re.test(withoutCommentLines(stmt))));
}

module.exports = { splitStatements, transformSql };
