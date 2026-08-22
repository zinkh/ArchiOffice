// Shared multer instance for compose/reply attachments (server/routes/
// gmailSync.ts, server/routes/outlookSync.ts) — unlike server/imageUpload.ts
// this isn't restricted to images (a compose window can attach a PDF, a
// DOCX, etc.), just size/count-limited. 10 MB per file: Gmail's raw-message
// API wants the whole MIME body under ~25MB before it needs the resumable
// upload API, and Graph wants a large-file upload session past ~3MB —
// implementing either is explicitly out of scope for this lot, so a modest
// cap keeps every attachment on the simple single-request path.
import multer from 'multer';

export const ATTACHMENT_MAX_FILE_BYTES = 10 * 1024 * 1024;

export const mailAttachmentUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: ATTACHMENT_MAX_FILE_BYTES, files: 10 },
}).array('attachments');
