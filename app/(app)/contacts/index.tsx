import { useFocusEffect } from 'expo-router';
import React, { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Modal,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';

import { useAuth } from '../../../src/auth/GoogleAuthProvider';
import { getContacts, removeContact } from '../../../src/contacts/contactStore';
import { getMyOutboxUrl } from '../../../src/outbox/outboxService';
import { Contact } from '../../../src/shared/types';
import { QRGenerator } from '../../../src/qr/QRGenerator';

export default function ContactsScreen() {
  const { user } = useAuth();
  const router = useRouter();
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [myOutboxUrl, setMyOutboxUrl] = useState<string | null>(null);
  const [showQR, setShowQR] = useState(false);
  const [loading, setLoading] = useState(true);

  useFocusEffect(useCallback(() => {
    if (!user) return;
    setLoading(true);
    Promise.all([
      getContacts(user.sub),
      getMyOutboxUrl(user.sub),
    ]).then(([c, url]) => {
      setContacts(c);
      setMyOutboxUrl(url);
      setLoading(false);
    });
  }, [user]));

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.actions}>
        <TouchableOpacity
          style={styles.button}
          onPress={() => setShowQR(true)}
          disabled={!myOutboxUrl}
        >
          <Text style={styles.buttonText}>My QR Code</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.button, styles.secondaryButton]}
          onPress={() => router.push('/(app)/contacts/scan')}
        >
          <Text style={[styles.buttonText, styles.secondaryButtonText]}>Scan QR Code</Text>
        </TouchableOpacity>
      </View>

      {contacts.length === 0 ? (
        <View style={styles.center}>
          <Text style={styles.empty}>No contacts yet.</Text>
          <Text style={styles.hint}>Share your QR code or scan a friend's.</Text>
        </View>
      ) : (
        <FlatList
          data={contacts}
          keyExtractor={(c) => c.email}
          renderItem={({ item }) => (
            <View style={styles.contactRow}>
              <View style={{ flex: 1 }}>
                <Text style={styles.contactName}>{item.name}</Text>
                <Text style={styles.contactEmail}>{item.email}</Text>
              </View>
              <TouchableOpacity
                onPress={async () => {
                  await removeContact(user!.sub, item.email);
                  setContacts(prev => prev.filter(c => c.email !== item.email));
                }}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              >
                <Text style={styles.deleteText}>Delete</Text>
              </TouchableOpacity>
            </View>
          )}
        />
      )}

      <Modal visible={showQR} animationType="slide" onRequestClose={() => setShowQR(false)}>
        <View style={styles.modalContainer}>
          <TouchableOpacity style={styles.closeButton} onPress={() => setShowQR(false)}>
            <Text style={styles.closeButtonText}>Close</Text>
          </TouchableOpacity>
          {myOutboxUrl && user && (
            <QRGenerator outboxUrl={myOutboxUrl} displayName={user.name} />
          )}
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 8 },
  actions: {
    flexDirection: 'row',
    gap: 12,
    padding: 16,
  },
  button: {
    flex: 1,
    backgroundColor: '#4285F4',
    paddingVertical: 12,
    borderRadius: 8,
    alignItems: 'center',
  },
  secondaryButton: {
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#4285F4',
  },
  buttonText: {
    color: '#fff',
    fontWeight: '600',
  },
  secondaryButtonText: {
    color: '#4285F4',
  },
  empty: { fontSize: 18, fontWeight: '600' },
  hint: { fontSize: 14, color: '#666' },
  contactRow: {
    padding: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#ddd',
  },
  contactName: { fontSize: 16, fontWeight: '600' },
  contactEmail: { fontSize: 13, color: '#666', marginTop: 2 },
  deleteText: { color: '#FF3B30', fontSize: 14, fontWeight: '600' },
  modalContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  closeButton: {
    position: 'absolute',
    top: 56,
    right: 24,
  },
  closeButtonText: {
    fontSize: 16,
    color: '#4285F4',
    fontWeight: '600',
  },
});
