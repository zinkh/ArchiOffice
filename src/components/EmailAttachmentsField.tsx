// Pièces jointes d'un mail envoyé depuis l'application — fichier local, ou
// document déjà déposé sur l'affaire/la fiche (facture PDF, annonce d'appel
// d'offres...) sans avoir à le retélécharger puis le rejoindre à la main.
// Générique : câblé sur le suivi des sollicitations (TenderDetail.tsx) et
// l'envoi d'une facture (Invoices.tsx).
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { IconPaperclip, IconFolder, IconX, IconLoader2, IconFileText, IconAlertTriangle } from '@tabler/icons-react';
import {
  type EmailAttachment, type AttachableDocument,
  fileToEmailAttachment, documentToEmailAttachment, fetchAttachableDocuments,
  totalAttachmentsBytes, MAX_EMAIL_ATTACHMENTS_BYTES,
} from '../lib/emailAttachments';

interface EmailAttachmentsFieldProps {
  attachments: EmailAttachment[];
  onChange: (next: EmailAttachment[]) => void;
  documentsQuery?: { project_id?: string; resource_type?: string; resource_id?: string };
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} o`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} Ko`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} Mo`;
}

export default function EmailAttachmentsField({ attachments, onChange, documentsQuery }: EmailAttachmentsFieldProps) {
  const { t } = useTranslation();
  const [pickerOpen, setPickerOpen] = useState(false);
  const [documents, setDocuments] = useState<AttachableDocument[] | null>(null);
  const [loadingDocs, setLoadingDocs] = useState(false);
  const [busyDocId, setBusyDocId] = useState<string | null>(null);
  const [addingFiles, setAddingFiles] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canPickDocuments = !!(documentsQuery?.project_id || (documentsQuery?.resource_type && documentsQuery?.resource_id));

  const handleFiles = async (files: FileList | null) => {
    if (!files?.length) return;
    setAddingFiles(true);
    setError(null);
    try {
      const converted = await Promise.all(Array.from(files).map(fileToEmailAttachment));
      onChange([...attachments, ...converted]);
    } catch (err: any) {
      setError(err?.message || t('email_attachments_error'));
    } finally {
      setAddingFiles(false);
    }
  };

  const togglePicker = async () => {
    const next = !pickerOpen;
    setPickerOpen(next);
    if (next && documents === null && documentsQuery) {
      setLoadingDocs(true);
      try {
        setDocuments(await fetchAttachableDocuments(documentsQuery));
      } catch (err: any) {
        setError(err?.message || t('email_attachments_error'));
        setDocuments([]);
      } finally {
        setLoadingDocs(false);
      }
    }
  };

  const addDocument = async (doc: AttachableDocument) => {
    setBusyDocId(doc.id);
    setError(null);
    try {
      const attachment = await documentToEmailAttachment(doc);
      onChange([...attachments, attachment]);
    } catch (err: any) {
      setError(err?.message || t('email_attachments_error'));
    } finally {
      setBusyDocId(null);
    }
  };

  const removeAt = (idx: number) => onChange(attachments.filter((_, i) => i !== idx));

  const totalBytes = totalAttachmentsBytes(attachments);
  const alreadyAttached = new Set(attachments.map(a => a.filename));

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 flex-wrap">
        <label className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium cursor-pointer" style={{ border: '1px solid var(--tblr-border)', color: 'var(--tblr-text)' }}>
          {addingFiles ? <IconLoader2 size={13} className="animate-spin" /> : <IconPaperclip size={13} />}
          {t('email_attachments_add_file')}
          <input type="file" multiple hidden disabled={addingFiles} onChange={e => { handleFiles(e.target.files); e.target.value = ''; }} />
        </label>
        {canPickDocuments && (
          <button type="button" onClick={togglePicker}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium"
            style={pickerOpen
              ? { background: 'var(--tblr-primary-lt)', color: 'var(--tblr-primary)', border: '1px solid var(--tblr-primary)' }
              : { border: '1px solid var(--tblr-border)', color: 'var(--tblr-text)' }}>
            <IconFolder size={13} /> {t('email_attachments_add_document')}
          </button>
        )}
      </div>

      {pickerOpen && canPickDocuments && (
        <div className="rounded-lg p-2 space-y-1 max-h-48 overflow-y-auto" style={{ border: '1px solid var(--tblr-border)', background: 'var(--tblr-bg)' }}>
          {loadingDocs && <p className="text-xs flex items-center gap-1.5 px-1" style={{ color: 'var(--tblr-muted)' }}><IconLoader2 size={12} className="animate-spin" /> {t('loading')}</p>}
          {!loadingDocs && documents?.length === 0 && <p className="text-xs italic px-1" style={{ color: 'var(--tblr-muted)' }}>{t('email_attachments_no_documents')}</p>}
          {!loadingDocs && documents?.map(doc => {
            const attached = alreadyAttached.has(doc.name);
            const busy = busyDocId === doc.id;
            return (
              <button
                key={doc.id}
                type="button"
                disabled={attached || busy}
                onClick={() => addDocument(doc)}
                className="w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-left text-xs disabled:opacity-60"
                style={{ color: 'var(--tblr-text)' }}
              >
                {busy ? <IconLoader2 size={13} className="animate-spin shrink-0" /> : <IconFileText size={13} className="shrink-0" style={{ color: 'var(--tblr-muted)' }} />}
                <span className="truncate flex-1">{doc.name}</span>
                {attached && <span className="text-[0.6875rem] shrink-0" style={{ color: 'var(--tblr-muted)' }}>{t('email_attachments_already_added')}</span>}
              </button>
            );
          })}
        </div>
      )}

      {attachments.length > 0 && (
        <div className="flex items-center gap-1.5 flex-wrap">
          {attachments.map((a, i) => (
            <span key={i} className="flex items-center gap-1.5 text-xs px-2 py-1 rounded-lg" style={{ background: 'var(--tblr-bg)', color: 'var(--tblr-muted)' }}>
              {a.filename}
              <button type="button" onClick={() => removeAt(i)} style={{ color: 'var(--tblr-muted)' }}><IconX size={11} /></button>
            </span>
          ))}
        </div>
      )}

      {totalBytes > MAX_EMAIL_ATTACHMENTS_BYTES && (
        <p className="text-[0.6875rem] flex items-center gap-1" style={{ color: 'var(--tblr-warning)' }}>
          <IconAlertTriangle size={12} /> {t('email_attachments_size_warning', { size: formatSize(totalBytes) })}
        </p>
      )}
      {error && <p className="text-[0.6875rem] font-medium" style={{ color: 'var(--tblr-danger)' }}>{error}</p>}
    </div>
  );
}
