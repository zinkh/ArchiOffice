/** Read-only business information for already-mounted documents. Never supplies
 * a path, credential, URL, or permission to modify the working copy. */
export interface ShellBusinessDocument {
  nodeId:string;name:string;projectId:string;phase:string|null;documentType:string|null;
  indice:string|null;remoteVersion:number;status:string|null;
  permissions:{read:boolean;write:boolean;delete:boolean};readOnlyReason:string|null;
}
const refused=()=>Object.assign(new Error('Shell metadata refused'),{code:'WINDOWS_SHELL_METADATA_REFUSED'});
const text=(value:unknown,limit=512):string|null=> {
  if(value===undefined||value===null)return null;
  if(typeof value!=='string'||value.length>limit||/[\x00-\x1f\x7f]/.test(value))throw refused();
  return value;
};
export async function readShellMetadata(projectId:string,nodeIds:string[],read:(route:string)=>Promise<any>) {
  if(typeof projectId!=='string'||!/^[a-zA-Z0-9_-]{1,200}$/.test(projectId)||!Array.isArray(nodeIds)||nodeIds.length>100
    ||new Set(nodeIds).size!==nodeIds.length||nodeIds.some(id=>typeof id!=='string'||!/^doc:[a-zA-Z0-9_-]{1,200}$/.test(id)))throw refused();
  const project=await read('/nodes/'+encodeURIComponent('prj:'+projectId));
  if(project?.id!=='prj:'+projectId||project.kind!=='folder'||project.permissions?.read!==true)throw refused();
  const name=text(project.name);if(name===null)throw refused();
  const documents:ShellBusinessDocument[]=[];
  // Bounded serial reads reuse the authenticated, tenant-scoped desktop routes.
  for(const id of nodeIds) {
    const node=await read('/nodes/'+encodeURIComponent(id));
    if(node?.id!==id||node.kind!=='file'||node.projectId!==projectId||typeof node.parentId!=='string'
      ||!node.parentId.startsWith('phase:'+projectId+':')||node.permissions?.read!==true
      ||!Number.isSafeInteger(node.version)||node.version<1
      ||typeof node.permissions.write!=='boolean'||typeof node.permissions.delete!=='boolean')throw refused();
    const documentName=text(node.name);if(documentName===null)throw refused();
    documents.push({nodeId:id,name:documentName,projectId,phase:text(node.phase,200),documentType:text(node.documentType,200),
      indice:text(node.indice,200),remoteVersion:node.version,status:text(node.status,200),
      permissions:{read:true,write:node.permissions.write,delete:node.permissions.delete},readOnlyReason:text(node.readOnlyReason,200)});
  }
  return {projectId,name,documents};
}
