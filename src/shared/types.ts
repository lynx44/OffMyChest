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
  conv_id: string;
  timestamp: string; // ISO 8601
  duration_seconds: number;
  manifest_url: string;
  thumbnail_url: string;
  status?: 'recording' | 'complete'; // absent = complete (backwards compat)
}

/** Per-conversation outbox — one file per participant per conversation */
export interface ConversationOutbox {
  version: '1';
  updated_at: string;
  messages: OutboxEntry[];
}

export interface MessageManifest {
  version: '1';
  message_id: string;
  conv_id: string;
  sender: string; // email
  sender_outbox_url: string; // public URL of sender's outbox for this conversation
  timestamp: string;
  duration_seconds: number;
  chunk_duration_seconds?: number;
  chunks: string[]; // public Drive download URLs
  thumbnail: string; // public URL or empty
  base_url: string;
  status?: 'recording' | 'complete'; // absent = complete (backwards compat)
}

/** A conversation participant whose messages we poll */
export interface ConversationMember {
  name: string;
  email: string;
  outbox_url: string; // public URL of their ConversationOutbox for this conv
}

/** Stored locally in AsyncStorage — represents one conversation the user is part of */
export interface LocalConversation {
  conv_id: string;
  name: string;
  my_outbox_url: string;      // public URL of my outbox for this conversation
  my_outbox_file_id: string;  // Drive file ID for updating my outbox
  members: ConversationMember[]; // known participants (other than me)
  created_at: string;
  last_message_at: string | null;
}

export interface DraftMessage {
  message_id: string;
  conv_id: string;
  started_at: string;
  chunks_uploaded: string[]; // Drive file IDs
  status: 'recording' | 'uploading' | 'finalizing';
}

// Legacy types kept for root outbox identity (read-only, no threads map)
export interface Outbox {
  version: '1';
  owner: string;
  owner_email: string;
  updated_at: string;
}

/** @deprecated Use LocalConversation instead */
export interface ThreadOutbox {
  version: '1';
  updated_at: string;
  messages: OutboxEntry[];
}
