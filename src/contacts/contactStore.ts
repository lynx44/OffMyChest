import AsyncStorage from '@react-native-async-storage/async-storage';

import { STORAGE_KEYS } from '../shared/constants';
import { Contact } from '../shared/types';

async function loadContacts(userSub: string): Promise<Contact[]> {
  const raw = await AsyncStorage.getItem(STORAGE_KEYS.contacts(userSub));
  if (!raw) return [];
  try {
    return JSON.parse(raw) as Contact[];
  } catch {
    return [];
  }
}

async function saveContacts(userSub: string, contacts: Contact[]): Promise<void> {
  await AsyncStorage.setItem(STORAGE_KEYS.contacts(userSub), JSON.stringify(contacts));
}

export async function getContacts(userSub: string): Promise<Contact[]> {
  return loadContacts(userSub);
}

export async function addContact(userSub: string, contact: Contact): Promise<void> {
  const contacts = await loadContacts(userSub);
  const exists = contacts.some((c) => c.email === contact.email);
  if (!exists) {
    contacts.push(contact);
    await saveContacts(userSub, contacts);
  }
}

export async function removeContact(userSub: string, email: string): Promise<void> {
  const contacts = await loadContacts(userSub);
  await saveContacts(
    userSub,
    contacts.filter((c) => c.email !== email),
  );
}
