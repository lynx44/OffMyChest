import AsyncStorage from '@react-native-async-storage/async-storage';
import { STORAGE_KEYS } from '../shared/constants';

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
