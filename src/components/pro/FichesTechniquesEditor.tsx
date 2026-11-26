import { useEffect, useState } from 'react';
import { IconPaperclip, IconX, IconFileText } from '@tabler/icons-react';
import { apiFetch } from '../../lib/api';
import { openSignedUrl } from '../../lib/signedStorageUrl';
import { estPhoto } from '../../lib/fichePhoto';
import type { FicheTechnique } from '../../types/dpgf';
import {
  ajouterFiches, basculerAnonymisation, envoyerFicheTechnique, marquerAnonymisation, retirerFiche, MAX_FICHES_PAR_POSTE,
} from '../../lib/fichesTechniques';

interface FichesTechniquesEditorProps {
  projectId: string;
  fiches: FicheTechnique[];
  /** Reçoit la liste complète à enregistrer sur le poste. */
  onChange: (fiches: FicheTechnique[]) => void;
}

interface DocumentAffaire { id: string; name: string; file_url: string }

/**
 * Fiches techniques d'un poste : dépôt d'un fichier (rangé dans les documents de l'affaire, catégorie
 * « Fiches techniques ») ou rattachement d'un document déjà présent dans l'affaire. Le poste ne garde
 * que la référence ; retirer une fiche ne supprime jamais le document.
 */
export function FichesTechniquesEditor({ projectId, fiches, onChange }: FichesTechniquesEditorProps) {
  const [envoi, setEnvoi] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);
  const [documents, setDocuments] = useState<DocumentAffaire[] | null>(null);
  // Option d'import : les fiches ajoutées (envoyées ou rattachées) sont marquées « marques anonymisées ».
  const [anonymiserImport, setAnonymiserImport] = useState(false);
  const complet = fiches.length >= MAX_FICHES_PAR_POSTE;

  // Les documents de l'affaire sont lus une fois, pour proposer de les rattacher.
  useEffect(() => {
    if (documents !== null || !projectId) return;
    let annule = false;
    apiFetch<DocumentAffaire[]>(`/api/documents?project_id=${encodeURIComponent(projectId)}`)
      .then(rows => { if (!annule) setDocuments(Array.isArray(rows) ? rows.filter(d => d.file_url) : []); })
      .catch(() => { if (!annule) setDocuments([]); });
    return () => { annule = true; };
  }, [documents, projectId]);

  const deposer = async (fichiers: FileList | null) => {
    if (!fichiers?.length) return;
    setEnvoi(true);
    setErreur(null);
    const envoyees: FicheTechnique[] = [];
    try {
      for (const f of Array.from(fichiers)) envoyees.push(await envoyerFicheTechnique(projectId, f));
    } catch (e: any) {
      setErreur(e?.message || "Échec de l'envoi du fichier.");
    } finally {
      // Les fichiers déjà envoyés sont gardés même si un suivant échoue.
      if (envoyees.length) {
        onChange(ajouterFiches(fiches, marquerAnonymisation(envoyees, anonymiserImport)));
        setDocuments(null);
      }
      setEnvoi(false);
    }
  };

  const rattacher = (documentId: string) => {
    const d = documents?.find(x => x.id === documentId);
    if (d) onChange(ajouterFiches(fiches, marquerAnonymisation([{ id: crypto.randomUUID(), documentId: d.id, fileUrl: d.file_url, nom: d.name }], anonymiserImport)));
  };

  const disponibles = (documents ?? []).filter(d => !fiches.some(f => f.documentId === d.id || f.fileUrl === d.file_url));

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="block text-xs font-bold text-zinc-500 dark:text-zinc-400 uppercase tracking-widest">Fiches techniques</span>
        <label className={`inline-flex items-center gap-1.5 h-8 px-3 rounded border text-xs cursor-pointer hover:bg-[var(--tblr-surface-2)] ${envoi || complet ? 'opacity-60 pointer-events-none' : ''}`} style={{ borderColor: 'var(--tblr-border)' }}>
          <IconPaperclip size={14} aria-hidden />
          {envoi ? 'Envoi…' : 'Joindre une fiche ou une photo'}
          <input type="file" multiple className="sr-only" onChange={e => { void deposer(e.target.files); e.target.value = ''; }} />
        </label>
      </div>
      <label className="flex items-start gap-2 text-xs">
        <input type="checkbox" className="mt-0.5" checked={anonymiserImport} onChange={e => setAnonymiserImport(e.target.checked)} />
        <span>
          Anonymiser les marques de la fiche
          <span className="block text-[0.6875rem] text-zinc-400">
            L'IA décrit le produit par ses performances (« ou équivalent ») sans citer marque, fabricant ni référence commerciale. S'applique aux fiches ajoutées ensuite.
          </span>
        </span>
      </label>
      {disponibles.length > 0 && !complet && (
        <select
          value=""
          onChange={e => { if (e.target.value) rattacher(e.target.value); }}
          aria-label="Rattacher un document de l'affaire"
          className="w-full px-2 py-1.5 text-xs border rounded bg-transparent"
          style={{ borderColor: 'var(--tblr-border)' }}
        >
          <option value="">Rattacher un document de l'affaire…</option>
          {disponibles.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
        </select>
      )}
      {erreur && <p className="text-xs text-red-600" role="alert">{erreur}</p>}
      {fiches.length > 0 ? (
        <ul className="space-y-1">
          {fiches.map(f => (
            <li key={f.id} className="flex items-center gap-2 rounded border px-2 py-1 text-xs" style={{ borderColor: 'var(--tblr-border)' }}>
              <IconFileText size={14} aria-hidden className="shrink-0" />
              <button type="button" onClick={() => { void openSignedUrl(f.fileUrl); }} className="min-w-0 flex-1 truncate text-left hover:underline" title={f.nom}>
                {f.nom}
              </button>
              {estPhoto(f.nom) && <span className="shrink-0 rounded border px-1 text-[0.6875rem]" style={{ borderColor: 'var(--tblr-border)' }}>Photo</span>}
              <label className="inline-flex shrink-0 items-center gap-1 text-[0.6875rem]" title="Les marques de cette fiche ne sont pas citées par l'IA ni dans l'export">
                <input type="checkbox" checked={!!f.anonymiser} onChange={e => onChange(basculerAnonymisation(fiches, f.id, e.target.checked))} aria-label={`Anonymiser les marques de la fiche ${f.nom}`} />
                Anonyme
              </label>
              <button type="button" onClick={() => onChange(retirerFiche(fiches, f.id))} aria-label={`Retirer la fiche ${f.nom}`} className="shrink-0 p-0.5 rounded hover:bg-[var(--tblr-surface-2)]">
                <IconX size={12} aria-hidden />
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-[0.6875rem] text-zinc-400">
          Fiche produit, avis technique ou PV d'essai du poste, ou une photo (existant, produit posé, étiquette) que l'IA décrit pour alimenter le texte du poste avec « Rédiger avec l'IA ». Le fichier est rangé dans les documents de l'affaire ; une photo n'est jamais jointe à l'annexe des fiches techniques.
        </p>
      )}
    </div>
  );
}
