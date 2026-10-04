import { safeFileName } from './storageKey';

// Shared by server.ts and any extracted route module that builds a storage
// path from a user-supplied filename (e.g. server/routes/meetings.ts). Les
// clés Supabase Storage doivent rester ASCII : voir server/storageKey.ts.
export function sanitizeFilename(name: string): string {
  return safeFileName(name);
}
