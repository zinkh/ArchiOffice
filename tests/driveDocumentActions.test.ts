// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { DriveDocumentActions } from '../src/components/DriveDocumentActions';
vi.mock('react-i18next',()=>({useTranslation:()=>({t:(key:string)=>key})}));
let host:HTMLDivElement;let root:Root;const open=vi.fn();const upload=vi.fn();const preserve=vi.fn();const restart=vi.fn();
beforeEach(()=>{
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT=true;
  (window as any).archiofficeDesktop={isDesktop:true,openDriveDocument:open,uploadDriveDocument:upload,preserveDriveConflict:preserve};
  open.mockReset();upload.mockReset();preserve.mockReset();restart.mockReset();host=document.createElement('div');document.body.append(host);root=createRoot(host);
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
it('shows durable transfer states separately from action feedback and never presents stale success after a refusal',async()=>{
  for(const state of ['queued','uploading','retry','blocked','conflict','uploaded'] as const) {
    await act(async()=>root.render(React.createElement(DriveDocumentActions,{documentId:'one',transfer:{nodeId:'doc:one',state,version:2}})));
    expect(host.textContent).toContain(`drive_document_transfer_${state}`);
    expect(host.querySelector('[role=alert]')!==null).toBe(['blocked','conflict'].includes(state));
  }
  await act(async()=>root.render(React.createElement(DriveDocumentActions,{documentId:'one',unavailable:true})));
  expect(host.textContent).toContain('drive_document_transfer_unavailable');expect(host.textContent).not.toContain('drive_document_transfer_uploaded');
});
it('offers snapshot preservation only for an unsaved conflict and distinguishes queuing from completion',async()=>{
  await act(async()=>root.render(React.createElement(DriveDocumentActions,{documentId:'one',transfer:{nodeId:'doc:one',state:'conflict'}})));
  expect(host.textContent).toContain('drive_conflict_copy_explanation');preserve.mockResolvedValue({status:'preserve_queued'});
  await act(async()=>{host.querySelectorAll('button')[2].click();});
  expect(preserve).toHaveBeenCalledWith('doc:one');expect(host.textContent).toContain('drive_document_preserve_queued');
  for(const preservation of ['pending','blocked','done'] as const) {
    await act(async()=>root.render(React.createElement(DriveDocumentActions,{documentId:'one',transfer:{nodeId:'doc:one',state:'conflict',preservation}})));
    expect(host.textContent).toContain(`drive_conflict_copy_${preservation}`);expect(host.querySelectorAll('button')).toHaveLength(2);
  }
});
it('requires an accepted snapshot and an explicit second click before restarting the working copy',async()=>{
  (window as any).archiofficeDesktop.restartDriveDocument=restart;restart.mockResolvedValue({status:'restarted'});
  const show=(preservation:'pending'|'done')=>act(async()=>root.render(React.createElement(DriveDocumentActions,{documentId:'one',transfer:{nodeId:'doc:one',state:'conflict',preservation}})));
  await show('pending');expect(host.textContent).not.toContain('drive_restart_action');await show('done');
  await act(async()=>{[...host.querySelectorAll('button')].find(b=>b.textContent==='drive_restart_action')!.click();});
  expect(restart).not.toHaveBeenCalled();expect(host.textContent).toContain('drive_restart_explanation');
  await act(async()=>{[...host.querySelectorAll('button')].find(b=>b.textContent==='drive_restart_confirm')!.click();});
  expect(restart).toHaveBeenCalledWith('doc:one');expect(host.textContent).toContain('drive_document_restarted');
});
