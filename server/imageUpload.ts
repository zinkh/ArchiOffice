// Dedicated multer instance + content sniffing for the agency-logo and
// user-avatar uploads (server/routes/uploads.ts) — the security audit found
// these accepted any file type: `file.mimetype` is a client-supplied header
// (trivially spoofed) and the stored extension came straight from
// `originalname`, so an SVG-with-script or an HTML file renamed to `.png`
// would be accepted, stored in a public bucket, and served back as-is.
import multer from 'multer';
import { Jimp, JimpMime } from 'jimp';

const ALLOWED_IMAGE_MIME = new Set(['image/png', 'image/jpeg', 'image/webp']);

// Shared with scripts/backfill-resize-images.ts, which re-processes
// whatever was stored before these caps existed — keep both call sites
// pointed at the same numbers instead of letting them drift apart.
export const AVATAR_MAX_DIMENSION = 512;   // only ever shown at a few dozen px (header, team list)
export const LOGO_MAX_DIMENSION = 800;     // may be reused at document/letterhead size
export const MEETING_PHOTO_MAX_DIMENSION = 1600; // site inspection photos benefit from more detail when zoomed

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

/** Downscales an image to fit within maxDimension×maxDimension before it
 *  ever reaches storage — avatars, the agency logo, and meeting photos were
 *  all being stored (and then served, on every page load) at whatever
 *  resolution the client's camera/phone produced, often several MB for
 *  something displayed at a few dozen pixels. Only shrinks — an image
 *  already within bounds is returned untouched, so this never upscales or
 *  re-encodes (and thus never loses quality on) a small image.
 *
 *  WebP has no encoder bundled with Jimp's default build (would need the
 *  separate @jimp/wasm-webp package); since PNG/JPEG cover the overwhelming
 *  majority of real uploads here (phone photos, exported logos), WebP is
 *  passed through unresized rather than pulling in that extra dependency
 *  for an edge case. PNG is kept as PNG (avatars/logos can have
 *  transparency); JPEG is re-encoded at `jpegQuality` for extra size
 *  savings on top of the dimension cut, which is what actually matters for
 *  multi-MB phone photos. */
export async function resizeImage(
  buffer: Buffer,
  mimetype: 'image/png' | 'image/jpeg' | 'image/webp',
  maxDimension: number,
  jpegQuality = 82,
): Promise<{ buffer: Buffer; mimetype: 'image/png' | 'image/jpeg' | 'image/webp' }> {
  if (mimetype === 'image/webp') return { buffer, mimetype };

  try {
    const image = await Jimp.read(buffer);
    const { width, height } = image.bitmap;
    if (width <= maxDimension && height <= maxDimension) {
      return { buffer, mimetype };
    }
    image.scaleToFit({ w: maxDimension, h: maxDimension });
    if (mimetype === 'image/png') {
      return { buffer: await image.getBuffer(JimpMime.png), mimetype: 'image/png' };
    }
    return { buffer: await image.getBuffer(JimpMime.jpeg, { quality: jpegQuality }), mimetype: 'image/jpeg' };
  } catch (err: any) {
    // Decoding failed for some reason the magic-byte sniff didn't catch —
    // fail safe by storing the original rather than blocking the upload.
    console.error('[resizeImage] Falling back to the original file:', err?.message);
    return { buffer, mimetype };
  }
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
