import { useFocusEffect, useRouter } from 'expo-router';
import React, { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';

import { useAuth } from '../../../src/auth/GoogleAuthProvider';
import { getConversations } from '../../../src/conversations/conversationStore';
import { LocalConversation } from '../../../src/shared/types';

function formatTime(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  const now = new Date();
  const diffDays = Math.floor((now.getTime() - d.getTime()) / 86400000);
  if (diffDays === 0) return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  if (diffDays === 1) return 'Yesterday';
  if (diffDays < 7) return d.toLocaleDateString([], { weekday: 'short' });
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

export default function ConversationsScreen() {
  const { user } = useAuth();
  const router = useRouter();
  const [conversations, setConversations] = useState<LocalConversation[]>([]);
  const [loading, setLoading] = useState(true);

  useFocusEffect(useCallback(() => {
    if (!user) return;
    setLoading(true);
    getConversations(user.sub).then((convs) => {
      // Sort by most recent message first
      const sorted = [...convs].sort((a, b) => {
        const ta = a.last_message_at ?? a.created_at;
        const tb = b.last_message_at ?? b.created_at;
        return tb.localeCompare(ta);
      });
      setConversations(sorted);
      setLoading(false);
    });
  }, [user]));

  if (loading) {
    return <View style={styles.center}><ActivityIndicator /></View>;
  }

  return (
    <View style={styles.container}>
      <FlatList
        data={conversations}
        keyExtractor={(c) => c.conv_id}
        ListEmptyComponent={
          <View style={styles.center}>
            <Text style={styles.empty}>No conversations yet.</Text>
            <Text style={styles.hint}>Tap + to start one.</Text>
          </View>
        }
        renderItem={({ item }) => (
          <TouchableOpacity
            style={styles.row}
            onPress={() => router.push(`/(app)/conversations/${item.conv_id}`)}
          >
            <View style={styles.avatar}>
              <Text style={styles.avatarText}>{item.name.charAt(0).toUpperCase()}</Text>
            </View>
            <View style={styles.rowText}>
              <Text style={styles.name}>{item.name}</Text>
              <Text style={styles.sub} numberOfLines={1}>
                {item.members.length > 0
                  ? item.members.map((m) => m.name).join(', ')
                  : 'No members yet — share your invite link'}
              </Text>
            </View>
            <Text style={styles.time}>{formatTime(item.last_message_at ?? item.created_at)}</Text>
          </TouchableOpacity>
        )}
        ItemSeparatorComponent={() => <View style={styles.separator} />}
      />

      <View style={styles.fab}>
        <TouchableOpacity
          style={styles.fabNew}
          onPress={() => router.push('/(app)/conversations/new')}
        >
          <Text style={styles.fabText}>+</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.fabJoin}
          onPress={() => router.push('/(app)/conversations/join')}
        >
          <Text style={styles.fabJoinText}>Join</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 8, paddingTop: 60 },
  empty: { fontSize: 18, fontWeight: '600' },
  hint: { fontSize: 14, color: '#666' },
  row: { flexDirection: 'row', alignItems: 'center', padding: 16, gap: 12 },
  avatar: {
    width: 48, height: 48, borderRadius: 24,
    backgroundColor: '#4285F4',
    alignItems: 'center', justifyContent: 'center',
  },
  avatarText: { color: '#fff', fontSize: 20, fontWeight: '700' },
  rowText: { flex: 1 },
  name: { fontSize: 16, fontWeight: '600' },
  sub: { fontSize: 13, color: '#888', marginTop: 2 },
  time: { fontSize: 12, color: '#aaa' },
  separator: { height: StyleSheet.hairlineWidth, backgroundColor: '#eee', marginLeft: 76 },
  fab: {
    position: 'absolute',
    bottom: 24,
    right: 20,
    flexDirection: 'row',
    gap: 12,
    alignItems: 'center',
  },
  fabNew: {
    width: 56, height: 56, borderRadius: 28,
    backgroundColor: '#007AFF',
    alignItems: 'center', justifyContent: 'center',
    shadowColor: '#000', shadowOpacity: 0.2, shadowRadius: 6, shadowOffset: { width: 0, height: 2 },
    elevation: 4,
  },
  fabText: { color: '#fff', fontSize: 30, lineHeight: 34, fontWeight: '300' },
  fabJoin: {
    height: 40,
    paddingHorizontal: 16,
    borderRadius: 20,
    backgroundColor: '#f0f0f0',
    alignItems: 'center', justifyContent: 'center',
  },
  fabJoinText: { fontSize: 14, fontWeight: '600', color: '#333' },
});
