// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { useDriveDocumentStatuses } from '../src/hooks/useDriveDocumentStatuses';
let host:HTMLDivElement;let root:Root;const request=vi.fn();
function Harness({ids,scope}:{ids:string[];scope:string|null}) {
  const value=useDriveDocumentStatuses(ids,scope);
  return React.createElement('div',null,React.createElement('pre',null,JSON.stringify({statuses:value.statuses,unavailable:value.unavailable})),
    React.createElement('button',{onClick:value.refresh},'Refresh'));
}
const render=(ids=['doc:one'],scope:string|null='user:tenant')=>act(async()=>root.render(React.createElement(Harness,{ids,scope})));
beforeEach(()=>{
  vi.useFakeTimers();(globalThis as any).IS_REACT_ACT_ENVIRONMENT=true;
  Object.defineProperty(document,'visibilityState',{value:'visible',configurable:true});
  request.mockReset().mockImplementation(async(ids:string[])=>ids.map(nodeId=>({nodeId,state:'queued'})));
  (window as any).archiofficeDesktop={isDesktop:true,getDriveDocumentStatuses:request};
  host=document.createElement('div');document.body.append(host);root=createRoot(host);
});
afterEach(async()=>{await act(async()=>root.unmount());host.remove();delete (window as any).archiofficeDesktop;vi.useRealTimers();});
it('batches visible documents once, polls periodically, and refreshes on focus or action',async()=>{
  const ids=Array.from({length:101},(_,i)=>`doc:${i}`);await render(ids);
  expect(request).toHaveBeenCalledTimes(2);expect(request.mock.calls.map(call=>call[0].length)).toEqual([100,1]);
  await act(async()=>{await vi.advanceTimersByTimeAsync(10000);});expect(request).toHaveBeenCalledTimes(4);
  await act(async()=>{window.dispatchEvent(new Event('focus'));});expect(request).toHaveBeenCalledTimes(6);
  await act(async()=>{host.querySelector('button')!.click();});expect(request).toHaveBeenCalledTimes(8);
});
it('does not overlap slow reads and suspends polling while hidden',async()=>{
  let resolve!:(value:any)=>void;request.mockImplementationOnce(()=>new Promise(done=>{resolve=done;}));
  await render();await act(async()=>{window.dispatchEvent(new Event('focus'));await vi.advanceTimersByTimeAsync(30000);});
  expect(request).toHaveBeenCalledTimes(1);
  Object.defineProperty(document,'visibilityState',{value:'hidden',configurable:true});
  await act(async()=>{document.dispatchEvent(new Event('visibilitychange'));resolve([{nodeId:'doc:one',state:'uploading'}]);});
  await act(async()=>{await vi.advanceTimersByTimeAsync(30000);});expect(request).toHaveBeenCalledTimes(1);
  Object.defineProperty(document,'visibilityState',{value:'visible',configurable:true});
  await act(async()=>{document.dispatchEvent(new Event('visibilitychange'));});expect(request).toHaveBeenCalledTimes(2);
});
it('clears stale success on failure and ignores a reply from the previous account',async()=>{
  request.mockResolvedValueOnce([{nodeId:'doc:one',state:'uploaded',version:2}]);await render();expect(host.textContent).toContain('uploaded');
  request.mockRejectedValueOnce(new Error('license expired'));
  await act(async()=>{host.querySelector('button')!.click();});expect(host.querySelector('pre')!.textContent).toBe('{"statuses":{},"unavailable":true}');
  let old!:(value:any)=>void;request.mockImplementationOnce(()=>new Promise(done=>{old=done;}));await render(['doc:old'],'old');
  await render(['doc:new'],'new');
  await act(async()=>{old([{nodeId:'doc:old',state:'uploaded',version:9}]);});
  expect(host.textContent).toContain('doc:new');expect(host.textContent).not.toMatch(/doc:old|uploaded/);
  request.mockClear();await render(['doc:new'],null);expect(request).not.toHaveBeenCalled();
  expect(host.querySelector('pre')!.textContent).toBe('{"statuses":{},"unavailable":false}');
});
