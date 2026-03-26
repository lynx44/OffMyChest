export interface User {
  sub: string;
  email: string;
  name: string;
  accessToken: string;
  refreshToken: string | null;
  tokenExpiry: number; // Unix ms
}

export interface OutboxEntry {
  message_id: string;
  thread_id: string;
  group_id: string | null;
  timestamp: string; // ISO 8601
  duration_seconds: number;
  manifest_url: string;
  thumbnail_url: string;
  status?: 'recording' | 'complete'; // absent = complete (backwards compat)
}

export interface Outbox {
  version: '1';
  owner: string;
  owner_email: string;
  updated_at: string; // ISO 8601
  messages: OutboxEntry[];
}

export interface MessageManifest {
  version: '1';
  message_id: string;
  thread_id: string;
  group_id: string | null;
  sender: string; // email
  timestamp: string;
  duration_seconds: number;
  chunk_duration_seconds?: number; // average seconds per chunk (duration / chunk count)
  chunks: string[]; // relative paths under base_url
  thumbnail: string; // relative to base_url
  base_url: string;
  status?: 'recording' | 'complete'; // absent = complete (backwards compat)
}

export interface GroupMember {
  name: string;
  email: string;
  outbox_url: string;
}

export interface GroupManifest {
  version: '1';
  group_id: string;
  name: string;
  created_by: string; // email
  created_at: string;
  updated_at: string;
  members: GroupMember[];
}

export interface Contact {
  name: string;
  email: string;
  outbox_url: string;
  added_at: string; // ISO 8601
  last_seen_updated_at: string | null;
}

export interface DraftMessage {
  message_id: string;
  thread_id: string;
  group_id: string | null;
  started_at: string;
  chunks_uploaded: string[]; // Drive file IDs
  status: 'recording' | 'uploading' | 'finalizing';
}
