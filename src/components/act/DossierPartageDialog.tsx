// Ajout d'un dossier partagé à l'envoi du DCE d'une entreprise : un fichier (zip ou autre)
// téléversé dans les documents de l'affaire, un document déjà présent dans l'affaire, ou un
// lien externe (kDrive, Drive, WeTransfer...). Rien ne part en pièce jointe : l'élément devient
// une pièce du dossier de consultation, téléchargeable depuis l'espace de dépôt de l'entreprise.
import { useEffect, useState } from 'react';
import { IconFolderShare, IconLoader2, IconX } from '@tabler/icons-react';
import { getAccessToken } from '../../lib/authToken';
import { useEscapeKey } from '../../hooks/useEscapeKey';
import { lienExterneValide } from '../../lib/dossierPartageMail';
import type { DocumentDce } from '../../lib/dceIndices';

export interface NouveauPartage {
  libelle: string;
  /** Document de l'affaire (fichier téléversé ou choisi). */
  documentId?: string;
  /** Lien externe, https seulement. */
  url?: string;
}

/** Plafond du téléversement multipart (server/documentUpload.ts) : au-delà, un lien externe. */
export const TAILLE_MAX_TELEVERSEMENT = 50 * 1024 * 1024;

type Onglet = 'televerser' | 'affaire' | 'lien';

const ONGLETS: Array<{ id: Onglet; libelle: string }> = [
  { id: 'televerser', libelle: 'Téléverser un fichier' },
  { id: 'affaire', libelle: 'Document de l\'affaire' },
  { id: 'lien', libelle: 'Lien externe' },
];

const CHAMP = 'w-full text-sm px-3 py-2 border rounded-lg outline-none focus:ring-2 focus:ring-zinc-500';
const CHAMP_STYLE = { background: 'var(--tblr-surface)', borderColor: 'var(--tblr-border)', color: 'var(--tblr-text)' } as const;
const BOUTON_PRIMAIRE = 'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold bg-[var(--tblr-primary)] text-white hover:opacity-90 disabled:opacity-50';

const formatTaille = (o: number) => (o < 1024 * 1024 ? `${Math.max(1, Math.round(o / 1024))} Ko` : `${(o / (1024 * 1024)).toFixed(1)} Mo`);

