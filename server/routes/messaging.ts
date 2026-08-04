// Phase 7 extraction — moved out of server.ts's "── Messagerie interne
// (conversations 1-à-1 et groupes) ──" section. getProfileDisplayName and
// assertParticipant are only ever used by these routes, so they move here
// as locally-defined helpers closing over this module's own supabaseAdmin.
import type { Express } from 'express';
import { tenantScopedFrom } from '../tenantScopedFrom';
import { sanitizeFilename } from '../sanitizeFilename';

export interface RouteDeps {
  supabaseAdmin: any;
  getTenantId: (userId: string) => Promise<string>;
  uploadToStorage: (bucket: string, storagePath: string, buffer: Buffer, mimetype: string) => Promise<string>;
  resolveFileUrl: (bucket: string, value: string | null | undefined, expiresIn?: number) => Promise<string | null>;
  upload: any;
}

export function registerMessagingRoutes(app: Express, { supabaseAdmin, getTenantId, uploadToStorage, resolveFileUrl, upload }: RouteDeps) {
  const getProfileDisplayName = async (tenantId: string, userId: string): Promise<string> => {
    const { data } = await tenantScopedFrom(supabaseAdmin, tenantId, 'profiles').select('name').eq('id', userId).maybeSingle();
    return (data as any)?.name || 'Utilisateur';
  };

  const assertParticipant = async (tenantId: string, conversationId: string, userId: string) => {
    const { data } = await tenantScopedFrom(supabaseAdmin, tenantId, 'conversation_participants').select('id')
      .eq('conversation_id', conversationId).eq('user_id', userId).maybeSingle();
    if (!data) {
      const err: any = new Error("Vous ne participez pas à cette conversation");
      err.status = 403;
      throw err;
    }
  };

  app.get("/api/conversations", async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { data: myParticipations } = await tenantScopedFrom(supabaseAdmin, tenantId, 'conversation_participants')
        .select('conversation_id, last_read_at').eq('user_id', req.user.id);
      const convIds = (myParticipations || []).map((p: any) => p.conversation_id);
      if (!convIds.length) return res.json([]);

      const lastReadByConv = new Map((myParticipations || []).map((p: any) => [p.conversation_id, p.last_read_at]));

      const [{ data: conversations }, { data: allParticipants }] = await Promise.all([
        supabaseAdmin.from('conversations').select('*').in('id', convIds).order('last_message_at', { ascending: false }),
        supabaseAdmin.from('conversation_participants').select('conversation_id, user_id, profiles(id, name, avatar)').in('conversation_id', convIds),
      ]);

      const result = await Promise.all((conversations || []).map(async (conv: any) => {
        const participants = (allParticipants || []).filter((p: any) => p.conversation_id === conv.id);
        const others = participants.filter((p: any) => p.user_id !== req.user.id).map((p: any) => p.profiles).filter(Boolean);

        const { data: lastMsg } = await supabaseAdmin.from('messages').select('content, attachment_name, sender_name, created_at')
          .eq('conversation_id', conv.id).order('created_at', { ascending: false }).limit(1).maybeSingle();

        const lastRead = lastReadByConv.get(conv.id) || new Date(0).toISOString();
        const { count: unreadCount } = await supabaseAdmin.from('messages').select('id', { count: 'exact', head: true })
          .eq('conversation_id', conv.id).neq('sender_id', req.user.id).gt('created_at', lastRead);

        const displayName = conv.is_group ? (conv.name || 'Groupe') : (others[0]?.name || 'Utilisateur');
        const displayAvatar = conv.is_group ? null : (others[0]?.avatar || null);

        return {
          id: conv.id,
          is_group: conv.is_group,
          name: displayName,
          avatar: displayAvatar,
          participants: participants.map((p: any) => p.profiles).filter(Boolean),
          last_message: (lastMsg as any)?.content || ((lastMsg as any)?.attachment_name ? `📎 ${(lastMsg as any).attachment_name}` : null),
          last_message_at: conv.last_message_at,
          unread_count: unreadCount || 0,
        };
      }));

      res.json(result.sort((a, b) => new Date(b.last_message_at).getTime() - new Date(a.last_message_at).getTime()));
    } catch (e: any) {
      console.error(e);
      res.status(500).json({ error: "Failed to fetch conversations" });
    }
  });

  app.post("/api/conversations", async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { participant_ids, is_group, name } = req.body;
      const otherIds: string[] = (participant_ids || []).filter((id: string) => id && id !== req.user.id);
      if (!otherIds.length) return res.status(400).json({ error: "Au moins un destinataire est requis" });

      // Reuse the existing 1:1 conversation instead of creating a duplicate
      if (!is_group && otherIds.length === 1) {
        const { data: myConvs } = await tenantScopedFrom(supabaseAdmin, tenantId, 'conversation_participants').select('conversation_id').eq('user_id', req.user.id);
        const myConvIds = (myConvs || []).map((c: any) => c.conversation_id);
        if (myConvIds.length) {
          const { data: theirConvs } = await tenantScopedFrom(supabaseAdmin, tenantId, 'conversation_participants').select('conversation_id').eq('user_id', otherIds[0]).in('conversation_id', myConvIds);
          for (const tc of theirConvs || []) {
            const { data: conv } = await tenantScopedFrom(supabaseAdmin, tenantId, 'conversations').select('id, is_group').eq('id', (tc as any).conversation_id).maybeSingle();
            if (conv && !(conv as any).is_group) {
              return res.json({ id: (conv as any).id, existing: true });
            }
          }
        }
      }

      const id = crypto.randomUUID();
      const now = new Date().toISOString();
      const { error: convErr } = await tenantScopedFrom(supabaseAdmin, tenantId, 'conversations').insert({
        id, is_group: !!is_group, name: is_group ? (name || 'Groupe') : null, created_by: req.user.id, created_at: now, last_message_at: now
      });
      if (convErr) throw convErr;

      const participantRows = [req.user.id, ...otherIds].map(uid => ({
        id: crypto.randomUUID(), conversation_id: id, user_id: uid, last_read_at: now, joined_at: now
      }));
      const { error: partErr } = await tenantScopedFrom(supabaseAdmin, tenantId, 'conversation_participants').insert(participantRows);
      if (partErr) throw partErr;

      res.status(201).json({ id, existing: false });
    } catch (e: any) {
      console.error(e);
      res.status(500).json({ error: "Failed to create conversation" });
    }
  });

  app.get("/api/conversations/:id/messages", async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { id } = req.params;
      await assertParticipant(tenantId, id, req.user.id);
      const { data, error } = await tenantScopedFrom(supabaseAdmin, tenantId, 'messages').select('*').eq('conversation_id', id)
        .order('created_at', { ascending: true }).limit(200);
      if (error) throw error;
      const withUrls = await Promise.all((data || []).map(async (m: any) => ({ ...m, attachment_url: await resolveFileUrl('message-attachments', m.attachment_url) })));
      res.json(withUrls);
    } catch (e: any) {
      console.error("[GET /api/conversations/:id/messages]", e);
      res.status(e.status || 500).json({ error: e.message || "Failed to fetch messages" });
    }
  });

  app.post("/api/conversations/:id/messages", upload.single('file'), async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { id } = req.params;
      await assertParticipant(tenantId, id, req.user.id);
      const { content } = req.body;
      const file = req.file;
      if (!content?.trim() && !file) return res.status(400).json({ error: "Message vide" });

      let attachment_url: string | null = null, attachment_name: string | null = null, attachment_type: string | null = null;
      if (file) {
        const storagePath = `${tenantId}/${id}/${Date.now()}-${sanitizeFilename(file.originalname)}`;
        attachment_url = await uploadToStorage('message-attachments', storagePath, file.buffer, file.mimetype);
        attachment_name = file.originalname;
        attachment_type = file.mimetype;
      }

      const senderName = await getProfileDisplayName(tenantId, req.user.id);
      const msgId = crypto.randomUUID();
      const created_at = new Date().toISOString();
      const { error } = await tenantScopedFrom(supabaseAdmin, tenantId, 'messages').insert({
        id: msgId, conversation_id: id, sender_id: req.user.id, sender_name: senderName,
        content: content?.trim() || null, attachment_url, attachment_name, attachment_type, created_at
      });
      if (error) throw error;
      await tenantScopedFrom(supabaseAdmin, tenantId, 'conversations').update({ last_message_at: created_at }).eq('id', id);
      // Sending counts as having read the thread up to now
      await tenantScopedFrom(supabaseAdmin, tenantId, 'conversation_participants').update({ last_read_at: created_at }).eq('conversation_id', id).eq('user_id', req.user.id);

      const signedAttachmentUrl = await resolveFileUrl('message-attachments', attachment_url);
      res.status(201).json({
        id: msgId, conversation_id: id, sender_id: req.user.id, sender_name: senderName,
        content: content?.trim() || null, attachment_url: signedAttachmentUrl, attachment_name, attachment_type, created_at
      });
    } catch (e: any) {
      console.error(e);
      res.status(e.status || 500).json({ error: e.message || "Failed to send message" });
    }
  });

  app.post("/api/conversations/:id/read", async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { id } = req.params;
      const now = new Date().toISOString();
      await tenantScopedFrom(supabaseAdmin, tenantId, 'conversation_participants').update({ last_read_at: now })
        .eq('conversation_id', id).eq('user_id', req.user.id);
      res.json({ success: true, last_read_at: now });
    } catch (e: any) {
      console.error("[POST /api/conversations/:id/read]", e);
      res.status(500).json({ error: "Failed to mark conversation as read" });
    }
  });

  app.get("/api/messages/unread-count", async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { data: myParticipations } = await tenantScopedFrom(supabaseAdmin, tenantId, 'conversation_participants')
        .select('conversation_id, last_read_at').eq('user_id', req.user.id);
      const counts = await Promise.all((myParticipations || []).map(async (p: any) => {
        const { count } = await supabaseAdmin.from('messages').select('id', { count: 'exact', head: true })
          .eq('conversation_id', p.conversation_id).neq('sender_id', req.user.id).gt('created_at', p.last_read_at);
        return count || 0;
      }));
      res.json({ count: counts.reduce((a, b) => a + b, 0) });
    } catch (e: any) {
      console.error("[GET /api/messages/unread-count]", e);
      res.json({ count: 0 });
    }
  });

  app.post("/api/conversations/:id/participants", async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { id } = req.params;
      await assertParticipant(tenantId, id, req.user.id);
      const { data: conv } = await tenantScopedFrom(supabaseAdmin, tenantId, 'conversations').select('is_group').eq('id', id).maybeSingle();
      if (!(conv as any)?.is_group) return res.status(400).json({ error: "Impossible d'ajouter des participants à une conversation 1-à-1" });
      const { user_ids } = req.body;
      const now = new Date().toISOString();
      const rows = (user_ids || []).map((uid: string) => ({
        id: crypto.randomUUID(), tenant_id: tenantId, conversation_id: id, user_id: uid, last_read_at: now, joined_at: now
      }));
      if (rows.length) await supabaseAdmin.from('conversation_participants').upsert(rows, { onConflict: 'conversation_id,user_id', ignoreDuplicates: true });
      res.json({ success: true });
    } catch (e: any) {
      console.error("[POST /api/conversations/:id/participants]", e);
      res.status(e.status || 500).json({ error: e.message || "Failed to add participants" });
    }
  });

  app.delete("/api/conversations/:id/participants/:userId", async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { id, userId } = req.params;
      // Anyone can leave; only self-removal is allowed for now (no group admin concept yet)
      if (userId !== req.user.id) return res.status(403).json({ error: "Vous ne pouvez retirer que vous-même du groupe" });
      await tenantScopedFrom(supabaseAdmin, tenantId, 'conversation_participants').delete().eq('conversation_id', id).eq('user_id', userId);
      res.json({ success: true });
    } catch (e: any) {
      console.error("[DELETE /api/conversations/:id/participants/:userId]", e);
      res.status(500).json({ error: "Failed to leave conversation" });
    }
  });
}
