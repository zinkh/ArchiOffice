// <img> for a file stored in one of the private buckets (documents/plans/cv/
// message-attachments/feed-attachments/meeting-photos/reserve-photos) — resolves `src` to a
// signed URL (see src/lib/signedStorageUrl.ts) before rendering, since the
// raw file_url/attachment_url is no longer directly fetchable.
import { useCallback, useEffect, useRef, useState } from 'react';
import { resolveSignedUrl } from '../lib/signedStorageUrl';

export function SignedImage({
  src,
  alt,
  className,
  style,
  onClick,
  onLoadError,
  deferUntilVisible = false,
}: {
  src: string;
  alt?: string;
  className?: string;
  style?: React.CSSProperties;
  onClick?: React.MouseEventHandler<HTMLImageElement>;
  onLoadError?: () => void;
  deferUntilVisible?: boolean;
}) {
  const imageRef = useRef<HTMLElement | null>(null);
  const observerRef = useRef<IntersectionObserver | null>(null);
  const onLoadErrorRef = useRef(onLoadError);
  const [resolvedSrc, setResolvedSrc] = useState<string | null>(null);
  const [visibleSrc, setVisibleSrc] = useState<string | null>(() => deferUntilVisible ? null : src);
  const setImageRef = useCallback((node: HTMLElement | null) => {
    imageRef.current = node;
    if (node) observerRef.current?.observe(node);
  }, []);

  useEffect(() => {
    onLoadErrorRef.current = onLoadError;
  }, [onLoadError]);

  useEffect(() => {
    if (!deferUntilVisible) {
      setVisibleSrc(src);
      return;
    }
    setVisibleSrc(null);
    const target = imageRef.current;
    if (!target || !('IntersectionObserver' in window)) {
      setVisibleSrc(src);
      return;
    }
    const observer = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) {
        setVisibleSrc(src);
        observer.disconnect();
        observerRef.current = null;
      }
    }, { rootMargin: '200px' });
    observerRef.current = observer;
    observer.observe(target);
    return () => {
      observer.disconnect();
      observerRef.current = null;
    };
  }, [src, deferUntilVisible]);

  useEffect(() => {
    let cancelled = false;
    setResolvedSrc(null);
    if (deferUntilVisible && visibleSrc !== src) return;
    resolveSignedUrl(src)
      .then((url) => { if (!cancelled) setResolvedSrc(url); })
      .catch((err) => {
        console.error('[SignedImage] Failed to resolve:', err);
        if (!cancelled) onLoadErrorRef.current?.();
      });
    return () => { cancelled = true; };
  }, [src, visibleSrc, deferUntilVisible]);

  if (!resolvedSrc) {
    return (
      <div
        ref={setImageRef}
        className={className}
        style={{ background: 'var(--tblr-border-color, #e5e7eb)', minHeight: '2rem', minWidth: '2rem', ...style }}
        aria-label={alt}
      />
    );
  }
  return <img ref={setImageRef} src={resolvedSrc} alt={alt} className={className} style={style} onClick={onClick} onError={() => {
    console.error('[SignedImage] Failed to load image.');
    onLoadErrorRef.current?.();
  }} loading={deferUntilVisible ? 'lazy' : undefined} />;
}

