import AsyncStorage from '@react-native-async-storage/async-storage';
import { useCallback, useEffect, useState } from 'react';

import { POLLING_INTERVAL_MS, STORAGE_KEYS } from '../shared/constants';
import { Outbox, ThreadOutbox, OutboxEntry } from '../shared/types';
import { fetchPublicJson } from '../storage/driveApi';

export interface ConversationMessage extends OutboxEntry {
  fromMe: boolean;
}

/** base64url-encode a string (URL-safe, no padding) */
function encodeThreadId(url: string): string {
  return btoa(url).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

/**
 * Fetches and merges messages for a conversation:
 *   - My messages to the contact  (from my per-thread outbox)
 *   - Their messages to me        (from their per-thread outbox, discovered via their root outbox)
 *
 * Polls on POLLING_INTERVAL_MS and re-fetches when `refresh()` is called.
 */
export function useConversationMessages(
  userSub: string,
  contactOutboxUrl: string,
  /** The threadId URL param (= encodeThreadId(contactOutboxUrl)) */
  threadId: string,
) {
  const [messages, setMessages] = useState<ConversationMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchMessages = useCallback(async () => {
    try {
      const myOutboxUrl = await AsyncStorage.getItem(
        STORAGE_KEYS.driveOutboxPublicUrl(userSub),
      );

      // The key the contact uses to look up their messages from me in my threads map.
      // = base64url(contactOutboxUrl) = the route threadId param.
      // The key I use to look up messages from them in their threads map
      // = base64url(myOutboxUrl).
      const myThreadId = myOutboxUrl ? encodeThreadId(myOutboxUrl) : null;

      // --- Received messages ---
      // Fetch contact's root outbox to discover the URL of their thread outbox for me
      let received: ConversationMessage[] = [];
      try {
        const contactRootOutbox = await fetchPublicJson<Outbox>(contactOutboxUrl);
        const contactThreadUrl = myThreadId ? contactRootOutbox.threads?.[myThreadId] : null;
        if (contactThreadUrl) {
          const contactThreadOutbox = await fetchPublicJson<ThreadOutbox>(contactThreadUrl);
          received = contactThreadOutbox.messages.map((m) => ({ ...m, fromMe: false }));
        }
      } catch {
        // Contact may not have sent anything yet — not an error
      }

      // --- Sent messages ---
      // Read from my own thread outbox for this contact (cached URL in AsyncStorage)
      let sent: ConversationMessage[] = [];
      const myThreadOutboxUrl = await AsyncStorage.getItem(
        STORAGE_KEYS.myThreadOutboxUrl(threadId),
      );
      if (myThreadOutboxUrl) {
        try {
          const myThreadOutbox = await fetchPublicJson<ThreadOutbox>(myThreadOutboxUrl);
          sent = myThreadOutbox.messages.map((m) => ({ ...m, fromMe: true }));
        } catch {
          // Not yet written — empty
        }
      }

      const all = [...received, ...sent].sort(
        (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
      );

      setMessages(all);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load messages');
    } finally {
      setLoading(false);
    }
  }, [userSub, contactOutboxUrl, threadId]);

  useEffect(() => {
    fetchMessages();
    const interval = setInterval(fetchMessages, POLLING_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [fetchMessages]);

  return { messages, loading, error, refresh: fetchMessages };
}
