// Liste stockée en texte JSON (réserves : lots, entreprises) ; module sans dépendance, utilisable par les tests.
export function parseJsonList(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String).filter(Boolean);
  if (typeof value !== 'string' || !value.trim()) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.map(String).filter(Boolean) : [String(parsed)];
  } catch {
    return value.split(',').map(s => s.trim()).filter(Boolean);
  }
}
