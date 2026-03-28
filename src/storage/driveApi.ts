/**
 * Raw Google Drive v3 REST calls.
 * All functions take an accessToken and return typed results.
 * No SDK — Drive REST API only.
 */

import { DRIVE_API_BASE, DRIVE_UPLOAD_BASE, publicDownloadUrl } from '../shared/constants';
import { DriveApiError } from '../shared/errors';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DriveFile {
  id: string;
  name: string;
  webContentLink?: string;
  webViewLink?: string;
  createdTime?: string;
}

interface ResumableUploadSession {
  sessionUri: string;
  fileId?: string; // only present on update
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Retry helper
// ---------------------------------------------------------------------------

const RETRY_DELAYS_MS = [1_000, 3_000, 9_000]; // 3 attempts after first failure

function isRetryable(status: number): boolean {
  // Network errors (status 0), rate limits, and server errors are retryable.
  // 4xx client errors (except 429) are not — retrying won't help.
  return status === 0 || status === 429 || status >= 500;
}

async function withRetry<T>(fn: () => Promise<T>): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      const status = err instanceof DriveApiError ? err.status : 0;
      if (!isRetryable(status) || attempt === RETRY_DELAYS_MS.length) break;
      const delay = RETRY_DELAYS_MS[attempt];
      console.warn(`[Drive] attempt ${attempt + 1} failed (${status}), retrying in ${delay}ms`);
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  throw lastErr;
}

// ---------------------------------------------------------------------------
// Core request
// ---------------------------------------------------------------------------

async function driveRequest<T>(
  url: string,
  options: RequestInit,
  accessToken: string,
): Promise<T> {
  return withRetry(async () => {
    const headers = new Headers(options.headers);
    headers.set('Authorization', `Bearer ${accessToken}`);

    const res = await fetch(url, { ...options, headers });

    if (!res.ok) {
      let body: unknown;
      try {
        body = await res.json();
      } catch {
        body = await res.text();
      }
      throw new DriveApiError(
        `Drive API ${options.method ?? 'GET'} ${url} failed with ${res.status}`,
        res.status,
        body,
      );
    }

    if (res.status === 204) return undefined as T;
    return res.json() as Promise<T>;
  });
}

// ---------------------------------------------------------------------------
// Folder operations
// ---------------------------------------------------------------------------

/** Find a folder by name owned by the app. Returns null if not found. */
export async function findFolder(
  name: string,
  accessToken: string,
): Promise<DriveFile | null> {
  const q = encodeURIComponent(
    `name='${name}' and mimeType='application/vnd.google-apps.folder' and trashed=false`,
  );
  const fields = encodeURIComponent('files(id,name,createdTime)');
  const url = `${DRIVE_API_BASE}/files?q=${q}&fields=${fields}&orderBy=createdTime`;

  const data = await driveRequest<{ files: DriveFile[] }>(
    url,
    { method: 'GET' },
    accessToken,
  );

  if (!data.files || data.files.length === 0) return null;
  // If duplicates exist (shouldn't happen normally), use the oldest
  return data.files[0] ?? null;
}

/** Create a folder, optionally under a parent. Returns the new DriveFile. */
export async function createFolder(
  name: string,
  accessToken: string,
  parentFolderId?: string,
): Promise<DriveFile> {
  const body: Record<string, unknown> = {
    name,
    mimeType: 'application/vnd.google-apps.folder',
  };
  if (parentFolderId) body['parents'] = [parentFolderId];

  return driveRequest<DriveFile>(
    `${DRIVE_API_BASE}/files?fields=id,name,createdTime`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    },
    accessToken,
  );
}

/** Find a named folder within a specific parent. Returns null if not found. */
export async function findFolderInParent(
  name: string,
  parentFolderId: string,
  accessToken: string,
): Promise<DriveFile | null> {
  const q = encodeURIComponent(
    `name='${name}' and mimeType='application/vnd.google-apps.folder' and '${parentFolderId}' in parents and trashed=false`,
  );
  const url = `${DRIVE_API_BASE}/files?q=${q}&fields=${encodeURIComponent('files(id,name)')}`;
  const data = await driveRequest<{ files: DriveFile[] }>( url, { method: 'GET' }, accessToken);
  return data.files?.[0] ?? null;
}

