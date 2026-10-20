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
