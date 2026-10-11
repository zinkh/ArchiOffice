# Mistral Libraries — anonymous contribution rollout

## Configuration

Existing application secret: `MISTRAL_API_KEY` (DigitalOcean App Platform server secret).
Sandbox library: `01a12a77-dd1c-77eb-84b0-25cac8adccf4`

```env
MISTRAL_KNOWLEDGE_LIBRARY_ID=01a12a77-dd1c-77eb-84b0-25cac8adccf4
MISTRAL_KNOWLEDGE_PUBLISH_ENABLED=false
```

Do not commit or expose the API key. Deploy `supabase/migrate_knowledge_z_mistral_publications.sql` **before** deploying the API changes. Publishing remains disabled until explicitly enabled and privacy/security review completed.

## Workflow

1. An authorized tenant admin opts into *technical knowledge contributions* (not a signup/GDPR acceptance).
2. Select a private PDF/DOCX/XLSX from the tenant. Only extracted text enters a private draft.
3. Manually inspect and revise anonymized text; affirm privacy and ownership/redistribution rights.
4. Review the draft; then separately check *confirmed external transfer* and publish a single excerpt.
5. Server reserves one unique outbox row (tenant/contribution/library) before calling Mistral. Sends only an opaque `archioffice-<uuid>.txt` filename and the reviewed text; **never** the original document or its filename.
6. On a successful upload, saves the remote library/document IDs. A repeated publication returns a conflict without a new upload.
7. If upload outcome is uncertain (timeout or DB error), no blind upload retry; reconciliation searches every page for the unique remote filename.
8. Withdraw consent or delete an excerpt: database triggers mark the remote ID for deletion even if original source document is already deleted. Attempt immediate DELETE; retain a durable outbox for automatic retries every minute and administrator-triggered retry.

All operations are tenant-admin protected. The outbox and notes are service-role-only. No existing files in the library are changed or deleted unless they have an ArchiOffice-managed reservation and remote ID.

**Important operational limitations:** Do not enable production client publication until anonymization is assessed per data category, the Mistral data processing agreement and permissions are verified, retention/deletion and incident response are reviewed, and a live sandbox upload/delete smoke test is completed. An unknown upload outcome can remain pending manual reconciliation; it must never be treated as confirmed erased. API availability and the success of remote deletion are not guaranteed while Mistral is offline. Check the outbox until there are no pending deletion tasks.

## Sandbox acceptance tests

- Confirm the existing test files are still present in Mistral.
- Click **Vérifier la bibliothèque Mistral** to validate key/library access.
- Run the unit tests in `tests/mistralLibrary.test.ts`.
- Opt in in a test tenant; create a fictional PDF/DOCX/XLSX draft, review it, confirm publication.
- Verify its opaque filename, ID and library in the outbox; repeat publish and confirm it refuses a second upload.
- Withdraw consent; verify the indexed document disappears but the manually uploaded test files remain.
- Simulate a transient Mistral failure; verify a pending deletion remains and can be retried.
- Disable `MISTRAL_KNOWLEDGE_PUBLISH_ENABLED` before any production deployment until approval.

## Mistral API

- `POST /v1/libraries/{library_id}/documents` (multipart `file`)
- `GET /v1/libraries/{library_id}/documents` (pagination with `next_page_token`)
- `DELETE /v1/libraries/{library_id}/documents/{document_id}`

Docs: https://docs.mistral.ai/api/endpoint/beta/libraries/documents
