import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
const { openDriveWorking } = createRequire(import.meta.url)('../electron/driveWorking.cjs');
let root: string; let file: string;
const identity = { userId: 'user', tenantId: 'tenant', deviceId: 'device' };
const hash=(v:string[])=>crypto.createHash('sha256').update(JSON.stringify(v)).digest('hex');
beforeEach(async()=>{
  root=await fs.mkdtemp(path.join(os.tmpdir(),'drive-open-'));
  file=path.join(root,hash(['user','tenant']),'working',hash(['user','tenant','doc:one']),'files','Plan.pdf');
  await fs.mkdir(path.dirname(file),{recursive:true});await fs.writeFile(file,'pdf');
});
afterEach(async()=>{await fs.rm(root,{recursive:true,force:true});});
function config(){return {root,nodeId:'doc:one',agent:{working:vi.fn().mockResolvedValue({file,identity})},vault:vi.fn().mockResolvedValue(identity),shell:{openPath:vi.fn().mockResolvedValue('')}};}
it('opens only the scoped document and returns no private path',async()=>{
  const c=config();expect(await openDriveWorking(c)).toEqual({status:'opened'});
  expect(c.shell.openPath).toHaveBeenCalledWith(file);expect(c.vault).toHaveBeenCalledTimes(2);
});
it('does not open after the vault changes identity or refuses at the final check',async()=>{
  const c=config();c.vault.mockResolvedValueOnce(identity).mockRejectedValueOnce(new Error('revoked'));
  expect(await openDriveWorking(c)).toEqual({status:'error'});expect(c.shell.openPath).not.toHaveBeenCalled();
  c.vault.mockResolvedValue({...identity,tenantId:'other'});
  expect(await openDriveWorking(c)).toEqual({status:'error'});expect(c.shell.openPath).not.toHaveBeenCalled();
});
it('refuses files from another document, symlinks and executable types',async()=>{
  const c=config();c.agent.working.mockResolvedValueOnce({file:path.join(root,'outside.pdf'),identity});
  expect(await openDriveWorking(c)).toEqual({status:'error'});
  await fs.unlink(file);await fs.symlink(path.join(root,'target.pdf'),file);await fs.writeFile(path.join(root,'target.pdf'),'x');
  expect(await openDriveWorking(c)).toEqual({status:'error'});
  await fs.unlink(file);file=path.join(path.dirname(file),'Program.exe');await fs.writeFile(file,'x');
  c.agent.working.mockResolvedValue({file,identity});
  expect(await openDriveWorking(c)).toEqual({status:'unsupported'});expect(c.shell.openPath).not.toHaveBeenCalled();
});
it('rejects untrusted identifiers before asking the worker and handles OS launch errors',async()=>{
  const c=config();expect(await openDriveWorking({...c,nodeId:'../../file'})).toEqual({status:'error'});
  expect(c.agent.working).not.toHaveBeenCalled();c.shell.openPath.mockResolvedValue('No associated application');
  expect(await openDriveWorking(c)).toEqual({status:'error'});
});

it('returns only whitelisted document states and rejects a mismatched identity or unrequested result',async()=>{
  const {driveDocumentStatuses}=require('../electron/driveWorking.cjs');
  const identity={userId:'user',tenantId:'tenant',deviceId:'device'};
  const agent={documentStatuses:vi.fn().mockResolvedValue({identity,documents:[{nodeId:'doc:one',state:'uploaded',version:2,file:'/private/plan',token:'secret'}]})};
  const vault=vi.fn().mockResolvedValue({...identity,token:'ds_at_secret'});
  expect(await driveDocumentStatuses({agent,vault,nodeIds:['doc:one']})).toEqual([{nodeId:'doc:one',state:'uploaded',version:2}]);
  for(const document of [{nodeId:'doc:other',state:'queued'},{nodeId:'doc:one',state:'alien'},{nodeId:'doc:one',state:'uploaded',version:-1}]) {
    agent.documentStatuses.mockResolvedValue({identity,documents:[document]});
    await expect(driveDocumentStatuses({agent,vault,nodeIds:['doc:one']})).rejects.toThrow();
  }
  agent.documentStatuses.mockResolvedValue({identity,documents:[{nodeId:'doc:one',state:'queued'}]});
  vault.mockRejectedValueOnce(new Error('license expired'));await expect(driveDocumentStatuses({agent,vault,nodeIds:['doc:one']})).rejects.toThrow('license expired');
  vault.mockResolvedValue({...identity,userId:'other'});await expect(driveDocumentStatuses({agent,vault,nodeIds:['doc:one']})).rejects.toThrow('Identity changed');
  await expect(driveDocumentStatuses({agent,vault,nodeIds:['../../bad']})).rejects.toThrow('Invalid documents');
});
it('filters the conflict preservation state without returning new document paths or credentials',async()=>{
  const {driveDocumentStatuses}=require('../electron/driveWorking.cjs');const identity={userId:'user',tenantId:'tenant',deviceId:'device'};
  const agent={documentStatuses:vi.fn().mockResolvedValue({identity,documents:[{nodeId:'doc:one',state:'conflict',preservation:'done',file:'/private',token:'secret'}]})};
  const vault=async()=>identity;
  expect(await driveDocumentStatuses({agent,vault,nodeIds:['doc:one']})).toEqual([{nodeId:'doc:one',state:'conflict',preservation:'done'}]);
  agent.documentStatuses.mockResolvedValue({identity,documents:[{nodeId:'doc:one',state:'conflict',preservation:'invalid'}]});
  await expect(driveDocumentStatuses({agent,vault,nodeIds:['doc:one']})).rejects.toThrow('Invalid preservation state');
});
