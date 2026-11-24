// Compile le serveur une fois, au build, pour la production (Docker).
//
// `tsx server.ts` recompilait tout le TypeScript à chaque démarrage : une
// vingtaine de secondes de démarrage et le compilateur gardé en mémoire, sur
// une instance de 512 Mo. Ici, esbuild ne regroupe que le code du dépôt
// (server.ts, server/, le paquet @zinkh/archioffice-agents livré en source
// TypeScript) ; les paquets de node_modules restent des imports externes,
// résolus au démarrage depuis /app/node_modules. C'est ce qui garde
// l'instrumentation d'Express par Sentry (`--import instrument.mjs`), qui ne
// peut pas patcher un module recopié dans le bundle.
//
// Format ESM et non CJS, dans dist-api/ : distinct de `build:server`, le bundle
// complet en CommonJS du client Electron (dist-server/, recopié en entier dans
// l'installeur), qui embarque toutes ses dépendances.
import { readFile } from 'node:fs/promises';
import { build } from 'esbuild';

const localPackages = ['@zinkh/archioffice-agents'];

// Paquets CommonJS que le serveur ne peut PAS importer en nommé une fois externes : Node ne détecte pas
// leurs exports (UMD, Object.defineProperty...) et refuse `import { saveAs } from 'file-saver'` au démarrage
// (« Named export not found »). Le serveur n'en a pas besoin pour télécharger : le code partagé avec l'écran
// (src/lib/xlsxLetterhead.ts, exportSortie.ts...) les importe, il suffit donc de les recopier dans le bundle,
// où esbuild fait lui-même l'interopérabilité CommonJS. Ajouter ici tout paquet que la vérification
// ci-dessous signale.
const bundledPackages = ['file-saver'];

const externalizeNodeModules = {
  name: 'externalize-node-modules',
  setup(b) {
    b.onResolve({ filter: /.*/ }, args => {
      const p = args.path;
      if (args.kind === 'entry-point') return undefined;
      if (p.startsWith('.') || p.startsWith('/') || p.startsWith('@/')) return undefined;
      if (localPackages.some(pkg => p === pkg || p.startsWith(`${pkg}/`))) return undefined;
      if (bundledPackages.includes(p)) return undefined;
      return { path: p, external: true };
    });
  },
};

// Le dossier de sortie se change pour les tests (variable SERVER_BUILD_OUTDIR) ; la production garde dist-api.
const outdir = process.env.SERVER_BUILD_OUTDIR || 'dist-api';

await build({
  entryPoints: { server: 'server.ts', instrument: 'instrument.ts' },
  outdir,
  outExtension: { '.js': '.mjs' },
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  sourcemap: true,
  logLevel: 'warning',
  plugins: [externalizeNodeModules],
});

// Un import nommé d'un paquet externe qui n'existe pas côté Node ne se voit qu'au démarrage du serveur : le
// déploiement échouait alors après la mise en ligne du build. On le vérifie ici, au build, en important chaque
// paquet comme le fera Node. Un paquet qui ne se charge pas (optionnel, absent) est ignoré : seul un nom
// réellement manquant fait échouer.
const source = await readFile(`${outdir}/server.mjs`, 'utf8');
const wanted = new Map();
for (const [, names, pkg] of source.matchAll(/^import\s*\{([^}]*)\}\s*from\s*"([^"]+)";?$/gm)) {
  if (pkg.startsWith('.') || pkg.startsWith('/') || pkg.startsWith('node:')) continue;
  const set = wanted.get(pkg) ?? new Set();
  for (const part of names.split(',')) {
    const name = part.trim().split(/\s+as\s+/)[0].replace(/^type\s+/, '');
    if (name) set.add(name);
  }
  wanted.set(pkg, set);
}
const missing = [];
for (const [pkg, names] of wanted) {
  let ns;
  try { ns = await import(pkg); } catch { continue; }
  for (const name of names) if (!(name in ns)) missing.push(`${name} depuis « ${pkg} »`);
}
if (missing.length) {
  console.error(`Import nommé introuvable côté Node : ${missing.join(', ')}.`);
  console.error('Ces paquets sont en CommonJS : ajoutez-les à `bundledPackages` dans scripts/build-server.mjs.');
  process.exit(1);
}

console.log(`Serveur compilé dans ${outdir}/ (server.mjs, instrument.mjs)`);
