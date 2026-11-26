import { useRef, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { FULL_BTN, LABEL, PANEL } from './ui';

interface CroquisBackgroundPanelProps {
  hasBackground: boolean;
  /** Opacité du fond, de 0,05 à 1. */
  opacity: number;
  onOpacity: (value: number) => void;
  onImport: (file: File) => void;
  onClear: () => void;
  /** Contenu ajouté sous les boutons (choix d'un plan ou d'une photo de l'affaire, étape 6). */
  children?: ReactNode;
}

/** Panneau « Fond » : feuille blanche, image importée, opacité. */
export default function CroquisBackgroundPanel({
  hasBackground,
  opacity,
  onOpacity,
  onImport,
  onClear,
  children,
}: CroquisBackgroundPanelProps) {
  const { t } = useTranslation();
  const fileRef = useRef<HTMLInputElement>(null);
  const percent = Math.round(opacity * 100);

  return (
    <section id="croquis-panel-bg" className={PANEL} aria-label={t('croquis_panel_background')}>
      <div className="flex flex-col gap-1.5">
        <div className={LABEL}>{t('croquis_bg_support')}</div>
        <button type="button" className={FULL_BTN} onClick={() => fileRef.current?.click()}>
          {t('croquis_bg_import')}
        </button>
        <button type="button" className={FULL_BTN} aria-pressed={!hasBackground} onClick={onClear}>
          {t('croquis_bg_blank')}
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          hidden
          onChange={(ev) => {
            const file = ev.target.files?.[0];
            ev.target.value = '';
            if (file) onImport(file);
          }}
        />
        {children}
      </div>

      {hasBackground && (
        <div className="flex flex-col gap-1.5">
          <div className={LABEL}>
            <label htmlFor="croquis-bg-opacity">{t('croquis_bg_opacity')}</label>
            <output htmlFor="croquis-bg-opacity" className="font-mono normal-case tracking-normal text-neutral-900">
              {percent} %
            </output>
          </div>
          <input
            id="croquis-bg-opacity"
            type="range"
            min={5}
            max={100}
            step={5}
            value={percent}
            className="h-6 w-full accent-neutral-900"
            onChange={(ev) => onOpacity(Number(ev.target.value) / 100)}
          />
        </div>
      )}

      <p className="m-0 text-xs leading-snug text-neutral-500">{t('croquis_bg_hint')}</p>
    </section>
  );
}
