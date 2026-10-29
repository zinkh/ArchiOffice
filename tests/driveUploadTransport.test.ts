import { afterEach, expect, it, vi } from 'vitest';
import { createUploadTransport } from '../server/desktop/agent/uploadTransport';
afterEach(() => vi.unstubAllGlobals());
it('checks entitlement on every call and sends ranges without following redirects', async () => {
  const fetch = vi.fn().mockResolvedValue(new Response(null,{ status:204 })); vi.stubGlobal('fetch',fetch);
  const authorize = vi.fn().mockResolvedValue('ds_at_secret');
  const transport = createUploadTransport('https://www.archioffice.fr','tenant1',authorize);
  await transport.chunk('up_1',3,8,Buffer.from('def'));
  expect(authorize).toHaveBeenCalledTimes(1);
  expect(fetch.mock.calls[0][1]).toMatchObject({ redirect:'error', headers:{ 'X-Tenant-Id':'tenant1','Content-Range':'bytes 3-5/8' } });
  authorize.mockRejectedValue(new Error('license expired'));
  await expect(transport.status('up_1')).rejects.toThrow('license expired'); expect(fetch).toHaveBeenCalledTimes(1);
});
it('rejects HTTP origins and preserves stable server error codes', async () => {
  expect(() => createUploadTransport('http://example.test','t',async()=> 'token')).toThrow();
  vi.stubGlobal('fetch',vi.fn().mockResolvedValue(new Response(JSON.stringify({code:'VERSION_CONFLICT'}),{status:409})));
  await expect(createUploadTransport('https://example.test','t',async()=> 'token').complete('up_1','hash')).rejects.toMatchObject({status:409,code:'VERSION_CONFLICT'});
});
