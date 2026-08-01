// Shared by server.ts and any extracted route module that builds a storage
// path from a user-supplied filename (e.g. server/routes/meetings.ts).
export function sanitizeFilename(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 100);
}
