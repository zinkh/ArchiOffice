import { build } from 'esbuild';
// Whitespace and syntax only: identifiers are NOT renamed (minifyIdentifiers
// stays off), so anything reading a class/function `.name` or a stack trace
// keeps working. The bundle is copied whole into the installer.
await build({entryPoints:['server.ts'],bundle:true,platform:'node',format:'cjs',outfile:'dist-server/server.cjs',external:['vite','playwright-core'],minifyWhitespace:true,minifySyntax:true,logLevel:'warning'});
await build({entryPoints:['server/desktop/agent/entry.ts'],bundle:true,platform:'node',format:'cjs',target:'node22',outfile:'dist-server/drive-agent.cjs',logLevel:'warning'});
console.log('Serveur et agent Drive compilés dans dist-server/.');
