/**
 * Polls all conversation member outboxes for new messages and fires
 * local notifications. Works from both foreground and background contexts
 * since member outbox URLs are public (no auth token required).
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Notifications from 'expo-notifications';
import * as SecureStore from 'expo-secure-store';

import { getConversations } from '../conversations/conversationStore';
import { fetchPublicJson } from '../storage/driveApi';
import { ConversationOutbox } from '../shared/types';
import { SECURE_KEYS, STORAGE_KEYS } from '../shared/constants';

// ---------------------------------------------------------------------------
// Seen-message tracking
// ---------------------------------------------------------------------------

async function getSeenIds(userSub: string): Promise<Set<string>> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEYS.notifSeen(userSub));
    if (!raw) return new Set();
    return new Set(JSON.parse(raw) as string[]);
  } catch {
    return new Set();
  }
}

async function markSeen(userSub: string, ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  try {
    const existing = await getSeenIds(userSub);
    for (const id of ids) existing.add(id);
    await AsyncStorage.setItem(
      STORAGE_KEYS.notifSeen(userSub),
      JSON.stringify([...existing]),
    );
  } catch {}
}

// ---------------------------------------------------------------------------
// First-run initialization — mark all existing messages seen without notifying
// ---------------------------------------------------------------------------

export async function initializeSeenMessages(userSub: string, userEmail: string): Promise<void> {
  try {
    const alreadyInit = await AsyncStorage.getItem(STORAGE_KEYS.notifInitialized(userSub));
    if (alreadyInit) return;

    const conversations = await getConversations(userSub);
    const allIds: string[] = [];

    for (const conv of conversations) {
      for (const member of conv.members) {
        if (member.email === userEmail) continue;
        try {
          const outbox = await fetchPublicJson<ConversationOutbox>(member.outbox_url);
          for (const entry of outbox.messages ?? []) {
            allIds.push(entry.message_id);
          }
        } catch {}
      }
    }

    await markSeen(userSub, allIds);
    await AsyncStorage.setItem(STORAGE_KEYS.notifInitialized(userSub), '1');
  } catch {}
}

// ---------------------------------------------------------------------------
// Core poll — call from foreground or background
// ---------------------------------------------------------------------------

export async function checkForNewMessages(): Promise<void> {
  const userSub = await SecureStore.getItemAsync(SECURE_KEYS.userSub);
  const userEmail = await SecureStore.getItemAsync(SECURE_KEYS.userEmail);
  if (!userSub || !userEmail) return;

  const conversations = await getConversations(userSub);
  if (conversations.length === 0) return;

  const seenIds = await getSeenIds(userSub);
  const newIds: string[] = [];

  for (const conv of conversations) {
    const newForConv: Array<{ senderName: string; isLive: boolean }> = [];

    for (const member of conv.members) {
      if (member.email === userEmail) continue;
      try {
        const outbox = await fetchPublicJson<ConversationOutbox>(member.outbox_url);
        for (const entry of outbox.messages ?? []) {
          if (seenIds.has(entry.message_id)) continue;
          newIds.push(entry.message_id);
          newForConv.push({
            senderName: member.name,
            isLive: entry.status === 'recording',
          });
        }
      } catch {}
    }

    if (newForConv.length === 0) continue;

    // Collapse multiple new messages from the same conversation into one notification
    const liveEntries = newForConv.filter((e) => e.isLive);
    const completedEntries = newForConv.filter((e) => !e.isLive);

    if (liveEntries.length > 0) {
      const names = [...new Set(liveEntries.map((e) => e.senderName))];
      await Notifications.scheduleNotificationAsync({
        content: {
          title: conv.name,
          body: `${names.join(', ')} ${names.length === 1 ? 'is' : 'are'} recording live`,
          sound: true,
          data: { convId: conv.conv_id },
        },
        trigger: null,
      });
    }

    if (completedEntries.length > 0) {
      const names = [...new Set(completedEntries.map((e) => e.senderName))];
      const body =
        completedEntries.length === 1
          ? `New video from ${names[0]}`
          : `${completedEntries.length} new videos from ${names.join(', ')}`;
      await Notifications.scheduleNotificationAsync({
        content: {
          title: conv.name,
          body,
          sound: true,
          data: { convId: conv.conv_id },
        },
        trigger: null,
      });
    }
  }

  await markSeen(userSub, newIds);
}

// ---------------------------------------------------------------------------
// Permission request + notification handler setup
// ---------------------------------------------------------------------------

export async function setupNotifications(): Promise<void> {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowAlert: true,
      shouldPlaySound: true,
      shouldSetBadge: false,
    }),
  });

  const { status } = await Notifications.getPermissionsAsync();
  if (status !== 'granted') {
    await Notifications.requestPermissionsAsync();
  }
}
