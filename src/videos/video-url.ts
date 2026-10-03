export enum VideoProvider {
  YOUTUBE = 'YOUTUBE',
  VIMEO = 'VIMEO',
}

export interface ParsedVideo {
  provider: VideoProvider;
  id: string;
}

export const VIDEO_URL_MAX_LENGTH = 2048;

const YOUTUBE_ID = /^[A-Za-z0-9_-]{11}$/;
const VIMEO_ID = /^\d{1,12}$/;

const YOUTUBE_HOSTS = new Set([
  'youtube.com',
  'www.youtube.com',
  'm.youtube.com',
  'youtube-nocookie.com',
  'www.youtube-nocookie.com',
]);
const VIMEO_HOSTS = new Set(['vimeo.com', 'www.vimeo.com']);

// /embed/ID, /shorts/ID, /live/ID, /v/ID
const YOUTUBE_PATH_ID = /^\/(?:embed|shorts|live|v)\/([^/]+)\/?$/;
// /123456 or /123456/<unlisted hash>
const VIMEO_PATH_ID = /^\/(\d+)(?:\/[0-9a-f]+)?\/?$/;
const VIMEO_PLAYER_PATH_ID = /^\/video\/(\d+)\/?$/;

function youtube(id: string | null | undefined): ParsedVideo | null {
  return id && YOUTUBE_ID.test(id)
    ? { provider: VideoProvider.YOUTUBE, id }
    : null;
}

function vimeo(id: string | null | undefined): ParsedVideo | null {
  return id && VIMEO_ID.test(id) ? { provider: VideoProvider.VIMEO, id } : null;
}

/**
 * Reduces a YouTube or Vimeo link to (provider, id). Only known hosts and
 * URL shapes are accepted; anything else (other sites, credentials, ports,
 * `javascript:` and friends) returns null. Nothing from the URL except the
 * validated id is ever kept: embed and watch URLs are rebuilt from it.
 */
export function parseVideoUrl(raw: string): ParsedVideo | null {
  if (typeof raw !== 'string' || raw.length > VIDEO_URL_MAX_LENGTH) {
    return null;
  }
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
  if (url.username || url.password || url.port) return null;

  const host = url.hostname.toLowerCase();
  const path = url.pathname;

  if (host === 'youtu.be') return youtube(path.slice(1).replace(/\/$/, ''));
  if (YOUTUBE_HOSTS.has(host)) {
    if (path === '/watch') return youtube(url.searchParams.get('v'));
    return youtube(YOUTUBE_PATH_ID.exec(path)?.[1]);
  }
  if (VIMEO_HOSTS.has(host)) return vimeo(VIMEO_PATH_ID.exec(path)?.[1]);
  if (host === 'player.vimeo.com') {
    return vimeo(VIMEO_PLAYER_PATH_ID.exec(path)?.[1]);
  }
  return null;
}

// Privacy-friendly players: no tracking cookies before playback.
export function embedUrl(provider: VideoProvider, id: string): string {
  return provider === VideoProvider.YOUTUBE
    ? `https://www.youtube-nocookie.com/embed/${id}`
    : `https://player.vimeo.com/video/${id}?dnt=1`;
}

export function watchUrl(provider: VideoProvider, id: string): string {
  return provider === VideoProvider.YOUTUBE
    ? `https://www.youtube.com/watch?v=${id}`
    : `https://vimeo.com/${id}`;
}

// YouTube serves thumbnails at a predictable URL; Vimeo needs its API.
export function defaultThumbnailUrl(
  provider: VideoProvider,
  id: string,
): string | null {
  return provider === VideoProvider.YOUTUBE
    ? `https://i.ytimg.com/vi/${id}/hqdefault.jpg`
    : null;
}
