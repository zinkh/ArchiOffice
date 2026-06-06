import React from 'react';

interface PrintPageDecorationsProps {
  title: string;
  subtitle?: string;
  reference?: string;
}

/**
 * Invisible on screen. When the browser prints, renders as a fixed header
 * (title + date) and a fixed footer (brand + reference) on every page.
 * Requires the companion print CSS in index.css.
 */
export const PrintPageDecorations: React.FC<PrintPageDecorationsProps> = ({
  title,
  subtitle,
  reference,
}) => {
  const date = new Date().toLocaleDateString('fr-FR', {
    day: '2-digit',
    month: 'long',
    year: 'numeric',
  });

  return (
    <>
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

      <div className="print-page-footer" aria-hidden="true">
        <span className="print-page-footer__brand">ArchiOffice</span>
        {reference && <span className="print-page-footer__ref">{reference}</span>}
      </div>
    </>
  );
};
