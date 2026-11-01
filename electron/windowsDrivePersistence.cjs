'use strict';
const fs = require('fs/promises');
const path = require('path');
const crypto = require('crypto');
const { createWindowsPreview, noLinks } = require('./windowsDrive.cjs');
const same = (a,b) => a && b && ['userId','tenantId','deviceId'].every(k => typeof a[k] === 'string' && a[k] === b[k]);

// Only identifiers and the last private snapshot path are persisted. Authorization
// always comes from the vault. No registry Run command, shell command or token.
function createPersistentWindowsDrive(options) {
  const { stateFile, login, vault, root } = options;
  const preview = createWindowsPreview({ ...options, mountA: options.mountA!==false });
  let operation = false;
  let lastError = null;
  let retry = null;
  let stopped = false;
  let configured = false;
  let preferenceEpoch = 0;
  const snapshotPath=(identity,projectId)=>options.manifestFile||path.join(root,crypto.createHash('sha256').update(JSON.stringify([identity.userId,identity.tenantId,identity.deviceId,projectId])).digest('hex')+'.json');
  async function readSnapshot(identity,projectId) {
    try {
      const file=snapshotPath(identity,projectId);const stat=await fs.lstat(file);
      if(!stat.isFile()||stat.isSymbolicLink()||stat.size>512*1024)throw new Error('Invalid snapshot manifest');
      const saved=JSON.parse(await fs.readFile(file,'utf8'));
      if(!same(saved.identity,identity)||saved.projectId!==projectId||typeof saved.directory!=='string'
        ||path.dirname(saved.directory)!==path.resolve(root)||!Array.isArray(saved.catalog)||saved.catalog.length>256
        ||typeof saved.rootKey!=='string'||!/^[a-f0-9]{64}$/.test(saved.rootKey))throw new Error('Invalid snapshot manifest');
      await noLinks(root,saved.directory);return saved;
    } catch(error) {
      if(error.code==='ENOENT') {
        // Only a missing manifest is a first use. A manifest whose directory
        // vanished must never silently create another path.
        try { await fs.lstat(snapshotPath(identity,projectId)); } catch(e) { if(e.code==='ENOENT')return null; }
      }
      throw Object.assign(new Error('Stored project cannot be resumed'),{code:'DRIVE_SNAPSHOT_INVALID'});
    }
  }
  async function atomicJson(file,data) {
    const temporary=file+'.tmp';
    await fs.mkdir(path.dirname(file),{recursive:true,mode:0o700});
    await fs.writeFile(temporary,JSON.stringify(data),{mode:0o600});
    await fs.rename(temporary,file);
  }
  async function read() {
    try {
      const stat = await fs.lstat(stateFile);
      if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 8192) throw new Error('Invalid reconnection state');
      const data = JSON.parse(await fs.readFile(stateFile, 'utf8'));
      if (!/^[a-zA-Z0-9_-]{1,200}$/.test(data.projectId) || !same(data.identity,data.identity)
        || typeof data.directory !== 'string' || path.dirname(data.directory) !== path.resolve(root)) throw new Error('Invalid reconnection state');
      await noLinks(root,data.directory);
      return data;
    } catch(error) {
      if(error.code!=='ENOENT'){configured=true;lastError='DRIVE_SNAPSHOT_INVALID';}
      return null;
    }
  }
  async function save(data) {
    // Persist the project catalog separately so disconnecting A: only forgets
    // automatic reconnection, not the stable directory or its file identities.
    await atomicJson(snapshotPath(data.identity,data.projectId),data);
    const {catalog,rootKey,...state}=data;
    await atomicJson(stateFile,{...state,manifestVersion:1});
    configured = true;
  }
  async function start(projectId, { restore=false, open=true } = {}) {
    if (operation || stopped) return {status:'error',code:'DRIVE_BUSY'};
    operation = true;
    let previous;
    try {
      previous = await read();
      const identity = await vault();
      if (restore && (!previous || !same(previous.identity,identity))) return {status:'error'};
      const snapshot=await readSnapshot(identity,projectId);
      if(!snapshot&&previous?.manifestVersion===1&&previous.projectId===projectId&&same(previous.identity,identity))
        throw Object.assign(new Error('Missing catalog for active directory'),{code:'DRIVE_SNAPSHOT_INVALID'});
      const result = await preview.start(projectId, {
        open: !restore&&open,
        previousRoot: previous?.directory || '',
        onPrepared: save,
        onReady: save,
        snapshot,
        catalogOverride:options.catalogOverride||null,
      });
      if (stopped) { preview.stop(); return {status:'error'}; }
      // Enabling the persistent reader explicitly also enables the desktop app
      // at logon. Disable removes this setting; quitting preserves the choice.
      await login(true);
      lastError = null;
      return result;
    } catch (error) {
      preview.stop();
      lastError = ['DRIVE_LETTER_IN_USE','DRIVE_SNAPSHOT_INVALID'].includes(error.code) ? error.code : 'DRIVE_UNAVAILABLE';
      // Keep the latest prepared path for crash recovery; never delete snapshots.
      return {status:'error',code:lastError};
    } finally { operation = false; }
  }
  async function enableEditing(projectId) {
    if(operation||stopped||!preview.status().active)return {status:'error',code:'DRIVE_BUSY'};
    operation=true;
    try {
      const identity=await vault();const snapshot=await readSnapshot(identity,projectId);
      if(!snapshot||!same(identity,await vault()))throw new Error('Access refused');
      if(snapshot.editable===true)return {status:'editing'};
      if(!await preview.verify())return {status:'error',code:'DRIVE_LOCAL_CHANGES'};
      if(!same(identity,await vault()))throw new Error('Access refused');
      // Durable intent precedes native write access. Reconnection can then
      // retain dirty placeholders and ordinary files made by replace-save.
      await save({...snapshot,editable:true});preview.stop();
    }catch{return {status:'error',code:'DRIVE_UNAVAILABLE'};}
    finally{operation=false;}
    const result=await start(projectId,{open:false});
    return result.status==='opened'?{status:'editing'}:result;
  }
  async function restore() {
    if (stopped || operation || preview.status().active || !preview.status().enabled) return;
    const epoch = preferenceEpoch;
    const saved = await read();
    if (!saved) return;
    configured = true;
    // Wait for local account/cabinet initialization, without creating snapshots.
    try { if (!same(saved.identity,await vault())) return; } catch { return; }
    // A failed native mount requires explicit retry; avoid generating snapshots
    // repeatedly when a real A: disk is present or a project exceeds the limits.
    if (!lastError && epoch === preferenceEpoch && !stopped) await start(saved.projectId,{restore:true});
  }
  async function disconnect() {
    if (operation) throw new Error('Drive operation in progress');
    operation = true;
    preferenceEpoch++;
    try {
      preview.stop();
      await fs.rm(stateFile,{force:true});
      configured = false;
      await login(false);
      lastError = null;
    } finally { operation = false; }
  }
  function resume() {
    if (retry) return;
    void restore();
    retry = setInterval(()=>void restore(),30000); retry.unref();
  }
  function shutdown() {
    stopped=true; clearInterval(retry); retry=null; preview.stop();
  }
  async function open() {
    try {
      const saved = await read();
      if (!preview.status().active || !saved || !same(saved.identity,await vault())) throw new Error('Access refused');
      if (await options.shell.openPath('A:\\')) throw new Error('Explorer unavailable');
      return {status:'opened'};
    } catch { return {status:'error'}; }
  }
  return { start, open, disconnect, resume, shutdown, enableEditing, verify:()=>preview.verify(), snapshot:async(projectId)=>readSnapshot(await vault(),projectId),
    status:()=>({...preview.status(),letter:'A:',error:lastError,configured}) };
}
module.exports = { createPersistentWindowsDrive };
