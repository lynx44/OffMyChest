import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Image,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';

import { useAuth } from '../../../../src/auth/GoogleAuthProvider';
import { getContacts } from '../../../../src/contacts/contactStore';
import { useConversationMessages, ConversationMessage } from '../../../../src/messages/useConversationMessages';
import { getWatchStates } from '../../../../src/messages/watchStateStore';
import { Contact } from '../../../../src/shared/types';

/** Reverse base64url → original URL */
function decodeThreadId(encoded: string): string {
  const padded = encoded + '==='.slice((encoded.length + 3) % 4);
  return atob(padded.replace(/-/g, '+').replace(/_/g, '/'));
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const diffDays = Math.floor((now.getTime() - d.getTime()) / 86400000);
  if (diffDays === 0) return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  if (diffDays === 1) return 'Yesterday';
  if (diffDays < 7) return d.toLocaleDateString([], { weekday: 'short' });
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

/** base64url-encode for passing manifest URL as a route param */
function encodeParam(url: string): string {
  return btoa(url).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

export default function ConversationScreen() {
  const { threadId } = useLocalSearchParams<{ threadId: string }>();
  const { user } = useAuth();
  const router = useRouter();

  const contactOutboxUrl = decodeThreadId(threadId);
  const { messages, loading, error, refresh } = useConversationMessages(
    user?.sub ?? '',
    contactOutboxUrl,
    threadId,
  );

  const [contactName, setContactName] = useState('');

  // Load contact name
  useEffect(() => {
    if (!user) return;
    getContacts(user.sub).then((contacts) => {
      const match = contacts.find((c: Contact) => c.outbox_url === contactOutboxUrl);
      if (match) setContactName(match.name);
    });
  }, [user, contactOutboxUrl]);

  // Refresh when screen comes back into focus
  useFocusEffect(useCallback(() => { refresh(); }, [refresh]));

  // Autoplay on first load: pick the right video based on watch history
  const autoplayDone = useRef(false);
  useEffect(() => {
    if (loading || autoplayDone.current || messages.length === 0) return;
    autoplayDone.current = true;

    (async () => {
      const urls = messages.map((m) => m.manifest_url);
      const states = await getWatchStates(urls);

      // Priority 1: last partially-watched video (most recently watched incomplete)
      let partial: ConversationMessage | null = null;
      let partialTime = '';
      for (const msg of messages) {
        const ws = states.get(msg.manifest_url);
        if (ws && !ws.completed && ws.positionMs > 0) {
          if (!partial || ws.lastWatchedAt > partialTime) {
            partial = msg;
            partialTime = ws.lastWatchedAt;
          }
        }
      }
      if (partial) { handlePlay(partial); return; }

      // Priority 2: first unwatched video after the last completed one
      let lastCompletedIdx = -1;
      for (let i = messages.length - 1; i >= 0; i--) {
        const ws = states.get(messages[i].manifest_url);
        if (ws?.completed) { lastCompletedIdx = i; break; }
      }
      if (lastCompletedIdx >= 0 && lastCompletedIdx < messages.length - 1) {
        handlePlay(messages[lastCompletedIdx + 1]);
        return;
      }

      // Priority 3: no watch history — play the oldest (first) video
      if (states.size === 0) {
        handlePlay(messages[0]);
        return;
      }
    })();
  }, [loading, messages]);

  function handlePlay(msg: ConversationMessage) {
    const encoded = encodeParam(msg.manifest_url);
    router.push(`/(app)/conversations/${threadId}/play?manifest=${encoded}`);
  }

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {error ? (
        <View style={styles.errorBanner}>
          <Text style={styles.errorText}>{error}</Text>
        </View>
      ) : null}

      <FlatList
        data={messages}
        keyExtractor={(m) => m.message_id}
        contentContainerStyle={styles.list}
        ListEmptyComponent={
          <View style={styles.emptyContainer}>
            <Text style={styles.emptyText}>No messages yet.</Text>
            <Text style={styles.emptyHint}>Tap Record to send the first one.</Text>
          </View>
        }
        renderItem={({ item }) => (
          <View style={[styles.row, item.fromMe ? styles.rowMe : styles.rowThem]}>
            <TouchableOpacity
              style={[styles.bubble, item.fromMe ? styles.bubbleMe : styles.bubbleThem]}
              onPress={() => handlePlay(item)}
              activeOpacity={0.8}
            >
              {/* Thumbnail */}
              {item.thumbnail_url ? (
                <Image
                  source={{ uri: item.thumbnail_url }}
                  style={styles.thumbnail}
                  resizeMode="cover"
                />
              ) : (
                <View style={[styles.thumbnail, styles.thumbnailPlaceholder]}>
                  <Text style={styles.thumbnailIcon}>▶</Text>
                </View>
              )}

              {/* Play overlay */}
              <View style={styles.playOverlay}>
                <View style={styles.playButton}>
                  <Text style={styles.playIcon}>▶</Text>
                </View>
              </View>

              {/* Meta */}
              <View style={styles.meta}>
                <Text style={[styles.duration, item.fromMe ? styles.metaMe : styles.metaThem]}>
                  {formatDuration(item.duration_seconds)}
                </Text>
                <Text style={[styles.time, item.fromMe ? styles.metaMe : styles.metaThem]}>
                  {formatTime(item.timestamp)}
                </Text>
              </View>
            </TouchableOpacity>
          </View>
        )}
      />

      {/* Record button */}
      <View style={styles.toolbar}>
        <TouchableOpacity
          style={styles.recordBtn}
          onPress={() => router.push(`/(app)/conversations/${threadId}/record`)}
        >
          <View style={styles.recordDot} />
        </TouchableOpacity>
      </View>
    </View>
  );
}

const THUMBNAIL_HEIGHT = 160;

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f2f2f7' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  list: { padding: 12, paddingBottom: 80 },

  emptyContainer: { alignItems: 'center', paddingTop: 60, gap: 8 },
  emptyText: { fontSize: 16, fontWeight: '600', color: '#333' },
  emptyHint: { fontSize: 14, color: '#888' },

  errorBanner: { backgroundColor: '#ffcdd2', padding: 10, alignItems: 'center' },
  errorText: { color: '#c62828', fontSize: 13 },

  row: { marginVertical: 4, flexDirection: 'row' },
  rowMe: { justifyContent: 'flex-end' },
  rowThem: { justifyContent: 'flex-start' },

  bubble: {
    width: 220,
    borderRadius: 16,
    overflow: 'hidden',
  },
  bubbleMe: { backgroundColor: '#007AFF' },
  bubbleThem: { backgroundColor: '#fff' },

  thumbnail: {
    width: '100%',
    height: THUMBNAIL_HEIGHT,
    backgroundColor: '#000',
  },
  thumbnailPlaceholder: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  thumbnailIcon: { fontSize: 32, color: '#555' },

  playOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    height: THUMBNAIL_HEIGHT,
  },
  playButton: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: 'rgba(0,0,0,0.55)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  playIcon: { color: '#fff', fontSize: 18, marginLeft: 3 },

  meta: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  duration: { fontSize: 13, fontWeight: '600' },
  time: { fontSize: 12 },
  metaMe: { color: 'rgba(255,255,255,0.9)' },
  metaThem: { color: '#555' },

  toolbar: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    paddingBottom: 32,
    paddingTop: 12,
    backgroundColor: '#f2f2f7',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#ccc',
    alignItems: 'center',
  },
  recordBtn: {
    width: 60,
    height: 60,
    borderRadius: 30,
    borderWidth: 3,
    borderColor: '#FF3B30',
    alignItems: 'center',
    justifyContent: 'center',
  },
  recordDot: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#FF3B30',
  },
});