/** Get or create a named subfolder under a parent. */
export async function getOrCreateSubfolder(
  name: string,
  parentFolderId: string,
  accessToken: string,
): Promise<DriveFile> {
  const existing = await findFolderInParent(name, parentFolderId, accessToken);
  if (existing) return existing;
  return createFolder(name, accessToken, parentFolderId);
}

/** Find or create the app folder. Always searches first to handle reinstalls. */
export async function getOrCreateAppFolder(
  name: string,
  accessToken: string,
): Promise<DriveFile> {
  const existing = await findFolder(name, accessToken);
  if (existing) return existing;
  return createFolder(name, accessToken);
}

// ---------------------------------------------------------------------------
// File sharing
// ---------------------------------------------------------------------------

/**
 * Grant anyoneWithLink reader access to a file.
 * Returns the public download URL using the confirmed bypass parameter.
 */
export async function shareFilePublic(
  fileId: string,
  accessToken: string,
): Promise<string> {
  await driveRequest<void>(
    `${DRIVE_API_BASE}/files/${fileId}/permissions`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ role: 'reader', type: 'anyone' }),
    },
    accessToken,
  );
  return publicDownloadUrl(fileId);
}

// ---------------------------------------------------------------------------
// JSON file upload (for outbox.json and manifest.json — small files)
// Uses multipart upload (fine for files well under 5MB)
// ---------------------------------------------------------------------------

function buildMultipartBody(
  metadata: Record<string, unknown>,
  content: string,
  boundary: string,
): string {
  return (
    `--${boundary}\r\n` +
    `Content-Type: application/json; charset=UTF-8\r\n\r\n` +
    `${JSON.stringify(metadata)}\r\n` +
    `--${boundary}\r\n` +
    `Content-Type: application/json; charset=UTF-8\r\n\r\n` +
    `${content}\r\n` +
    `--${boundary}--`
  );
}

/** Upload a new JSON file to a parent folder. Returns the created DriveFile. */
export async function uploadJsonFile(
  filename: string,
  content: object,
  parentFolderId: string,
  accessToken: string,
): Promise<DriveFile> {
  const boundary = 'omc_boundary_' + Math.random().toString(36).slice(2);
  const metadata = { name: filename, parents: [parentFolderId] };
  const body = buildMultipartBody(metadata, JSON.stringify(content), boundary);

  return driveRequest<DriveFile>(
    `${DRIVE_UPLOAD_BASE}/files?uploadType=multipart&fields=id,name,webContentLink`,
    {
      method: 'POST',
      headers: { 'Content-Type': `multipart/related; boundary=${boundary}` },
      body,
    },
    accessToken,
  );
}

/** Update the content of an existing JSON file (PATCH). */
export async function updateJsonFile(
  fileId: string,
  content: object,
  accessToken: string,
): Promise<DriveFile> {
  return driveRequest<DriveFile>(
    `${DRIVE_UPLOAD_BASE}/files/${fileId}?uploadType=media&fields=id,name`,
    {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(content),
    },
    accessToken,
  );
}

// ---------------------------------------------------------------------------
// Resumable upload (for video chunks — binary, >100KB)
// Two-step: initiate session URI, then PUT bytes
// ---------------------------------------------------------------------------

