import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { beforeEach, afterEach, expect, it } from 'vitest';
import { WorkingCopies } from '../server/desktop/agent/workingCopies';
import type { TransferJob } from '../server/desktop/agent/transferQueue';
const identity = {userId:'user',tenantId:'tenant'};
const sha = (text:string) => crypto.createHash('sha256').update(text).digest('hex');
const meta = (version=1,name='Plan.dwg') => ({nodeId:'doc:plan',version,name,size:5,sha256:sha('hello')});
let root:string;let source:{file:string;sha256:string};let copies:WorkingCopies;
beforeEach(async()=> {
  root=await fs.mkdtemp(path.join(os.tmpdir(),'drive-working-'));
  source={file:path.join(root,'immutable.cache'),sha256:sha('hello')};await fs.writeFile(source.file,'hello');
  copies=new WorkingCopies(path.join(root,'working'),identity);
});
afterEach(async()=>{await fs.rm(root,{recursive:true,force:true});});
function done(version=2):TransferJob {
  return {...identity,formatVersion:1,id:crypto.randomUUID(),state:'done',createdAt:1,attempts:1,nextAttemptAt:0,errorCode:null,
    target:{documentId:'doc:plan'},baseVersion:1,name:'Plan.dwg',mimeType:'application/octet-stream',size:6,sha256:sha('edited'),bumpIndice:false,
    result:{node:{id:'doc:plan'},version}};
}
it('makes a separate writable inode and keeps a stable path across remote rename/version changes',async()=> {
  const copy=await copies.prepare(meta(),source);
  expect(copy).toMatchObject({baseVersion:1,remoteVersion:1,modified:false});expect(path.basename(copy.file)).toBe('Plan.dwg');
  expect((await fs.stat(copy.file)).ino).not.toBe((await fs.stat(source.file)).ino);
  await fs.writeFile(copy.file,'my edits');
  const reopened=await new WorkingCopies(path.join(root,'working'),identity).prepare(meta(2,'Renamed.dwg'),source);
  expect(reopened).toMatchObject({file:copy.file,baseVersion:1,remoteVersion:2,modified:true});
  expect(await fs.readFile(copy.file,'utf8')).toBe('my edits');expect(await fs.readFile(source.file,'utf8')).toBe('hello');
});
it.each(['../../outside.dwg','..\\..\\outside.dwg','CON.dwg','NUL','a:b?.dwg','.','   '])('contains unsafe filename %s inside its generated document directory',async name=> {
  const copy=await copies.prepare(meta(1,name),source);
  expect(path.relative(root,copy.file)).not.toMatch(/(^|[/\\])\.\.([/\\]|$)/);
  expect(path.basename(path.dirname(copy.file))).toBe('files');
  expect(path.basename(copy.file)).not.toMatch(/[<>:"/\\|?*]/);
  expect(await fs.readFile(copy.file,'utf8')).toBe('hello');
});
it('does not replace a deleted, untracked or invalid working file',async()=> {
  const copy=await copies.prepare(meta(),source);await fs.unlink(copy.file);
  await expect(copies.prepare(meta(),source)).rejects.toMatchObject({code:'ENOENT'});
  await fs.writeFile(copy.file,'untracked');
  await fs.unlink(path.join(path.dirname(path.dirname(copy.file)),'working.json'));
  await expect(copies.prepare(meta(),source)).rejects.toMatchObject({code:'WORKING_FILE_EXISTS'});
  expect(await fs.readFile(copy.file,'utf8')).toBe('untracked');
});
it('verifies copied bytes before publication and can recover a prepared manifest',async()=> {
  await fs.writeFile(source.file,'bad!!');
  await expect(copies.prepare(meta(),source)).rejects.toMatchObject({code:'WORKING_SOURCE_CORRUPT'});
  await fs.writeFile(source.file,'hello');
  const copy=await new WorkingCopies(path.join(root,'working'),identity).prepare(meta(),source);
  const journal=path.join(path.dirname(path.dirname(copy.file)),'working.json');
  const record=JSON.parse(await fs.readFile(journal,'utf8'));record.state='prepared';await fs.writeFile(journal,JSON.stringify(record));
  expect(await copies.prepare(meta(),source)).toMatchObject({modified:false});
  record.state='prepared';await fs.writeFile(journal,JSON.stringify(record));await fs.writeFile(copy.file,'edits');
  await expect(copies.prepare(meta(),source)).rejects.toMatchObject({code:'WORKING_RECOVERY_REQUIRED'});
  expect(await fs.readFile(copy.file,'utf8')).toBe('edits');
});
it('advances only the acknowledged snapshot baseline and preserves edits made during upload',async()=> {
  const copy=await copies.prepare(meta(),source);await fs.writeFile(copy.file,'edited');
  await copies.acknowledge(done());expect(await copies.inspect('doc:plan')).toMatchObject({baseVersion:2,modified:false});
  await fs.writeFile(copy.file,'later edit');await copies.acknowledge(done());
  expect(await copies.inspect('doc:plan')).toMatchObject({baseVersion:2,modified:true});
  expect(await fs.readFile(copy.file,'utf8')).toBe('later edit');
});
it('does not acknowledge conflicts, another identity, an invalid result or another baseline',async()=> {
  await copies.prepare(meta(),source);
  await copies.acknowledge({...done(),state:'conflict'});
  await expect(copies.acknowledge({...done(),userId:'other'})).rejects.toMatchObject({code:'WORKING_IDENTITY_MISMATCH'});
  await expect(copies.acknowledge({...done(),result:{node:{id:'doc:wrong'},version:2}})).rejects.toMatchObject({code:'INVALID_WORKING_ACKNOWLEDGEMENT'});
  await copies.acknowledge({...done(),baseVersion:3});
  expect(await copies.inspect('doc:plan')).toMatchObject({baseVersion:1,modified:false});
});
it('rejects manifest path traversal and does not adopt symbolic links as working files',async()=> {
  const copy=await copies.prepare(meta(),source);const journal=path.join(path.dirname(path.dirname(copy.file)),'working.json');
  const record=JSON.parse(await fs.readFile(journal,'utf8'));record.name='../../outside';await fs.writeFile(journal,JSON.stringify(record));
  await expect(copies.inspect('doc:plan')).rejects.toMatchObject({code:'WORKING_RECORD_CORRUPT'});
  record.name='Plan.dwg';await fs.writeFile(journal,JSON.stringify(record));await fs.unlink(copy.file);await fs.symlink(source.file,copy.file);
  await expect(copies.inspect('doc:plan')).rejects.toThrow();expect(await fs.readFile(source.file,'utf8')).toBe('hello');
});
it('isolates identities and serializes simultaneous materializations',async()=> {
  const [a,b]=await Promise.all([copies.prepare(meta(),source),copies.prepare(meta(),source)]);expect(a.file).toBe(b.file);
  const other=await new WorkingCopies(path.join(root,'working'),{...identity,userId:'other'}).prepare(meta(),source);
  expect(other.file).not.toBe(a.file);
});
it('restarts into a distinct verified file and leaves the previous file and later edits at their original path',async()=>{
  const old=await copies.prepare(meta(),source);await fs.writeFile(old.file,'latest local edits');
  const remote={...meta(2),size:6,sha256:sha('remote')};await fs.writeFile(source.file,'remote');const id=crypto.randomUUID();
  const next=await copies.restart(remote,{...source,sha256:sha('remote')},id,async()=>{});
  expect(next).toMatchObject({baseVersion:2,modified:false});expect(next.file).not.toBe(old.file);
  expect(await fs.readFile(next.file,'utf8')).toBe('remote');expect(await fs.readFile(old.file,'utf8')).toBe('latest local edits');
  // An app still holding the old file may save again; those bytes are retained.
  await fs.writeFile(old.file,'even newer edits');
  expect((await new WorkingCopies(path.join(root,'working'),identity).restart(remote,{...source,sha256:sha('remote')},id,async()=>{})).file).toBe(next.file);
  expect(await fs.readFile(old.file,'utf8')).toBe('even newer edits');
});
it('does not switch the working pointer after authorization refusal and recovers exclusive publication on retry',async()=>{
  const old=await copies.prepare(meta(),source);const remote={...meta(2),size:6,sha256:sha('remote')};await fs.writeFile(source.file,'remote');const id=crypto.randomUUID();
  await expect(copies.restart(remote,{...source,sha256:sha('remote')},id,async()=>{throw new Error('revoked');})).rejects.toThrow('revoked');
  expect((await copies.inspect('doc:plan')).file).toBe(old.file);
  expect(await copies.restart(remote,{...source,sha256:sha('remote')},id,async()=>{})).toMatchObject({baseVersion:2});
});
it('refuses a clean-only update if an application saves local changes before final publication',async()=>{
  const old=await copies.prepare(meta(),source);const remote={...meta(2),size:6,sha256:sha('remote')};await fs.writeFile(source.file,'remote');
  await expect(copies.restart(remote,{...source,sha256:sha('remote')},crypto.randomUUID(),async()=>{await fs.writeFile(old.file,'late app save');},true)).rejects.toMatchObject({code:'WORKING_LOCAL_MODIFICATIONS'});
  expect((await copies.inspect('doc:plan')).file).toBe(old.file);expect(await fs.readFile(old.file,'utf8')).toBe('late app save');
});
