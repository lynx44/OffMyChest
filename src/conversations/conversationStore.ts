import AsyncStorage from '@react-native-async-storage/async-storage';

import { STORAGE_KEYS } from '../shared/constants';
import { LocalConversation, ConversationMember } from '../shared/types';

async function load(userSub: string): Promise<LocalConversation[]> {
  const raw = await AsyncStorage.getItem(STORAGE_KEYS.conversations(userSub));
  if (!raw) return [];
  try {
    return JSON.parse(raw) as LocalConversation[];
  } catch {
    return [];
  }
}

async function save(userSub: string, conversations: LocalConversation[]): Promise<void> {
  await AsyncStorage.setItem(STORAGE_KEYS.conversations(userSub), JSON.stringify(conversations));
}

export async function getConversations(userSub: string): Promise<LocalConversation[]> {
  return load(userSub);
}

export async function getConversation(
  userSub: string,
  convId: string,
): Promise<LocalConversation | null> {
  const all = await load(userSub);
  return all.find((c) => c.conv_id === convId) ?? null;
}

export async function saveConversation(
  userSub: string,
  conv: LocalConversation,
): Promise<void> {
  const all = await load(userSub);
  const idx = all.findIndex((c) => c.conv_id === conv.conv_id);
  if (idx >= 0) {
    all[idx] = conv;
  } else {
    all.push(conv);
  }
  await save(userSub, all);
}

export async function addMemberToConversation(
  userSub: string,
  convId: string,
  member: ConversationMember,
): Promise<void> {
  const all = await load(userSub);
  const conv = all.find((c) => c.conv_id === convId);
  if (!conv) return;

  const exists = conv.members.some((m) => m.email === member.email);
  if (!exists) {
    conv.members.push(member);
    await save(userSub, all);
  }
}

export async function updateConversationLastMessage(
  userSub: string,
  convId: string,
  timestamp: string,
): Promise<void> {
  const all = await load(userSub);
  const conv = all.find((c) => c.conv_id === convId);
  if (!conv) return;
  if (!conv.last_message_at || timestamp > conv.last_message_at) {
    conv.last_message_at = timestamp;
    await save(userSub, all);
  }
}

export async function removeConversation(userSub: string, convId: string): Promise<void> {
  const all = await load(userSub);
  await save(userSub, all.filter((c) => c.conv_id !== convId));
}
