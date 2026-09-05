// Phase 7 extraction — moved out of server.ts's "── Activity Feed ──"
// section. getUserName/logActivity themselves stay defined in server.ts
// (createApp()) rather than moving here: ~85 still-inline routes and every
// previously-extracted route module depend on them via the same closure-
// over-supabaseAdmin pattern, so hoisting them would mean threading
// supabaseAdmin through every call site across the codebase — out of scope
// for this batch. extractMentionedUserIds/createMentionsForContent, by
// contrast, are only ever used by the two feed routes below, so they move
// here and close over this module's own `supabaseAdmin` deps parameter
// instead.
import type { Express } from 'express';
import { tenantScopedFrom } from '../tenantScopedFrom';
import { sanitizeFilename } from '../sanitizeFilename';
import { handleDocumentUpload } from '../documentUpload';
import { notifyUsers } from '../push';

export interface RouteDeps {
  supabaseAdmin: any;
  getTenantId: (userId: string) => Promise<string>;
  getUserName: (tenantId: string, userId: string, email?: string) => Promise<string>;
  uploadToStorage: (bucket: string, storagePath: string, buffer: Buffer, mimetype: string) => Promise<string>;
  captureWithContext: (error: any, context: { route: string; tenantId?: string; userId?: string }) => void;
}

