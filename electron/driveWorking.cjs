'use strict';
const fs = require('fs/promises');
const path = require('path');
const crypto = require('crypto');
const { isSafeToOpen } = require('./fileAccess.cjs');

/** Runs exclusively in Electron main. No file path is returned to the renderer. */
async function openDriveWorking({ agent, vault, root, nodeId, shell }) {
  if(typeof nodeId!=='string'||!/^doc:[a-zA-Z0-9_-]{1,200}$/.test(nodeId))return {status:'error'};
  try {
    const result=await agent.working('open',nodeId);
    const active=await vault();
    if(!result?.identity || ['userId','tenantId','deviceId'].some(k=>result.identity[k]!==active[k]))return {status:'error'};
    // Scope the path independently to the authorized identity and this document.
    const owner=crypto.createHash('sha256').update(JSON.stringify([active.userId,active.tenantId])).digest('hex');
    const document=crypto.createHash('sha256').update(JSON.stringify([active.userId,active.tenantId,nodeId])).digest('hex');
    const files=path.join(root,owner,'working',document,'files');
    if(typeof result.file!=='string'||path.dirname(result.file)!==files)return {status:'error'};
    const relative=path.relative(root,result.file);
    let current=root;
    if((await fs.lstat(current)).isSymbolicLink())return {status:'error'};
    for(const segment of relative.split(path.sep)) {
      current=path.join(current,segment);
      if((await fs.lstat(current)).isSymbolicLink())return {status:'error'};
    }
    if(!(await fs.lstat(result.file)).isFile())return {status:'error'};
    if(!isSafeToOpen(result.file))return {status:'unsupported'};
    // Recheck after filesystem inspection; do not open after an observed refusal.
    const latest=await vault();
    if(['userId','tenantId','deviceId'].some(k=>latest[k]!==active[k]))return {status:'error'};
    return {status:await shell.openPath(result.file)?'error':'opened'};
  } catch {return {status:'error'};}
}
/** Return only enumerated state and a version; no native paths or credentials. */
async function driveDocumentStatuses({agent,vault,nodeIds}) {
  if(!Array.isArray(nodeIds)||nodeIds.length>100||nodeIds.some(id=>typeof id!=='string'||!/^doc:[a-zA-Z0-9_-]{1,200}$/.test(id))||new Set(nodeIds).size!==nodeIds.length)throw new Error('Invalid documents');
  const result=await agent.documentStatuses(nodeIds);const active=await vault();
  if(!result?.identity||['userId','tenantId','deviceId'].some(k=>result.identity[k]!==active[k]))throw new Error('Identity changed');
  if(!Array.isArray(result.documents)||result.documents.length!==nodeIds.length)throw new Error('Invalid status response');
  const seen=new Set();
  return result.documents.map(doc=> {
    if(!doc||!nodeIds.includes(doc.nodeId)||seen.has(doc.nodeId)||!['none','queued','uploading','retry','blocked','conflict','uploaded'].includes(doc.state))throw new Error('Invalid status response');
    seen.add(doc.nodeId);
    if(doc.state==='uploaded') {
      if(!Number.isSafeInteger(doc.version)||doc.version<1)throw new Error('Invalid version');
      return {nodeId:doc.nodeId,state:doc.state,version:doc.version};
    }
    return {nodeId:doc.nodeId,state:doc.state};
  });
}
module.exports={openDriveWorking,driveDocumentStatuses};
