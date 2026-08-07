import type { CSSProperties, ReactNode } from 'react';

interface IllustrationProps {
  viewBox: string;
  width?: number | string;
  height?: number | string;
  className?: string;
  children: ReactNode;
}

/** Shared shell for dual-tone illustrations: derives a light "base" and a darker "shadow" tone
 * from the app's own brand color so every illustration follows light/dark theme automatically. */
export function Illustration({ viewBox, width, height, className, children }: IllustrationProps) {
  const style = {
    '--illus-base': 'var(--tblr-primary)',
    '--illus-shadow': 'color-mix(in srgb, var(--tblr-primary) 65%, black)',
  } as CSSProperties;

  return (
    <svg
      viewBox={viewBox}
      width={width}
      height={height}
      className={className}
      style={style}
      aria-hidden="true"
      focusable="false"
    >
      {children}
    </svg>
  );
}

interface DualShapeProps {
  children: ReactNode;
  offsetX?: number;
  offsetY?: number;
}

/** Renders a primary subject shape twice: an offset copy behind in the shadow tone, and the
 * shape on top in the base tone — the dual-tone duplicate-and-offset technique. */
export function DualShape({ children, offsetX = 5, offsetY = 6 }: DualShapeProps) {
  return (
    <>
      <g transform={`translate(${offsetX} ${offsetY})`} fill="var(--illus-shadow)">{children}</g>
      <g fill="var(--illus-base)">{children}</g>
    </>
  );
}
