/**
 * Deep link handler for offmychest://add-friend?outbox=URL&name=Alice
 * Expo Router maps the URL path segment to this file automatically.
 */
import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from 'react-native';

import { useAuth } from '../src/auth/GoogleAuthProvider';
import { addContact } from '../src/contacts/contactStore';

export default function AddFriendScreen() {
  const { outbox, name } = useLocalSearchParams<{ outbox: string; name: string }>();
  const { user } = useAuth();
  const router = useRouter();
  const [status, setStatus] = useState<'idle' | 'adding' | 'done' | 'error'>('idle');

  // If user arrives here while not logged in, they'll be redirected to auth
  // by the root layout. This screen handles the post-login case.

  async function handleAdd() {
    if (!user || !outbox || !name) return;
    setStatus('adding');

    try {
      await addContact(user.sub, {
        name,
        email: `pending:${outbox}`,
        outbox_url: outbox,
        added_at: new Date().toISOString(),
        last_seen_updated_at: null,
      });
      setStatus('done');
    } catch {
      setStatus('error');
    }
  }

  if (!outbox || !name) {
    return (
      <View style={styles.container}>
        <Text style={styles.title}>Invalid Link</Text>
        <Text style={styles.subtitle}>This link is missing required information.</Text>
        <TouchableOpacity style={styles.button} onPress={() => router.replace('/(app)/contacts')}>
          <Text style={styles.buttonText}>Go to Contacts</Text>
        </TouchableOpacity>
      </View>
    );
  }

  if (status === 'done') {
    return (
      <View style={styles.container}>
        <Text style={styles.title}>Added!</Text>
        <Text style={styles.subtitle}>{name} has been added to your contacts.</Text>
        <TouchableOpacity style={styles.button} onPress={() => router.replace('/(app)/contacts')}>
          <Text style={styles.buttonText}>Go to Contacts</Text>
        </TouchableOpacity>
      </View>
    );
  }

  if (status === 'error') {
    return (
      <View style={styles.container}>
        <Text style={styles.title}>Something went wrong</Text>
        <TouchableOpacity style={styles.button} onPress={handleAdd}>
          <Text style={styles.buttonText}>Try Again</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Add {name}?</Text>
      <Text style={styles.subtitle}>They'll appear in your contacts and you can start a conversation.</Text>

      {status === 'adding' ? (
        <ActivityIndicator style={{ marginTop: 16 }} />
      ) : (
        <TouchableOpacity style={styles.button} onPress={handleAdd}>
          <Text style={styles.buttonText}>Add Contact</Text>
        </TouchableOpacity>
      )}

      <TouchableOpacity
        style={styles.cancelButton}
        onPress={() => router.replace('/(app)/contacts')}
      >
        <Text style={styles.cancelText}>Cancel</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32, gap: 12 },
  title: { fontSize: 28, fontWeight: '700' },
  subtitle: { fontSize: 16, color: '#555', textAlign: 'center' },
  button: {
    marginTop: 16,
    backgroundColor: '#4285F4',
    paddingHorizontal: 32,
    paddingVertical: 14,
    borderRadius: 8,
  },
  buttonText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  cancelButton: { marginTop: 8 },
  cancelText: { color: '#666', fontSize: 16 },
});
