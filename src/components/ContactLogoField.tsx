import { useRef, useState, type CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';
import { compressImage } from '../lib/imageCompression';

/**
 * Logo d'un contact (typiquement un cotraitant). Il sert d'en-tête aux
 * documents exportés d'un groupement : stocké en data URL PNG (transparence
 * conservée) réduite à CONTACT_LOGO_MAX_* pour ne pas alourdir la fiche ni
 * chaque export qui la relit.
 */
const CONTACT_LOGO_MAX_W = 600;
const CONTACT_LOGO_MAX_H = 300;
const CONTACT_LOGO_MAX_FILE_BYTES = 5 * 1024 * 1024;

interface ContactLogoFieldProps {
  logo: string;
  onChange: (logo: string) => void;
  labelClass: string;
  labelStyle: CSSProperties;
}

export function ContactLogoField({ logo, onChange, labelClass, labelStyle }: ContactLogoFieldProps) {
  const { t } = useTranslation();
  const inputRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);

  const handleFile = (file: File | undefined) => {
    setError(null);
    if (!file) return;
    if (!file.type.startsWith('image/') || file.size > CONTACT_LOGO_MAX_FILE_BYTES) {
      setError(t('contacts_logo_invalid'));
      return;
    }
    const reader = new FileReader();
    reader.onload = async () => {
      const compressed = await compressImage(
        reader.result as string, CONTACT_LOGO_MAX_W, CONTACT_LOGO_MAX_H, 0.92, 'image/png',
      );
      if (!compressed) { setError(t('contacts_logo_invalid')); return; }
      onChange(compressed.dataUrl);
    };
    reader.onerror = () => setError(t('contacts_logo_invalid'));
    reader.readAsDataURL(file);
  };

  return (
    <div className="space-y-1">
      <label className={labelClass} style={labelStyle}>{t('contacts_logo_label')}</label>
      <div className="flex items-center gap-3">
        {logo && (
          <img
            src={logo}
            alt={t('contacts_logo_label')}
            className="h-12 max-w-[8rem] object-contain rounded p-1"
            style={{ border: '1px solid var(--tblr-border)', background: '#fff' }}
          />
        )}
        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={e => { handleFile(e.target.files?.[0]); e.target.value = ''; }}
        />
        <button type="button" className="btn btn-sm" onClick={() => inputRef.current?.click()}>
          {logo ? t('contacts_logo_replace') : t('contacts_logo_add')}
        </button>
        {logo && (
          <button type="button" className="btn btn-sm" onClick={() => onChange('')}>
            {t('contacts_logo_remove')}
          </button>
        )}
      </div>
      <p className="text-[0.6875rem]" style={{ color: 'var(--tblr-muted)' }}>{t('contacts_logo_hint')}</p>
      {error && <p className="text-[0.6875rem]" style={{ color: 'var(--tblr-danger)' }} role="alert">{error}</p>}
    </div>
  );
}
