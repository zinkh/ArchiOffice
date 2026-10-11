// Envoi d'une illustration d'article de CCTP : réduite côté navigateur (JPEG,
// 1600 px au plus : une photo de téléphone de plusieurs Mo n'a pas sa place
// dans un CCTP), puis déposée comme document de l'affaire. L'article ne garde
// que la référence.
import { getAccessToken } from './authToken';

export const COTE_MAX_ILLUSTRATION = 1600;
export const CATEGORIE_ILLUSTRATION = 'CCTP - illustrations';

async function reduire(fichier: File): Promise<Blob> {
  const url = URL.createObjectURL(fichier);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error('Image illisible.'));
      el.src = url;
    });
    const echelle = Math.min(1, COTE_MAX_ILLUSTRATION / Math.max(img.naturalWidth, img.naturalHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(img.naturalWidth * echelle));
    canvas.height = Math.max(1, Math.round(img.naturalHeight * echelle));
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Image illisible.');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.85));
    if (!blob) throw new Error('Image illisible.');
    return blob;
  } finally {
    URL.revokeObjectURL(url);
  }
}

export async function envoyerIllustration(
  projectId: string,
  fichier: File,
): Promise<{ id: string; documentId: string; fileUrl: string }> {
  if (!fichier.type.startsWith('image/')) throw new Error(`« ${fichier.name} » n'est pas une image.`);
  const blob = await reduire(fichier);
  const nom = `${fichier.name.replace(/\.[^.]+$/, '') || 'illustration'}.jpg`;
  const form = new FormData();
  form.append('file', new File([blob], nom, { type: 'image/jpeg' }));
  form.append('project_id', projectId);
  form.append('name', nom);
  form.append('category', CATEGORIE_ILLUSTRATION);
  const token = await getAccessToken();
  const res = await fetch('/api/documents', { method: 'POST', headers: token ? { Authorization: `Bearer ${token}` } : {}, body: form });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(data?.error || "Échec de l'envoi de l'image.");
  return { id: crypto.randomUUID(), documentId: data.id, fileUrl: data.file_url };
}
