// « Base de données » du cabinet (mini-Notion) : pages imbriquées, éditeur de blocs et bases de données
// (tableaux typés comme « Fabricants »). Route /base-de-donnees/:pageId?. API : server/routes/knowledgeBase.ts.
import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { AnimatePresence, motion } from 'motion/react';
import { IconDatabase, IconFilePlus, IconFileText, IconLayoutSidebar, IconTable, IconUpload } from '@tabler/icons-react';
import { useTranslation } from 'react-i18next';
import type { KbPage } from '../lib/kb';
import { kbApi } from '../lib/kbApi';
import { buildKbTree, kbBreadcrumb } from '../lib/kbTree';
import { useToastWithUndo } from '../hooks/useToastWithUndo';
import { useConfirmDialog } from '../components/ui/ConfirmDialog';
import { Toast } from '../components/ui/Toast';
import { ErrorState, ListSkeleton } from '../components/DataState';
import { KbImportDialog } from '../components/kb/KbImportDialog';
import { KbSidebar } from '../components/kb/KbSidebar';
import { KbPageView } from '../components/kb/KbPageView';

const NAV_KEY = 'kb:nav-open';

const PRODUCT_TAGS:Array<{ label: string; color: 'bleu' | 'brique' | 'ocre' | 'gris' }> = [
  { label: 'Construction vitrée', color: 'bleu' },
  { label: 'Pavés de verre', color: 'brique' },
  { label: 'Menuiseries extérieures', color: 'ocre' },
  { label: 'Structure métallique', color: 'gris' },
];

