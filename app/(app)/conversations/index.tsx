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
import { getContacts } from '../../../src/contacts/contactStore';
import { Contact } from '../../../src/shared/types';

export default function ConversationsScreen() {
  const { user } = useAuth();
  const router = useRouter();
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [loading, setLoading] = useState(true);

  useFocusEffect(useCallback(() => {
    if (!user) return;
    setLoading(true);
    getContacts(user.sub).then(c => {
      setContacts(c);
      setLoading(false);
    });
  }, [user]));

  if (loading) {
    return <View style={styles.center}><ActivityIndicator /></View>;
  }

  if (contacts.length === 0) {
    return (
      <View style={styles.center}>
        <Text style={styles.empty}>No conversations yet.</Text>
        <Text style={styles.hint}>Add a contact to get started.</Text>
      </View>
    );
  }

  function threadIdFor(contact: Contact) {
    // Base64url: URL-safe, no slashes that would confuse expo-router
    return btoa(contact.outbox_url).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
  }

  return (
    <FlatList
      data={contacts}
      keyExtractor={c => c.outbox_url}
      renderItem={({ item }) => (
        <TouchableOpacity
          style={styles.row}
          onPress={() => router.push(`/(app)/conversations/${threadIdFor(item)}`)}
        >
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>{item.name.charAt(0).toUpperCase()}</Text>
          </View>
          <View style={styles.rowText}>
            <Text style={styles.name}>{item.name}</Text>
            <Text style={styles.sub} numberOfLines={1}>{item.email.startsWith('pending:') ? 'Syncing...' : item.email}</Text>
          </View>
          <Text style={styles.chevron}>›</Text>
        </TouchableOpacity>
      )}
      ItemSeparatorComponent={() => <View style={styles.separator} />}
    />
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 8 },
  empty: { fontSize: 18, fontWeight: '600' },
  hint: { fontSize: 14, color: '#666' },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    gap: 12,
  },
  avatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: '#4285F4',
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: { color: '#fff', fontSize: 20, fontWeight: '700' },
  rowText: { flex: 1 },
  name: { fontSize: 16, fontWeight: '600' },
  sub: { fontSize: 13, color: '#888', marginTop: 2 },
  chevron: { fontSize: 24, color: '#ccc' },
  separator: { height: StyleSheet.hairlineWidth, backgroundColor: '#eee', marginLeft: 76 },
});
