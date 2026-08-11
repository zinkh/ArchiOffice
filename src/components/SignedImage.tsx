// <img> for a file stored in one of the private buckets (documents/plans/cv/
// message-attachments/feed-attachments) — resolves `src` to a signed URL
// (see src/lib/signedStorageUrl.ts) before rendering, since the raw
// file_url/attachment_url is no longer directly fetchable.
import { useEffect, useState } from 'react';
import { resolveSignedUrl } from '../lib/signedStorageUrl';

export function SignedImage({
  src,
  alt,
  className,
  style,
}: {
  src: string;
  alt?: string;
  className?: string;
  style?: React.CSSProperties;
}) {
  const [resolvedSrc, setResolvedSrc] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setResolvedSrc(null);
    resolveSignedUrl(src)
      .then((url) => { if (!cancelled) setResolvedSrc(url); })
      .catch((err) => console.error('[SignedImage] Failed to resolve:', err));
    return () => { cancelled = true; };
  }, [src]);

  if (!resolvedSrc) {
    return (
      <div
        className={className}
        style={{ background: 'var(--tblr-border-color, #e5e7eb)', minHeight: '2rem', minWidth: '2rem', ...style }}
        aria-label={alt}
      />
    );
  }
  return <img src={resolvedSrc} alt={alt} className={className} style={style} />;
}
