import { Illustration, DualShape } from './DualTone';

interface StepIllustrationProps {
  className?: string;
  width?: number | string;
}

/** Drafting set-square crossed by a ruler — setting up your agency workspace. */
export function WorkspaceIllustration({ className, width = 64 }: StepIllustrationProps) {
  return (
    <Illustration viewBox="0 0 64 64" width={width} className={className}>
      <DualShape offsetX={3} offsetY={4}>
        <polygon points="14,50 14,14 50,50" />
      </DualShape>
      <g transform="rotate(-28 32 32)">
        <DualShape offsetX={2} offsetY={3}>
          <rect x={4} y={40} width={56} height={9} rx={2} />
        </DualShape>
        {[0, 1, 2, 3, 4].map(i => (
          <rect key={i} x={10 + i * 10} y={40} width={2} height={9} fill="var(--tblr-bg)" />
        ))}
      </g>
    </Illustration>
  );
}

/** Building overlapped by a project folder — centralizing projects and contacts. */
export function ProjectsIllustration({ className, width = 64 }: StepIllustrationProps) {
  return (
    <Illustration viewBox="0 0 64 64" width={width} className={className}>
      <DualShape offsetX={3} offsetY={4}>
        <rect x={10} y={14} width={28} height={36} rx={3} />
      </DualShape>
      <rect x={16} y={22} width={6} height={6} rx={1} fill="var(--tblr-bg)" />
      <rect x={28} y={22} width={6} height={6} rx={1} fill="var(--tblr-bg)" />
      <rect x={16} y={34} width={6} height={6} rx={1} fill="var(--tblr-bg)" />
      <rect x={28} y={34} width={6} height={6} rx={1} fill="var(--tblr-bg)" />
      <DualShape offsetX={3} offsetY={4}>
        <rect x={22} y={44} width={34} height={16} rx={3} />
        <rect x={22} y={38} width={16} height={9} rx={2} />
      </DualShape>
    </Illustration>
  );
}

/** Document with text lines crossed by a pen — automating devis, CCTP and invoices. */
export function DocsIllustration({ className, width = 64 }: StepIllustrationProps) {
  return (
    <Illustration viewBox="0 0 64 64" width={width} className={className}>
      <DualShape offsetX={3} offsetY={4}>
        <rect x={14} y={10} width={30} height={40} rx={3} />
      </DualShape>
      <rect x={20} y={20} width={18} height={4} rx={2} fill="var(--tblr-bg)" />
      <rect x={20} y={28} width={14} height={4} rx={2} fill="var(--tblr-bg)" />
      <rect x={20} y={36} width={18} height={4} rx={2} fill="var(--tblr-bg)" />
      <g transform="rotate(38 40 40)">
        <DualShape offsetX={2} offsetY={2}>
          <rect x={38} y={12} width={5} height={32} rx={2.5} />
          <polygon points="37,10 43,10 40,3" />
        </DualShape>
      </g>
    </Illustration>
  );
}

/** Gantt-style progress bars with a pennant at the end of the longest one — tracking a site through to delivery. */
export function SiteProgressIllustration({ className, width = 64 }: StepIllustrationProps) {
  return (
    <Illustration viewBox="0 0 64 64" width={width} className={className}>
      <rect x={8} y={16} width={44} height={8} rx={4} fill="var(--illus-base)" />
      <rect x={8} y={30} width={32} height={8} rx={4} fill="var(--illus-shadow)" />
      <rect x={8} y={44} width={22} height={8} rx={4} fill="var(--illus-base)" fillOpacity={0.7} />
      <DualShape offsetX={2} offsetY={2}>
        <rect x={51} y={4} width={3} height={18} />
        <polygon points="54,6 63,10 54,14" />
      </DualShape>
    </Illustration>
  );
}
