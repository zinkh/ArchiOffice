// ── Barre de mise en forme et aperçu du texte technique d'un poste ───────────
// Le champ reste un <textarea> (le texte est une chaîne, voir lib/cctpRichText) :
// la barre pose les balises autour de la sélection, l'aperçu montre le rendu
// tel qu'il sera imprimé. Variables {{…}} non résolues : l'aperçu les laisse.
import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { IconBold, IconItalic, IconUnderline, IconPalette } from '@tabler/icons-react';
import { COULEURS_CCTP, paragraphesRiches, type BaliseRiche } from '../../lib/cctpRichText';

interface ToolbarProps {
  onBalise: (code: BaliseRiche) => void;
  onCouleur: (hex: string | null) => void;
}

const BOUTON = 'w-8 h-8 inline-flex items-center justify-center rounded border text-sm outline-none hover:bg-[var(--tblr-surface-2)] focus-visible:ring-2 focus-visible:ring-[var(--tblr-primary)] pointer-coarse:w-11 pointer-coarse:h-11';

export const CctpRichToolbar: React.FC<ToolbarProps> = ({ onBalise, onCouleur }) => {
  const { t } = useTranslation();
  const [palette, setPalette] = useState(false);
  // mouseDown est bloqué : cliquer un bouton ne doit pas faire perdre sa sélection au champ.
  const garderSelection = (e: React.MouseEvent) => e.preventDefault();
  const boutons: { code: BaliseRiche; label: string; icon: React.ReactNode; raccourci: string }[] = [
    { code: 'b', label: t('pro_cctp_format_bold'), icon: <IconBold size={16} aria-hidden />, raccourci: 'Ctrl+B' },
    { code: 'i', label: t('pro_cctp_format_italic'), icon: <IconItalic size={16} aria-hidden />, raccourci: 'Ctrl+I' },
    { code: 'u', label: t('pro_cctp_format_underline'), icon: <IconUnderline size={16} aria-hidden />, raccourci: 'Ctrl+U' },
  ];
  return (
    <div className="relative flex items-center gap-1" role="toolbar" aria-label={t('pro_cctp_format')}>
      {boutons.map(b => (
        <button
          key={b.code} type="button" className={BOUTON} style={{ borderColor: 'var(--tblr-border)' }}
          title={`${b.label} (${b.raccourci})`} aria-label={b.label}
          onMouseDown={garderSelection} onClick={() => onBalise(b.code)}
        >
          {b.icon}
        </button>
      ))}
      <button
        type="button" className={BOUTON} style={{ borderColor: 'var(--tblr-border)' }}
        title={t('pro_cctp_format_color')} aria-label={t('pro_cctp_format_color')}
        aria-haspopup="true" aria-expanded={palette}
        onMouseDown={garderSelection} onClick={() => setPalette(v => !v)}
      >
        <IconPalette size={16} aria-hidden />
      </button>
      {palette && (
        <div
          className="absolute left-0 top-full mt-1 z-20 flex items-center gap-1.5 p-2 rounded border shadow-lg"
          style={{ background: 'var(--tblr-surface)', borderColor: 'var(--tblr-border)' }}
          onKeyDown={e => { if (e.key === 'Escape') { e.stopPropagation(); setPalette(false); } }}
        >
          {COULEURS_CCTP.map(c => (
            <button
              key={c.hex} type="button" title={c.libelle} aria-label={c.libelle}
              className="w-6 h-6 rounded-full border outline-none focus-visible:ring-2 focus-visible:ring-[var(--tblr-primary)] pointer-coarse:w-9 pointer-coarse:h-9"
              style={{ background: c.hex, borderColor: 'var(--tblr-border)' }}
              onMouseDown={garderSelection}
              onClick={() => { onCouleur(c.hex); setPalette(false); }}
            />
          ))}
          <button
            type="button" className="h-6 px-2 rounded border text-[0.6875rem] outline-none hover:bg-[var(--tblr-surface-2)] focus-visible:ring-2 focus-visible:ring-[var(--tblr-primary)] pointer-coarse:h-9"
            style={{ borderColor: 'var(--tblr-border)' }}
            onMouseDown={garderSelection}
            onClick={() => { onCouleur(null); setPalette(false); }}
          >
            {t('pro_cctp_format_color_none')}
          </button>
        </div>
      )}
    </div>
  );
};

/** Rendu du texte mis en forme, sans HTML brut : chaque segment est un <span> stylé. */
export const CctpRichPreview: React.FC<{ texte: string }> = ({ texte }) => (
  <div className="text-sm leading-relaxed">
    {paragraphesRiches(texte).map((para, i) => (
      <p key={i} className="min-h-[1.4em]">
        {para.map((seg, j) => (
          <span
            key={j}
            style={{
              fontWeight: seg.b ? 700 : undefined,
              fontStyle: seg.i ? 'italic' : undefined,
              textDecoration: seg.u ? 'underline' : undefined,
              color: seg.color,
            }}
          >
            {seg.text}
          </span>
        ))}
      </p>
    ))}
  </div>
);
