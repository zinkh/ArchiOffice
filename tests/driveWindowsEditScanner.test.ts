import fs from 'node:fs/promises';import os from 'node:os';import path from 'node:path';import {createRequire} from 'node:module';
import {beforeEach,afterEach,it,expect,vi} from 'vitest';
const {createWindowsEdits}=createRequire(import.meta.url)('../electron/windowsDriveEdits.cjs');
const {noLinks}=createRequire(import.meta.url)('../electron/windowsDrive.cjs');
const identity={userId:'u',tenantId:'t',deviceId:'d'},key='a'.repeat(64);
let root:string,file:string,manifest:any,options:any,scanner:any,clock:number;
beforeEach(async()=>{
 root=await fs.mkdtemp(path.join(os.tmpdir(),'drive-scanner-'));file=path.join(root,'_Plan.txt');await fs.writeFile(file,'edit');clock=0;
 manifest={identity,projectId:'p',rootKey:'b'.repeat(64),directory:root,catalog:[{key,path:'_Plan.txt',folder:false,meta:{nodeId:'doc:plan'}}]};
 options={manifest,noLinks,lock:vi.fn(async()=>vi.fn()),now:()=>clock,vault:vi.fn().mockResolvedValue(identity),changes:vi.fn().mockResolvedValue([key]),agent:{windowsPreview:vi.fn().mockResolvedValue({queued:true,jobId:'j'}),documentStatuses:vi.fn().mockResolvedValue({identity,documents:[{nodeId:'doc:plan',state:'none'}]})}};
});
afterEach(async()=>{scanner?.stop();scanner=null;await new Promise(resolve=>setImmediate(resolve));await fs.rm(root,{recursive:true,force:true});});
async function begin(){scanner=createWindowsEdits(options);await vi.waitFor(()=>expect(options.agent.documentStatuses).toHaveBeenCalled());}
it('does not read or capture untouched placeholders',async()=>{options.changes.mockResolvedValue([]);await begin();clock=3000;await scanner.scan();expect(options.agent.windowsPreview).not.toHaveBeenCalled();expect(scanner.status().pending).toBe(0);});
it('waits for a stable save, captures only its opaque identity and skips the same save',async()=>{
 await begin();expect(options.agent.windowsPreview).not.toHaveBeenCalled();clock=1999;await scanner.scan();expect(options.agent.windowsPreview).not.toHaveBeenCalled();clock=2000;await scanner.scan();
 expect(options.agent.windowsPreview).toHaveBeenCalledWith('upload',{identity,projectId:'p',rootKey:manifest.rootKey,key});clock=5000;await scanner.scan();expect(options.agent.windowsPreview).toHaveBeenCalledTimes(1);
});
it('detects an atomic replacement and retains a later save while an upload is pending',async()=>{
 await begin();clock=3000;await scanner.scan();const tmp=file+'.tmp';await fs.writeFile(tmp,'new saved bytes');await fs.rename(tmp,file);clock=4000;await scanner.scan();
 options.agent.windowsPreview.mockResolvedValueOnce({queued:true,pending:true,jobId:'old'});clock=7000;await scanner.scan();expect(options.agent.windowsPreview).toHaveBeenCalledTimes(2);
 clock=10000;await scanner.scan();expect(options.agent.windowsPreview).toHaveBeenCalledTimes(3);expect(await fs.readFile(file,'utf8')).toBe('new saved bytes');
});
it('reports capture failures and retries without touching the local file',async()=>{
 await begin();options.agent.windowsPreview.mockRejectedValueOnce(new Error('locked'));clock=3000;await scanner.scan();expect(scanner.status().unavailable).toBe(1);clock=6000;await scanner.scan();expect(scanner.status().unavailable).toBe(0);expect(await fs.readFile(file,'utf8')).toBe('edit');
});
it('reports remote conflicts and blocked uploads without showing successful synchronization',async()=>{
 options.agent.documentStatuses.mockResolvedValue({identity,documents:[{nodeId:'doc:plan',state:'conflict'}]});await begin();expect(scanner.status().conflicts).toBe(1);
 options.agent.documentStatuses.mockResolvedValue({identity,documents:[{nodeId:'doc:plan',state:'blocked'}]});await scanner.scan();expect(scanner.status().blocked).toBe(1);
});
it('refuses unknown changes and stops capturing on expiry or cabinet change',async()=>{
 options.changes.mockResolvedValue(['unknown']);scanner=createWindowsEdits(options);await vi.waitFor(()=>expect(scanner.status().unavailable).toBe(1));expect(options.agent.windowsPreview).not.toHaveBeenCalled();
 options.changes.mockResolvedValue([key]);options.vault.mockResolvedValue({...identity,tenantId:'other'});clock=3000;await scanner.scan();expect(options.agent.windowsPreview).not.toHaveBeenCalled();
 options.vault.mockRejectedValue(new Error('expired'));clock=6000;await scanner.scan();expect(options.agent.windowsPreview).not.toHaveBeenCalled();
});
it('keeps missing files missing, refuses links and stops on disconnect',async()=>{
 await fs.unlink(file);await begin();clock=3000;await scanner.scan();expect(scanner.status().unavailable).toBe(1);expect(options.agent.windowsPreview).not.toHaveBeenCalled();
 const outside=path.join(root,'outside');await fs.writeFile(outside,'keep');await fs.symlink(outside,file);await scanner.scan();expect(options.agent.windowsPreview).not.toHaveBeenCalled();
 scanner.stop();options.changes.mockClear();await scanner.scan();expect(options.changes).not.toHaveBeenCalled();expect(await fs.readFile(outside,'utf8')).toBe('keep');
});

it('waits for writers to close and releases its read lease after capture refusal',async()=>{
 options.lock.mockResolvedValue(null);await begin();clock=3000;await scanner.scan();expect(options.agent.windowsPreview).not.toHaveBeenCalled();expect(scanner.status().pending).toBe(1);
 const release=vi.fn();options.lock.mockResolvedValue(release);options.agent.windowsPreview.mockRejectedValueOnce(new Error('refused'));clock=6000;await scanner.scan();expect(release).toHaveBeenCalledTimes(1);
});

it('does not query a new provider when stopped during authorization',async()=>{
 await begin();options.changes.mockClear();let release:(value:any)=>void=()=>{};options.vault.mockImplementationOnce(()=>new Promise(resolve=>{release=resolve;}));
 const pending=scanner.scan();scanner.stop();release(identity);await pending;expect(options.changes).not.toHaveBeenCalled();expect(options.agent.windowsPreview).not.toHaveBeenCalled();
});
