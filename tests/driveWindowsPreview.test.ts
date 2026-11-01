// @vitest-environment jsdom
import React,{act} from 'react';import {createRoot,type Root} from 'react-dom/client';import {beforeEach,afterEach,expect,it,vi} from 'vitest';
import {WindowsDrivePreview} from '../src/components/WindowsDrivePreview';
vi.mock('react-i18next',()=>({useTranslation:()=>({t:(key:string)=>key})}));
let host:HTMLDivElement;let root:Root;const status=vi.fn(),start=vi.fn(),stop=vi.fn();
beforeEach(()=>{(globalThis as any).IS_REACT_ACT_ENVIRONMENT=true;status.mockReset().mockResolvedValue({enabled:true,active:false});start.mockReset().mockImplementation(async(projectId:string)=>{status.mockResolvedValue({enabled:true,active:true,configured:true,projectCount:1,projectIds:[projectId]});return {status:'opened'};});stop.mockReset().mockResolvedValue({status:'stopped'});(window as any).archiofficeDesktop={isDesktop:true,getWindowsDrivePreview:status,startWindowsDrivePreview:start,stopWindowsDrivePreview:stop};host=document.createElement('div');document.body.append(host);root=createRoot(host);});
afterEach(async()=>{await act(async()=>root.unmount());host.remove();delete (window as any).archiofficeDesktop;});
it('explains why it is unavailable when disabled and requires a selected project when enabled',async()=>{
 status.mockResolvedValue({enabled:false,active:false});await act(async()=>root.render(React.createElement(WindowsDrivePreview,{projectId:'p'})));expect(host.textContent).toContain('windows_drive_unavailable_preview');expect(host.querySelector('button')).toBeNull();
 await act(async()=>root.unmount());root=createRoot(host);status.mockResolvedValue({enabled:true,active:false});await act(async()=>root.render(React.createElement(WindowsDrivePreview,{projectId:null})));expect(host.querySelector('button')!.disabled).toBe(true);expect(host.textContent).toContain('windows_drive_choose_project');
});
it('launches only the selected project and can disconnect without exposing paths',async()=>{
 await act(async()=>root.render(React.createElement(WindowsDrivePreview,{projectId:'project'})));expect(host.textContent).toContain('windows_drive_explanation');
 await act(async()=>host.querySelector('button')!.click());expect(start).toHaveBeenCalledWith('project');expect(host.textContent).toContain('windows_drive_opened');
 await act(async()=>Array.from(host.querySelectorAll('button')).find(button=>button.textContent==='windows_drive_stop')!.click());expect(stop).toHaveBeenCalled();expect(host.textContent).toContain('windows_drive_stopped');
});
it('announces an occupied drive letter without reporting a successful activation',async()=>{
 start.mockResolvedValue({status:'error',code:'DRIVE_LETTER_IN_USE'});
 await act(async()=>root.render(React.createElement(WindowsDrivePreview,{projectId:'project'})));
 await act(async()=>host.querySelector('button')!.click());
 expect(host.querySelector('[role="alert"]')?.textContent).toBe('windows_drive_letter_busy');expect(host.textContent).not.toContain('windows_drive_opened');
});
it('opens a restored A: drive from settings without needing a selected project',async()=>{
 status.mockResolvedValue({enabled:true,active:true,configured:true});const open=vi.fn().mockResolvedValue({status:'opened'});(window as any).archiofficeDesktop.openWindowsDrive=open;
 await act(async()=>root.render(React.createElement(WindowsDrivePreview,{projectId:null})));
 expect(host.querySelector('button')!.disabled).toBe(false);
 await act(async()=>host.querySelector('button')!.click());expect(open).toHaveBeenCalled();expect(start).not.toHaveBeenCalled();
});
it('offers addition while other projects are connected and then offers removal',async()=>{
 status.mockResolvedValue({enabled:true,active:true,configured:true,projectCount:1,projectIds:['other']});
 start.mockImplementation(async()=>{status.mockResolvedValue({enabled:true,active:true,configured:true,projectCount:2,projectIds:['other','project']});return {status:'opened'};});
 await act(async()=>root.render(React.createElement(WindowsDrivePreview,{projectId:'project'})));
 expect(host.querySelector('button')!.textContent).toBe('windows_drive_add');await act(async()=>host.querySelector('button')!.click());
 expect(start).toHaveBeenCalledWith('project');expect(host.textContent).toContain('windows_drive_remove');expect(host.querySelector('button')!.textContent).toBe('windows_drive_open_active');
});
it('removes only the selected project and reports that its files are preserved',async()=>{
 status.mockResolvedValue({enabled:true,active:true,configured:true,projectCount:2,projectIds:['project','other']});
 const remove=vi.fn().mockImplementation(async()=>{status.mockResolvedValue({enabled:true,active:true,configured:true,projectCount:1,projectIds:['other']});return {status:'removed'};});(window as any).archiofficeDesktop.removeWindowsDriveProject=remove;
 await act(async()=>root.render(React.createElement(WindowsDrivePreview,{projectId:'project'})));
 await act(async()=>Array.from(host.querySelectorAll('button')).find(button=>button.textContent==='windows_drive_remove')!.click());
 expect(remove).toHaveBeenCalledWith('project');expect(host.textContent).toContain('windows_drive_removed');expect(Array.from(host.querySelectorAll('button')).some(button=>button.textContent==='windows_drive_remove')).toBe(false);
});
