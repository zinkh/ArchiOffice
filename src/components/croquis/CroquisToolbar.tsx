import type { ComponentType } from 'react';
import { useTranslation } from 'react-i18next';
import {
  IconArrowUpRight,
  IconEraser,
  IconHandStop,
  IconLine,
  IconOval,
  IconPencil,
  IconPointer,
  IconSquare,
  IconTypography,
} from '@tabler/icons-react';
import type { CroquisTool } from '../../types/croquis';
import { BAR, ICON_BTN, SEPARATOR } from './ui';

interface ToolDef {
  tool: CroquisTool;
  Icon: ComponentType<{ size?: number; stroke?: number; 'aria-hidden'?: boolean }>;
  shortcut: string;
}

/** Raccourcis clavier du prototype : V H P L A R O T E. */
export const TOOLS: readonly ToolDef[] = [
  { tool: 'select', Icon: IconPointer, shortcut: 'V' },
  { tool: 'hand', Icon: IconHandStop, shortcut: 'H' },
  { tool: 'pen', Icon: IconPencil, shortcut: 'P' },
  { tool: 'line', Icon: IconLine, shortcut: 'L' },
  { tool: 'arrow', Icon: IconArrowUpRight, shortcut: 'A' },
  { tool: 'rect', Icon: IconSquare, shortcut: 'R' },
  { tool: 'ellipse', Icon: IconOval, shortcut: 'O' },
  { tool: 'text', Icon: IconTypography, shortcut: 'T' },
  { tool: 'eraser', Icon: IconEraser, shortcut: 'E' },
];

export const SHORTCUT_TO_TOOL: Readonly<Record<string, CroquisTool>> = Object.fromEntries(
  TOOLS.map((d) => [d.shortcut.toLowerCase(), d.tool]),
);

interface CroquisToolbarProps {
  tool: CroquisTool;
  onTool: (tool: CroquisTool) => void;
}

/** Barre d'outils flottante en bas de l'éditeur. */
export default function CroquisToolbar({ tool, onTool }: CroquisToolbarProps) {
  const { t } = useTranslation();
  return (
    <div
      role="toolbar"
      aria-label={t('croquis_tools')}
      className={`${BAR} bottom-3.5 left-1/2 max-w-[calc(100%-1rem)] -translate-x-1/2 overflow-x-auto`}
    >
      {TOOLS.map(({ tool: id, Icon, shortcut }, index) => (
        <span key={id} className="flex items-center">
          {(index === 2) && <span className={SEPARATOR} aria-hidden="true" />}
          <button
            type="button"
            className={ICON_BTN}
            aria-pressed={tool === id}
            aria-label={t(`croquis_tool_${id}`)}
            title={`${t(`croquis_tool_${id}`)} (${shortcut})`}
            onClick={() => onTool(id)}
          >
            <Icon size={20} stroke={1.6} aria-hidden />
          </button>
        </span>
      ))}
    </div>
  );
}
