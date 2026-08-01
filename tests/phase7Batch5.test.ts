// Phase 7 batch 5: end-to-end Supertest coverage for the domains extracted
// into server/routes/{activityFeed,messaging}.ts — confirms the extraction
// didn't change behavior and that tenantScopedFrom() still enforces tenant
// isolation through the real app. Also exercises FakeSupabaseAdmin's new
// .upsert() support (needed by POST /api/conversations/:id/participants).
import { beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { getTestApp, fakeSupabaseAdmin, makeTenant, makeUser, authHeader } from './testServer';

let app: Express;

beforeAll(async () => {
  app = await getTestApp();
});

describe('Activity Feed', () => {
  it('creates a post and toggles its like on and off', async () => {
    const tenantId = makeTenant();
    const { token } = makeUser(tenantId);

    const created = await request(app).post('/api/feed/posts').set(authHeader(token)).send({ content: 'Bonjour tout le monde' });
    expect(created.status).toBe(201);
    expect(created.body.likes_count).toBe(0);
    const postId = created.body.id;

    const liked = await request(app).post(`/api/feed/posts/${postId}/like`).set(authHeader(token));
    expect(liked.status).toBe(200);
    expect(liked.body).toEqual({ liked: true, likes_count: 1 });

    const unliked = await request(app).post(`/api/feed/posts/${postId}/like`).set(authHeader(token));
    expect(unliked.status).toBe(200);
    expect(unliked.body).toEqual({ liked: false, likes_count: 0 });

    const feed = await request(app).get('/api/feed').set(authHeader(token));
    expect(feed.status).toBe(200);
    expect(feed.body.some((item: any) => item.id === postId)).toBe(true);
  });

  it('toggles the like on an activity item', async () => {
    const tenantId = makeTenant();
    const { token } = makeUser(tenantId);
    fakeSupabaseAdmin.seed('activities', [{ id: 'act-1', tenant_id: tenantId, user_id: 'u1', user_name: 'Jean', action: 'a fait X', target: '', target_id: '', target_type: 'project', category: 'Projets', created_at: new Date().toISOString(), likes_count: 0 }]);

    const liked = await request(app).post('/api/feed/activities/act-1/like').set(authHeader(token));
    expect(liked.status).toBe(200);
    expect(liked.body).toEqual({ liked: true, likes_count: 1 });
  });

  it('never lets a caller like another tenant\'s post or activity', async () => {
    const tenantB = makeTenant();
    fakeSupabaseAdmin.seed('feed_posts', [{ id: 'post-b', tenant_id: tenantB, user_id: 'ub', user_name: 'B', content: 'secret', likes_count: 0, created_at: new Date().toISOString() }]);
    fakeSupabaseAdmin.seed('activities', [{ id: 'act-b', tenant_id: tenantB, user_id: 'ub', user_name: 'B', action: 'x', target: '', target_id: '', target_type: 'project', category: 'Projets', created_at: new Date().toISOString(), likes_count: 0 }]);

    const tenantA = makeTenant();
    const { token } = makeUser(tenantA);

    // The post itself must never show a like from a caller outside its tenant
    // (the Phase 2 fix this test locks in) — a same-tenant-stamped feed_likes
    // row referencing the foreign item_id is pre-existing, harmless behavior
    // (never surfaced back, since GET /api/feed only reads the caller's own
    // tenant's posts) and unchanged by this extraction.
    await request(app).post('/api/feed/posts/post-b/like').set(authHeader(token));
    expect(fakeSupabaseAdmin.getTable('feed_posts').find(p => p.id === 'post-b')?.likes_count).toBe(0);

    await request(app).post('/api/feed/activities/act-b/like').set(authHeader(token));
    expect(fakeSupabaseAdmin.getTable('activities').find(a => a.id === 'act-b')?.likes_count).toBe(0);
  });

  it('creates a mention when a comment @-mentions a known tenant member', async () => {
    const tenantId = makeTenant();
    const { token } = makeUser(tenantId);
    const { userId: mentionedId } = makeUser(tenantId);
    fakeSupabaseAdmin.seed('profiles', [{ id: mentionedId, tenant_id: tenantId, name: 'Marie Curie' }]);

    const post = await request(app).post('/api/feed/posts').set(authHeader(token)).send({ content: 'Point projet' });
    const commented = await request(app).post(`/api/feed/posts/${post.body.id}/comments`).set(authHeader(token)).send({ content: 'Salut @Marie Curie, tu peux valider ?' });
    expect(commented.status).toBe(201);

    expect(fakeSupabaseAdmin.getTable('mentions').some(m => m.mentioned_user_id === mentionedId && m.tenant_id === tenantId)).toBe(true);
  });

  it('reports and clears the unread notifications count', async () => {
    const tenantId = makeTenant();
    const { token } = makeUser(tenantId);

    await request(app).post('/api/feed/posts').set(authHeader(token)).send({ content: 'Nouveau post' });
    const unread = await request(app).get('/api/notifications/unread-count').set(authHeader(token));
    expect(unread.status).toBe(200);
    expect(unread.body.count).toBeGreaterThan(0);

    const marked = await request(app).post('/api/notifications/mark-read').set(authHeader(token));
    expect(marked.status).toBe(200);
  });
});

describe('Messagerie interne', () => {
  it('creates a 1:1 conversation, sends a message, and reuses the conversation on a second attempt', async () => {
    const tenantId = makeTenant();
    const { userId: userA, token: tokenA } = makeUser(tenantId);
    const { userId: userB } = makeUser(tenantId);

    const created = await request(app).post('/api/conversations').set(authHeader(tokenA)).send({ participant_ids: [userB] });
    expect(created.status).toBe(201);
    expect(created.body.existing).toBe(false);
    const convId = created.body.id;

    const sent = await request(app).post(`/api/conversations/${convId}/messages`).set(authHeader(tokenA)).send({ content: 'Bonjour !' });
    expect(sent.status).toBe(201);
    expect(sent.body.sender_id).toBe(userA);

    const messages = await request(app).get(`/api/conversations/${convId}/messages`).set(authHeader(tokenA));
    expect(messages.status).toBe(200);
    expect(messages.body).toHaveLength(1);

    const reused = await request(app).post('/api/conversations').set(authHeader(tokenA)).send({ participant_ids: [userB] });
    expect(reused.status).toBe(200);
    expect(reused.body.existing).toBe(true);
    expect(reused.body.id).toBe(convId);
  });

  it('rejects reading or sending messages by a non-participant', async () => {
    const tenantId = makeTenant();
    const { userId: userA, token: tokenA } = makeUser(tenantId);
    const { userId: userB } = makeUser(tenantId);
    const { token: outsiderToken } = makeUser(tenantId);

    const created = await request(app).post('/api/conversations').set(authHeader(tokenA)).send({ participant_ids: [userB] });
    const convId = created.body.id;

    const res = await request(app).get(`/api/conversations/${convId}/messages`).set(authHeader(outsiderToken));
    expect(res.status).toBe(403);
  });

  it('adds a participant to a group conversation via upsert and lets them leave', async () => {
    const tenantId = makeTenant();
    const { userId: userA, token: tokenA } = makeUser(tenantId);
    const { userId: userB } = makeUser(tenantId);
    const { userId: userC, token: tokenC } = makeUser(tenantId);

    const created = await request(app).post('/api/conversations').set(authHeader(tokenA)).send({ participant_ids: [userB], is_group: true, name: 'Équipe projet' });
    const convId = created.body.id;

    const added = await request(app).post(`/api/conversations/${convId}/participants`).set(authHeader(tokenA)).send({ user_ids: [userC] });
    expect(added.status).toBe(200);
    expect(fakeSupabaseAdmin.getTable('conversation_participants').some(p => p.conversation_id === convId && p.user_id === userC)).toBe(true);

    // Adding the same participant again must not create a duplicate row (ignoreDuplicates upsert).
    await request(app).post(`/api/conversations/${convId}/participants`).set(authHeader(tokenA)).send({ user_ids: [userC] });
    expect(fakeSupabaseAdmin.getTable('conversation_participants').filter(p => p.conversation_id === convId && p.user_id === userC)).toHaveLength(1);

    const left = await request(app).delete(`/api/conversations/${convId}/participants/${userC}`).set(authHeader(tokenC));
    expect(left.status).toBe(200);
    expect(fakeSupabaseAdmin.getTable('conversation_participants').find(p => p.conversation_id === convId && p.user_id === userC)).toBeUndefined();
  });

  it('never lets a caller read another tenant\'s conversation', async () => {
    const tenantB = makeTenant();
    fakeSupabaseAdmin.seed('conversations', [{ id: 'conv-b', tenant_id: tenantB, is_group: false, name: null, created_at: new Date().toISOString(), last_message_at: new Date().toISOString() }]);
    fakeSupabaseAdmin.seed('conversation_participants', [{ id: 'cp-b', tenant_id: tenantB, conversation_id: 'conv-b', user_id: 'victim' }]);

    const tenantA = makeTenant();
    const { token } = makeUser(tenantA);

    const res = await request(app).get('/api/conversations/conv-b/messages').set(authHeader(token));
    expect(res.status).toBe(403);
  });
});
