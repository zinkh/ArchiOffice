// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { DriveDocumentActions } from '../src/components/DriveDocumentActions';
vi.mock('react-i18next',()=>({useTranslation:()=>({t:(key:string)=>key})}));
let host:HTMLDivElement;let root:Root;const open=vi.fn();const upload=vi.fn();
beforeEach(()=>{
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT=true;
  (window as any).archiofficeDesktop={isDesktop:true,openDriveDocument:open,uploadDriveDocument:upload};
  open.mockReset();upload.mockReset();host=document.createElement('div');document.body.append(host);root=createRoot(host);
});
afterEach(async()=>{await act(async()=>root.unmount());host.remove();delete (window as any).archiofficeDesktop;});
const render=()=>act(async()=>{root.render(React.createElement(DriveDocumentActions,{documentId:'one'}));});
it('shows preparation feedback, prevents a second action and passes only the document id',async()=>{
  let done!:(value:any)=>void;open.mockImplementation(()=>new Promise(resolve=>{done=resolve;}));
  await render();await act(async()=>{host.querySelectorAll('button')[0].click();});
  expect(open).toHaveBeenCalledWith('doc:one');expect(host.textContent).toContain('drive_document_opening');
  expect([...host.querySelectorAll('button')].every(b=>b.disabled)).toBe(true);
  await act(async()=>{done({status:'opened'});});expect(host.querySelector('[role=status]')?.textContent).toBe('drive_document_opened');
  expect(host.textContent).not.toContain('/private/');
});
it('distinguishes queued, unchanged, conflict and failure without claiming completion',async()=>{
  await render();
  for(const status of ['queued','pending','unchanged','conflict','error']) {
    upload.mockResolvedValue({status});await act(async()=>{host.querySelectorAll('button')[1].click();});
    expect(host.textContent).toContain(`drive_document_${status}`);
    expect(host.querySelector('[role=alert]')!==null).toBe(['conflict','error'].includes(status));
  }
});
