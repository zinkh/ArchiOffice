// QR code en SVG vectoriel (net à toute taille d'impression), généré sans réseau.
import QRCode from 'qrcode';

/** Zone de silence réglementaire d'un QR code : 4 modules blancs tout autour. */
const QUIET_MODULES = 4;

export function qrSvg(text: string): string {
  const qr = QRCode.create(text, { errorCorrectionLevel: 'M' });
  const n = qr.modules.size;
  const size = n + QUIET_MODULES * 2;
  let path = '';
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      if (qr.modules.get(r, c)) path += `M${c + QUIET_MODULES} ${r + QUIET_MODULES}h1v1h-1z`;
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" shape-rendering="crispEdges"><rect width="${size}" height="${size}" fill="#fff"/><path d="${path}" fill="#000"/></svg>`;
}
