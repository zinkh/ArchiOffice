// @vitest-environment jsdom
import React,{act} from 'react';import {createRoot,type Root} from 'react-dom/client';import {beforeEach,afterEach,expect,it,vi} from 'vitest';
import {WindowsDrivePreview} from '../src/components/WindowsDrivePreview';
vi.mock('react-i18next',()=>({useTranslation:()=>({t:(key:string)=>key})}));
let host:HTMLDivElement;let root:Root;const status=vi.fn(),start=vi.fn(),stop=vi.fn();
beforeEach(()=>{(globalThis as any).IS_REACT_ACT_ENVIRONMENT=true;status.mockReset().mockResolvedValue({enabled:true,active:false});start.mockReset().mockResolvedValue({status:'opened'});stop.mockReset().mockResolvedValue({status:'stopped'});(window as any).archiofficeDesktop={isDesktop:true,getWindowsDrivePreview:status,startWindowsDrivePreview:start,stopWindowsDrivePreview:stop};host=document.createElement('div');document.body.append(host);root=createRoot(host);});
afterEach(async()=>{await act(async()=>root.unmount());host.remove();delete (window as any).archiofficeDesktop;});
it('explains why it is unavailable when disabled and requires a selected project when enabled',async()=>{
 status.mockResolvedValue({enabled:false,active:false});await act(async()=>root.render(React.createElement(WindowsDrivePreview,{projectId:'p'})));expect(host.textContent).toContain('windows_drive_unavailable_preview');expect(host.querySelector('button')).toBeNull();
 await act(async()=>root.unmount());root=createRoot(host);status.mockResolvedValue({enabled:true,active:false});await act(async()=>root.render(React.createElement(WindowsDrivePreview,{projectId:null})));expect(host.querySelector('button')!.disabled).toBe(true);expect(host.textContent).toContain('windows_drive_choose_project');
});
it('launches only the selected project and can disconnect without exposing paths',async()=>{
 await act(async()=>root.render(React.createElement(WindowsDrivePreview,{projectId:'project'})));expect(host.textContent).toContain('windows_drive_explanation');
 await act(async()=>host.querySelector('button')!.click());expect(start).toHaveBeenCalledWith('project');expect(host.textContent).toContain('windows_drive_opened');
 await act(async()=>host.querySelectorAll('button')[1].click());expect(stop).toHaveBeenCalled();expect(host.textContent).toContain('windows_drive_stopped');
});
