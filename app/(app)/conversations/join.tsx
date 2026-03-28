import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Share,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';

import { useAuth } from '../../../src/auth/GoogleAuthProvider';
import { useStorageAdapter } from '../../../src/storage/useStorageAdapter';
import {
  getConversation,
  saveConversation,
  addMemberToConversation,
} from '../../../src/conversations/conversationStore';
import { buildInviteLink } from './new';

function decodeOutbox(encoded: string): string {
  const padded = encoded + '==='.slice((encoded.length + 3) % 4);
  return atob(padded.replace(/-/g, '+').replace(/_/g, '/'));
}

export default function JoinScreen() {
  const params = useLocalSearchParams<{
    conv: string;
    outbox: string;
    name: string;
    fromName: string;
    fromEmail: string;
  }>();
  const { user } = useAuth();
  const adapter = useStorageAdapter();
  const router = useRouter();

  const [loading, setLoading] = useState(false);
  const [myInviteLink, setMyInviteLink] = useState<string | null>(null);
  const [convId, setConvId] = useState<string | null>(null);
  const [alreadyMember, setAlreadyMember] = useState(false);

  const senderOutboxUrl = params.outbox ? decodeOutbox(params.outbox) : '';
  const convName = params.name ?? 'Conversation';
  const fromName = params.fromName ?? 'Someone';
  const fromEmail = params.fromEmail ?? '';

  // Check if we already belong to this conversation
  useEffect(() => {
    if (!user || !params.conv) return;
    getConversation(user.sub, params.conv).then((conv) => {
      if (conv) setAlreadyMember(true);
    });
  }, [user, params.conv]);

  async function handleJoin() {
    if (!adapter || !user || !params.conv || !senderOutboxUrl) return;
    setLoading(true);
    try {
      const id = params.conv;

      let myOutboxUrl: string;
      let myOutboxFileId: string;

      const existing = await getConversation(user.sub, id);
      if (existing) {
        // Already in this conversation — just add the new member
        myOutboxUrl = existing.my_outbox_url;
        myOutboxFileId = existing.my_outbox_file_id;
      } else {
        // New conversation — create my outbox
        const result = await adapter.createConversationOutbox(id);
        myOutboxUrl = result.url;
        myOutboxFileId = result.fileId;

        await saveConversation(user.sub, {
          conv_id: id,
          name: convName,
          my_outbox_url: myOutboxUrl,
          my_outbox_file_id: myOutboxFileId,
          members: [],
          created_at: new Date().toISOString(),
          last_message_at: null,
        });
      }

      // Add the sender as a known member
      await addMemberToConversation(user.sub, id, {
        name: fromName,
        email: fromEmail,
        outbox_url: senderOutboxUrl,
      });

      // Build my response invite link for the sender
      const link = buildInviteLink({
        convId: id,
        convName,
        outboxUrl: myOutboxUrl,
        fromName: user.name,
        fromEmail: user.email,
      });

      setConvId(id);
      setMyInviteLink(link);
    } catch (err) {
      console.error('Failed to join conversation:', err);
    } finally {
      setLoading(false);
    }
  }

  function handleShareResponse() {
    if (!myInviteLink) return;
    Share.share({
      message: `I joined your Off My Chest conversation! Send this link to add me:\n\n${myInviteLink}`,
      title: 'My join link',
    });
  }

  function handleOpen() {
    if (!convId) return;
    router.replace(`/(app)/conversations/${convId}`);
  }

  if (myInviteLink) {
    return (
      <View style={styles.container}>
        <Text style={styles.heading}>You're in!</Text>
        <Text style={styles.sub}>
          Now share YOUR link back with {fromName} so they can see your messages too.
          They need to open it in Off My Chest.
        </Text>
        <TouchableOpacity style={styles.primaryBtn} onPress={handleShareResponse}>
          <Text style={styles.primaryBtnText}>Share My Link</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.secondaryBtn} onPress={handleOpen}>
          <Text style={styles.secondaryBtnText}>Open Conversation</Text>
        </TouchableOpacity>
      </View>
    );
  }

  if (alreadyMember) {
    return (
      <View style={styles.container}>
        <Text style={styles.heading}>{convName}</Text>
        <Text style={styles.sub}>
          {fromName} wants to join this conversation (or share their link with you).
          Adding them as a member.
        </Text>
        {loading ? (
          <ActivityIndicator style={{ marginTop: 24 }} />
        ) : (
          <TouchableOpacity style={styles.primaryBtn} onPress={handleJoin}>
            <Text style={styles.primaryBtnText}>Add {fromName}</Text>
          </TouchableOpacity>
        )}
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Text style={styles.heading}>Join Conversation</Text>
      <Text style={styles.inviterName}>{fromName}</Text>
      <Text style={styles.sub}>invited you to join</Text>
      <Text style={styles.convName}>"{convName}"</Text>

      {loading ? (
        <ActivityIndicator style={{ marginTop: 32 }} />
      ) : (
        <TouchableOpacity style={styles.primaryBtn} onPress={handleJoin}>
          <Text style={styles.primaryBtnText}>Join</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 24, backgroundColor: '#fff', justifyContent: 'center' },
  heading: { fontSize: 26, fontWeight: '700', marginBottom: 12, textAlign: 'center' },
  inviterName: { fontSize: 18, fontWeight: '600', textAlign: 'center', color: '#333' },
  sub: { fontSize: 15, color: '#666', textAlign: 'center', marginBottom: 8 },
  convName: { fontSize: 18, fontWeight: '600', textAlign: 'center', marginBottom: 32 },
  primaryBtn: {
    backgroundColor: '#007AFF',
    paddingVertical: 14,
    borderRadius: 10,
    alignItems: 'center',
    marginBottom: 12,
  },
  primaryBtnText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  secondaryBtn: {
    paddingVertical: 14,
    borderRadius: 10,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#007AFF',
  },
  secondaryBtnText: { color: '#007AFF', fontSize: 16, fontWeight: '600' },
});
