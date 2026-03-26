/**
 * In-memory playlist for auto-advancing between videos.
 * The thread view sets the playlist before navigating to the player.
 * The player reads it to determine the next video on completion.
 */

/** Ordered list of manifest URLs, oldest first */
let playlist: string[] = [];

export function setPlaylist(manifestUrls: string[]): void {
  playlist = manifestUrls;
}

export function getPlaylist(): string[] {
  return playlist;
}
