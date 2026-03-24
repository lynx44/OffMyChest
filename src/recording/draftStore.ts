import AsyncStorage from '@react-native-async-storage/async-storage';

import { STORAGE_KEYS } from '../shared/constants';
import { DraftMessage } from '../shared/types';

export async function saveDraft(draft: DraftMessage): Promise<void> {
  await AsyncStorage.setItem(
    STORAGE_KEYS.draft(draft.message_id),
    JSON.stringify(draft),
  );
}

export async function getDraft(messageId: string): Promise<DraftMessage | null> {
  const raw = await AsyncStorage.getItem(STORAGE_KEYS.draft(messageId));
  if (!raw) return null;
  try {
    return JSON.parse(raw) as DraftMessage;
  } catch {
    return null;
  }
}

export async function updateDraftChunks(
  messageId: string,
  chunkFileId: string,
): Promise<void> {
  const draft = await getDraft(messageId);
  if (!draft) return;
  draft.chunks_uploaded.push(chunkFileId);
  await saveDraft(draft);
}

export async function updateDraftStatus(
  messageId: string,
  status: DraftMessage['status'],
): Promise<void> {
  const draft = await getDraft(messageId);
  if (!draft) return;
  draft.status = status;
  await saveDraft(draft);
}

export async function clearDraft(messageId: string): Promise<void> {
  await AsyncStorage.removeItem(STORAGE_KEYS.draft(messageId));
}

/** Returns all incomplete drafts (status !== 'done'). */
export async function getIncompleteDrafts(): Promise<DraftMessage[]> {
  const allKeys = await AsyncStorage.getAllKeys();
  const draftKeys = allKeys.filter((k) => k.startsWith('draft:'));
  const pairs = await AsyncStorage.multiGet(draftKeys);

  const drafts: DraftMessage[] = [];
  for (const [, value] of pairs) {
    if (!value) continue;
    try {
      const d = JSON.parse(value) as DraftMessage;
      drafts.push(d);
    } catch {
      // ignore corrupt entries
    }
  }
  return drafts;
}
