// Phase 6b of the engineering-maturity plan: closes the observability gap
// found while analyzing server.ts's ~440 console.error call sites — roughly
// half of its ~386 `catch` blocks have NO logging at all (not even a bare
// console.error), so a failure there is invisible: no terminal output, no
// Sentry event (captureConsoleIntegration only sees console.* calls that
// never happen), just a generic 500 to the client. This inserts a minimal
// `console.error("[METHOD /route]", err)` into every such block — a label
// derived from the nearest enclosing app.get/post/put/patch/delete
// registration, so even an anonymous Error in the log at least says which
// route it came from.
//
// Deliberately NOT captureWithContext()/tenant tagging here — that stays
// reserved for the security-sensitive routes already covered in Phase 6.
// This pass's only job is "no more silent catches".
//
// Uses the real TypeScript AST (ts.createSourceFile), not brace/regex
// scanning on raw text — see scripts/audit-tenant-scoping.ts's own comment
// for why a hand-rolled scanner breaks on regex literals with embedded
// quotes elsewhere in this file.
//
// One-shot codemod: run with `npx tsx scripts/fix-silent-catch-blocks.ts`,
// review the diff, then delete this script or keep it for a future re-run
// (it's idempotent — already-logged catch blocks are left untouched).
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

function indentOf(pos: number): string {
  const lineStart = src.lastIndexOf('\n', pos) + 1;
  const leading = src.slice(lineStart, pos).match(/^\s*/);
  return (leading ? leading[0] : '') + '  ';
}

const HTTP_METHODS = new Set(['get', 'post', 'put', 'patch', 'delete']);
const LOGGING_CALL_RE = /console\.(error|warn|log)\(|captureWithContext\(|Sentry\.captureException\(/;

interface Insertion {
  pos: number;
  text: string;
}

const insertions: Insertion[] = [];
const routeStack: string[] = [];
let fixed = 0;
let alreadyLogged = 0;

function visit(node: ts.Node) {
  let pushedRoute = false;

  if (
    ts.isCallExpression(node) &&
    ts.isPropertyAccessExpression(node.expression) &&
    ts.isIdentifier(node.expression.expression) &&
    node.expression.expression.text === 'app' &&
    HTTP_METHODS.has(node.expression.name.text)
  ) {
    const method = node.expression.name.text;
    const pathArg = node.arguments.find(a => ts.isStringLiteral(a) || ts.isNoSubstitutionTemplateLiteral(a));
    if (pathArg) {
      routeStack.push(`${method.toUpperCase()} ${(pathArg as ts.StringLiteral).text}`);
      pushedRoute = true;
    }
  }

  if (ts.isCatchClause(node) && node.block) {
    const blockText = src.slice(node.block.getStart(sourceFile), node.block.getEnd());
    if (LOGGING_CALL_RE.test(blockText)) {
      alreadyLogged++;
    } else {
      const label = routeStack.length > 0 ? routeStack[routeStack.length - 1] : `server.ts:${lineOf(node.getStart(sourceFile))}`;
      const varName = node.variableDeclaration && ts.isIdentifier(node.variableDeclaration.name)
        ? node.variableDeclaration.name.text
        : null;
      const stmt = varName
        ? `console.error("[${label}]", ${varName});`
        : `console.error("[${label}] Unhandled error");`;
      const insertPos = node.block.getStart(sourceFile) + 1; // right after the block's opening `{`
      insertions.push({ pos: insertPos, text: `\n${indentOf(node.getStart(sourceFile))}${stmt}` });
      fixed++;
    }
  }

  ts.forEachChild(node, visit);
  if (pushedRoute) routeStack.pop();
}

visit(sourceFile);

insertions.sort((a, b) => b.pos - a.pos);
let output = src;
for (const ins of insertions) {
  output = output.slice(0, ins.pos) + ins.text + output.slice(ins.pos);
}

fs.writeFileSync(SERVER_TS, output, 'utf8');
console.log(`Inserted logging into ${fixed} silent catch block(s); ${alreadyLogged} already had logging (left untouched).`);
