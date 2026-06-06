import React, { useState, useEffect } from 'react';
import QRCode from 'qrcode';

interface PrintPageDecorationsProps {
  title: string;
  subtitle?: string;
  reference?: string;
  /** Full URL to the project's web page — encoded as a QR code in the print footer */
  projectUrl?: string;
}

/**
 * Invisible on screen. When the browser prints, renders as:
 *  - a fixed header (title left · date right) at the top of every page
 *  - a fixed footer (brand left · reference right) at the bottom of every page
 *  - a QR code image (bottom-right corner) linking to the project's live URL
 * Requires the companion print CSS in index.css.
 */
export const PrintPageDecorations: React.FC<PrintPageDecorationsProps> = ({
  title,
  subtitle,
  reference,
  projectUrl,
}) => {
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);

  const date = new Date().toLocaleDateString('fr-FR', {
    day: '2-digit',
    month: 'long',
    year: 'numeric',
  });

  // Generate QR PNG data URL from the project URL
  useEffect(() => {
    if (!projectUrl) return;
    QRCode.toDataURL(projectUrl, {
      width: 200,
      margin: 1,
      color: { dark: '#1e3a5f', light: '#ffffff' },
      errorCorrectionLevel: 'M',
    })
      .then(url => setQrDataUrl(url))
      .catch(() => { /* silently ignore — QR is decorative */ });
  }, [projectUrl]);

  return (
    <>
      {/* Fixed header — document title + date */}
      <div className="print-page-header" aria-hidden="true">
        <div className="print-page-header__left">
          <span className="print-page-header__title">{title}</span>
          {subtitle && <span className="print-page-header__sub">{subtitle}</span>}
        </div>
        <div className="print-page-header__right">
          {reference && <span>{reference}</span>}
          <span>{date}</span>
        </div>
      </div>

      {/* Fixed footer — brand + reference */}
      <div className="print-page-footer" aria-hidden="true">
        <span className="print-page-footer__brand">ArchiOffice</span>
        {reference && <span className="print-page-footer__ref">{reference}</span>}
      </div>

      {/* QR code — bottom-right corner of every printed page */}
      {qrDataUrl && (
        <div className="print-page-qr" aria-hidden="true">
          <img
            src={qrDataUrl}
            alt=""
            className="print-page-qr__img"
          />
          <span className="print-page-qr__label">Version en ligne</span>
        </div>
      )}
    </>
  );
};
