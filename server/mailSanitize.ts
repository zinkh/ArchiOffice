// Assainit le HTML d'un email avant qu'il n'atteigne le frontend — un corps
// d'email est un contenu non fiable (n'importe quel expéditeur externe peut
// y mettre ce qu'il veut), donc ceci retire tout ce qui pourrait s'exécuter
// ou naviguer hors du cadre d'affichage : scripts, gestionnaires
// d'événements, formulaires, iframes imbriquées, URLs javascript:/data:
// (sauf data: sur <img>, inoffensif — pas de requête réseau).
//
// Défense en profondeur : le frontend (src/components/MailMessageView.tsx)
// affiche systématiquement ce HTML dans une <iframe sandbox="" srcDoc=...>
// sans allow-scripts ni allow-same-origin, qui neutraliserait déjà un script
// qui passerait au travers — les deux couches sont volontairement
// redondantes plutôt que de compter sur une seule.
import sanitizeHtmlLib from 'sanitize-html';

const BLOCKED_IMAGE_PLACEHOLDER =
  'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBTAA7';

// Bloque les images distantes par défaut (mitigation standard anti-pixel-de-
// tracking des clients mail) : l'URL réelle est préservée dans
// data-blocked-src, que le frontend réinjecte dans src si l'utilisateur
// clique explicitement sur "Afficher les images" — voir MailMessageView.tsx.
// Les images cid: (pièces jointes intégrées) ne sont pas résolues dans ce
// lot : limitation connue, documentée plutôt que silencieuse — elles
// s'afficheront cassées.
function blockRemoteImages(tagName: string, attribs: Record<string, string>) {
  if (tagName !== 'img') return { tagName, attribs };
  const src = attribs.src || '';
  if (/^https?:\/\//i.test(src)) {
    return { tagName, attribs: { ...attribs, src: BLOCKED_IMAGE_PLACEHOLDER, 'data-blocked-src': src } };
  }
  return { tagName, attribs };
}

export function sanitizeMailHtml(html: string): string {
  return sanitizeHtmlLib(html, {
    allowedTags: [
      'a', 'b', 'br', 'blockquote', 'div', 'em', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
      'hr', 'i', 'img', 'li', 'ol', 'p', 'pre', 'span', 'strong', 'sub', 'sup',
      'table', 'tbody', 'td', 'th', 'thead', 'tr', 'u', 'ul', 'font', 'small',
    ],
    disallowedTagsMode: 'discard', // script/style/form/iframe/etc. — retirés avec leur contenu
    allowedAttributes: {
      a: ['href', 'title', 'target'],
      img: ['src', 'alt', 'width', 'height', 'data-blocked-src'],
      '*': ['style', 'class', 'align', 'colspan', 'rowspan'],
    },
    allowedSchemes: ['http', 'https', 'mailto'],
    allowedSchemesByTag: { img: ['http', 'https', 'data'] },
    transformTags: { img: blockRemoteImages },
    // `style` reste autorisé sans filtrage des propriétés (y compris
    // position:fixed) : c'est sans risque ici précisément parce que le
    // rendu se fait dans une <iframe sandbox> sans allow-same-origin —
    // le CSS d'un email ne peut affecter que l'intérieur de ce cadre,
    // jamais la page ArchiOffice qui l'englobe.
  });
}
