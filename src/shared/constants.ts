export const DRIVE_FOLDER_NAME = 'OffMyChest';
export const OUTBOX_FILENAME = 'outbox.json';
export const OUTBOX_VERSION = '1' as const;
export const POLLING_INTERVAL_MS = 30_000;
export const CHUNK_DURATION_SECONDS = 8;

// Google Drive REST API
export const DRIVE_API_BASE = 'https://www.googleapis.com/drive/v3';
export const DRIVE_UPLOAD_BASE = 'https://www.googleapis.com/upload/drive/v3';

/** Build a public download URL that bypasses the virus-scan interstitial */
export function publicDownloadUrl(fileId: string): string {
  return `https://drive.google.com/uc?export=download&id=${fileId}&confirm=t`;
}

// AsyncStorage keys
export const STORAGE_KEYS = {
  driveFolderId: (sub: string) => `drive:folderId:${sub}`,
  conversations: (sub: string) => `conversations:${sub}`,
  myConvOutboxFileId: (convId: string) => `conv:outboxFileId:${convId}`,
  myConvOutboxUrl: (convId: string) => `conv:outboxUrl:${convId}`,
  notifSeen: (userSub: string) => `notif:seen:${userSub}`,
  notifInitialized: (userSub: string) => `notif:init:${userSub}`,
  notes: (convId: string) => `notes:${convId}`,
  notesUndo: (convId: string) => `notes_undo:${convId}`,
  draft: (messageId: string) => `draft:${messageId}`,
} as const;

// SecureStore keys
export const SECURE_KEYS = {
  accessToken: 'auth.accessToken',
  refreshToken: 'auth.refreshToken',
  tokenExpiry: 'auth.tokenExpiry',
  userSub: 'auth.sub',
  userEmail: 'auth.email',
  userName: 'auth.name',
} as const;

// Google OAuth — populated from env
export const GOOGLE_CLIENT_IDS = {
  ios: process.env.EXPO_PUBLIC_GOOGLE_CLIENT_ID_IOS ?? '',
  android: process.env.EXPO_PUBLIC_GOOGLE_CLIENT_ID_ANDROID ?? '',
  web: process.env.EXPO_PUBLIC_GOOGLE_CLIENT_ID_WEB ?? '',
} as const;

export const GOOGLE_SCOPES = [
  'openid',
  'email',
  'profile',
  'https://www.googleapis.com/auth/drive.file',
];
