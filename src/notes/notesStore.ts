import AsyncStorage from '@react-native-async-storage/async-storage';
import { STORAGE_KEYS } from '../shared/constants';

const MAX_UNDO = 3;

export async function getNotes(threadId: string): Promise<string> {
  const raw = await AsyncStorage.getItem(STORAGE_KEYS.notes(threadId));
  return raw ?? '';
}

export async function saveNotes(threadId: string, text: string): Promise<void> {
  if (text.trim()) {
    await AsyncStorage.setItem(STORAGE_KEYS.notes(threadId), text);
  } else {
    await AsyncStorage.removeItem(STORAGE_KEYS.notes(threadId));
  }
}

/** Push a snapshot onto the undo stack before clearing. Keeps at most MAX_UNDO entries. */
export async function pushClearHistory(threadId: string, text: string): Promise<void> {
  if (!text.trim()) return;
  const raw = await AsyncStorage.getItem(STORAGE_KEYS.notesUndo(threadId));
  const history: string[] = raw ? JSON.parse(raw) : [];
  history.push(text);
  if (history.length > MAX_UNDO) history.splice(0, history.length - MAX_UNDO);
  await AsyncStorage.setItem(STORAGE_KEYS.notesUndo(threadId), JSON.stringify(history));
}

/** Pop the most recent snapshot from the undo stack. Returns null if empty. */
export async function popClearHistory(threadId: string): Promise<string | null> {
  const raw = await AsyncStorage.getItem(STORAGE_KEYS.notesUndo(threadId));
  if (!raw) return null;
  const history: string[] = JSON.parse(raw);
  if (history.length === 0) return null;
  const restored = history.pop()!;
  if (history.length === 0) {
    await AsyncStorage.removeItem(STORAGE_KEYS.notesUndo(threadId));
  } else {
    await AsyncStorage.setItem(STORAGE_KEYS.notesUndo(threadId), JSON.stringify(history));
  }
  return restored;
}

/** Returns how many undo snapshots are available. */
export async function getClearHistoryCount(threadId: string): Promise<number> {
  const raw = await AsyncStorage.getItem(STORAGE_KEYS.notesUndo(threadId));
  if (!raw) return 0;
  const history: string[] = JSON.parse(raw);
  return history.length;
}
