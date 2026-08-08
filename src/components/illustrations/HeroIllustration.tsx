import { Illustration, DualShape } from './DualTone';

interface HeroIllustrationProps {
  className?: string;
  width?: number | string;
}

/** Dual-tone hero graphic: a tilted floor-plan sheet overlapped by a building block. */
export function HeroIllustration({ className, width = 420 }: HeroIllustrationProps) {
  return (
    <Illustration viewBox="0 0 260 220" width={width} className={className}>
      <g transform="rotate(-8 95 90)">
        <DualShape offsetX={6} offsetY={7}>
          <rect x={20} y={30} width={150} height={120} rx={8} />
        </DualShape>
        <rect x={36} y={50} width={90} height={6} rx={3} fill="var(--illus-shadow)" fillOpacity={0.35} />
        <rect x={36} y={66} width={70} height={6} rx={3} fill="var(--illus-shadow)" fillOpacity={0.35} />
        <rect x={36} y={82} width={100} height={6} rx={3} fill="var(--illus-shadow)" fillOpacity={0.35} />
        <rect x={36} y={104} width={60} height={40} rx={4} fill="var(--illus-shadow)" fillOpacity={0.22} />
        <rect x={104} y={104} width={44} height={40} rx={4} fill="var(--illus-shadow)" fillOpacity={0.22} />
      </g>

      <DualShape offsetX={6} offsetY={7}>
        <rect x={130} y={70} width={100} height={130} rx={6} />
      </DualShape>
      {[0, 1, 2].map(row => (
        <g key={row}>
          <rect x={146} y={92 + row * 30} width={20} height={20} rx={3} fill="var(--tblr-bg)" />
          <rect x={182} y={92 + row * 30} width={20} height={20} rx={3} fill="var(--tblr-bg)" />
        </g>
      ))}
      <rect x={160} y={182} width={30} height={18} rx={2} fill="var(--tblr-bg)" />

      <circle cx={224} cy={54} r={12} fill="var(--illus-base)" fillOpacity={0.5} />
    </Illustration>
  );
}
