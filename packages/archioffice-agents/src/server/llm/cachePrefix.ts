// Applique `LlmChatParams.cachePrefix` pour les fournisseurs sans balise de
// cache explicite (Gemini met en cache de lui-même un préfixe identique,
// Mistral n'a pas de cache) : le préfixe est simplement placé devant le texte
// du premier message utilisateur. Garder le préfixe en tête est ce qui rend le
// cache implicite possible.
import type { LlmMessage } from './types.js';

export function prependCachePrefix(messages: LlmMessage[], prefix?: string): LlmMessage[] {
  if (!prefix) return messages;
  const first = messages.findIndex(m => m.role === 'user');
  if (first < 0) return messages;
  return messages.map((m, i) =>
    i === first && m.role === 'user' ? { ...m, content: m.content ? `${prefix}\n\n${m.content}` : prefix } : m,
  );
}
