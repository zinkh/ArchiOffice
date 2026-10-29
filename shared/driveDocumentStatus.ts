/** "uploaded" describes the last accepted snapshot, never a guarantee that
 * an application has no newer unsent edits. */
export type DriveDocumentTransferState = 'none' | 'queued' | 'uploading' | 'retry' | 'blocked' | 'conflict' | 'uploaded';
export interface DriveDocumentStatus {
  nodeId: string;
  state: DriveDocumentTransferState;
  version?: number;
}
