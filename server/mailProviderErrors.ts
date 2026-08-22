// Distinguishes "the stored OAuth token doesn't have the scope this call
// needs" from any other failure. Existing Gmail/Outlook connections were
// authorized with read-only scopes (gmail.readonly / Mail.Read) before
// archive/delete/send existed — calling one of those newer endpoints with
// an old token 403s with a provider-specific shape, and the frontend needs
// to tell that apart from a generic error so it can offer "reconnect"
// instead of a dead-end message (see src/hooks/useMailConnections.ts).
export function isInsufficientScopeError(provider: 'google' | 'microsoft', status: number, body: any): boolean {
  if (status !== 401 && status !== 403) return false;
  if (provider === 'google') {
    const reasons = (body?.error?.errors || []).map((e: any) => e?.reason);
    return reasons.includes('insufficientPermissions') || body?.error?.status === 'PERMISSION_DENIED';
  }
  // Microsoft Graph
  const code = body?.error?.code;
  return code === 'Authorization_RequestDenied' || code === 'ErrorAccessDenied';
}