/** Step 1: Initiate a resumable upload session. Returns the session URI. */
export async function initiateResumableUpload(
  filename: string,
  mimeType: string,
  parentFolderId: string,
  accessToken: string,
  existingFileId?: string,
): Promise<string> {
  const metadata: Record<string, unknown> = { name: filename };
  if (!existingFileId) {
    metadata['parents'] = [parentFolderId];
  }

  const endpoint = existingFileId
    ? `${DRIVE_UPLOAD_BASE}/files/${existingFileId}?uploadType=resumable`
    : `${DRIVE_UPLOAD_BASE}/files?uploadType=resumable`;

  const method = existingFileId ? 'PATCH' : 'POST';

  const headers = new Headers({
    Authorization: `Bearer ${accessToken}`,
    'Content-Type': 'application/json; charset=UTF-8',
    'X-Upload-Content-Type': mimeType,
  });

  const res = await fetch(endpoint, {
    method,
    headers,
    body: JSON.stringify(metadata),
  });

  if (!res.ok) {
    throw new DriveApiError(
      `Failed to initiate resumable upload (${res.status})`,
      res.status,
    );
  }

  const sessionUri = res.headers.get('Location');
  if (!sessionUri) {
    throw new DriveApiError('No Location header in resumable upload response', 0);
  }
  return sessionUri;
}

/** Step 2: Upload bytes to the resumable session URI, with resume-on-interrupt retries. */
export async function executeResumableUpload(
  sessionUri: string,
  data: Uint8Array,
  mimeType: string,
): Promise<DriveFile> {
  const buffer = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);

  return withRetry(async () => {
    // Query how many bytes Drive has already received (0 if starting fresh)
    let resumeOffset = 0;
    const queryRes = await fetch(sessionUri, {
      method: 'PUT',
      headers: {
        'Content-Range': `bytes */${data.byteLength}`,
        'Content-Length': '0',
      },
    });

    if (queryRes.status === 200 || queryRes.status === 201) {
      // Already complete from a previous attempt
      return queryRes.json() as Promise<DriveFile>;
    } else if (queryRes.status === 308) {
      const range = queryRes.headers.get('Range');
      if (range) {
        // Range: bytes=0-N  →  N+1 bytes received
        resumeOffset = parseInt(range.split('-')[1], 10) + 1;
      }
    } else if (queryRes.status === 404) {
      // Session expired — caller must re-initiate (throw non-retryable)
      throw new DriveApiError('Resumable upload session expired', 404);
    }
    // status 503 / network error falls through to retry

    const slice = resumeOffset > 0 ? buffer.slice(resumeOffset) : buffer;
    const res = await fetch(sessionUri, {
      method: 'PUT',
      headers: {
        'Content-Type': mimeType,
        'Content-Length': String(data.byteLength - resumeOffset),
        ...(resumeOffset > 0
          ? { 'Content-Range': `bytes ${resumeOffset}-${data.byteLength - 1}/${data.byteLength}` }
          : {}),
      },
      body: slice,
    });

    if (!res.ok) {
      throw new DriveApiError(`Resumable upload PUT failed (${res.status})`, res.status);
    }

    return res.json() as Promise<DriveFile>;
  });
}

// ---------------------------------------------------------------------------
// File deletion
// ---------------------------------------------------------------------------

/** Move a file/folder to trash. Trashing a folder trashes all its contents. */
export async function deleteFile(fileId: string, accessToken: string): Promise<void> {
  await driveRequest<void>(
    `${DRIVE_API_BASE}/files/${fileId}`,
    { method: 'DELETE' },
    accessToken,
  );
}

/** Return the parent folder IDs of a file. */
export async function getFileParents(fileId: string, accessToken: string): Promise<string[]> {
  const data = await driveRequest<{ parents?: string[] }>(
    `${DRIVE_API_BASE}/files/${fileId}?fields=parents`,
    { method: 'GET' },
    accessToken,
  );
  return data.parents ?? [];
}

// ---------------------------------------------------------------------------
// Public file fetch (no auth — anyoneWithLink)
// ---------------------------------------------------------------------------

/** Fetch a public JSON file by its direct download URL. */
export async function fetchPublicJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) {
    throw new DriveApiError(`Failed to fetch public file at ${url} (${res.status})`, res.status);
  }
  return res.json() as Promise<T>;
}

/** Fetch raw bytes from a public URL (for video chunks). */
export async function fetchPublicBytes(url: string): Promise<Uint8Array> {
  const res = await fetch(url);
  if (!res.ok) {
    throw new DriveApiError(`Failed to fetch bytes at ${url} (${res.status})`, res.status);
  }
  const buf = await res.arrayBuffer();
  return new Uint8Array(buf);
}
