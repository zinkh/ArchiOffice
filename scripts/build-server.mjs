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
import { build } from 'esbuild';

const localPackages = ['@zinkh/archioffice-agents'];

const externalizeNodeModules = {
  name: 'externalize-node-modules',
  setup(b) {
    b.onResolve({ filter: /.*/ }, args => {
      const p = args.path;
      if (args.kind === 'entry-point') return undefined;
      if (p.startsWith('.') || p.startsWith('/') || p.startsWith('@/')) return undefined;
      if (localPackages.some(pkg => p === pkg || p.startsWith(`${pkg}/`))) return undefined;
      return { path: p, external: true };
    });
  },
};

await build({
  entryPoints: { server: 'server.ts', instrument: 'instrument.ts' },
  outdir: 'dist-api',
  outExtension: { '.js': '.mjs' },
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  sourcemap: true,
  logLevel: 'warning',
  plugins: [externalizeNodeModules],
});

console.log('Serveur compilé dans dist-api/ (server.mjs, instrument.mjs)');
