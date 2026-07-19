import { Sentry } from '../lib/sentry';

/**
 * Wraps a single address/location info widget (PLU, Géorisques, cadastre,
 * maps...) so a failure in one — e.g. an address the underlying geocoding/
 * cartography API can't resolve — shows an inline fallback instead of
 * propagating up. Without this, an uncaught error in any of these optional
 * panels hits the app's single top-level error boundary (see main.tsx) and
 * blanks the entire page, taking whatever form the user was filling in
 * (and hadn't saved yet) down with it.
 */
export function InfoPanelBoundary({ children, label }: { children: React.ReactNode; label?: string }) {
  return (
    <Sentry.ErrorBoundary
      fallback={
        <div className="text-[11px] italic p-3 rounded-lg" style={{ color: 'var(--tblr-muted, #71717a)', background: 'var(--tblr-surface-2, #f4f4f5)' }}>
          {label ? `${label} : ` : ''}informations indisponibles pour cette adresse.
        </div>
      }
    >
      {children}
    </Sentry.ErrorBoundary>
  );
}
