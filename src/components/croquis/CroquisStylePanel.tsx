import { useTranslation } from 'react-i18next';
import type { CroquisFill, CroquisStyle } from '../../types/croquis';
import { COLORS, HATCH_PRESETS, STROKE_WIDTHS, type HatchPresetKey } from '../../lib/croquis/scene';
import { CHIP, LABEL, PANEL, SEGMENT, SEGMENT_BTN } from './ui';

interface CroquisStylePanelProps {
  style: CroquisStyle;
  /** Changement définitif (clic) : une étape d'historique. */
  onChange: (patch: Partial<CroquisStyle>) => void;
  /** Aperçu pendant le glissement d'un curseur : pas d'étape d'historique tant que `onCommit` n'est pas appelé. */
  onPreview: (patch: Partial<CroquisStyle>) => void;
  onCommit: () => void;
  onPreset: (key: HatchPresetKey) => void;
}

const FILLS_ROW_1: readonly CroquisFill[] = ['none', 'hachure', 'cross-hatch'];
const FILLS_ROW_2: readonly CroquisFill[] = ['zigzag', 'dots', 'solid'];

/** Panneau « Style » : trait, couleur, épaisseur, remplissage, hachures types. */
export default function CroquisStylePanel({ style, onChange, onPreview, onCommit, onPreset }: CroquisStylePanelProps) {
  const { t } = useTranslation();

  const fillRow = (fills: readonly CroquisFill[]) => (
    <div className={SEGMENT}>
      {fills.map((fill) => (
        <button
          key={fill}
          type="button"
          className={SEGMENT_BTN}
          aria-pressed={style.fill === fill}
          onClick={() => onChange({ fill })}
        >
          {t(`croquis_fill_${fill}`)}
        </button>
      ))}
    </div>
  );

  return (
    <section id="croquis-panel-style" className={PANEL} aria-label={t('croquis_panel_style')}>
      <div className="flex flex-col gap-1.5">
        <div className={LABEL}>{t('croquis_style_stroke')}</div>
        <div className={SEGMENT}>
          <button type="button" className={SEGMENT_BTN} aria-pressed={style.rough} onClick={() => onChange({ rough: true })}>
            {t('croquis_stroke_rough')}
          </button>
          <button type="button" className={SEGMENT_BTN} aria-pressed={!style.rough} onClick={() => onChange({ rough: false })}>
            {t('croquis_stroke_clean')}
          </button>
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        <div className={LABEL}>{t('croquis_style_color')}</div>
        <div className="flex gap-2">
          {COLORS.map(({ value, key }) => (
            <button
              key={value}
              type="button"
              aria-pressed={style.color === value}
              aria-label={t(`croquis_color_${key}`)}
              title={t(`croquis_color_${key}`)}
              style={{ backgroundColor: value }}
              className="h-9 w-9 rounded-full border border-neutral-300 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neutral-900 aria-pressed:shadow-[0_0_0_2px_#fbfbf9,0_0_0_4px_#141414]"
              onClick={() => onChange({ color: value })}
            />
          ))}
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        <div className={LABEL}>{t('croquis_style_width')}</div>
        <div className={SEGMENT}>
          {STROKE_WIDTHS.map(({ value, key }) => (
            <button
              key={key}
              type="button"
              className={SEGMENT_BTN}
              aria-pressed={style.sw === value}
              onClick={() => onChange({ sw: value })}
            >
              {t(`croquis_width_${key}`)}
            </button>
          ))}
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        <div className={LABEL}>{t('croquis_style_fill')}</div>
        {fillRow(FILLS_ROW_1)}
        {fillRow(FILLS_ROW_2)}
      </div>

      <div className="flex flex-col gap-1.5">
        <div className={LABEL}>
          <label htmlFor="croquis-angle">{t('croquis_style_angle')}</label>
          <output htmlFor="croquis-angle" className="font-mono normal-case tracking-normal text-neutral-900">
            {style.angle}°
          </output>
        </div>
        <input
          id="croquis-angle"
          type="range"
          min={-90}
          max={90}
          step={5}
          value={style.angle}
          className="h-6 w-full accent-neutral-900"
          onChange={(ev) => onPreview({ angle: Number(ev.target.value) })}
          onPointerUp={onCommit}
          onKeyUp={onCommit}
          onBlur={onCommit}
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <div className={LABEL}>
          <label htmlFor="croquis-gap">{t('croquis_style_gap')}</label>
          <output htmlFor="croquis-gap" className="font-mono normal-case tracking-normal text-neutral-900">
            {style.gap}
          </output>
        </div>
        <input
          id="croquis-gap"
          type="range"
          min={3}
          max={20}
          step={1}
          value={style.gap}
          className="h-6 w-full accent-neutral-900"
          onChange={(ev) => onPreview({ gap: Number(ev.target.value) })}
          onPointerUp={onCommit}
          onKeyUp={onCommit}
          onBlur={onCommit}
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <div className={LABEL}>{t('croquis_style_presets')}</div>
        <div className="flex flex-wrap gap-1.5">
          {(Object.keys(HATCH_PRESETS) as HatchPresetKey[]).map((key) => (
            <button key={key} type="button" className={CHIP} onClick={() => onPreset(key)}>
              {t(`croquis_preset_${key}`)}
            </button>
          ))}
        </div>
      </div>
    </section>
  );
}
