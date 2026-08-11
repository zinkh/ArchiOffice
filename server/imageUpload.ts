// Dedicated multer instance + content sniffing for the agency-logo and
// user-avatar uploads (server/routes/uploads.ts) — the security audit found
// these accepted any file type: `file.mimetype` is a client-supplied header
// (trivially spoofed) and the stored extension came straight from
// `originalname`, so an SVG-with-script or an HTML file renamed to `.png`
// would be accepted, stored in a public bucket, and served back as-is.
import multer from 'multer';

const ALLOWED_IMAGE_MIME = new Set(['image/png', 'image/jpeg', 'image/webp']);

// Rejects on Content-Type header alone — cheap first filter. The real check
// is sniffImageMime() below, run against the actual bytes once uploaded.
export const imageUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 }, // 5 MB — matches the "logos" bucket's own limit
  fileFilter: (_req, file, cb) => {
    if (!ALLOWED_IMAGE_MIME.has(file.mimetype)) {
      return cb(new Error('Type de fichier non autorisé. Formats acceptés : PNG, JPEG, WebP.'));
    }
    cb(null, true);
  },
});

/** Sniffs the real file format from its magic bytes; returns null if it
 *  isn't one of the whitelisted image formats, regardless of what the
 *  client claimed via Content-Type or filename extension. */
export function sniffImageMime(buffer: Buffer): 'image/png' | 'image/jpeg' | 'image/webp' | null {
  if (
    buffer.length >= 8 &&
    buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47 &&
    buffer[4] === 0x0d && buffer[5] === 0x0a && buffer[6] === 0x1a && buffer[7] === 0x0a
  ) {
    return 'image/png';
  }
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return 'image/jpeg';
  }
  if (
    buffer.length >= 12 &&
    buffer.toString('ascii', 0, 4) === 'RIFF' &&
    buffer.toString('ascii', 8, 12) === 'WEBP'
  ) {
    return 'image/webp';
  }
  return null;
}

const EXTENSION_BY_MIME: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
};

export function extensionForImageMime(mime: string): string {
  return EXTENSION_BY_MIME[mime];
}

/** imageUpload.single(field) as middleware, but turns a rejected/oversized
 *  file into the same JSON error shape the rest of this app's routes use
 *  instead of falling through to Express's generic (HTML) error handler. */
export function handleSingleImageUpload(fieldName: string) {
  const middleware = imageUpload.single(fieldName);
  return (req: any, res: any, next: any) => {
    middleware(req, res, (err: any) => {
      if (err) return res.status(400).json({ error: err.message || 'Upload invalide' });
      next();
    });
  };
}
