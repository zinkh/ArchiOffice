/** Fichier joint depuis l'appareil : même route que la GED, rangé sous « Assistant IA ». */
export async function uploadChatDocument(file: File): Promise<{ id: string; name: string }> {
  const form = new FormData();
  form.append('file', file);
  form.append('name', file.name);
  form.append('category', 'Assistant IA');
  const res = await fetch('/api/documents', { method: 'POST', body: form });
  if (!res.ok) throw new Error('upload_failed');
  const data = await res.json();
  return { id: data.id, name: file.name };
}

/**
 * Images collées (Ctrl+V) depuis le presse-papiers : captures d'écran, images copiées d'un
 * navigateur ou d'un logiciel de dessin. Rend [] quand le presse-papiers ne porte aucune image,
 * pour laisser le collage de texte se faire normalement. Un fichier copié dans l'Explorateur
 * (type image/*) est repris tel quel ; une capture arrive toujours sous le nom « image.png », que
 * l'on remplace par un nom horodaté pour que plusieurs collages ne se confondent pas.
 */
export function imagesFromClipboard(data: DataTransfer | null | undefined, now: Date = new Date()): File[] {
  if (!data) return [];
  const files: File[] = [];
  for (const item of Array.from(data.items ?? [])) {
    if (item.kind !== 'file' || !item.type.startsWith('image/')) continue;
    const file = item.getAsFile();
    if (file) files.push(file);
  }
  if (files.length === 0) return [];
  const stamp = now.toISOString().replace(/[-:]/g, '').replace(/\..*$/, '').replace('T', '-');
  return files.map((file, i) => {
    if (file.name && !/^image\.\w+$/i.test(file.name)) return file;
    const ext = (file.type.split('/')[1] || 'png').replace('jpeg', 'jpg').replace(/\+.*$/, '');
    const suffix = files.length > 1 ? `-${i + 1}` : '';
    return new File([file], `capture-${stamp}${suffix}.${ext}`, { type: file.type });
  });
}
