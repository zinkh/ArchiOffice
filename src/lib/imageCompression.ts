// Shared image downscaling for exporters that embed a logo/photo into a
// generated document. jsPDF embeds <img> sources at their NATIVE pixel
// resolution regardless of CSS display size — a high-resolution uploaded
// logo can balloon an export to tens of megabytes. Resize before embedding.
export interface CompressedImage {
  base64: string;   // base64 without the data-URL prefix
  dataUrl: string;  // full data-URL
  buffer: ArrayBuffer;
  w: number;         // actual pixel width after resize
  h: number;         // actual pixel height after resize
}

export async function compressImage(
  url: string,
  maxW: number,
  maxH: number,
  quality = 0.72,
  mimeType: 'image/jpeg' | 'image/png' = 'image/jpeg',
): Promise<CompressedImage | null> {
  return new Promise(resolve => {
    const img = new Image();
    img.crossOrigin = 'anonymous';

    img.onload = () => {
      const ratio = Math.min(maxW / img.naturalWidth, maxH / img.naturalHeight, 1);
      const w = Math.round(img.naturalWidth * ratio);
      const h = Math.round(img.naturalHeight * ratio);

      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      canvas.getContext('2d')!.drawImage(img, 0, 0, w, h);

      const dataUrl = canvas.toDataURL(mimeType, quality);
      const base64 = dataUrl.split(',')[1];

      const bin = atob(base64);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);

      resolve({ base64, dataUrl, buffer: bytes.buffer, w, h });
    };

    img.onerror = () => resolve(null);
    img.src = url;
  });
}
