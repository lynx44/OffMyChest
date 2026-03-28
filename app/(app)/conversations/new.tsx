import * as Contacts from 'expo-contacts';
import * as Crypto from 'expo-crypto';
import * as SMS from 'expo-sms';
import { useRouter } from 'expo-router';
import React, { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  AppState,
  Linking,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';

import { useAuth } from '../../../src/auth/GoogleAuthProvider';
import { useStorageAdapter } from '../../../src/storage/useStorageAdapter';
import { saveConversation } from '../../../src/conversations/conversationStore';

interface PhoneContact {
  id: string;
  name: string;
  phoneNumber: string | null;
}

interface SelectedContact {
  id: string;
  name: string;
  phoneNumber: string | null;
}

export default function NewConversationScreen() {
  const { user } = useAuth();
  const adapter = useStorageAdapter();
  const router = useRouter();

  // Contact search state
  const [searchQuery, setSearchQuery] = useState('');
  const [allContacts, setAllContacts] = useState<PhoneContact[]>([]);
  const [suggestions, setSuggestions] = useState<PhoneContact[]>([]);
  const [selected, setSelected] = useState<SelectedContact[]>([]);
  const [contactsPermission, setContactsPermission] = useState<'unknown' | 'granted' | 'denied'>('unknown');

  // Manual creation state
  const [showManualInput, setShowManualInput] = useState(false);
  const [manualName, setManualName] = useState('');
  const manualInputRef = useRef<TextInput>(null);

  // Creation state
  const [loading, setLoading] = useState(false);
  const [inviteResult, setInviteResult] = useState<{ convId: string; link: string; recipientPhones: string[] } | null>(null);

  const searchRef = useRef<TextInput>(null);

  // Check contacts permission on mount (don't request yet)
  useEffect(() => {
    checkContactsPermission();

    // Re-check when user returns from Settings
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') checkContactsPermission();
    });
    return () => sub.remove();
  }, []);

  async function checkContactsPermission() {
    const { status } = await Contacts.getPermissionsAsync();
    if (status === 'granted') {
      setContactsPermission('granted');
      loadContacts();
    } else if (status === 'denied') {
      setContactsPermission('denied');
    }
    // 'unknown' stays as-is — request only when user taps search
  }

  async function requestContactsPermission() {
    const { status } = await Contacts.requestPermissionsAsync();
    if (status === 'granted') {
      setContactsPermission('granted');
      loadContacts();
    } else {
      setContactsPermission('denied');
    }
  }

  async function loadContacts() {
    const { data } = await Contacts.getContactsAsync({
      fields: [Contacts.Fields.Name, Contacts.Fields.PhoneNumbers],
    });
    const mapped: PhoneContact[] = data
      .filter((c) => c.name)
      .map((c) => ({
        id: c.id ?? c.name!,
        name: c.name!,
        phoneNumber: c.phoneNumbers?.[0]?.number ?? null,
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
    setAllContacts(mapped);
  }

  // Update suggestions when search query changes
  useEffect(() => {
    if (!searchQuery.trim()) {
      setSuggestions([]);
      return;
    }
    const q = searchQuery.toLowerCase();
    const filtered = allContacts
      .filter(
        (c) =>
          c.name.toLowerCase().includes(q) &&
          !selected.some((s) => s.id === c.id),
      )
      .slice(0, 6);
    setSuggestions(filtered);
  }, [searchQuery, allContacts, selected]);

  function selectContact(contact: PhoneContact) {
    setSelected((prev) => [...prev, contact]);
    setSearchQuery('');
    setSuggestions([]);
    searchRef.current?.focus();
  }

  function removeContact(id: string) {
    setSelected((prev) => prev.filter((c) => c.id !== id));
  }

  // Auto-derive conversation name from selected contacts
  const derivedName = selected.map((c) => c.name).join(', ');

  async function createConversation(name: string) {
    if (!adapter || !user || !name.trim()) return;
    setLoading(true);
    try {
      const convId = Crypto.randomUUID();
      const { url: myOutboxUrl, fileId: myOutboxFileId } = await adapter.createConversationOutbox(convId);

      await saveConversation(user.sub, {
        conv_id: convId,
        name: name.trim(),
        my_outbox_url: myOutboxUrl,
        my_outbox_file_id: myOutboxFileId,
        members: [],
        created_at: new Date().toISOString(),
        last_message_at: null,
      });

      const link = buildInviteLink({
        convId,
        convName: name.trim(),
        outboxUrl: myOutboxUrl,
        fromName: user.name,
        fromEmail: user.email,
      });

      const phones = selected.map((c) => c.phoneNumber).filter((p): p is string => !!p);
      setInviteResult({ convId, link, recipientPhones: phones });
    } catch (err) {
      console.error('Failed to create conversation:', err);
    } finally {
      setLoading(false);
    }
  }

  function handleCreateFromContacts() {
    createConversation(derivedName);
  }

  function handleStartConversation() {
    setShowManualInput(true);
    setTimeout(() => manualInputRef.current?.focus(), 50);
  }

  function handleCreateManual() {
    if (manualName.trim()) createConversation(manualName.trim());
  }

  // Send invite via SMS to selected contacts (if they have phone numbers)
  async function handleSendSMS() {
    if (!inviteResult) return;
    const { recipientPhones, link, convId } = inviteResult;

    if (recipientPhones.length > 0) {
      const isAvailable = await SMS.isAvailableAsync();
      if (isAvailable) {
        await SMS.sendSMSAsync(
          recipientPhones,
          `Join me on Off My Chest!\n\n${link}`,
        );
        router.replace(`/(app)/conversations/${convId}`);
        return;
      }
    }

    // Fallback to generic share sheet
    Share.share({ message: `Join me on Off My Chest!\n\n${link}` });
  }

  function handleShareLink() {
    if (!inviteResult) return;
    Share.share({ message: `Join me on Off My Chest!\n\n${inviteResult.link}` });
  }

  function handleOpen() {
    if (!inviteResult) return;
    router.replace(`/(app)/conversations/${inviteResult.convId}`);
  }

  // ── Invite sent confirmation screen ────────────────────────────────────────
  if (inviteResult) {
    const hasPhones = inviteResult.recipientPhones.length > 0;
    return (
      <View style={styles.confirmContainer}>
        <Text style={styles.confirmHeading}>Conversation created!</Text>
        <Text style={styles.confirmSub}>
          Invite the other person so they can see your messages.
        </Text>

        {hasPhones ? (
          <TouchableOpacity style={styles.primaryBtn} onPress={handleSendSMS}>
            <Text style={styles.primaryBtnText}>
              Send Invite via Text Message
            </Text>
          </TouchableOpacity>
        ) : (
          <TouchableOpacity style={styles.primaryBtn} onPress={handleShareLink}>
            <Text style={styles.primaryBtnText}>Share Invite Link</Text>
          </TouchableOpacity>
        )}

        {hasPhones && (
          <TouchableOpacity style={styles.secondaryBtn} onPress={handleShareLink}>
            <Text style={styles.secondaryBtnText}>Share Link Another Way</Text>
          </TouchableOpacity>
        )}

        <TouchableOpacity style={styles.ghostBtn} onPress={handleOpen}>
          <Text style={styles.ghostBtnText}>Skip for now</Text>
        </TouchableOpacity>
      </View>
    );
  }

  // ── Creation screen ─────────────────────────────────────────────────────────
  return (
    <View style={styles.container}>
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.scroll}>

        {/* ── Contact picker section ── */}
        <Text style={styles.sectionLabel}>Invite from contacts</Text>

        {/* Selected contact chips */}
        {selected.length > 0 && (
          <View style={styles.chips}>
            {selected.map((c) => (
              <TouchableOpacity
                key={c.id}
                style={styles.chip}
                onPress={() => removeContact(c.id)}
              >
                <Text style={styles.chipText}>{c.name}</Text>
                <Text style={styles.chipX}> ×</Text>
              </TouchableOpacity>
            ))}
          </View>
        )}

        {/* Search input */}
        {contactsPermission === 'denied' ? (
          <TouchableOpacity style={styles.searchRow} onPress={() => Linking.openSettings()}>
            <Text style={styles.searchDeniedText}>Tap to allow contacts access in Settings</Text>
          </TouchableOpacity>
        ) : contactsPermission === 'unknown' ? (
          <TouchableOpacity style={styles.searchRow} onPress={requestContactsPermission}>
            <Text style={styles.searchPlaceholderText}>Search contacts…</Text>
          </TouchableOpacity>
        ) : (
          <View style={styles.searchRow}>
            <TextInput
              ref={searchRef}
              style={styles.searchInput}
              value={searchQuery}
              onChangeText={setSearchQuery}
              placeholder="Search contacts…"
              placeholderTextColor="#aaa"
              autoCorrect={false}
            />
          </View>
        )}

        {/* Autocomplete suggestions */}
        {suggestions.length > 0 && (
          <View style={styles.suggestions}>
            {suggestions.map((c) => (
              <TouchableOpacity
                key={c.id}
                style={styles.suggestionRow}
                onPress={() => selectContact(c)}
              >
                <View style={styles.suggestionAvatar}>
                  <Text style={styles.suggestionAvatarText}>
                    {c.name.charAt(0).toUpperCase()}
                  </Text>
                </View>
                <View style={styles.suggestionText}>
                  <Text style={styles.suggestionName}>{c.name}</Text>
                  {c.phoneNumber && (
                    <Text style={styles.suggestionPhone}>{c.phoneNumber}</Text>
                  )}
                </View>
              </TouchableOpacity>
            ))}
          </View>
        )}

        {/* Create from contacts button */}
        {selected.length > 0 && (
          loading ? (
            <ActivityIndicator style={{ marginTop: 20 }} />
          ) : (
            <TouchableOpacity style={[styles.primaryBtn, styles.createBtn]} onPress={handleCreateFromContacts}>
              <Text style={styles.primaryBtnText}>
                {selected.length === 1
                  ? `Create conversation with ${selected[0].name}`
                  : `Create group with ${selected.length} people`}
              </Text>
            </TouchableOpacity>
          )
        )}

        {/* ── Divider ── */}
        <View style={styles.divider}>
          <View style={styles.dividerLine} />
          <Text style={styles.dividerText}>or</Text>
          <View style={styles.dividerLine} />
        </View>

        {/* ── Manual section ── */}
        {showManualInput ? (
          <View style={styles.manualInputRow}>
            <TextInput
              ref={manualInputRef}
              style={styles.manualInput}
              value={manualName}
              onChangeText={setManualName}
              placeholder="Conversation name…"
              placeholderTextColor="#aaa"
              returnKeyType="done"
              onSubmitEditing={handleCreateManual}
            />
            {loading ? (
              <ActivityIndicator style={{ marginLeft: 12 }} />
            ) : (
              <TouchableOpacity
                style={[styles.manualCreateBtn, !manualName.trim() && styles.manualCreateBtnDisabled]}
                onPress={handleCreateManual}
                disabled={!manualName.trim()}
              >
                <Text style={styles.manualBtnText}>Create</Text>
              </TouchableOpacity>
            )}
          </View>
        ) : loading ? (
          <ActivityIndicator style={{ marginTop: 4 }} />
        ) : (
          <>
            <TouchableOpacity style={styles.manualBtn} onPress={handleStartConversation}>
              <Text style={styles.manualBtnText}>Start a conversation</Text>
            </TouchableOpacity>
            <Text style={styles.manualHint}>You can invite others after it's created.</Text>
          </>
        )}

      </ScrollView>
    </View>
  );
}

export function buildInviteLink(params: {
  convId: string;
  convName: string;
  outboxUrl: string;
  fromName: string;
  fromEmail: string;
}): string {
  const encoded = btoa(params.outboxUrl).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
  return (
    `offmychest://join` +
    `?conv=${encodeURIComponent(params.convId)}` +
    `&outbox=${encoded}` +
    `&name=${encodeURIComponent(params.convName)}` +
    `&fromName=${encodeURIComponent(params.fromName)}` +
    `&fromEmail=${encodeURIComponent(params.fromEmail)}`
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff' },
  scroll: { padding: 20, paddingBottom: 40 },

  sectionLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: '#888',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 10,
    marginTop: 4,
  },

  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 10 },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#e8f0fe',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
  },
  chipText: { color: '#1a73e8', fontSize: 14, fontWeight: '500' },
  chipX: { color: '#1a73e8', fontSize: 16, fontWeight: '600' },

  searchRow: {
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 11,
    backgroundColor: '#fafafa',
  },
  searchInput: { fontSize: 16, color: '#000' },
  searchDeniedText: { fontSize: 15, color: '#007AFF' },
  searchPlaceholderText: { fontSize: 16, color: '#aaa' },

  suggestions: {
    marginTop: 4,
    borderWidth: 1,
    borderColor: '#eee',
    borderRadius: 10,
    overflow: 'hidden',
    backgroundColor: '#fff',
    shadowColor: '#000',
    shadowOpacity: 0.06,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 3,
  },
  suggestionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    gap: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#f0f0f0',
  },
  suggestionAvatar: {
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: '#4285F4',
    alignItems: 'center', justifyContent: 'center',
  },
  suggestionAvatarText: { color: '#fff', fontWeight: '700', fontSize: 15 },
  suggestionText: { flex: 1 },
  suggestionName: { fontSize: 15, fontWeight: '500', color: '#000' },
  suggestionPhone: { fontSize: 13, color: '#888', marginTop: 1 },

  createBtn: { marginTop: 16 },

  divider: {
    flexDirection: 'row',
    alignItems: 'center',
    marginVertical: 28,
    gap: 12,
  },
  dividerLine: { flex: 1, height: StyleSheet.hairlineWidth, backgroundColor: '#ddd' },
  dividerText: { color: '#aaa', fontSize: 13, fontWeight: '500' },

  manualInputRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  manualInput: {
    flex: 1,
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 11,
    fontSize: 16,
    color: '#000',
    backgroundColor: '#fafafa',
  },
  manualCreateBtn: {
    backgroundColor: '#007AFF',
    paddingHorizontal: 18,
    paddingVertical: 11,
    borderRadius: 10,
  },
  manualCreateBtnDisabled: { backgroundColor: '#c0d9f0' },
  manualBtn: {
    backgroundColor: '#007AFF',
    paddingVertical: 14,
    borderRadius: 10,
    alignItems: 'center',
  },
  manualBtnText: { color: '#fff', fontWeight: '600', fontSize: 16 },
  manualHint: { textAlign: 'center', color: '#aaa', fontSize: 13, marginTop: 10 },

  // Confirmation screen
  confirmContainer: {
    flex: 1, padding: 28, backgroundColor: '#fff',
    justifyContent: 'center',
  },
  confirmHeading: { fontSize: 24, fontWeight: '700', marginBottom: 10 },
  confirmSub: { fontSize: 15, color: '#555', marginBottom: 28, lineHeight: 22 },

  primaryBtn: {
    backgroundColor: '#007AFF',
    paddingVertical: 14,
    borderRadius: 10,
    alignItems: 'center',
    marginBottom: 12,
  },
  primaryBtnText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  secondaryBtn: {
    paddingVertical: 14, borderRadius: 10,
    alignItems: 'center',
    borderWidth: 1, borderColor: '#007AFF',
    marginBottom: 12,
  },
  secondaryBtnText: { color: '#007AFF', fontSize: 16, fontWeight: '600' },
  ghostBtn: { paddingVertical: 10, alignItems: 'center', marginTop: 4 },
  ghostBtnText: { color: '#aaa', fontSize: 15 },
});
