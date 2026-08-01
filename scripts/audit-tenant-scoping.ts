// Mechanical audit for the tenant-isolation bug class fixed in Phase 2:
// a route handler resolves `tenantId` via getTenantId(userId), but then runs
// a supabaseAdmin query (which bypasses RLS — it uses the service-role key)
// without an `.eq('tenant_id', tenantId)` (or `.in('tenant_id', ...)`) filter,
// leaking or mutating another tenant's row. See:
//   - PUT /api/invoices/:id (and 4 sibling routes): filtered UPDATE followed
//     by an unfiltered read-back that leaked the response.
//   - POST /api/feed/{posts,activities}/:id/like: no tenant filter at all.
//
// Handler-body boundaries are found via the real TypeScript AST (not brace
// counting on raw text) — a first cut using hand-rolled brace matching broke
// on `/column "([^"]+)"/.exec(...)` (server.ts:6522): a regex literal whose
// embedded quote characters look like string delimiters to a naive scanner,
// which then swallows real code (including its braces) as "inside a string"
// until the next stray quote far downstream, misattributing findings to the
// wrong handler entirely. Using the parser sidesteps that class of problem.
//
// This is still a heuristic — it flags candidates for manual review inside
// an already-correctly-bounded handler body, it does not prove a bug on its
// own. Run with: npx tsx scripts/audit-tenant-scoping.ts
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import ts from 'typescript';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SERVER_TS = path.join(__dirname, '..', 'server.ts');
const src = fs.readFileSync(SERVER_TS, 'utf8');
const sourceFile = ts.createSourceFile(SERVER_TS, src, ts.ScriptTarget.ES2022, true);

function lineOf(pos: number): number {
  return sourceFile.getLineAndCharacterOfPosition(pos).line + 1;
}

const HTTP_METHODS = new Set(['get', 'post', 'put', 'patch', 'delete']);

interface HandlerBlock {
  method: string;
  routePath: string;
  startLine: number;
  body: string;
  bodyStart: number;
}

function extractHandlerBlocks(): HandlerBlock[] {
  const blocks: HandlerBlock[] = [];

  function visit(node: ts.Node) {
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      ts.isIdentifier(node.expression.expression) &&
      node.expression.expression.text === 'app' &&
      HTTP_METHODS.has(node.expression.name.text)
    ) {
      const method = node.expression.name.text;
      const pathArg = node.arguments.find(a => ts.isStringLiteral(a) || ts.isNoSubstitutionTemplateLiteral(a));
      const handlerArg = node.arguments[node.arguments.length - 1];
      if (pathArg && handlerArg && (ts.isArrowFunction(handlerArg) || ts.isFunctionExpression(handlerArg)) && handlerArg.body && ts.isBlock(handlerArg.body)) {
        const routePath = (pathArg as ts.StringLiteral).text;
        const body = handlerArg.body;
        blocks.push({
          method,
          routePath,
          startLine: lineOf(node.getStart(sourceFile)),
          body: src.slice(body.getStart(sourceFile), body.getEnd()),
          bodyStart: body.getStart(sourceFile),
        });
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(sourceFile);
  return blocks;
}

interface Finding {
  method: string;
  routePath: string;
  startLine: number;
  table: string;
  snippetLine: number;
  kind: 'select-single' | 'select-list' | 'update' | 'delete';
  snippet: string;
}

function auditBlock(block: HandlerBlock): Finding[] {
  if (!/getTenantId\(/.test(block.body)) return [];

  const findings: Finding[] = [];
  // Every `supabaseAdmin ... .from('table')` chain up to its terminating `;`.
  const chainRe = /supabaseAdmin\s*[\s\S]{0,20}?\.from\(\s*['"`](\w+)['"`]\)[\s\S]*?;/g;
  let m: RegExpExecArray | null;
  while ((m = chainRe.exec(block.body))) {
    const chain = m[0];
    const table = m[1];
    if (chain.includes('tenant_id')) continue;

    const absoluteIdx = block.bodyStart + m.index;
    const snippetLine = lineOf(absoluteIdx);
    const snippet = chain.replace(/\s+/g, ' ').trim().slice(0, 160);

    if (/\.(single|maybeSingle)\(\)/.test(chain)) {
      findings.push({ method: block.method, routePath: block.routePath, startLine: block.startLine, table, snippetLine, kind: 'select-single', snippet });
    } else if (/\.update\(/.test(chain)) {
      findings.push({ method: block.method, routePath: block.routePath, startLine: block.startLine, table, snippetLine, kind: 'update', snippet });
    } else if (/\.delete\(\)/.test(chain)) {
      findings.push({ method: block.method, routePath: block.routePath, startLine: block.startLine, table, snippetLine, kind: 'delete', snippet });
    } else if (/\.select\(/.test(chain)) {
      findings.push({ method: block.method, routePath: block.routePath, startLine: block.startLine, table, snippetLine, kind: 'select-list', snippet });
    }
  }
  return findings;
}

const blocks = extractHandlerBlocks();
const allFindings = blocks.flatMap(auditBlock);

console.log(`Scanned ${blocks.length} route handlers, ${blocks.filter(b => /getTenantId\(/.test(b.body)).length} of which call getTenantId().`);
console.log(`${allFindings.length} candidate finding(s) — a query on the same handler as a getTenantId() call, with no 'tenant_id' anywhere in its own filter chain.\n`);
console.log('Review each manually: some are legitimate (e.g. profiles.eq(\'id\', req.user.id) — a user looking up their own row, or queries scoped by a different but still tenant-owned foreign key already validated elsewhere).\n');

for (const f of allFindings) {
  console.log(`[${f.kind}] ${f.method.toUpperCase()} ${f.routePath} (handler @ server.ts:${f.startLine})`);
  console.log(`    server.ts:${f.snippetLine} table=${f.table}`);
  console.log(`    ${f.snippet}`);
  console.log('');
}
