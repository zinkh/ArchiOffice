// Validates POST /api/team and PUT /api/team/:id/role bodies.
// PUT /api/team/:id/role previously wrote `req.body.role` straight into
// `profiles.system_role` with no check at all — every RBAC decision in the
// app (requireRole(), requireTenantAdmin(), isAdmin(), and every client-side
// `currentUser?.system_role === 'admin'` check) depends on that column only
// ever holding one of these four exact strings, so this is the single
// highest-value schema in this rollout.
import { z } from 'zod';

export const SYSTEM_ROLES = ['admin', 'manager', 'pm', 'user'] as const;

export const createTeamMemberSchema = z.object({
  name: z.string().min(1, 'name is required'),
  email: z.string().email('a valid email is required'),
  role: z.string().optional(),
  system_role: z.enum(SYSTEM_ROLES).optional(),
});

export const updateTeamMemberRoleSchema = z.object({
  role: z.enum(SYSTEM_ROLES),
});
