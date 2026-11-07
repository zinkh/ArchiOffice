import {it,expect,beforeEach,afterEach,vi} from 'vitest';import fs from 'node:fs/promises';import path from 'node:path';import os from 'node:os';import {EventEmitter} from 'node:events';import {PassThrough} from 'node:stream';import {createRequire} from 'node:module';
const {createShellPreviewRenderer}=createRequire(import.meta.url)('../electron/windowsShellPreview.cjs');
let root:string,file:string,config:any;
const frame=()=>{const b=Buffer.alloc(24);b.write('AOP1');b.writeUInt32LE(1,4);b.writeUInt32LE(1,8);b.writeUInt32LE(1,12);b.writeUInt32LE(0,16);return b;};
beforeEach(async()=>{root=await fs.mkdtemp(path.join(os.tmpdir(),'preview-test-'));file=path.join(root,'Plan.pdf');await fs.writeFile(file,'snapshot');config={root:path.join(root,'previews'),executable:'renderer.exe',environment:{PATH:'/bin',CLOUD_TOKEN:'secret'},spawn:vi.fn((_exe:string,args:string[],options:any)=>{const child:any=new EventEmitter();child.stdout=new PassThrough();child.kill=vi.fn(()=>queueMicrotask(()=>child.emit('close',1)));queueMicrotask(()=>{child.stdout.write(frame());child.emit('close',0);});return child;})};});
afterEach(async()=>{await fs.rm(root,{recursive:true,force:true});});
it('renders a private immutable input and emits only a bounded raster, then removes the input',async()=>{
 const render=createShellPreviewRenderer(config);expect(await render(file,0)).toMatchObject({status:'preview',width:1,height:1,pages:1,page:0});
 const args=config.spawn.mock.calls[0];expect(args[1][0]).not.toBe(file);expect(args[1][0]).toContain('input.pdf');expect(args[2].env).not.toHaveProperty('CLOUD_TOKEN');expect(await fs.readdir(config.root)).toEqual([]);expect(await fs.readFile(file,'utf8')).toBe('snapshot');
});
it('does not render unsupported formats',async()=>{await fs.writeFile(path.join(root,'Model.rvt'),'model');expect(await createShellPreviewRenderer(config)(path.join(root,'Model.rvt'),0)).toEqual({status:'unsupported'});expect(config.spawn).not.toHaveBeenCalled();});
it('rejects a source changed while rendering',async()=>{
 config.spawn.mockImplementation(()=>{const child:any=new EventEmitter();child.stdout=new PassThrough();child.kill=()=>{};void fs.writeFile(file,'new content').then(()=>{child.stdout.write(frame());child.emit('close',0);});return child;});
 await expect(createShellPreviewRenderer(config)(file,0)).rejects.toThrow('changed');expect(await fs.readdir(config.root)).toEqual([]);
});
it('cancels a render and cleans up after the child has closed',async()=>{
 const cancel=new AbortController();config.spawn.mockImplementation(()=>{const child:any=new EventEmitter();child.stdout=new PassThrough();child.kill=vi.fn(()=>queueMicrotask(()=>child.emit('close',1)));queueMicrotask(()=>cancel.abort());return child;});
 await expect(createShellPreviewRenderer(config)(file,0,cancel.signal)).rejects.toThrow('cancelled');expect(await fs.readdir(config.root)).toEqual([]);
});
it('rejects invalid frame dimensions',async()=>{config.spawn.mockImplementation(()=>{const child:any=new EventEmitter();child.stdout=new PassThrough();child.kill=()=>{};queueMicrotask(()=>{const bad=frame();bad.writeUInt32LE(9999,4);child.stdout.write(bad);child.emit('close',0);});return child;});await expect(createShellPreviewRenderer(config)(file,0)).rejects.toThrow('dimensions');});
