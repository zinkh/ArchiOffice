import React, { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { parseMarkdown, type Block, type Inline } from './chatMarkdown.js';
import { useAgentChat } from './AgentChat.js';

// Rendu des réponses d'agent (voir chatMarkdown.ts : analyse pure, aucun HTML brut).
// Un lien vers l'application s'ouvre dans l'application, sans recharger la page ; un lien
// externe s'ouvre dans un nouvel onglet.

/** Chemin interne d'un lien vers l'application (même hôte ou archioffice.fr), sinon null. */
export function internalPath(href: string, currentOrigin: string): string | null {
  if (href.startsWith('/') && !href.startsWith('//')) return href;
  try {
    const url = new URL(href);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    const host = url.hostname.toLowerCase();
    const sameApp = url.origin === currentOrigin || host === 'archioffice.fr' || host.endsWith('.archioffice.fr');
    return sameApp ? `${url.pathname}${url.search}${url.hash}` : null;
  } catch {
    return null;
  }
}

const LINK_STYLE: React.CSSProperties = { color: 'var(--tblr-primary)', textDecoration: 'underline', textUnderlineOffset: 2 };

function Inlines({ nodes, onInternal }: { nodes: Inline[]; onInternal: (path: string) => void }) {
  return (
    <>
      {nodes.map((n, i) => {
        switch (n.t) {
          case 'text': return <React.Fragment key={i}>{n.v}</React.Fragment>;
          case 'br': return <br key={i} />;
          case 'code': return <code key={i} className="px-1 rounded text-[12px]" style={{ background: 'var(--tblr-surface)', border: '1px solid var(--tblr-border)' }}>{n.v}</code>;
          case 'bold': return <strong key={i} className="font-semibold"><Inlines nodes={n.c} onInternal={onInternal} /></strong>;
          case 'italic': return <em key={i}><Inlines nodes={n.c} onInternal={onInternal} /></em>;
          case 'del': return <del key={i}><Inlines nodes={n.c} onInternal={onInternal} /></del>;
          case 'link': {
            const path = internalPath(n.href, window.location.origin);
            return (
              <a
                key={i}
                href={path ?? n.href}
                style={LINK_STYLE}
                {...(path
                  ? { onClick: (e: React.MouseEvent) => {
                      // Ctrl/Cmd/Maj/clic milieu : le navigateur ouvre l'adresse dans un autre onglet.
                      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
                      e.preventDefault();
                      onInternal(path);
                    } }
                  : { target: '_blank', rel: 'noopener noreferrer' })}
              >
                <Inlines nodes={n.c} onInternal={onInternal} />
              </a>
            );
          }
        }
      })}
    </>
  );
}

const HEADING_CLASS = ['', 'text-[16px]', 'text-[15px]', 'text-[14px]', 'text-[13px]', 'text-[13px]', 'text-[13px]'];

function Blocks({ blocks, onInternal }: { blocks: Block[]; onInternal: (path: string) => void }) {
  return (
    <>
      {blocks.map((b, i) => {
        switch (b.t) {
          case 'heading':
            return <div key={i} role="heading" aria-level={b.level} className={`font-semibold mt-2 first:mt-0 mb-1 ${HEADING_CLASS[b.level]}`}><Inlines nodes={b.c} onInternal={onInternal} /></div>;
          case 'para':
            return <p key={i} className="my-1.5 first:mt-0 last:mb-0"><Inlines nodes={b.c} onInternal={onInternal} /></p>;
          case 'hr':
            return <hr key={i} className="my-2" style={{ borderColor: 'var(--tblr-border)' }} />;
          case 'code':
            return <pre key={i} className="my-1.5 p-2 rounded-md overflow-x-auto text-[12px] whitespace-pre" style={{ background: 'var(--tblr-surface)', border: '1px solid var(--tblr-border)' }}><code>{b.v}</code></pre>;
          case 'quote':
            return <blockquote key={i} className="my-1.5 pl-3" style={{ borderLeft: '3px solid var(--tblr-border)', color: 'var(--tblr-muted)' }}><Blocks blocks={b.c} onInternal={onInternal} /></blockquote>;
          case 'list': {
            const Tag = b.ordered ? 'ol' : 'ul';
            return (
              <Tag key={i} start={b.ordered ? b.start : undefined} className={`my-1.5 pl-5 ${b.ordered ? 'list-decimal' : 'list-disc'}`}>
                {b.items.map((it, j) => (
                  <li key={j} className="my-0.5">
                    <Inlines nodes={it.c} onInternal={onInternal} />
                    {it.sub.length > 0 && <Blocks blocks={it.sub} onInternal={onInternal} />}
                  </li>
                ))}
              </Tag>
            );
          }
          case 'table':
            return (
              <div key={i} className="my-1.5 overflow-x-auto">
                <table className="text-[12px] border-collapse">
                  <thead>
                    <tr>{b.head.map((h, j) => <th key={j} className="px-2 py-1 text-left font-semibold" style={{ textAlign: b.align[j] ?? undefined, borderBottom: '1px solid var(--tblr-border)' }}><Inlines nodes={h} onInternal={onInternal} /></th>)}</tr>
                  </thead>
                  <tbody>
                    {b.rows.map((r, j) => (
                      <tr key={j}>{r.map((c, k) => <td key={k} className="px-2 py-1 align-top" style={{ textAlign: b.align[k] ?? undefined, borderBottom: '1px solid var(--tblr-border)' }}><Inlines nodes={c} onInternal={onInternal} /></td>)}</tr>
                    ))}
                  </tbody>
                </table>
              </div>
            );
        }
      })}
    </>
  );
}

export function ChatMarkdown({ content }: { content: string }) {
  const navigate = useNavigate();
  const { closeChat } = useAgentChat();
  const blocks = useMemo(() => parseMarkdown(content), [content]);
  // Dans le panneau flottant, suivre un lien referme le panneau pour montrer la page ouverte.
  const onInternal = (path: string) => { closeChat(); navigate(path); };
  return <div className="break-words"><Blocks blocks={blocks} onInternal={onInternal} /></div>;
}
