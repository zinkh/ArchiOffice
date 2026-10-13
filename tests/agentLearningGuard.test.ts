// Valider une proposition d'apprentissage change le prompt de l'agent pour tout
// le cabinet : PUT /api/agent-learning-suggestions/:id est réservé aux
// administrateurs. Le test vérifie le câblage de la garde, route par route.
import { describe, expect, it, vi } from 'vitest';
import { registerAgentRoutes } from '../packages/archioffice-agents/src/server/routes';

type Handler = (req: any, res: any, next?: any) => unknown;

function collectRoutes(requireRole?: (...roles: string[]) => Handler) {
  const routes = new Map<string, Handler[]>();
  const add = (method: string) => (path: string, ...handlers: Handler[]) => { routes.set(`${method} ${path}`, handlers); };
  const app = { get: add('GET'), post: add('POST'), put: add('PUT'), delete: add('DELETE'), patch: add('PATCH'), use: () => {} };
  registerAgentRoutes(app, {}, async () => 'tenant-1', async () => ({ plan: 'enterprise', trial_ends_at: null, is_expired: false }), undefined, requireRole as any);
  return routes;
}

const APPROVE = 'PUT /api/agent-learning-suggestions/:id';

describe('validation des propositions d\'apprentissage : administrateur seul', () => {
  it('place requireRole(\'admin\') devant le handler de validation', () => {
    const adminGuard: Handler = vi.fn();
    const requireRole = vi.fn(() => adminGuard);
    const handlers = collectRoutes(requireRole)!.get(APPROVE)!;
    expect(requireRole).toHaveBeenCalledWith('admin');
    expect(handlers).toHaveLength(2);
    expect(handlers[0]).toBe(adminGuard);
  });

  it('se ferme (403) quand aucune garde de rôle n\'est injectée', () => {
    const [guard] = collectRoutes(undefined).get(APPROVE)!;
    const res = { status: vi.fn().mockReturnThis(), json: vi.fn() };
    guard({}, res);
    expect(res.status).toHaveBeenCalledWith(403);
  });

  it('laisse le dépôt d\'une proposition ouvert à tout membre du cabinet', () => {
    const requireRole = vi.fn(() => vi.fn() as Handler);
    const handlers = collectRoutes(requireRole).get('POST /api/agent-learning-suggestions')!;
    expect(handlers).toHaveLength(1);
  });
});
