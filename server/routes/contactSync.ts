// Phase 7 extraction — moved out of server.ts's "── Google Contacts sync ──"
// and "── CardDAV sync ──" sections. Both import contacts from an external
// source using tenant-scoped dedup-by-email, then upsert into `contacts`.
import type { Express } from 'express';
import { tenantScopedFrom } from '../tenantScopedFrom';

export interface RouteDeps {
  supabaseAdmin: any;
  getTenantId: (userId: string) => Promise<string>;
}

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
        'https://people.googleapis.com/v1/people/me/connections?personFields=names,emailAddresses,phoneNumbers,organizations,addresses&pageSize=1000',
        { headers: { Authorization: `Bearer ${access_token}` } }
      );
      if (!googleRes.ok) {
        return res.status(400).json({ error: "Token Google invalide ou expiré" });
      }
      const googleData: any = await googleRes.json();
      const connections: any[] = googleData.connections || [];

      let imported = 0;
      let updated = 0;

      for (const person of connections) {
        const name = person.names?.[0] || {};
        const email = person.emailAddresses?.[0]?.value || '';
        const phone = person.phoneNumbers?.[0]?.value || '';
        const org = person.organizations?.[0] || {};
        const addr = person.addresses?.[0] || {};

        if (!name.givenName && !name.familyName && !email) continue;

        // Check if contact already exists by email
        const { data: existing } = await tenantScopedFrom(supabaseAdmin, tenantId, 'contacts')
          .select('id')
          .eq('email', email)
          .maybeSingle();

        const contactData = {
          first_name: name.givenName || '',
          last_name: name.familyName || '',
          email: email,
          phone: phone,
          company_name: org.name || '',
          job_title: org.title || '',
          city: addr.city || '',
          zip: addr.postalCode || '',
          country: addr.country || '',
          updated_at: new Date().toISOString()
        };

        if (existing) {
          await tenantScopedFrom(supabaseAdmin, tenantId, 'contacts').update(contactData).eq('id', existing.id);
          updated++;
        } else {
          await tenantScopedFrom(supabaseAdmin, tenantId, 'contacts').insert({ ...contactData, id: crypto.randomUUID(), address: '', state: '', ca_amount: 0, created_at: new Date().toISOString() });
          imported++;
        }
      }

      res.json({ imported, updated });
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
