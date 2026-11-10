// Static source index, deliberately not an OpenAPI contract or a runtime router dump.
import ts from 'typescript';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = path.join(root, 'docs/api-routes.md');
const methods = new Set(['get', 'post', 'put', 'patch', 'delete', 'head', 'options', 'all']);

export function extractRoutes(source, filename) {
  const file = ts.createSourceFile(filename, source, ts.ScriptTarget.Latest, true);
  const routes = [];
  const dynamic = [];
  function visit(node) {
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
      const { expression: receiver, name } = node.expression;
      // Only Express app/router declarations; avoid HTTP clients and database builders.
      if (ts.isIdentifier(receiver) && /^(app|router|.*Router)$/.test(receiver.text) && methods.has(name.text)) {
        const arg = node.arguments[0];
        const line = file.getLineAndCharacterOfPosition(node.getStart(file)).line + 1;
        const args = arg && ts.isArrayLiteralExpression(arg) ? arg.elements : arg ? [arg] : [];
        for (const value of args) {
          if (ts.isStringLiteral(value) || ts.isNoSubstitutionTemplateLiteral(value)) {
            routes.push({ method: name.text.toUpperCase(), path: value.text, file: filename, line });
          } else {
            dynamic.push({ method: name.text.toUpperCase(), expression: value.getText(file), file: filename, line });
          }
        }
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(file);
  return { routes, dynamic };
}

async function sourceFiles(dir) {
  const entries = await readdir(path.join(root, dir), { withFileTypes: true });
  const files = [];
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name, 'en'))) {
    const relative = `${dir}/${entry.name}`;
    if (entry.isDirectory() && !['__tests__', 'node_modules'].includes(entry.name)) files.push(...await sourceFiles(relative));
    else if (entry.isFile() && /\.tsx?$/.test(entry.name) && !/\.(test|spec)\./.test(entry.name)) files.push(relative);
  }
  return files;
}

export async function buildInventory() {
  const files = ['server.ts', ...await sourceFiles('server'), ...await sourceFiles('packages/archioffice-agents/src/server')];
  const results = await Promise.all(files.map(async filename => extractRoutes(await readFile(path.join(root, filename), 'utf8'), filename)));
  const routes = results.flatMap(r => r.routes).sort((a, b) => a.path.localeCompare(b.path, 'en') || a.method.localeCompare(b.method, 'en') || a.file.localeCompare(b.file, 'en') || a.line - b.line);
  const dynamic = results.flatMap(r => r.dynamic);
  const link = r => `[${r.file}:${r.line}](../${r.file}#L${r.line})`;
  const escape = s => s.replaceAll('|', '\\|').replaceAll('`', '\\`').replaceAll('\n', ' ');
  return `# Inventaire des déclarations de routes\n\n` +
    `Généré avec \`npm run docs:routes\`. Vérifier avec \`npm run docs:check\`.\n\n` +
    `Cet index analyse l’AST TypeScript de server.ts, server/ et du serveur du paquet agents. ` +
    `Il relève les appels HTTP app/router/*Router avec chemins littéraux, y compris les tableaux. ` +
    `Les commentaires et tests sont exclus. Les préfixes de montage des routers ne sont pas résolus ; ` +
    `les déclarations conditionnelles restent listées, même si leur mode n’est pas actif. ` +
    `Les fabriques de routes, alias de receivers et app.route(...).get(...) ne sont pas développés. ` +
    `Ce n’est ni une liste garantie des routes actives ni un contrat de paramètres ou d’autorisations. ` +
    `Lire [API.md](../API.md), [MCP.md](../MCP.md) et le gestionnaire lié avant intégration.\n\n` +
    `${routes.length} déclarations littérales relevées. Les chemins relatifs appartiennent à leur router.\n\n` +
    `| Méthode | Chemin déclaré | Source |\n| --- | --- | --- |\n` +
    routes.map(r => `| ${r.method} | \`${escape(r.path)}\` | ${link(r)} |`).join('\n') + '\n\n' +
    `## Déclarations dynamiques à examiner\n\n` +
    `Ces expressions ne sont pas transformées en endpoints supposés.\n\n` +
    (dynamic.length ? `| Méthode | Expression source | Source |\n| --- | --- | --- |\n` + dynamic.map(r => `| ${r.method} | ${escape(r.expression)} | ${link(r)} |`).join('\n') : 'Aucune expression dynamique relevée.') + '\n';
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const content = await buildInventory();
  if (process.argv.includes('--check')) {
    const current = await readFile(output, 'utf8').catch(() => '');
    if (current !== content) {
      console.error('Inventaire obsolète : exécuter npm run docs:routes et committer docs/api-routes.md.');
      process.exitCode = 1;
    } else console.log('Inventaire des routes à jour.');
  } else {
    await writeFile(output, content);
    console.log('docs/api-routes.md régénéré.');
  }
}