export default function DossierPartageDialog({ projectId, documents, dejaPartages, onAjouter, onDocumentDepose, onClose }: {
  projectId: string;
  /** Documents de l'affaire proposés dans l'onglet « Document de l'affaire ». */
  documents: DocumentDce[];
  /** Documents déjà partagés dans ce message : ils ne sont plus proposés. */
  dejaPartages: string[];
  onAjouter: (partage: NouveauPartage) => void;
  /** Un fichier vient d'être ajouté aux documents de l'affaire : le parent relit la liste. */
  onDocumentDepose: () => void;
  onClose: () => void;
}) {
  const [onglet, setOnglet] = useState<Onglet>('televerser');
  const [fichier, setFichier] = useState<File | null>(null);
  const [documentId, setDocumentId] = useState('');
  const [libelleLien, setLibelleLien] = useState('');
  const [url, setUrl] = useState('');
  const [enCours, setEnCours] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);
  useEscapeKey(true, onClose);
  useEffect(() => { setErreur(null); }, [onglet]);

  const disponibles = documents.filter(d => !dejaPartages.includes(d.id));

  const televerser = async () => {
    if (!fichier) return;
    if (fichier.size > TAILLE_MAX_TELEVERSEMENT) {
      setErreur(`Ce fichier fait ${formatTaille(fichier.size)} : le téléversement est limité à ${formatTaille(TAILLE_MAX_TELEVERSEMENT)}. Déposez-le sur votre espace externe et utilisez l'onglet « Lien externe ».`);
      return;
    }
    setEnCours(true); setErreur(null);
    try {
      const form = new FormData();
      form.append('file', fichier);
      form.append('project_id', projectId);
      form.append('name', fichier.name);
      form.append('category', 'DCE');
      form.append('phase', 'ACT');
      form.append('description', 'Dossier partagé avec les entreprises, accessible depuis leur espace de dépôt');
      form.append('uploaded_by', 'ACT');
      const token = await getAccessToken();
      const r = await fetch('/api/documents', { method: 'POST', headers: token ? { Authorization: `Bearer ${token}` } : {}, body: form });
      const doc = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(doc?.error || 'Le dépôt du fichier a échoué.');
      onDocumentDepose();
      onAjouter({ libelle: fichier.name, documentId: doc.id });
    } catch (e: any) {
      setErreur(e?.message || 'Le dépôt du fichier a échoué.');
      setEnCours(false);
    }
  };

  const choisirDocument = () => {
    const d = disponibles.find(x => x.id === documentId);
    if (d) onAjouter({ libelle: d.name, documentId: d.id });
  };

  const ajouterLien = () => {
    const valide = lienExterneValide(url);
    if (!valide) { setErreur('Le lien doit commencer par https:// (les liens http, javascript ou data sont refusés).'); return; }
    const libelle = libelleLien.trim() || new URL(valide).hostname;
    onAjouter({ libelle: libelle.slice(0, 200), url: valide });
  };

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-label="Ajouter un dossier partagé"
        className="rounded-xl shadow-xl w-full max-w-md max-h-[88dvh] overflow-y-auto"
        style={{ background: 'var(--tblr-surface)', border: '1px solid var(--tblr-border)' }}
        onClick={e => e.stopPropagation()}>
        <div className="p-4 flex justify-between items-start gap-3" style={{ borderBottom: '1px solid var(--tblr-border)' }}>
          <div>
            <h3 className="text-base font-bold flex items-center gap-2" style={{ color: 'var(--tblr-text)' }}><IconFolderShare size={16} /> Ajouter un dossier</h3>
            <p className="text-[0.6875rem] mt-0.5" style={{ color: 'var(--tblr-muted)' }}>
              Le dossier ne part pas en pièce jointe : l'entreprise le télécharge depuis son espace de dépôt, et le message le cite.
            </p>
          </div>
          <button type="button" onClick={onClose} aria-label="Fermer" style={{ color: 'var(--tblr-muted)' }}><IconX size={18} /></button>
        </div>

        <div className="p-4 space-y-3 text-sm" style={{ color: 'var(--tblr-text)' }}>
          <div role="tablist" aria-label="Origine du dossier" className="flex gap-1.5 flex-wrap">
            {ONGLETS.map(o => (
              <button key={o.id} type="button" role="tab" aria-selected={onglet === o.id} onClick={() => setOnglet(o.id)}
                className="px-2.5 py-1.5 rounded-lg text-xs font-medium"
                style={onglet === o.id
                  ? { background: 'var(--tblr-primary-lt)', color: 'var(--tblr-primary)', border: '1px solid var(--tblr-primary)' }
                  : { border: '1px solid var(--tblr-border)', color: 'var(--tblr-muted)' }}>
                {o.libelle}
              </button>
            ))}
          </div>

          {onglet === 'televerser' && (
            <div className="space-y-2">
              <label className="block text-[0.6875rem] font-semibold" style={{ color: 'var(--tblr-muted)' }} htmlFor="dossier-fichier">Fichier (zip ou autre, {formatTaille(TAILLE_MAX_TELEVERSEMENT)} au plus)</label>
              <input id="dossier-fichier" type="file" className="block w-full text-xs"
                onChange={e => { setFichier(e.target.files?.[0] ?? null); setErreur(null); }} />
              <p className="text-[0.6875rem]" style={{ color: 'var(--tblr-muted)' }}>Le fichier est enregistré dans les documents de l'affaire (catégorie DCE).</p>
              <button type="button" className={BOUTON_PRIMAIRE} disabled={!fichier || enCours} onClick={televerser}>
                {enCours && <IconLoader2 size={13} className="animate-spin" />} Téléverser et ajouter
              </button>
            </div>
          )}

          {onglet === 'affaire' && (
            <div className="space-y-2">
              <label className="block text-[0.6875rem] font-semibold" style={{ color: 'var(--tblr-muted)' }} htmlFor="dossier-document">Document de l'affaire</label>
              <select id="dossier-document" value={documentId} onChange={e => setDocumentId(e.target.value)} className={CHAMP} style={CHAMP_STYLE}>
                <option value="">{disponibles.length ? 'Choisir un document…' : 'Aucun document disponible'}</option>
                {disponibles.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
              </select>
              <button type="button" className={BOUTON_PRIMAIRE} disabled={!documentId} onClick={choisirDocument}>Ajouter</button>
            </div>
          )}

          {onglet === 'lien' && (
            <div className="space-y-2">
              <label className="block text-[0.6875rem] font-semibold" style={{ color: 'var(--tblr-muted)' }} htmlFor="dossier-lien-libelle">Libellé</label>
              <input id="dossier-lien-libelle" value={libelleLien} maxLength={200} onChange={e => setLibelleLien(e.target.value)}
                placeholder="Plans du DCE (kDrive)" className={CHAMP} style={CHAMP_STYLE} />
              <label className="block text-[0.6875rem] font-semibold" style={{ color: 'var(--tblr-muted)' }} htmlFor="dossier-lien-url">Lien (https)</label>
              <input id="dossier-lien-url" value={url} inputMode="url" onChange={e => { setUrl(e.target.value); setErreur(null); }}
                placeholder="https://" className={CHAMP} style={CHAMP_STYLE} />
              <button type="button" className={BOUTON_PRIMAIRE} disabled={!url.trim()} onClick={ajouterLien}>Ajouter le lien</button>
            </div>
          )}

          {erreur && <p role="alert" className="text-xs text-red-600 dark:text-red-400">{erreur}</p>}
        </div>
      </div>
    </div>
  );
}
