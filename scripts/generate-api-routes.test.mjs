import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractRoutes } from './generate-api-routes.mjs';

test('indexes real declarations, skips comments and client calls, retains source locations', () => {
  const { routes, dynamic } = extractRoutes(`// app.get('/fake', fn);
/* router.post('/also-fake', fn) */
app.get('/api/projects', fn);
router.post(['/upload', '/import'], middleware, fn);
client.get('/not-a-route');
app.delete(\`/api/contacts\`, fn);
app.put(prefix + '/:id', fn);
app.patch(\`/api/\${resource}/:id\`, fn);
`, 'example.ts');
  assert.deepEqual(routes.map(r => [r.method, r.path, r.line]), [
    ['GET', '/api/projects', 3], ['POST', '/upload', 4], ['POST', '/import', 4], ['DELETE', '/api/contacts', 6],
  ]);
  assert.equal(dynamic.length, 2);
  assert.equal(dynamic[0].expression, "prefix + '/:id'");
});
