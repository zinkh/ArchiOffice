// Phase 7 extraction — moved out of server.ts's "── Google Contacts sync ──"
// and "── CardDAV sync ──" sections. Both import contacts from an external
// source using tenant-scoped dedup-by-email, then upsert into `contacts`.
import type { Express } from 'express';
import { tenantScopedFrom } from '../tenantScopedFrom';
import { assertPublicHttpUrl } from '../ssrfGuard';

export interface RouteDeps {
  supabaseAdmin: any;
  getTenantId: (userId: string) => Promise<string>;
}

// Shared by the pull loop and the push-side conflict check below, so a
// Google person always maps onto our contacts columns the same way in
// both directions.
function mapGooglePersonToContactFields(person: any) {
  const name = person.names?.[0] || {};
  const email = person.emailAddresses?.[0]?.value || '';
  const phone = person.phoneNumbers?.[0]?.value || '';
  const org = person.organizations?.[0] || {};
  const addr = person.addresses?.[0] || {};
  return {
    first_name: name.givenName || '',
    last_name: name.familyName || '',
    email,
    phone,
    company_name: org.name || '',
    job_title: org.title || '',
    city: addr.city || '',
    zip: addr.postalCode || '',
    country: addr.country || '',
  };
}

// Inverse of the above: what we send TO the Google People API for a local
// contact. Only the same fields the pull direction reads are pushed, so a
// round trip (pull → push → pull) doesn't invent data on either side.
function buildGooglePersonPayload(contact: any) {
  return {
    names: [{ givenName: contact.first_name || '', familyName: contact.last_name || '' }],
    emailAddresses: contact.email ? [{ value: contact.email }] : [],
    phoneNumbers: contact.phone ? [{ value: contact.phone }] : [],
    organizations: (contact.company_name || contact.job_title)
      ? [{ name: contact.company_name || '', title: contact.job_title || '' }] : [],
    addresses: (contact.city || contact.zip || contact.country)
      ? [{ city: contact.city || '', postalCode: contact.zip || '', country: contact.country || '' }] : [],
  };
}

const GOOGLE_PERSON_FIELDS = 'names,emailAddresses,phoneNumbers,organizations,addresses';

