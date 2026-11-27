import { useEffect, useMemo, useState } from 'react';
import { IconX, IconSend, IconCheck, IconEye } from '@tabler/icons-react';
import { apiFetch } from '../../lib/api';
import { ContactAutocomplete } from '../ContactAutocomplete';
import { ContactModal } from '../ContactModal';
import type { Contact, Document, DocumentDiffusion } from '../../types';

import { contactDisplayName as contactDiffusionName } from '../ContactRecipientPicker';

const muted = { color: 'var(--tblr-muted)' } as const;
const card = { background: 'var(--tblr-surface-2)', border: '1px solid var(--tblr-border)' } as const;

/**
 * Diffusion maîtrisée d'un document. Les destinataires se choisissent dans les contacts du cabinet
 * (liste déroulante avec recherche) et un contact absent se crée sur place, sans quitter la fenêtre.
 * Partagé par la vue Documents d'une affaire et par la GED générale.
 */
export function DiffusionDialog({ doc, onClose, onChanged }: { doc: Document; onClose: () => void; onChanged?: () => void }) {
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [chosen, setChosen] = useState<Contact[]>([]);
  const [diffusions, setDiffusions] = useState<DocumentDiffusion[] | null>(null);
  const [pickerKey, setPickerKey] = useState(0);
  const [createWith, setCreateWith] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadDiffusions = async () => {
    try {
      const data = await apiFetch<DocumentDiffusion[]>(`/api/documents/${doc.id}/diffusions`);
      setDiffusions(Array.isArray(data) ? data : []);
    } catch { setDiffusions([]); }
  };

  useEffect(() => {
    let cancelled = false;
    apiFetch<Contact[]>('/api/contacts').then(d => { if (!cancelled) setContacts(Array.isArray(d) ? d : []); }).catch(() => {});
    void loadDiffusions();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc.id]);

  // Un contact déjà choisi ou déjà destinataire de ce document n'est plus proposé.
  const available = useMemo(() => {
    const taken = new Set(chosen.map(c => c.id));
    return contacts.filter(c => !taken.has(c.id));
  }, [contacts, chosen]);

  const choose = (id: string) => {
    const c = contacts.find(x => x.id === id);
    if (c) setChosen(prev => [...prev, c]);
    setPickerKey(k => k + 1);
  };

  const submit = async () => {
    if (!chosen.length) return;
    setBusy(true);
    setError(null);
    try {
      for (const c of chosen) {
        await apiFetch(`/api/documents/${doc.id}/diffusions`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ contact_name: contactDiffusionName(c), contact_email: c.email || null }),
        });
      }
      setChosen([]);
      await loadDiffusions();
      onChanged?.();
    } catch (e: any) {
      setError(e?.message || 'La diffusion n\'a pas pu être enregistrée.');
    } finally { setBusy(false); }
  };

  const acknowledge = async (id: string) => {
    try {
      await apiFetch(`/api/documents/${doc.id}/diffusions/${id}/acknowledge`, { method: 'PATCH' });
      await loadDiffusions();
      onChanged?.();
    } catch (e: any) { setError(e?.message || 'Action impossible.'); }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" role="dialog" aria-modal="true" aria-label="Diffusion maîtrisée">
      <div className="p-6 rounded-lg w-full max-w-lg max-h-[90dvh] overflow-y-auto" style={{ background: 'var(--tblr-surface)', color: 'var(--tblr-text)', border: '1px solid var(--tblr-border)' }}>
        <div className="flex justify-between items-center mb-4">
          <div className="min-w-0">
            <h2 className="text-lg font-bold">Diffusion maîtrisée</h2>
            <p className="text-xs mt-0.5 truncate" style={muted}>{doc.name} · Ind. {doc.indice || 'A'}</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Fermer" className="p-2 rounded-lg" style={muted}><IconX size={20} /></button>
        </div>

        <div className="p-3 rounded-lg mb-4" style={card}>
          <p className="text-xs font-bold mb-2 uppercase" style={muted}>Ajouter un destinataire</p>
          <ContactAutocomplete
            key={pickerKey}
            contacts={available}
            value=""
            onChange={choose}
            onAddNew={query => setCreateWith(query)}
            placeholder="Rechercher un contact de l'agence…"
            addNewLabel="Créer un nouveau contact"
          />
          {chosen.length > 0 && (
            <ul className="mt-3 flex flex-wrap gap-2" aria-label="Destinataires choisis">
              {chosen.map(c => (
                <li key={c.id} className="inline-flex items-center gap-1.5 text-xs rounded-lg px-2 py-1" style={{ background: 'var(--tblr-surface)', border: '1px solid var(--tblr-border)' }}>
                  <span className="font-semibold">{contactDiffusionName(c)}</span>
                  <span style={muted}>{c.email || 'sans e-mail'}</span>
                  <button type="button" aria-label={`Retirer ${contactDiffusionName(c)}`} onClick={() => setChosen(prev => prev.filter(x => x.id !== c.id))} style={muted}><IconX size={12} /></button>
                </li>
              ))}
            </ul>
          )}
          <button type="button" onClick={() => void submit()} disabled={!chosen.length || busy}
            className="btn btn-primary w-full mt-3 disabled:opacity-40">
            <IconSend size={14} className="inline mr-1.5" aria-hidden="true" />
            {busy ? 'Enregistrement…' : `Enregistrer la diffusion${chosen.length > 1 ? ` (${chosen.length})` : ''}`}
          </button>
          {error && <p role="alert" className="text-xs mt-2" style={{ color: 'var(--tblr-danger, #d63939)' }}>{error}</p>}
        </div>

        <p className="text-[0.6875rem] font-bold uppercase tracking-wider mb-2" style={muted}>Historique des diffusions ({diffusions?.length ?? 0})</p>
        {diffusions === null ? <p className="text-sm text-center py-6" style={muted}>Chargement…</p>
          : diffusions.length === 0 ? <p className="text-sm text-center py-6" style={muted}>Aucune diffusion enregistrée</p>
            : (
              <div className="space-y-2">
                {diffusions.map(d => (
                  <div key={d.id} className="flex items-center gap-3 p-3 rounded-lg" style={card}>
                    <div className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0"
                      style={{ background: d.acknowledged_at ? '#d3f9d8' : '#fff4e6', color: d.acknowledged_at ? '#2f9e44' : '#f76707' }}>
                      {d.acknowledged_at ? <IconCheck size={16} /> : <IconEye size={16} />}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold truncate">{d.contact_name}</p>
                      <p className="text-[0.6875rem]" style={muted}>
                        Envoyé le {new Date(d.sent_at).toLocaleDateString('fr-FR')}
                        {d.acknowledged_at && ` · AR le ${new Date(d.acknowledged_at).toLocaleDateString('fr-FR')}`}
                      </p>
                    </div>
                    {!d.acknowledged_at && (
                      <button type="button" onClick={() => void acknowledge(d.id)} className="text-[0.6875rem] font-bold px-2 py-1 rounded-lg shrink-0" style={{ background: '#d3f9d8', color: '#2f9e44' }}>Marquer AR</button>
                    )}
                  </div>
                ))}
              </div>
            )}
      </div>

      <ContactModal
        isOpen={createWith !== null}
        onClose={() => setCreateWith(null)}
        initialData={createWith ? { last_name: createWith } : undefined}
        onSuccess={c => {
          setContacts(prev => [c, ...prev.filter(x => x.id !== c.id)]);
          setChosen(prev => [...prev, c]);
          setCreateWith(null);
        }}
      />
    </div>
  );
}
