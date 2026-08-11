// Content-type validation for the business-document upload routes that
// accept more than just images (documents/plans/cv/meetings/messaging) —
// the security audit found these had none at all: Multer's `file.mimetype`
// is a client-supplied header, and the stored extension came straight from
// `originalname`, so an SVG-with-script, an HTML file, or any other
// "active content" format could be uploaded under a harmless-looking name
// and served back as-is from storage.
//
// Unlike server/imageUpload.ts (a strict PNG/JPEG/WebP allow-list), these
// routes legitimately need to accept a wide, not-fully-enumerable range of
// real business formats (PDF, DOCX, XLSX, DWG plans, scanned images, …), so
// a strict allow-list isn't practical here without risking false rejections
// staff actually need. Instead this blocks the specific dangerous classes
// the audit called out — by extension, by claimed Content-Type, and (the
// real defense, since the first two are trivially spoofed) by sniffing the
// file's actual leading bytes for HTML/SVG/script/executable markers
// regardless of what the client claimed.
import multer from 'multer';

const DANGEROUS_EXTENSIONS = new Set([
  'svg', 'svgz', 'html', 'htm', 'xhtml', 'shtml',
  'js', 'mjs', 'cjs', 'jse', 'vbs', 'vbe', 'wsf', 'wsh',
  'exe', 'dll', 'com', 'scr', 'msi', 'msp', 'bat', 'cmd', 'ps1',
  'sh', 'bash', 'apk', 'app', 'jar',
  'php', 'php3', 'php4', 'php5', 'phtml', 'jsp', 'jspx', 'asp', 'aspx', 'cgi',
]);

const DANGEROUS_MIME_TYPES = new Set([
  'image/svg+xml', 'text/html', 'application/xhtml+xml',
  'application/x-msdownload', 'application/x-msdos-program',
  'application/x-sh', 'application/x-bat',
  'application/javascript', 'text/javascript', 'application/ecmascript',
  'application/x-httpd-php',
]);

export const documentUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ext = (file.originalname.split('.').pop() || '').toLowerCase();
    if (DANGEROUS_EXTENSIONS.has(ext) || DANGEROUS_MIME_TYPES.has(file.mimetype.toLowerCase())) {
      return cb(new Error('Type de fichier non autorisé.'));
    }
    cb(null, true);
  },
});

const CONTENT_SNIFF_WINDOW = 1024;
const DANGEROUS_CONTENT_PATTERNS = [
  /<!doctype\s+html/i,
  /<html[\s>]/i,
  /<svg[\s>]/i,
  /<script[\s>]/i,
  /^#!\//, // shebang — shell/interpreter script
];

/** True if the file's actual bytes look like HTML/SVG/a script/a Windows
 *  executable, independent of the claimed extension or Content-Type — the
 *  real check, since both of those are trivially spoofed by the client. */
export function looksDangerous(buffer: Buffer): boolean {
  if (buffer.length >= 2 && buffer[0] === 0x4d && buffer[1] === 0x5a) return true; // "MZ" — Windows PE/EXE
  const head = buffer.subarray(0, CONTENT_SNIFF_WINDOW).toString('utf8').replace(/^﻿/, '').trimStart();
  return DANGEROUS_CONTENT_PATTERNS.some((re) => re.test(head));
}

/** documentUpload.single(field) as middleware, but (a) turns a rejected/
 *  oversized file into this app's usual JSON error shape instead of falling
 *  through to Express's generic handler, and (b) runs the content sniff
 *  above once the file is actually in memory. */
export function handleDocumentUpload(fieldName: string) {
  const middleware = documentUpload.single(fieldName);
  return (req: any, res: any, next: any) => {
    middleware(req, res, (err: any) => {
      if (err) return res.status(400).json({ error: err.message || 'Upload invalide' });
      if (req.file && looksDangerous(req.file.buffer)) {
        return res.status(400).json({ error: 'Type de fichier non autorisé.' });
      }
      next();
    });
  };
}