export function registerActivityFeedRoutes(app: Express, { supabaseAdmin, getTenantId, getUserName, uploadToStorage, captureWithContext }: RouteDeps) {
  // Matches "@Full Name" against known tenant members — longest names first so
  // "Jean Dupont" isn't shadowed by a coincidental "Jean" member.
  const extractMentionedUserIds = (content: string, members: { id: string; name: string }[]): string[] => {
    const ids = new Set<string>();
    const candidates = members.filter(m => m.name?.trim()).sort((a, b) => b.name.length - a.name.length);
    for (const m of candidates) {
      const escaped = m.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const re = new RegExp(`@${escaped}(?=[\\s.,!?;:]|$)`, 'u');
      if (re.test(content)) ids.add(m.id);
    }
    return [...ids];
  };

  const createMentionsForContent = async (
    tenantId: string, authorId: string, authorName: string, content: string,
    itemType: 'post' | 'comment', itemId: string, postId: string
  ) => {
    try {
      const { data: members } = await tenantScopedFrom(supabaseAdmin, tenantId, 'profiles').select('id, name');
      const mentionedIds = extractMentionedUserIds(content, (members || []).filter((m: any) => m.id !== authorId));
      if (!mentionedIds.length) return;
      const rows = mentionedIds.map(uid => ({
        id: crypto.randomUUID(), mentioned_user_id: uid,
        author_id: authorId, author_name: authorName, item_type: itemType, item_id: itemId, post_id: postId,
        content_snippet: content.slice(0, 200), created_at: new Date().toISOString()
      }));
      const { error } = await tenantScopedFrom(supabaseAdmin, tenantId, 'mentions').insert(rows);
      if (error) console.error('[mentions] insert failed:', error);
      // Après l'enregistrement, pas avant : la mention doit exister dans le
      // fil même si la notification système échoue. Être cité nommément est le
      // seul événement du flux qui sonne hors application sans passer par une
      // règle d'alerte — c'est là que l'attente d'une réponse est la plus forte.
      await notifyUsers(supabaseAdmin, tenantId, mentionedIds, {
        title: `${authorName} vous a mentionné`,
        body: content.slice(0, 200),
        url: '/notifications',
        category: 'Messages',
        tag: `mention:${postId}`,
      });
    } catch (e) {
      console.error('[mentions] unexpected error:', e);
    }
  };

  app.get("/api/feed", async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      // ?archived=1 switches to the archived view (see server/notificationArchiver.ts)
      const archivedView = req.query.archived === '1' || req.query.archived === 'true';

      let actsQuery = tenantScopedFrom(supabaseAdmin, tenantId, 'activities').select('*').order('created_at', { ascending: false }).limit(50);
      let postsQuery = tenantScopedFrom(supabaseAdmin, tenantId, 'feed_posts').select('*').order('created_at', { ascending: false }).limit(50);
      actsQuery = archivedView ? actsQuery.not('archived_at', 'is', null) : actsQuery.is('archived_at', null);
      postsQuery = archivedView ? postsQuery.not('archived_at', 'is', null) : postsQuery.is('archived_at', null);

      const [{ data: acts, error: actsError }, { data: posts, error: postsError }, { data: profile }] = await Promise.all([
        actsQuery,
        postsQuery,
        supabaseAdmin.from('profiles').select('notifications_last_seen').eq('id', req.user.id).maybeSingle()
      ]);
      if (actsError) console.error('[GET /api/feed] activities query failed:', actsError);
      if (postsError) console.error('[GET /api/feed] feed_posts query failed:', postsError);

      const lastSeen = (profile as any)?.notifications_last_seen || new Date(0).toISOString();

      // Bound the "my likes"/"mentions" lookups to the items actually loaded above
      // instead of the requesting user's entire history — keeps these queries flat
      // as activity/mentions volume grows, and lets them run alongside the
      // comments fetch instead of after it.
      const itemIds = [...(acts || []).map((a: any) => a.id), ...(posts || []).map((p: any) => p.id)];
      const postIds = (posts || []).map((p: any) => p.id);

      const [{ data: myLikes }, { data: allComments }, { data: myMentions }] = await Promise.all([
        itemIds.length
          ? tenantScopedFrom(supabaseAdmin, tenantId, 'feed_likes').select('item_id, item_type').eq('user_id', req.user.id).in('item_id', itemIds)
          : Promise.resolve({ data: [] }),
        postIds.length
          ? supabaseAdmin.from('feed_comments').select('*').in('post_id', postIds).order('created_at', { ascending: true }).limit(1000)
          : Promise.resolve({ data: [] }),
        // mentions.post_id is the parent post for both post- and comment-level
        // mentions (see supabase/migrate_mentions.sql), so filtering on the
        // posts we already loaded covers comment mentions too without needing
        // comment ids up front.
        postIds.length
          ? tenantScopedFrom(supabaseAdmin, tenantId, 'mentions').select('item_id').eq('mentioned_user_id', req.user.id).in('post_id', postIds)
          : Promise.resolve({ data: [] }),
      ]);

      const likedSet = new Set((myLikes || []).map((l: any) => `${l.item_type}:${l.item_id}`));
      const mentionedItemIds = new Set((myMentions || []).map((m: any) => m.item_id));

      const feedItems = [
        ...(acts || []).map((a: any) => ({
          id: a.id,
          kind: 'activity',
          user_name: a.user_name,
          user_id: a.user_id,
          action: a.action,
          target: a.target,
          target_id: a.target_id,
          target_type: a.target_type,
          category: a.category,
          created_at: a.created_at,
          likes_count: a.likes_count || 0,
          liked: likedSet.has(`activity:${a.id}`),
          unread: a.created_at > lastSeen,
          comments: [],
          comments_count: 0
        })),
        ...(posts || []).map((p: any) => {
          const postComments = (allComments || []).filter((c: any) => c.post_id === p.id)
            .map((c: any) => ({ ...c, mentions_me: mentionedItemIds.has(c.id) }));
          return {
            id: p.id,
            kind: 'post',
            user_name: p.user_name,
            user_id: p.user_id,
            content: p.content,
            attachment_url: p.attachment_url,
            attachment_name: p.attachment_name,
            attachment_type: p.attachment_type,
            category: 'Messages',
            created_at: p.created_at,
            likes_count: p.likes_count || 0,
            liked: likedSet.has(`post:${p.id}`),
            unread: p.created_at > lastSeen,
            mentions_me: mentionedItemIds.has(p.id) || postComments.some((c: any) => c.mentions_me),
            comments: postComments,
            comments_count: postComments.length
          };
        })
      ].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

      res.json(feedItems);
    } catch (err: any) {
      console.error(err);
      res.status(500).json({ error: "Failed to fetch feed" });
    }
  });

  app.post("/api/feed/posts", handleDocumentUpload('file'), async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { content } = req.body;
      const file = req.file;
      if (!content?.trim() && !file) return res.status(400).json({ error: "Content required" });

      // Get user name
      const userName = await getUserName(tenantId, req.user.id, req.user.email);

      let attachment_url: string | null = null, attachment_name: string | null = null, attachment_type: string | null = null;
      if (file) {
        const storagePath = `${tenantId}/${Date.now()}-${sanitizeFilename(file.originalname)}`;
        attachment_url = await uploadToStorage('feed-attachments', storagePath, file.buffer, file.mimetype);
        attachment_name = file.originalname;
        attachment_type = file.mimetype;
      }

      const id = crypto.randomUUID();
      const created_at = new Date().toISOString();
      const trimmedContent = content?.trim() || null;
      const { error: insertError } = await tenantScopedFrom(supabaseAdmin, tenantId, 'feed_posts').insert({
        id, user_id: req.user.id, user_name: userName, content: trimmedContent,
        attachment_url, attachment_name, attachment_type, created_at, likes_count: 0
      });
      if (insertError) throw insertError;
      if (trimmedContent) createMentionsForContent(tenantId, req.user.id, userName, trimmedContent, 'post', id, id);
      res.status(201).json({
        id, kind: 'post', user_name: userName, user_id: req.user.id, content: trimmedContent,
        attachment_url, attachment_name, attachment_type, created_at, likes_count: 0, liked: false, comments: [], comments_count: 0
      });
    } catch (err: any) {
      console.error(err);
      res.status(500).json({ error: "Failed to create post" });
    }
  });

  app.post("/api/feed/posts/:id/like", async (req: any, res: any) => {
    let tenantId: string | undefined;
    try {
      tenantId = await getTenantId(req.user.id);
      const { id } = req.params;
      const { data: existing } = await tenantScopedFrom(supabaseAdmin, tenantId, 'feed_likes').select('id').eq('item_id', id).eq('item_type', 'post').eq('user_id', req.user.id).maybeSingle();
      if (existing) {
        await supabaseAdmin.from('feed_likes').delete().eq('id', (existing as any).id);
        const { data: post } = await tenantScopedFrom(supabaseAdmin, tenantId, 'feed_posts').select('likes_count').eq('id', id).single();
        const newCount = Math.max(0, ((post as any)?.likes_count || 1) - 1);
        await tenantScopedFrom(supabaseAdmin, tenantId, 'feed_posts').update({ likes_count: newCount }).eq('id', id);
        res.json({ liked: false, likes_count: newCount });
      } else {
        await tenantScopedFrom(supabaseAdmin, tenantId, 'feed_likes').insert({ id: crypto.randomUUID(), item_id: id, item_type: 'post', user_id: req.user.id });
        const { data: post } = await tenantScopedFrom(supabaseAdmin, tenantId, 'feed_posts').select('likes_count').eq('id', id).single();
        const newCount = ((post as any)?.likes_count || 0) + 1;
        await tenantScopedFrom(supabaseAdmin, tenantId, 'feed_posts').update({ likes_count: newCount }).eq('id', id);
        res.json({ liked: true, likes_count: newCount });
      }
    } catch (err: any) {
      captureWithContext(err, { route: 'POST /api/feed/posts/:id/like', tenantId, userId: req.user?.id });
      res.status(500).json({ error: "Failed to toggle like" });
    }
  });

  app.post("/api/feed/activities/:id/like", async (req: any, res: any) => {
    let tenantId: string | undefined;
    try {
      tenantId = await getTenantId(req.user.id);
      const { id } = req.params;
      const { data: existing } = await tenantScopedFrom(supabaseAdmin, tenantId, 'feed_likes').select('id').eq('item_id', id).eq('item_type', 'activity').eq('user_id', req.user.id).maybeSingle();
      if (existing) {
        await supabaseAdmin.from('feed_likes').delete().eq('id', (existing as any).id);
        const { data: act } = await tenantScopedFrom(supabaseAdmin, tenantId, 'activities').select('likes_count').eq('id', id).single();
        const newCount = Math.max(0, ((act as any)?.likes_count || 1) - 1);
        await tenantScopedFrom(supabaseAdmin, tenantId, 'activities').update({ likes_count: newCount }).eq('id', id);
        res.json({ liked: false, likes_count: newCount });
      } else {
        await tenantScopedFrom(supabaseAdmin, tenantId, 'feed_likes').insert({ id: crypto.randomUUID(), item_id: id, item_type: 'activity', user_id: req.user.id });
        const { data: act } = await tenantScopedFrom(supabaseAdmin, tenantId, 'activities').select('likes_count').eq('id', id).single();
        const newCount = ((act as any)?.likes_count || 0) + 1;
        await tenantScopedFrom(supabaseAdmin, tenantId, 'activities').update({ likes_count: newCount }).eq('id', id);
        res.json({ liked: true, likes_count: newCount });
      }
    } catch (err: any) {
      captureWithContext(err, { route: 'POST /api/feed/activities/:id/like', tenantId, userId: req.user?.id });
      res.status(500).json({ error: "Failed to toggle like" });
    }
  });

  app.post("/api/feed/posts/:id/comments", handleDocumentUpload('file'), async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { id } = req.params;
      const { content } = req.body;
      const file = req.file;
      if (!content?.trim() && !file) return res.status(400).json({ error: "Content required" });
      const userName = await getUserName(tenantId, req.user.id, req.user.email);

      let attachment_url: string | null = null, attachment_name: string | null = null, attachment_type: string | null = null;
      if (file) {
        const storagePath = `${tenantId}/${id}/${Date.now()}-${sanitizeFilename(file.originalname)}`;
        attachment_url = await uploadToStorage('feed-attachments', storagePath, file.buffer, file.mimetype);
        attachment_name = file.originalname;
        attachment_type = file.mimetype;
      }

      const commentId = crypto.randomUUID();
      const created_at = new Date().toISOString();
      const trimmedContent = content?.trim() || null;
      const { error: insertError } = await tenantScopedFrom(supabaseAdmin, tenantId, 'feed_comments').insert({
        id: commentId, post_id: id, user_id: req.user.id, user_name: userName,
        content: trimmedContent, attachment_url, attachment_name, attachment_type, created_at
      });
      if (insertError) throw insertError;
      if (trimmedContent) createMentionsForContent(tenantId, req.user.id, userName, trimmedContent, 'comment', commentId, id);
      res.status(201).json({ id: commentId, post_id: id, user_name: userName, content: trimmedContent, attachment_url, attachment_name, attachment_type, created_at });
    } catch (err: any) {
      console.error(err);
      res.status(500).json({ error: "Failed to add comment" });
    }
  });

  app.get("/api/notifications/unread-count", async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { data: profile } = await supabaseAdmin.from('profiles').select('notifications_last_seen').eq('id', req.user.id).maybeSingle();
      const lastSeen = (profile as any)?.notifications_last_seen || new Date(0).toISOString();

      const [{ count: actCount }, { count: postCount }] = await Promise.all([
        tenantScopedFrom(supabaseAdmin, tenantId, 'activities').select('id', { count: 'exact', head: true }).gt('created_at', lastSeen),
        tenantScopedFrom(supabaseAdmin, tenantId, 'feed_posts').select('id', { count: 'exact', head: true }).gt('created_at', lastSeen)
      ]);

      res.json({ count: (actCount || 0) + (postCount || 0) });
    } catch (err: any) {
      console.error("[GET /api/notifications/unread-count]", err);
      res.json({ count: 0 });
    }
  });

  app.post("/api/notifications/mark-read", async (req: any, res: any) => {
    try {
      const now = new Date().toISOString();
      await supabaseAdmin.from('profiles').update({ notifications_last_seen: now }).eq('id', req.user.id);
      res.json({ success: true, last_seen: now });
    } catch (err: any) {
      console.error("[POST /api/notifications/mark-read]", err);
      res.status(500).json({ error: "Failed to mark notifications as read" });
    }
  });
}
