import { useCallback, useEffect, useState } from 'react';

import { POLLING_INTERVAL_MS } from '../shared/constants';
import { ConversationOutbox, OutboxEntry } from '../shared/types';
import { fetchPublicJson } from '../storage/driveApi';
import {
  getConversation,
  addMemberToConversation,
  updateConversationLastMessage,
} from '../conversations/conversationStore';

export interface ConversationMessage extends OutboxEntry {
  fromMe: boolean;
}

export function useConversationMessages(userSub: string, userEmail: string, convId: string) {
  const [messages, setMessages] = useState<ConversationMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchMessages = useCallback(async () => {
    try {
      const conv = await getConversation(userSub, convId);
      if (!conv) {
        setMessages([]);
        setError(null);
        setLoading(false);
        return;
      }

      const allMessages: ConversationMessage[] = [];

      // My own messages
      try {
        const myOutbox = await fetchPublicJson<ConversationOutbox>(conv.my_outbox_url);
        for (const msg of myOutbox.messages) {
          allMessages.push({ ...msg, fromMe: true });
        }
      } catch {
        // Not yet written — empty
      }

      // Each known member's messages
      for (const member of conv.members) {
        try {
          const memberOutbox = await fetchPublicJson<ConversationOutbox>(member.outbox_url);
          for (const msg of memberOutbox.messages) {
            allMessages.push({ ...msg, fromMe: false });

            // Discover new members from sender_outbox_url in message manifests
            // (handled separately in the conversation screen via manifest reads)
          }
        } catch {
          // Member may not have posted yet
        }
      }

      const sorted = allMessages.sort(
        (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
      );

      // Update last_message_at
      if (sorted.length > 0) {
        const latest = sorted[sorted.length - 1];
        await updateConversationLastMessage(userSub, convId, latest.timestamp);
      }

      setMessages(sorted);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load messages');
    } finally {
      setLoading(false);
    }
  }, [userSub, userEmail, convId]);

  useEffect(() => {
    fetchMessages();
    const interval = setInterval(fetchMessages, POLLING_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [fetchMessages]);

  return { messages, loading, error, refresh: fetchMessages };
}
