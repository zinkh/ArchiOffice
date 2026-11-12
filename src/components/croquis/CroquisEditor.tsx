import { useCallback, useEffect, useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { saveAs } from 'file-saver';
import { IconArrowBackUp, IconArrowForwardUp, IconDownload, IconTrash } from '@tabler/icons-react';
import '@fontsource/caveat/500.css';
import type {
  CroquisBackground,
  CroquisElement,
  CroquisScene,
  CroquisShapeType,
  CroquisStyle,
  CroquisTool,
} from '../../types/croquis';
import { BackgroundLoadError, loadBackgroundFromFile, type LoadedBackground } from '../../lib/croquis/background';
import {
  canRedo,
  canUndo,
  createHistory,
  pushHistory,
  redoHistory,
  undoHistory,
  type History,
} from '../../lib/croquis/history';
import {
  createRenderer,
  drawFrame,
  fontOf,
  measureTextWidth,
  renderSceneToCanvas,
  type CroquisRenderer,
} from '../../lib/croquis/render';
import {
  DEFAULT_STYLE,
  HATCH_PRESETS,
  MAX_TEXT_LENGTH,
  SCENE_VERSION,
  applyStyleToElement,
  createElement,
  elementHandles,
  eraseAtPoint,
  isWorthKeeping,
  moveHandle,
  sceneBBox,
  topElementAt,
  translateElement,
  type HatchPresetKey,
} from '../../lib/croquis/scene';
import {
  DEFAULT_VIEW,
  fitView,
  formatZoom,
  panBy,
  pinchMetrics,
  pinchView,
  toScreen,
  toWorld,
  unionBBox,
  zoomAt,
  type PinchMetrics,
  type ViewState,
} from '../../lib/croquis/view';
import CroquisBackgroundPanel from './CroquisBackgroundPanel';
import CroquisStylePanel from './CroquisStylePanel';
import CroquisToolbar, { SHORTCUT_TO_TOOL } from './CroquisToolbar';
import { BAR, ICON_BTN, SEPARATOR, TEXT_BTN } from './ui';

export interface CroquisEditorProps {
  /** Scène au chargement. L'éditeur garde ensuite son propre historique. */
  initialScene: CroquisScene;
  /** Appelé à chaque modification validée (trait terminé, déplacement, annulation...), jamais pendant un geste. */
  onSceneChange: (scene: CroquisScene) => void;
  background: CroquisBackground | null;
  bgOpacity: number;
  onBgOpacityChange: (opacity: number) => void;
  /** Image choisie par l'utilisateur, déjà réduite : à stocker puis à repasser dans `background`. */
  onBackgroundImport: (loaded: LoadedBackground) => void;
  onBackgroundClear: () => void;
  /** Consultation seule : déplacement et zoom de la vue, export, rien d'autre. */
  readOnly?: boolean;
  /** État de l'enregistrement (« Enregistré », « Hors ligne »...), fourni par le parent. */
  statusLabel?: string;
  exportFileName?: string;
  /** Contenu ajouté au panneau Fond (choix d'un plan ou d'une photo de l'affaire). */
  backgroundSlot?: ReactNode;
}

type Action =
  | { type: 'pan'; sx: number; sy: number }
  | { type: 'draw'; el: CroquisElement }
  | { type: 'move'; id: string; base: CroquisElement; startX: number; startY: number; moved: boolean }
  | { type: 'resize'; id: string; idx: number; base: CroquisElement; moved: boolean }
  | { type: 'erase'; removed: number }
  | { type: 'text'; x: number; y: number };

interface TextEdit {
  el: CroquisElement;
  existing: boolean;
  left: number;
  top: number;
  font: string;
  initial: string;
}

interface Live {
  tool: CroquisTool;
  style: CroquisStyle;
  selectedId: string | null;
  background: CroquisBackground | null;
  bgOpacity: number;
  panel: 'background' | 'style' | null;
  readOnly: boolean;
  textEdit: TextEdit | null;
}

type Panel = 'background' | 'style';

const NARROW = 760;
const DOUBLE_TAP_MS = 400;
const TOAST_MS = 2600;

const replaceElement = (list: readonly CroquisElement[], id: string, next: CroquisElement): CroquisElement[] =>
  list.map((e) => (e.id === id ? next : e));

/**
 * Éditeur de croquis : un seul <canvas>, Pointer Events, geste à deux doigts,
 * historique d'annulation. Les éléments sont immuables (voir lib/croquis/scene.ts) ;
 * pendant un geste, l'aperçu vit dans `draftRef` et n'entre dans l'historique qu'à
 * la fin du geste. Tout ce que les gestionnaires d'événements lisent passe par des
 * refs, pour ne jamais travailler sur une valeur périmée.
 */
export default function CroquisEditor({
  initialScene,
  onSceneChange,
  background,
  bgOpacity,
  onBgOpacityChange,
  onBackgroundImport,
  onBackgroundClear,
  readOnly = false,
  statusLabel,
  exportFileName = 'croquis-reunion.png',
  backgroundSlot,
}: CroquisEditorProps) {
  const { t } = useTranslation();

  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const textInputRef = useRef<HTMLInputElement>(null);
  const rendererRef = useRef<CroquisRenderer | null>(null);
  const rafRef = useRef(0);
  const toastTimerRef = useRef(0);

  const [history, setHistory] = useState<History<CroquisElement[]>>(() => createHistory(initialScene.elements));
  const [tool, setTool] = useState<CroquisTool>(readOnly ? 'hand' : 'pen');
  const [style, setStyle] = useState<CroquisStyle>(DEFAULT_STYLE);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [panel, setPanel] = useState<Panel | null>(() =>
    !readOnly && typeof window !== 'undefined' && window.innerWidth >= NARROW ? 'style' : null,
  );
  const [zoomLabel, setZoomLabel] = useState(formatZoom(1));
  const [toast, setToast] = useState('');
  const [textEdit, setTextEdit] = useState<TextEdit | null>(null);

  // La sélection disparaît d'elle-même quand son élément n'existe plus (annulation, gomme).
  const selectedEl = selectedId ? history.present.find((e) => e.id === selectedId) ?? null : null;

  // Miroirs lus par les gestionnaires d'événements (jamais pendant le rendu).
  const historyRef = useRef(history);
  const live = useRef<Live>({ tool, style, selectedId, background, bgOpacity, panel, readOnly, textEdit });
  const onSceneChangeRef = useRef(onSceneChange);
  useLayoutEffect(() => {
    live.current = { tool, style, selectedId: selectedEl?.id ?? null, background, bgOpacity, panel, readOnly, textEdit };
    onSceneChangeRef.current = onSceneChange;
  });

  // État du geste en cours.
  const viewRef = useRef<ViewState>(DEFAULT_VIEW);
  const sizeRef = useRef({ w: 0, h: 0, dpr: 1 });
  const actRef = useRef<Action | null>(null);
  const draftRef = useRef<CroquisElement[] | null>(null);
  const previewActiveRef = useRef(false);
  const pointersRef = useRef(new Map<number, { sx: number; sy: number }>());
  const gestureRef = useRef<PinchMetrics | null>(null);
  const spaceRef = useRef(false);
  const lastTapRef = useRef<{ t: number; id: string } | null>(null);

  // ── Dessin ────────────────────────────────────────────────────────────────

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    const renderer = rendererRef.current;
    if (!canvas || !renderer) return;
    const L = live.current;
    const act = actRef.current;
    drawFrame(renderer, canvas, {
      dpr: sizeRef.current.dpr,
      view: viewRef.current,
      elements: draftRef.current ?? historyRef.current.present,
      extra: act?.type === 'draw' ? act.el : null,
      background: L.background,
      bgOpacity: L.bgOpacity,
      selectedId: L.selectedId,
    });
  }, []);

  const scheduleDraw = useCallback(() => {
    if (rafRef.current) return;
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = 0;
      draw();
    });
  }, [draw]);

  const syncZoomLabel = useCallback(() => setZoomLabel(formatZoom(viewRef.current.zoom)), []);

  const fit = useCallback(() => {
    const { w, h } = sizeRef.current;
    const L = live.current;
    const bgBounds = L.background ? { x: 0, y: 0, w: L.background.width, h: L.background.height } : null;
    const bounds = L.background ? bgBounds : unionBBox(null, sceneBBox(historyRef.current.present));
    const left = w >= NARROW && L.panel === 'style' ? 312 : 0;
    viewRef.current = fitView(bounds, { w, h }, { top: 64, bottom: 74, pad: 16, left });
    syncZoomLabel();
    scheduleDraw();
  }, [scheduleDraw, syncZoomLabel]);

  useEffect(() => {
    scheduleDraw();
  }, [history.present, selectedEl?.id, background, bgOpacity, scheduleDraw]);

  // Le fond change (import, retrait, rechargement) : on recadre. Le premier passage est fait par la mesure initiale.
  const backgroundSeenRef = useRef(false);
  useEffect(() => {
    if (!backgroundSeenRef.current) {
      backgroundSeenRef.current = true;
      return;
    }
    if (sizeRef.current.w > 0) fit();
  }, [background, fit]);

  useEffect(() => {
    const wrap = wrapRef.current;
    const canvas = canvasRef.current;
    if (!wrap || !canvas) return undefined;
    rendererRef.current = createRenderer(canvas);
    let first = true;
    const apply = () => {
      const dpr = Math.max(1, window.devicePixelRatio || 1);
      const w = wrap.clientWidth;
      const h = wrap.clientHeight;
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      sizeRef.current = { w, h, dpr };
      if (first && w > 0) {
        first = false;
        fit();
      } else {
        scheduleDraw();
      }
    };
    const observer = new ResizeObserver(apply);
    observer.observe(wrap);
    apply();
    return () => {
      observer.disconnect();
      cancelAnimationFrame(rafRef.current);
      rafRef.current = 0;
    };
  }, [fit, scheduleDraw]);

  // L'écriture manuscrite n'est pas chargée au premier rendu : on redessine quand elle l'est.
  useEffect(() => {
    document.fonts?.load('500 24px Caveat').then(scheduleDraw).catch(() => undefined);
  }, [scheduleDraw]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;
    const onWheel = (ev: WheelEvent) => {
      ev.preventDefault();
      const r = canvas.getBoundingClientRect();
      const sx = ev.clientX - r.left;
      const sy = ev.clientY - r.top;
      viewRef.current =
        ev.ctrlKey || ev.metaKey
          ? zoomAt(viewRef.current, sx, sy, Math.exp(-ev.deltaY * 0.01))
          : panBy(viewRef.current, -ev.deltaX, -ev.deltaY);
      syncZoomLabel();
      scheduleDraw();
    };
    canvas.addEventListener('wheel', onWheel, { passive: false });
    return () => canvas.removeEventListener('wheel', onWheel);
  }, [scheduleDraw, syncZoomLabel]);

  useEffect(() => () => window.clearTimeout(toastTimerRef.current), []);

  // ── Historique et actions ─────────────────────────────────────────────────

  /** Seul point d'écriture de l'historique : met à jour le miroir, l'état et prévient le parent. */
  const applyHistory = useCallback((update: (h: History<CroquisElement[]>) => History<CroquisElement[]>) => {
    const next = update(historyRef.current);
    if (next === historyRef.current) return;
    historyRef.current = next;
    setHistory(next);
    onSceneChangeRef.current({ version: SCENE_VERSION, elements: next.present });
  }, []);

  const commitElements = useCallback(
    (elements: CroquisElement[]) => applyHistory((h) => pushHistory(h, elements)),
    [applyHistory],
  );

  const undo = useCallback(() => applyHistory(undoHistory), [applyHistory]);
  const redo = useCallback(() => applyHistory(redoHistory), [applyHistory]);

  const showToast = useCallback((message: string) => {
    setToast(message);
    window.clearTimeout(toastTimerRef.current);
    toastTimerRef.current = window.setTimeout(() => setToast(''), TOAST_MS);
  }, []);

  const chooseTool = useCallback((next: CroquisTool) => {
    setTool(next);
    if (next !== 'select') setSelectedId(null);
  }, []);

  const deleteSelected = useCallback((): boolean => {
    const id = live.current.selectedId;
    if (!id) return false;
    applyHistory((h) => pushHistory(h, h.present.filter((e) => e.id !== id)));
    setSelectedId(null);
    return true;
  }, [applyHistory]);

  const clearAll = () => {
    if (historyRef.current.present.length === 0) {
      showToast(t('croquis_already_empty'));
      return;
    }
    commitElements([]);
    setSelectedId(null);
    showToast(t('croquis_cleared'));
  };

  const exportPng = () => {
    const canvas = renderSceneToCanvas({
      elements: historyRef.current.present,
      background: live.current.background,
      bgOpacity: live.current.bgOpacity,
    });
    if (!canvas) {
      showToast(t('croquis_export_failed'));
      return;
    }
    canvas.toBlob((blob) => (blob ? saveAs(blob, exportFileName) : showToast(t('croquis_export_failed'))), 'image/png');
  };

  const importBackground = async (file: File) => {
    try {
      onBackgroundImport(await loadBackgroundFromFile(file));
    } catch (err) {
      showToast(t(err instanceof BackgroundLoadError && err.code === 'not_image' ? 'croquis_not_image' : 'croquis_image_unreadable'));
    }
  };

  // ── Style ─────────────────────────────────────────────────────────────────

  const applyStyle = (patch: Partial<CroquisStyle>) => {
    setStyle((s) => ({ ...s, ...patch }));
    const id = live.current.selectedId;
    if (id) applyHistory((h) => pushHistory(h, h.present.map((e) => (e.id === id ? applyStyleToElement(e, patch) : e))));
  };

  /** Pendant le glissement d'un curseur : aperçu sur l'élément sélectionné, sans étape d'historique. */
  const previewStyle = (patch: Partial<CroquisStyle>) => {
    setStyle((s) => ({ ...s, ...patch }));
    const id = live.current.selectedId;
    if (!id) return;
    previewActiveRef.current = true;
    draftRef.current = historyRef.current.present.map((e) => (e.id === id ? applyStyleToElement(e, patch) : e));
    scheduleDraw();
  };

  const commitPreview = () => {
    if (!previewActiveRef.current) return;
    previewActiveRef.current = false;
    const draft = draftRef.current;
    draftRef.current = null;
    if (draft) commitElements(draft);
  };

  const applyPreset = (key: HatchPresetKey) => {
    applyStyle(HATCH_PRESETS[key]);
    const L = live.current;
    if (!L.selectedId && L.tool !== 'rect' && L.tool !== 'ellipse') setTool('rect');
    showToast(t('croquis_preset_ready', { name: t(`croquis_preset_${key}`) }));
  };

  const syncStyleFromElement = (el: CroquisElement) =>
    setStyle((prev) => ({
      rough: el.rough,
      color: el.color,
      sw: el.sw,
      fill: el.type === 'rect' || el.type === 'ellipse' ? el.fill : prev.fill,
      angle: el.angle,
      gap: el.gap,
    }));

  // ── Texte ─────────────────────────────────────────────────────────────────

  const openText = (el: CroquisElement, existing: boolean) => {
    const view = viewRef.current;
    const at = toScreen(view, el.x1, el.y1);
    if (existing) {
      // Le texte édité est masqué du dessin pendant la saisie.
      draftRef.current = historyRef.current.present.filter((e) => e.id !== el.id);
      scheduleDraw();
    }
    setTextEdit({ el, existing, left: at.x, top: at.y, font: fontOf(el, view.zoom), initial: el.text ?? '' });
  };

  const closeText = () => {
    live.current.textEdit = null;
    draftRef.current = null;
    setTextEdit(null);
    scheduleDraw();
  };

  const commitText = (cancel = false) => {
    const te = live.current.textEdit;
    if (!te) return;
    const value = cancel ? '' : (textInputRef.current?.value ?? te.initial).trim().slice(0, MAX_TEXT_LENGTH);
    closeText();
    if (cancel) return;
    if (te.existing) {
      if (!value) applyHistory((h) => pushHistory(h, h.present.filter((e) => e.id !== te.el.id)));
      else if (value !== te.initial) {
        applyHistory((h) => pushHistory(h, h.present.map((e) => (e.id === te.el.id ? { ...e, text: value } : e))));
      }
    } else if (value) {
      const created: CroquisElement = { ...te.el, text: value };
      applyHistory((h) => pushHistory(h, [...h.present, created]));
    }
  };

  // ── Saisie : Pointer Events ───────────────────────────────────────────────

  const screenPos = (ev: { clientX: number; clientY: number }) => {
    const r = canvasRef.current?.getBoundingClientRect();
    return { sx: ev.clientX - (r?.left ?? 0), sy: ev.clientY - (r?.top ?? 0) };
  };

  const cancelAct = () => {
    actRef.current = null;
    draftRef.current = null;
  };

  const eraseAt = (x: number, y: number) => {
    const source = draftRef.current ?? historyRef.current.present;
    const res = eraseAtPoint(source, x, y, viewRef.current.zoom, measureTextWidth);
    if (!res.removed) return;
    draftRef.current = res.elements;
    const act = actRef.current;
    if (act?.type === 'erase') act.removed += res.removed;
  };

  const handlePointerDown = (ev: ReactPointerEvent<HTMLCanvasElement>) => {
    if (live.current.textEdit) {
      commitText();
      return;
    }
    if (ev.pointerType === 'mouse' && ev.button === 2) return;
    if (sizeRef.current.w < NARROW) setPanel(null);
    try {
      ev.currentTarget.setPointerCapture(ev.pointerId);
    } catch {
      /* la capture est un confort, pas une obligation */
    }
    const { sx, sy } = screenPos(ev);
    const pointers = pointersRef.current;
    pointers.set(ev.pointerId, { sx, sy });

    // Deux doigts : le tracé en cours est annulé, la vue prend la main.
    if (pointers.size === 2) {
      cancelAct();
      const [a, b] = [...pointers.values()];
      gestureRef.current = pinchMetrics(a, b);
      scheduleDraw();
      return;
    }
    if (pointers.size > 2) return;

    const L = live.current;
    const view = viewRef.current;
    const w = toWorld(view, sx, sy);
    if (L.readOnly || L.tool === 'hand' || spaceRef.current || ev.button === 1) {
      actRef.current = { type: 'pan', sx, sy };
      return;
    }
    const elements = historyRef.current.present;

    if (L.tool === 'select') {
      const current = elements.find((e) => e.id === L.selectedId);
      if (current) {
        const radius = 13 / view.zoom;
        const idx = elementHandles(current).findIndex((h) => Math.hypot(h.x - w.x, h.y - w.y) < radius);
        if (idx >= 0) {
          actRef.current = { type: 'resize', id: current.id, idx, base: current, moved: false };
          return;
        }
      }
      const hit = topElementAt(elements, w.x, w.y, view.zoom, measureTextWidth);
      if (hit) {
        setSelectedId(hit.id);
        syncStyleFromElement(hit);
        actRef.current = { type: 'move', id: hit.id, base: hit, startX: w.x, startY: w.y, moved: false };
      } else {
        setSelectedId(null);
      }
      scheduleDraw();
      return;
    }
    if (L.tool === 'eraser') {
      actRef.current = { type: 'erase', removed: 0 };
      eraseAt(w.x, w.y);
      scheduleDraw();
      return;
    }
    if (L.tool === 'text') {
      actRef.current = { type: 'text', x: w.x, y: w.y };
      return;
    }
    setSelectedId(null);
    const shape: CroquisShapeType = L.tool;
    const el = createElement(shape, w.x, w.y, L.style, view.zoom, shape === 'pen' ? { pts: [[w.x, w.y]] } : {});
    actRef.current = { type: 'draw', el };
    scheduleDraw();
  };

  const extendDraw = (act: Extract<Action, { type: 'draw' }>, ev: ReactPointerEvent<HTMLCanvasElement>) => {
    const view = viewRef.current;
    const { el } = act;
    if (el.type === 'pen' && el.pts) {
      // Les événements fusionnés donnent un tracé plus fin que le seul dernier point.
      const native = ev.nativeEvent;
      const events = native.getCoalescedEvents?.() ?? [];
      for (const e of events.length ? events : [native]) {
        const q = screenPos(e);
        const p = toWorld(view, q.sx, q.sy);
        const last = el.pts[el.pts.length - 1];
        if (Math.hypot(p.x - last[0], p.y - last[1]) > 1.5 / view.zoom) el.pts.push([p.x, p.y]);
      }
      return;
    }
    const { sx, sy } = screenPos(ev);
    const p = toWorld(view, sx, sy);
    let x2 = p.x;
    let y2 = p.y;
    if (ev.shiftKey && (el.type === 'rect' || el.type === 'ellipse')) {
      const side = Math.max(Math.abs(p.x - el.x1), Math.abs(p.y - el.y1));
      x2 = el.x1 + side * Math.sign(p.x - el.x1 || 1);
      y2 = el.y1 + side * Math.sign(p.y - el.y1 || 1);
    }
    act.el = { ...el, x2, y2 };
  };

  const handlePointerMove = (ev: ReactPointerEvent<HTMLCanvasElement>) => {
    const pointers = pointersRef.current;
    if (!pointers.has(ev.pointerId)) return;
    const { sx, sy } = screenPos(ev);
    pointers.set(ev.pointerId, { sx, sy });

    if (gestureRef.current && pointers.size >= 2) {
      const [a, b] = [...pointers.values()];
      const next = pinchMetrics(a, b);
      viewRef.current = pinchView(viewRef.current, gestureRef.current, next);
      gestureRef.current = next;
      syncZoomLabel();
      scheduleDraw();
      return;
    }
    const act = actRef.current;
    if (!act) return;
    const view = viewRef.current;
    const w = toWorld(view, sx, sy);
    const present = historyRef.current.present;
    if (act.type === 'pan') {
      viewRef.current = panBy(view, sx - act.sx, sy - act.sy);
      act.sx = sx;
      act.sy = sy;
    } else if (act.type === 'draw') {
      extendDraw(act, ev);
    } else if (act.type === 'move') {
      const dx = w.x - act.startX;
      const dy = w.y - act.startY;
      if (dx || dy) act.moved = true;
      draftRef.current = replaceElement(present, act.id, translateElement(act.base, dx, dy));
    } else if (act.type === 'resize') {
      act.moved = true;
      draftRef.current = replaceElement(present, act.id, moveHandle(act.base, act.idx, w.x, w.y));
    } else if (act.type === 'erase') {
      eraseAt(w.x, w.y);
    }
    scheduleDraw();
  };

  const commitDraft = () => {
    const draft = draftRef.current;
    draftRef.current = null;
    if (draft) commitElements(draft);
  };

  const handlePointerUp = (ev: ReactPointerEvent<HTMLCanvasElement>) => {
    const pointers = pointersRef.current;
    if (!pointers.has(ev.pointerId)) return;
    pointers.delete(ev.pointerId);
    if (gestureRef.current) {
      if (pointers.size < 2) gestureRef.current = null;
      if (pointers.size === 0) actRef.current = null;
      return;
    }
    const act = actRef.current;
    actRef.current = null;
    if (!act) return;
    const view = viewRef.current;

    if (act.type === 'draw') {
      if (isWorthKeeping(act.el, view.zoom)) {
        // Le brouillon du crayon est mutable : on fige une copie avant de l'entrer dans l'historique.
        const finished = act.el.pts ? { ...act.el, pts: [...act.el.pts] } : act.el;
        applyHistory((h) => pushHistory(h, [...h.present, finished]));
      }
    } else if (act.type === 'move') {
      if (act.moved) {
        commitDraft();
      } else {
        // Un second appui rapide sur un texte sélectionné le rouvre pour modification.
        const now = performance.now();
        const last = lastTapRef.current;
        if (act.base.type === 'text' && last && last.id === act.id && now - last.t < DOUBLE_TAP_MS) {
          lastTapRef.current = null;
          openText(act.base, true);
        } else {
          lastTapRef.current = { t: now, id: act.id };
        }
      }
    } else if (act.type === 'resize') {
      if (act.moved) commitDraft();
    } else if (act.type === 'erase') {
      if (act.removed) commitDraft();
    } else if (act.type === 'text') {
      openText(createElement('text', act.x, act.y, live.current.style, view.zoom), false);
    }
    if (!live.current.textEdit && !previewActiveRef.current) draftRef.current = null;
    scheduleDraw();
  };

  const handlePointerCancel = (ev: ReactPointerEvent<HTMLCanvasElement>) => {
    pointersRef.current.delete(ev.pointerId);
    if (pointersRef.current.size < 2) gestureRef.current = null;
    cancelAct();
    scheduleDraw();
  };

  // ── Clavier ───────────────────────────────────────────────────────────────

  useEffect(() => {
    const onKeyDown = (ev: KeyboardEvent) => {
      if (live.current.textEdit) return;
      const target = ev.target as HTMLElement | null;
      if (target && (/^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName) || target.isContentEditable)) return;
      if (ev.code === 'Space') {
        if (target?.tagName === 'BUTTON') return;
        spaceRef.current = true;
        ev.preventDefault();
        return;
      }
      if (live.current.readOnly) return;
      const key = ev.key.toLowerCase();
      if ((ev.ctrlKey || ev.metaKey) && key === 'z') {
        ev.preventDefault();
        if (ev.shiftKey) redo();
        else undo();
        return;
      }
      if ((ev.ctrlKey || ev.metaKey) && key === 'y') {
        ev.preventDefault();
        redo();
        return;
      }
      if (ev.ctrlKey || ev.metaKey || ev.altKey) return;
      if ((ev.key === 'Delete' || ev.key === 'Backspace') && deleteSelected()) {
        ev.preventDefault();
        return;
      }
      if (ev.key === 'Escape') {
        setSelectedId(null);
        return;
      }
      const next = SHORTCUT_TO_TOOL[key];
      if (next) chooseTool(next);
    };
    const onKeyUp = (ev: KeyboardEvent) => {
      if (ev.code === 'Space') spaceRef.current = false;
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
    };
  }, [chooseTool, deleteSelected, redo, undo]);

  // ── Rendu ─────────────────────────────────────────────────────────────────

  const togglePanel = (name: Panel) => setPanel((p) => (p === name ? null : name));
  const cursor = tool === 'hand' ? 'cursor-grab' : tool === 'select' ? 'cursor-default' : tool === 'text' ? 'cursor-text' : 'cursor-crosshair';

  return (
    <div ref={wrapRef} className="relative h-full min-h-72 w-full select-none overflow-hidden bg-white">
      <canvas
        ref={canvasRef}
        aria-label={t('croquis_editor_label')}
        className={`absolute inset-0 h-full w-full touch-none ${cursor}`}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerCancel}
        onContextMenu={(ev) => ev.preventDefault()}
      />

      {!readOnly && (
        <div className={`${BAR} left-2.5 top-2.5`}>
          <button
            type="button"
            className={TEXT_BTN}
            aria-expanded={panel === 'background'}
            aria-controls="croquis-panel-bg"
            onClick={() => togglePanel('background')}
          >
            {t('croquis_panel_background')}
          </button>
          <button
            type="button"
            className={TEXT_BTN}
            aria-expanded={panel === 'style'}
            aria-controls="croquis-panel-style"
            onClick={() => togglePanel('style')}
          >
            {t('croquis_panel_style')}
          </button>
        </div>
      )}

      <div className={`${BAR} right-2.5 top-2.5`}>
        {!readOnly && (
          <>
            <button
              type="button"
              className={ICON_BTN}
              disabled={!canUndo(history)}
              aria-label={t('croquis_undo')}
              title={`${t('croquis_undo')} (Ctrl+Z)`}
              onClick={undo}
            >
              <IconArrowBackUp size={20} stroke={1.6} aria-hidden />
            </button>
            <button
              type="button"
              className={ICON_BTN}
              disabled={!canRedo(history)}
              aria-label={t('croquis_redo')}
              title={`${t('croquis_redo')} (Ctrl+Maj+Z)`}
              onClick={redo}
            >
              <IconArrowForwardUp size={20} stroke={1.6} aria-hidden />
            </button>
          </>
        )}
        <button
          type="button"
          className="h-11 min-w-[52px] rounded-lg px-2 font-mono text-xs tabular-nums text-neutral-900 hover:bg-neutral-200/70 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neutral-900 max-[440px]:hidden"
          aria-label={t('croquis_fit')}
          title={t('croquis_fit')}
          onClick={fit}
        >
          {zoomLabel}
        </button>
        <span className={`${SEPARATOR} max-[440px]:hidden`} aria-hidden="true" />
        {!readOnly && (
          <button type="button" className={ICON_BTN} aria-label={t('croquis_clear')} title={t('croquis_clear')} onClick={clearAll}>
            <IconTrash size={20} stroke={1.6} aria-hidden />
          </button>
        )}
        <button
          type="button"
          className={ICON_BTN}
          aria-label={t('croquis_export_png')}
          title={t('croquis_export_png')}
          onClick={exportPng}
        >
          <IconDownload size={20} stroke={1.6} aria-hidden />
        </button>
      </div>

      {statusLabel && (
        <div
          role="status"
          aria-live="polite"
          className="pointer-events-none absolute right-3 top-16 rounded-md bg-white/85 px-2 py-0.5 text-[11.5px] text-neutral-500"
        >
          {statusLabel}
        </div>
      )}

      {!readOnly && panel === 'background' && (
        <CroquisBackgroundPanel
          hasBackground={background !== null}
          opacity={bgOpacity}
          onOpacity={onBgOpacityChange}
          onImport={importBackground}
          onClear={onBackgroundClear}
        >
          {backgroundSlot}
        </CroquisBackgroundPanel>
      )}
      {!readOnly && panel === 'style' && (
        <CroquisStylePanel
          style={style}
          onChange={applyStyle}
          onPreview={previewStyle}
          onCommit={commitPreview}
          onPreset={applyPreset}
        />
      )}

      {!readOnly && <CroquisToolbar tool={tool} onTool={chooseTool} />}

      {textEdit && (
        <input
          ref={textInputRef}
          type="text"
          autoFocus
          maxLength={MAX_TEXT_LENGTH}
          defaultValue={textEdit.initial}
          aria-label={t('croquis_text_aria')}
          style={{
            left: textEdit.left,
            top: textEdit.top,
            font: textEdit.font,
            color: textEdit.el.color,
            lineHeight: 1.2,
            width: '16rem',
            maxWidth: `calc(100% - ${Math.round(textEdit.left) + 12}px)`,
          }}
          className="absolute m-0 min-w-16 select-text border-0 border-b border-dashed border-neutral-500 bg-transparent p-0 outline-none"
          onKeyDown={(ev) => {
            ev.stopPropagation();
            if (ev.key === 'Enter') commitText();
            else if (ev.key === 'Escape') commitText(true);
          }}
          onBlur={() => commitText()}
        />
      )}

      <div
        role="status"
        aria-live="polite"
        className={`pointer-events-none absolute bottom-20 left-1/2 max-w-[calc(100%-2rem)] -translate-x-1/2 rounded-lg bg-neutral-900 px-3 py-2 text-[13px] text-white transition-opacity motion-reduce:transition-none ${toast ? 'opacity-100' : 'opacity-0'}`}
      >
        {toast}
      </div>
    </div>
  );
}
