import AsyncStorage from '@react-native-async-storage/async-storage';
import { useCallback, useEffect, useState } from 'react';

import { POLLING_INTERVAL_MS, STORAGE_KEYS } from '../shared/constants';
import { Outbox, OutboxEntry } from '../shared/types';
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
 *   - My messages to the contact  (from my outbox,      thread_id === threadId)
 *   - Their messages to me        (from their outbox,   thread_id === encodeThreadId(myOutboxUrl))
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

      // thread_id the contact uses when messaging me
      const myThreadId = myOutboxUrl ? encodeThreadId(myOutboxUrl) : null;

      const [contactOutbox, myOutbox] = await Promise.all([
        fetchPublicJson<Outbox>(contactOutboxUrl),
        myOutboxUrl ? fetchPublicJson<Outbox>(myOutboxUrl) : Promise.resolve(null),
      ]);

      const received: ConversationMessage[] = myThreadId
        ? contactOutbox.messages
            .filter((m) => m.thread_id === myThreadId)
            .map((m) => ({ ...m, fromMe: false }))
        : [];

      const sent: ConversationMessage[] = myOutbox
        ? myOutbox.messages
            .filter((m) => m.thread_id === threadId)
            .map((m) => ({ ...m, fromMe: true }))
        : [];

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