export function registerContactSyncRoutes(app: Express, { supabaseAdmin, getTenantId }: RouteDeps) {
  // POST /api/auth/google/token — exchanges the PKCE authorization code
  // (obtained by the popup at src/pages/GoogleAuthCallback.tsx) for a Google
  // access_token, which the frontend then hands to /api/sync/google-contacts
  // below. Called via apiFetch (authenticated) — despite the misleading
  // "public" label this section carried in server.ts, the global auth
  // middleware does require a JWT here, and the frontend does send one; only
  // the OAuth client_secret itself is meant to stay server-side.
  app.post("/api/auth/google/token", async (req: any, res: any) => {
    try {
      const { code, code_verifier, redirect_uri } = req.body;
      const clientId = process.env.VITE_GOOGLE_CLIENT_ID;
      const clientSecret = process.env.GOOGLE_CLIENT_SECRET;

      if (!clientId) return res.status(503).json({ error: "VITE_GOOGLE_CLIENT_ID non configuré" });
      if (!code || !code_verifier || !redirect_uri) {
        return res.status(400).json({ error: "code, code_verifier et redirect_uri requis" });
      }

      const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          code,
          client_id: clientId,
          ...(clientSecret ? { client_secret: clientSecret } : {}),
          code_verifier,
          redirect_uri,
          grant_type: 'authorization_code',
        }).toString(),
      });

      if (!tokenRes.ok) {
        const err = await tokenRes.json();
        return res.status(400).json({ error: err.error_description || 'Échec de l\'échange de code' });
      }

      const tokenData = await tokenRes.json();
      res.json({ access_token: tokenData.access_token });
    } catch (error: any) {
      console.error('Google token exchange error:', error);
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/sync/google-contacts", async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      // Google People API requires OAuth2. The client initiates the OAuth flow
      // and passes the access_token in the request body.
      const { access_token } = req.body;
      if (!access_token) {
        return res.status(400).json({ error: "access_token requis. Veuillez d'abord autoriser l'accès à Google Contacts." });
      }

      // Fetch contacts from Google People API
      const googleRes = await fetch(
        `https://people.googleapis.com/v1/people/me/connections?personFields=${GOOGLE_PERSON_FIELDS}&pageSize=1000`,
        { headers: { Authorization: `Bearer ${access_token}` } }
      );
      if (!googleRes.ok) {
        return res.status(400).json({ error: "Token Google invalide ou expiré" });
      }
      const googleData: any = await googleRes.json();
      const connections: any[] = googleData.connections || [];

      let imported = 0;
      let updated = 0;

      // Built while pulling, reused by the push step below to link a local
      // contact to an already-existing Google contact by email instead of
      // creating a duplicate the first time it's pushed.
      const connectionByEmail = new Map<string, any>();
      for (const person of connections) {
        const email = person.emailAddresses?.[0]?.value;
        if (email) connectionByEmail.set(email, person);
      }

      for (const person of connections) {
        const fields = mapGooglePersonToContactFields(person);
        if (!fields.first_name && !fields.last_name && !fields.email) continue;

        // Check if contact already exists by email
        const { data: existing } = await tenantScopedFrom(supabaseAdmin, tenantId, 'contacts')
          .select('id')
          .eq('email', fields.email)
          .maybeSingle();

        const contactData = { ...fields, updated_at: new Date().toISOString() };

        if (existing) {
          await tenantScopedFrom(supabaseAdmin, tenantId, 'contacts').update(contactData).eq('id', existing.id);
          updated++;
        } else {
          await tenantScopedFrom(supabaseAdmin, tenantId, 'contacts').insert({ ...contactData, id: crypto.randomUUID(), address: '', state: '', ca_amount: 0, created_at: new Date().toISOString(), google_resource_name: person.resourceName, google_synced_at: new Date().toISOString() });
          imported++;
        }
      }

      // ── Push direction: ArchiOffice → Google Contacts ──────────────────
      // Only for categories the cabinet opted into from Réglages; nothing
      // is pushed at all if the setting is empty (default, pull-only, same
      // behavior as before this feature existed).
      let pushedCreated = 0;
      let pushedUpdated = 0;
      let pulledOnConflict = 0;

      const { data: settingsRow } = await supabaseAdmin
        .from('settings')
        .select('google_contacts_sync_categories')
        .eq('tenant_id', tenantId)
        .maybeSingle();
      const syncCategories: string[] = settingsRow?.google_contacts_sync_categories || [];

      if (syncCategories.length > 0) {
        const { data: toPush } = await tenantScopedFrom(supabaseAdmin, tenantId, 'contacts')
          .select('*')
          .in('category', syncCategories)
          // A contact marked "Personnel" (src/components/ContactFormFields.tsx)
          // never leaves the cabinet via this sync, regardless of its category.
          // neq rather than eq(..., false): the column is NOT NULL DEFAULT
          // false in Postgres, but treating "not explicitly true" as the
          // exclusion condition is the safer read of intent either way.
          .neq('is_personal', true);

        for (const contact of (toPush || [])) {
          try {
            if (contact.google_resource_name) {
              // Already linked — fetch the current Google side to compare
              // modification times before deciding which one wins.
              const getRes = await fetch(
                `https://people.googleapis.com/v1/${contact.google_resource_name}?personFields=${GOOGLE_PERSON_FIELDS},metadata`,
                { headers: { Authorization: `Bearer ${access_token}` } }
              );
              if (getRes.status === 404) {
                // Deleted on the Google side since we last linked it — treat
                // as unlinked and fall through to create-or-link below.
                contact.google_resource_name = null;
              } else if (getRes.ok) {
                const googlePerson: any = await getRes.json();
                const googleUpdatedAt = googlePerson.metadata?.sources?.find((s: any) => s.type === 'CONTACT')?.updateTime;
                const localNewer = !googleUpdatedAt || new Date(contact.updated_at || 0) >= new Date(googleUpdatedAt);

                if (localNewer) {
                  const patchRes = await fetch(
                    `https://people.googleapis.com/v1/${contact.google_resource_name}:updateContact?updatePersonFields=${GOOGLE_PERSON_FIELDS}`,
                    {
                      method: 'PATCH',
                      headers: { Authorization: `Bearer ${access_token}`, 'Content-Type': 'application/json' },
                      body: JSON.stringify({ etag: googlePerson.etag, ...buildGooglePersonPayload(contact) }),
                    }
                  );
                  if (patchRes.ok) {
                    await tenantScopedFrom(supabaseAdmin, tenantId, 'contacts').update({ google_synced_at: new Date().toISOString() }).eq('id', contact.id);
                    pushedUpdated++;
                  }
                } else {
                  // Google side is more recent — pull it into the local
                  // contact instead of overwriting the newer data with ours.
                  const fields = mapGooglePersonToContactFields(googlePerson);
                  await tenantScopedFrom(supabaseAdmin, tenantId, 'contacts')
                    .update({ ...fields, updated_at: googleUpdatedAt || new Date().toISOString(), google_synced_at: new Date().toISOString() })
                    .eq('id', contact.id);
                  pulledOnConflict++;
                }
                continue;
              }
            }

            // Not linked (or the link just went stale): reuse a connection
            // already pulled this run if the email matches, rather than
            // creating a duplicate Google contact for the same person.
            const matched = contact.email ? connectionByEmail.get(contact.email) : undefined;
            if (matched) {
              await tenantScopedFrom(supabaseAdmin, tenantId, 'contacts')
                .update({ google_resource_name: matched.resourceName, google_synced_at: new Date().toISOString() })
                .eq('id', contact.id);
              pushedUpdated++;
              continue;
            }

            const createRes = await fetch('https://people.googleapis.com/v1/people:createContact', {
              method: 'POST',
              headers: { Authorization: `Bearer ${access_token}`, 'Content-Type': 'application/json' },
              body: JSON.stringify(buildGooglePersonPayload(contact)),
            });
            if (createRes.ok) {
              const created: any = await createRes.json();
              await tenantScopedFrom(supabaseAdmin, tenantId, 'contacts')
                .update({ google_resource_name: created.resourceName, google_synced_at: new Date().toISOString() })
                .eq('id', contact.id);
              pushedCreated++;
            }
          } catch (pushErr) {
            // One contact failing to push must not abort the rest of the batch.
            console.error(`[Google Contacts push] contact ${contact.id}:`, pushErr);
          }
        }
      }

      res.json({ imported, updated, pushedCreated, pushedUpdated, pulledOnConflict });
    } catch (error: any) {
      console.error('Google Contacts sync error:', error);
      res.status(500).json({ error: error.message || "Erreur de synchronisation Google Contacts" });
    }
  });

  app.post("/api/sync/carddav", async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { url, username, password } = req.body;
      if (!url || !username) {
        return res.status(400).json({ error: "URL et nom d'utilisateur requis" });
      }

      // `url` is fully caller-controlled — validate it points at a public
      // host before fetching, so this route can't be used to reach internal
      // services or the cloud metadata endpoint (SSRF).
      try {
        await assertPublicHttpUrl(url);
      } catch (e: any) {
        return res.status(e.status || 400).json({ error: e.message || 'URL invalide' });
      }

      const auth = Buffer.from(`${username}:${password}`).toString('base64');

      // PROPFIND to list vCards
      const propfindRes = await fetch(url, {
        method: 'PROPFIND',
        headers: {
          Authorization: `Basic ${auth}`,
          Depth: '1',
          'Content-Type': 'application/xml',
        },
        body: '<?xml version="1.0"?><d:propfind xmlns:d="DAV:" xmlns:card="urn:ietf:params:xml:ns:carddav"><d:prop><d:getetag/><card:address-data/></d:prop></d:propfind>'
      });

      if (!propfindRes.ok) {
        return res.status(400).json({ error: `Erreur CardDAV ${propfindRes.status}: vérifiez l'URL et les identifiants` });
      }

      const xml = await propfindRes.text();

      // Simple vCard parser — extract FN, EMAIL, TEL, ORG from each vCard block
      const vcards = xml.match(/BEGIN:VCARD[\s\S]*?END:VCARD/g) || [];
      const getField = (vcard: string, field: string) => {
        const m = vcard.match(new RegExp(`(?:^|\\n)${field}[^:]*:([^\\r\\n]*)`, 'i'));
        return m ? m[1].trim() : '';
      };

      let imported = 0;
      let updated = 0;

      for (const vcard of vcards) {
        const fullName = getField(vcard, 'FN');
        const email = getField(vcard, 'EMAIL');
        const phone = getField(vcard, 'TEL');
        const org = getField(vcard, 'ORG');
        const nField = getField(vcard, 'N');
        const nameParts = nField.split(';');
        const lastName = nameParts[0] || '';
        const firstName = nameParts[1] || (fullName.split(' ')[0] || '');

        if (!fullName && !email) continue;

        const { data: existing } = await tenantScopedFrom(supabaseAdmin, tenantId, 'contacts')
          .select('id')
          .eq('email', email)
          .maybeSingle();

        const contactData = {
          first_name: firstName,
          last_name: lastName || fullName,
          email: email,
          phone: phone,
          company_name: org.split(';')[0] || '',
          updated_at: new Date().toISOString()
        };

        if (existing) {
          await tenantScopedFrom(supabaseAdmin, tenantId, 'contacts').update(contactData).eq('id', existing.id);
          updated++;
        } else {
          await tenantScopedFrom(supabaseAdmin, tenantId, 'contacts').insert({ ...contactData, id: crypto.randomUUID(), address: '', city: '', zip: '', state: '', country: '', ca_amount: 0, created_at: new Date().toISOString() });
          imported++;
        }
      }

      res.json({ imported, updated });
    } catch (error: any) {
      console.error('CardDAV sync error:', error);
      res.status(500).json({ error: error.message || "Erreur de synchronisation CardDAV" });
    }
  });
}
