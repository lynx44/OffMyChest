import * as VideoThumbnails from 'expo-video-thumbnails';
import { readAsStringAsync } from 'expo-file-system';

/**
 * Capture a thumbnail from a video file at t=0.
 * Returns the raw JPEG bytes ready for upload.
 */
export async function captureThumbnail(videoUri: string): Promise<Uint8Array> {
  const { uri } = await VideoThumbnails.getThumbnailAsync(videoUri, {
    time: 0,
    quality: 0.7,
  });

  const base64 = await readAsStringAsync(uri, { encoding: 'base64' });
  return base64ToUint8Array(base64);
}

function base64ToUint8Array(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}
