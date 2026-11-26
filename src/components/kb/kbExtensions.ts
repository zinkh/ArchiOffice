// Nœuds Tiptap propres à la « Base de données » : image et fichier rattachés à la page. Le fichier reste dans
// le stockage du cabinet (POST /api/documents, resource_type = kb_pages) ; le document ne garde que son
// adresse de stockage, résolue en URL signée à l'affichage (elle expire, on ne la stocke jamais).
import Image from '@tiptap/extension-image';
import { Node, mergeAttributes } from '@tiptap/core';
import { openSignedUrl, resolveSignedUrl } from '../../lib/signedStorageUrl';

/** Image dont la source est une adresse de stockage, résolue à l'affichage. */
export const KbImage = Image.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      fileUrl: {
        default: null,
        parseHTML: (el: HTMLElement) => el.getAttribute('data-file-url'),
        renderHTML: (attrs: Record<string, unknown>) => (attrs.fileUrl ? { 'data-file-url': attrs.fileUrl } : {}),
      },
    };
  },
  addNodeView() {
    return ({ node }) => {
      const img = document.createElement('img');
      img.alt = String(node.attrs.alt || '');
      img.loading = 'lazy';
      const fileUrl = node.attrs.fileUrl as string | null;
      if (fileUrl) {
        void resolveSignedUrl(fileUrl).then(url => { img.src = url; }).catch(() => { img.alt = img.alt || 'Image indisponible'; });
      } else if (node.attrs.src) {
        img.src = String(node.attrs.src);
      }
      return { dom: img };
    };
  },
});

/** Bloc « fichier joint » : une ligne avec le nom du fichier, qui s'ouvre au clic. */
export const KbFile = Node.create({
  name: 'kbFile',
  group: 'block',
  atom: true,
  draggable: true,
  selectable: true,

  addAttributes() {
    return {
      documentId: { default: null },
      fileUrl: { default: null },
      name: { default: '' },
    };
  },
  parseHTML() {
    return [{ tag: 'div[data-type="kb-file"]' }];
  },
  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes({ 'data-type': 'kb-file', class: 'kb-file-block' }, HTMLAttributes)];
  },
  addNodeView() {
    return ({ node }) => {
      const dom = document.createElement('div');
      dom.className = 'kb-file-block';
      dom.setAttribute('data-type', 'kb-file');
      dom.contentEditable = 'false';
      const name = document.createElement('span');
      name.textContent = String(node.attrs.name || 'Fichier');
      name.style.fontWeight = '500';
      const open = document.createElement('button');
      open.type = 'button';
      open.textContent = 'Ouvrir';
      open.className = 'btn btn-secondary';
      open.style.marginLeft = 'auto';
      open.addEventListener('click', event => {
        event.preventDefault();
        const fileUrl = node.attrs.fileUrl as string | null;
        if (fileUrl) void openSignedUrl(fileUrl);
      });
      dom.append(name, open);
      return { dom };
    };
  },
});
