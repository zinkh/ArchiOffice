import { build } from 'esbuild';
await build({entryPoints:['server.ts'],bundle:true,platform:'node',format:'cjs',outfile:'dist-server/server.cjs',external:['vite','playwright-core'],logLevel:'warning'});
await build({entryPoints:['server/desktop/agent/entry.ts'],bundle:true,platform:'node',format:'cjs',target:'node22',outfile:'dist-server/drive-agent.cjs',logLevel:'warning'});
console.log('Serveur et agent Drive compilés dans dist-server/.');
