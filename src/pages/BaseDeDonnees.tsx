// « Base de données » du cabinet (mini-Notion) : pages imbriquées, éditeur de blocs et bases de données
// (tableaux typés comme « Fabricants »). Route /base-de-donnees/:pageId?. API : server/routes/knowledgeBase.ts.
import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { AnimatePresence } from 'motion/react';
import { IconDatabase, IconMenu2, IconUpload } from '@tabler/icons-react';
import { useTranslation } from 'react-i18next';
import type { KbPage } from '../lib/kb';
import { kbApi } from '../lib/kbApi';
import { kbBreadcrumb } from '../lib/kbTree';
import { useToastWithUndo } from '../hooks/useToastWithUndo';
import { useConfirmDialog } from '../components/ui/ConfirmDialog';
import { Toast } from '../components/ui/Toast';
import { ErrorState, ListSkeleton } from '../components/DataState';
import { KbImportDialog } from '../components/kb/KbImportDialog';
import { KbSidebar } from '../components/kb/KbSidebar';
import { KbPageView } from '../components/kb/KbPageView';

const PRODUCT_TAGS: Array<{ label: string; color: 'bleu' | 'brique' | 'ocre' | 'gris' }> = [
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
  const [navOpen, setNavOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);

  const errorText = (e: any) => e?.message || (t('kb_error_generic') as string);
  const openPage = useCallback((id: string | null) => {
    setNavOpen(false);
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

  if (treeLoading) return <ListSkeleton rows={6} />;
  if (treeFailed) return <ErrorState onRetry={() => { setTreeLoading(true); void loadTree(); }} />;

  return (
    <div className="lg:grid lg:grid-cols-[16rem_minmax(0,1fr)] lg:gap-6 items-start">
      <button
        type="button"
        onClick={() => setNavOpen(v => !v)}
        aria-expanded={navOpen}
        className="btn btn-secondary mb-3 inline-flex items-center gap-1.5 lg:hidden"
      >
        <IconMenu2 size={16} aria-hidden />{t('kb_toggle_pages')}
      </button>
      <aside className={`${navOpen ? 'block' : 'hidden'} lg:block mb-4 lg:mb-0 lg:sticky lg:top-4 lg:max-h-[calc(100dvh-6rem)] lg:overflow-y-auto`}>
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
      </aside>

      <main className="min-w-0">
        {pageId && pageLoading && <ListSkeleton rows={4} />}
        {pageId && pageFailed && <ErrorState message={t('kb_page_missing') as string} onRetry={() => openPage(null)} />}
        {pageId && page && !pageLoading && !pageFailed && (
          <KbPageView
            key={page.id}
            page={page}
            pages={pages}
            onOpen={openPage}
            onLocalChange={patch => updateLocal(page.id, patch)}
            onTrash={target => void trash(target)}
          />
        )}
        {!pageId && (
          <section className="card p-6 max-w-2xl" aria-label={t('kb_welcome_title') as string}>
            <div className="flex items-center gap-2 mb-2">
              <IconDatabase size={20} aria-hidden style={{ color: 'var(--tblr-primary)' }} />
              <h1 className="text-[1.25rem] font-semibold" style={{ color: 'var(--tblr-text)' }}>{t('kb_welcome_title')}</h1>
            </div>
            <p className="mb-4" style={{ color: 'var(--tblr-muted)' }}>{t('kb_welcome_text')}</p>
            <div className="flex flex-wrap gap-2">
              <button type="button" onClick={() => void create('page', null)} className="btn btn-primary">{t('kb_new_page')}</button>
              <button type="button" onClick={() => void create('database', null)} className="btn btn-secondary">{t('kb_new_database')}</button>
              <button type="button" onClick={() => setImportOpen(true)} className="btn btn-secondary inline-flex items-center gap-1.5" aria-haspopup="dialog">
                <IconUpload size={16} aria-hidden />{t('kb_import_file')}
              </button>
            </div>
            <h2 className="mt-6 mb-2 text-[0.6875rem] font-semibold uppercase tracking-wider" style={{ color: 'var(--tblr-muted)' }}>{t('kb_templates')}</h2>
            <div className="flex flex-wrap gap-2">
              <button type="button" onClick={() => void createFabricants()} className="btn btn-secondary">{t('kb_template_fabricants')}</button>
              <button type="button" onClick={() => void createDetails()} className="btn btn-secondary">{t('kb_template_details')}</button>
            </div>
          </section>
        )}
      </main>

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
