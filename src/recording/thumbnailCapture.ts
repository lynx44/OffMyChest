import * as VideoThumbnails from 'expo-video-thumbnails';

/**
 * Capture a thumbnail from a video file at t=0.
 * Returns the local file URI of the saved JPEG.
 */
export async function captureThumbnail(videoUri: string): Promise<string> {
  const { uri } = await VideoThumbnails.getThumbnailAsync(videoUri, {
    time: 0,
    quality: 0.7,
  });
  return uri;
}