export default function BaseDeDonnees() {
  const { t } = useTranslation();
  const { pageId } = useParams();
  const navigate = useNavigate();
  const { toast, showToast } = useToastWithUndo();
  const { confirm, dialog } = useConfirmDialog();

  const [pages, setPages] = useState<KbPage[]>([]);
  const [treeLoading, setTreeLoading] = useState(true);
  const [treeFailed, setTreeFailed] = useState(false);
  const [page, setPage] = useState<KbPage | null>(null);
  const [pageLoading, setPageLoading] = useState(false);
  const [pageFailed, setPageFailed] = useState(false);
  // Volet des pages replié par défaut (surface épurée) ; le choix est mémorisé dans le navigateur (confort seulement).
  const [navOpen, setNavOpen] = useState(() => {
    try { return localStorage.getItem(NAV_KEY) === '1'; } catch { return false; }
  });
  const toggleNav = () => setNavOpen(open => {
    try { localStorage.setItem(NAV_KEY, open ? '0' : '1'); } catch { /* confort seulement */ }
    return !open;
  });
  const [importOpen, setImportOpen] = useState(false);

  const errorText = (e: any) => e?.message || (t('kb_error_generic') as string);
  const openPage = useCallback((id: string | null) => {
    // Sur téléphone le volet recouvre la page : il se referme à l'ouverture d'une page. Au bureau il reste en place.
    if (window.matchMedia?.('(max-width: 1023px)').matches) setNavOpen(false);
    navigate(id ? `/base-de-donnees/${id}` : '/base-de-donnees');
  }, [navigate]);

  // Modifications faites à l'écran et pas encore vues du serveur (enregistrement automatique en attente) :
  // une relecture de l'arbre ne doit pas les écraser (titre tapé puis sous-page créée aussitôt).
  const localEdits = useRef(new Map<string, Partial<KbPage>>());

  const loadTree = useCallback(async () => {
    try {
      const fresh = await kbApi.tree();
      setPages(fresh.map(p => {
        const edit = localEdits.current.get(p.id);
        if (!edit) return p;
        const stale = (Object.keys(edit) as Array<keyof KbPage>).some(k => edit[k] !== p[k]);
        if (!stale) { localEdits.current.delete(p.id); return p; }
        return { ...p, ...edit };
      }));
      setTreeFailed(false);
    } catch { setTreeFailed(true); }
    finally { setTreeLoading(false); }
  }, []);

  useEffect(() => { void loadTree(); }, [loadTree]);

  useEffect(() => {
    if (!pageId) { setPage(null); setPageFailed(false); return; }
    let cancelled = false;
    setPageLoading(true);
    setPageFailed(false);
    kbApi.getPage(pageId)
      .then(data => { if (!cancelled) setPage(data); })
      .catch(() => { if (!cancelled) { setPage(null); setPageFailed(true); } })
      .finally(() => { if (!cancelled) setPageLoading(false); });
    return () => { cancelled = true; };
  }, [pageId]);

  const updateLocal = (id: string, patch: Partial<KbPage>) => {
    localEdits.current.set(id, { ...localEdits.current.get(id), ...patch });
    setPages(prev => prev.map(p => (p.id === id ? { ...p, ...patch } : p)));
  };

  const create = async (kind: 'page' | 'database', parentId: string | null) => {
    try {
      const created = await kbApi.createPage({ kind, parent_id: parentId, title: '' });
      await loadTree();
      openPage(created.id);
    } catch (e: any) { showToast(errorText(e), 'error'); }
  };

  /** Modèle « Fabricants » : la base de la capture Notion (Nom, Produits en étiquettes colorées, Texte). */
  const createFabricants = async () => {
    try {
      const db = await kbApi.createPage({ kind: 'database', title: 'Fabricants', icon: '🏭' });
      await kbApi.createProperty(db.id, { name: 'Produits', type: 'multi_select', options: PRODUCT_TAGS });
      await kbApi.createProperty(db.id, { name: 'Texte', type: 'text' });
      await loadTree();
      openPage(db.id);
    } catch (e: any) { showToast(errorText(e), 'error'); }
  };

  const createDetails = async () => {
    try {
      const created = await kbApi.createPage({ title: 'Détails constructifs', icon: '🧱' });
      await loadTree();
      openPage(created.id);
    } catch (e: any) { showToast(errorText(e), 'error'); }
  };

  const toggleFavorite = async (target: KbPage) => {
    updateLocal(target.id, { is_favorite: !target.is_favorite });
    try { await kbApi.updatePage(target.id, { is_favorite: !target.is_favorite }); }
    catch (e: any) { updateLocal(target.id, { is_favorite: target.is_favorite }); showToast(errorText(e), 'error'); }
  };

  const restore = async (target: KbPage) => {
    try { await kbApi.restorePage(target.id); await loadTree(); }
    catch (e: any) { showToast(errorText(e), 'error'); }
  };

  const trash = async (target: KbPage) => {
    try {
      await kbApi.trashPage(target.id);
      const parentId = kbBreadcrumb(pages, target.id).slice(-2, -1)[0]?.id ?? null;
      const wasOpen = !!pageId && kbBreadcrumb(pages, pageId).some(p => p.id === target.id);
      await loadTree();
      if (wasOpen) openPage(parentId);
      showToast(t('kb_page_trashed') as string, 'success', {
        duration: 6000,
        action: { label: t('kb_undo') as string, onClick: () => { void restore(target); } },
      });
    } catch (e: any) { showToast(errorText(e), 'error'); }
  };

  const deleteForever = async (target: KbPage) => {
    const ok = await confirm({
      title: t('kb_delete_forever_title', { name: target.title || t('kb_untitled') }) as string,
      message: t('kb_delete_forever_message') as string,
      confirmLabel: t('kb_delete_forever') as string,
      cancelLabel: t('kb_cancel') as string,
      tone: 'danger',
    });
    if (!ok) return;
    try { await kbApi.deletePermanently(target.id); await loadTree(); }
    catch (e: any) { showToast(errorText(e), 'error'); }
  };

  const rootPages = buildKbTree(pages).slice(0, 8).map(node => node.page);

  if (treeLoading) return <ListSkeleton rows={6} />;
  if (treeFailed) return <ErrorState onRetry={() => { setTreeLoading(true); void loadTree(); }} />;

  return (
    <div className="kb-canvas">
      <button
        type="button"
        onClick={toggleNav}
        aria-expanded={navOpen}
        className="kb-ghost mb-2"
      >
        <IconLayoutSidebar size={16} aria-hidden />{t('kb_toggle_pages')}
      </button>
      <div className="lg:flex lg:items-start lg:gap-8">
        <AnimatePresence initial={false}>
          {navOpen && (
            <motion.aside
              key="pages"
              initial={{ opacity: 0, x: -14 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -14 }}
              className="mb-4 lg:mb-0 lg:w-60 lg:shrink-0 lg:sticky lg:top-4 lg:max-h-[calc(100dvh-6rem)] lg:overflow-y-auto"
            >
              <KbSidebar
                pages={pages}
                activeId={pageId ?? null}
                onOpen={openPage}
                onCreate={(kind, parentId) => void create(kind, parentId)}
                onToggleFavorite={target => void toggleFavorite(target)}
                onTrash={target => void trash(target)}
                onRestore={target => void restore(target)}
                onDeleteForever={target => void deleteForever(target)}
              />
            </motion.aside>
          )}
        </AnimatePresence>

        <motion.main layout="position" className="min-w-0 flex-1">
          {pageId && pageLoading && <ListSkeleton rows={4} />}
          {pageId && pageFailed && <ErrorState message={t('kb_page_missing') as string} onRetry={() => openPage(null)} />}
          {pageId && page && !pageLoading && !pageFailed && (
            <motion.div
              key={page.id}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              className={`mx-auto w-full ${page.kind === 'database' ? 'max-w-6xl' : 'max-w-[46rem]'}`}
            >
              <KbPageView
                page={page}
                pages={pages}
                onOpen={openPage}
                onLocalChange={patch => updateLocal(page.id, patch)}
                onTrash={target => void trash(target)}
              />
            </motion.div>
          )}
          {!pageId && (
            <motion.section
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              className="mx-auto w-full max-w-[46rem] pt-8"
              aria-label={t('kb_welcome_title') as string}
            >
              <IconDatabase size={28} aria-hidden style={{ color: 'var(--tblr-muted)' }} />
              <h1 className="mt-3 text-[2.25rem] font-bold leading-tight tracking-tight" style={{ color: 'var(--tblr-text)' }}>{t('kb_welcome_title')}</h1>
              <p className="mt-2 mb-6 max-w-xl" style={{ color: 'var(--tblr-muted)' }}>{t('kb_welcome_text')}</p>
              <div className="flex flex-col items-start gap-0.5">
                <button type="button" onClick={() => void create('page', null)} className="kb-ghost" style={{ color: 'var(--tblr-text)' }}>
                  <IconFilePlus size={16} aria-hidden />{t('kb_new_page')}
                </button>
                <button type="button" onClick={() => void create('database', null)} className="kb-ghost" style={{ color: 'var(--tblr-text)' }}>
                  <IconDatabase size={16} aria-hidden />{t('kb_new_database')}
                </button>
                <button type="button" onClick={() => setImportOpen(true)} className="kb-ghost" style={{ color: 'var(--tblr-text)' }} aria-haspopup="dialog">
                  <IconUpload size={16} aria-hidden />{t('kb_import_file')}
                </button>
              </div>
              <h2 className="mt-8 mb-1 px-2.5 text-[0.75rem] font-medium" style={{ color: 'var(--tblr-muted)' }}>{t('kb_templates')}</h2>
              <div className="flex flex-col items-start gap-0.5">
                <button type="button" onClick={() => void createFabricants()} className="kb-ghost" style={{ color: 'var(--tblr-text)' }}><IconTable size={16} aria-hidden />{t('kb_template_fabricants')}</button>
                <button type="button" onClick={() => void createDetails()} className="kb-ghost" style={{ color: 'var(--tblr-text)' }}><IconFileText size={16} aria-hidden />{t('kb_template_details')}</button>
              </div>
              {rootPages.length > 0 && (
                <>
                  <h2 className="mt-8 mb-1 px-2.5 text-[0.75rem] font-medium" style={{ color: 'var(--tblr-muted)' }}>{t('kb_pages')}</h2>
                  <ul className="flex flex-col items-start gap-0.5">
                    {rootPages.map(root => (
                      <li key={root.id}>
                        <button type="button" onClick={() => openPage(root.id)} className="kb-ghost" style={{ color: 'var(--tblr-text)' }}>
                          <span aria-hidden className="w-4 text-center leading-none">{root.icon || (root.kind === 'database' ? '▦' : '▫')}</span>
                          <span className="truncate">{root.title || t('kb_untitled')}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </motion.section>
          )}
        </motion.main>
      </div>

      {dialog}
      <Toast toast={toast} />
      <AnimatePresence>
        {importOpen && (
          <KbImportDialog
            key="import"
            database={null}
            onClose={() => setImportOpen(false)}
            onDone={id => { setImportOpen(false); void loadTree().then(() => openPage(id)); }}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
