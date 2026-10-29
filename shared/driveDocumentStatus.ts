/** "uploaded" describes the last accepted snapshot, never a guarantee that
 * an application has no newer unsent edits. */
export type DriveDocumentTransferState = 'none' | 'queued' | 'uploading' | 'retry' | 'blocked' | 'conflict' | 'uploaded' | 'reconciled';
export interface DriveDocumentStatus {
  nodeId: string;
  state: DriveDocumentTransferState;
  version?: number;
  preservation?: 'pending' | 'blocked' | 'done';
}

export interface DriveRemoteCheck {
  status: 'current' | 'remote_newer' | 'local_newer' | 'modified' | 'busy' | 'missing' | 'refreshed' | 'changed' | 'error';
  localVersion?: number;
  remoteVersion?: number;
}
