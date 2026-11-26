// Synthetic producer/consumer fixture only; never mounts or reads A:.
import path from 'node:path';import crypto from 'node:crypto';
import {createRequire} from 'node:module';
const {createWindowsShellCatalog}=createRequire(import.meta.url)('../../electron/windowsShellCatalog.cjs');
const hash=value=>crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
const identity={userId:'fixture-user',tenantId:'fixture-tenant',deviceId:'fixture-device'};
const namespaceRoot=path.resolve(process.argv[2]);const directory=path.join(namespaceRoot,hash(Object.values(identity)));
const catalog=[{path:'_VIP',key:'a'.repeat(64),folder:true,size:0},{path:'_VIP\\_APD\\_Plan.pdf',key:'b'.repeat(64),folder:false,size:4,meta:{nodeId:'doc:d',version:3,size:4,sha256:null,name:'Plan.pdf'}}];
const snapshot={identity,projectId:'p',catalog,rootKey:hash([...Object.values(identity),'p',catalog])};
const bridge=createWindowsShellCatalog({namespaceRoot,cacheRoot:path.join(namespaceRoot,'business-cache'),vault:async()=>identity,
 drive:{shellSnapshots:async()=>({identity,directory,snapshots:[snapshot]})},
 agent:{windowsPreview:async()=>({identity,projectId:'p',name:'VIP-TC (fixture)',documents:[{nodeId:'doc:d',projectId:'p',name:'Plan.pdf',phase:'APD',documentType:'PLAN',indice:'C',remoteVersion:8,status:'en_cours',permissions:{read:true,write:false,delete:false},readOnlyReason:'approved'}]}),
 documentStatuses:async()=>({identity,documents:[{nodeId:'doc:d',state:'queued'}]})}});
await bridge.tick();await bridge.settle();await bridge.tick();
console.log(directory);
