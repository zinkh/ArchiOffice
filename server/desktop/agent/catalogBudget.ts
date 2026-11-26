// Memory/transport protection only: document counts are not a subscription quota.
export const MAX_CATALOG_BYTES=64*1024*1024;
export async function mapCatalog<T,R>(values:T[],read:(value:T)=>Promise<R>):Promise<R[]> {
 const result:R[]=new Array(values.length);let next=0,failed=false;
 await Promise.all(Array.from({length:Math.min(8,values.length)},async()=>{
  while(!failed){const index=next++;if(index>=values.length)return;try{result[index]=await read(values[index]);}catch(error){failed=true;throw error;}}
 }));return result;
}
