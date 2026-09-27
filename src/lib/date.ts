// Point unique de formatage des dates affichées à l'écran — jj/mm/aaaa
// partout (locale 'fr-FR' explicite), pour ne plus dépendre du fuseau/de la
// langue du navigateur ni laisser passer une date ISO brute (aaaa-mm-jj) à
// l'affichage à côté d'un format français ailleurs sur la même page.
export function formatDate(value: string | Date | null | undefined, options?: Intl.DateTimeFormatOptions): string {
  if (!value) return '—';
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('fr-FR', options);
}

export function formatDateTime(value: string | Date | null | undefined): string {
  return formatDate(value, { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}
