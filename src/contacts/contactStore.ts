import AsyncStorage from '@react-native-async-storage/async-storage';

import { STORAGE_KEYS } from '../shared/constants';
import { fetchPublicJson } from '../storage/driveApi';
import { Contact, Outbox } from '../shared/types';

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

/**
 * Fetches the contact's outbox to resolve their real email, replacing the
 * temporary `pending:` placeholder stored at add time.
 */
export async function resolveContactEmail(userSub: string, outboxUrl: string): Promise<void> {
  try {
    const outbox = await fetchPublicJson<Outbox>(outboxUrl);
    if (!outbox.owner_email) return;

    const contacts = await loadContacts(userSub);
    const updated = contacts.map(c =>
      c.outbox_url === outboxUrl
        ? { ...c, email: outbox.owner_email, name: outbox.owner ?? c.name }
        : c
    );
    await saveContacts(userSub, updated);
  } catch {
    // Non-fatal — contact stays with pending email until next resolution attempt
  }
}
