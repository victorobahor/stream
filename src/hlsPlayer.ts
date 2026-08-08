import { log } from './helpers';
import { registerNativeStop } from './mediaStop';

export const MAIN_PLAYER_KEY = 'main';

interface NativeInstance {
  hls: { destroy: () => void } | null;
  sessionId: string | null;
  generation: number;
  video: HTMLVideoElement;
}

const instances = new Map<string, NativeInstance>();
/** Monotonic per-key counter so in-flight opens cannot attach to a newer play. */
const generations = new Map<string, number>();

export function isHlsNativeEnabled(): boolean {
  const flag = import.meta.env.VITE_HLS_NATIVE;
  // Default ON for Streamed embed.st; set VITE_HLS_NATIVE=0 to force iframe.
  if (flag === '0' || flag === 'false') return false;
  return true;
}

/** True when this embed host cannot be minted by Playwright HLS (SportSRC wrappers). */
export function isHlsUnsupportedEmbed(embedUrl: string): boolean {
  try {
    const host = new URL(embedUrl).hostname.toLowerCase();
    return (
      host === 'embed.streamapi.cc' ||
      host === 'streamapi.cc' ||
      host.endsWith('.streamapi.cc') ||
      host === 'football77.org' ||
      host === 'www.football77.org' ||
      host === 'embed.sportsrc.org' ||
      host.endsWith('.sportsrc.org')
    );
  } catch {
    return false;
  }
}

function bumpGeneration(key: string): number {
  const next = (generations.get(key) ?? 0) + 1;
  generations.set(key, next);
  return next;
}

function closeRemoteSession(sessionId: string | null): void {
  if (!sessionId) return;
  const url = `/api/hls/${sessionId}/close`;
  try {
    if (typeof navigator !== 'undefined' && typeof navigator.sendBeacon === 'function') {
      navigator.sendBeacon(url);
      return;
    }
  } catch {
    /* fall through */
  }
  void fetch(url, { method: 'POST', keepalive: true }).catch(() => {});
}

function destroyKey(key: string): void {
  bumpGeneration(key);
  const inst = instances.get(key);
  if (!inst) return;
  const sessionId = inst.sessionId;
  if (inst.hls) {
    inst.hls.destroy();
    inst.hls = null;
  }
  inst.sessionId = null;
  const video = inst.video;
  if (video) {
    video.pause();
    video.removeAttribute('src');
    video.load();
    if (key === MAIN_PLAYER_KEY) {
      video.classList.add('hidden');
    }
  }
  instances.delete(key);
  closeRemoteSession(sessionId);
}

/** Stop one native player (`main`, `mv-0`, …) or every instance when omitted. */
export function stopNativeHls(key?: string): void {
  if (key) {
    destroyKey(key);
    return;
  }
  for (const k of [...instances.keys()]) {
    destroyKey(k);
  }
}

registerNativeStop(stopNativeHls);

export type PlayNativeOptions = {
  video: HTMLVideoElement;
  key: string;
  /** Called once the manifest is ready (before play resolves). */
  onReady?: () => void;
};

/**
 * Resolve embed → same-origin master playlist via /api/hls, then play with hls.js.
 * Returns true on success; false means caller should use the iframe fallback.
 */
export async function playNativeHls(embedUrl: string, opts: PlayNativeOptions): Promise<boolean> {
  if (!isHlsNativeEnabled()) return false;
  if (isHlsUnsupportedEmbed(embedUrl)) return false;

  // Lazy-load hls.js so the home grid does not pay for it on first paint.
  const { default: Hls } = await import('hls.js');
  if (!Hls.isSupported()) return false;

  const { video, key, onReady } = opts;
  if (!video || !key) return false;

  const prev = instances.get(key);
  if (prev?.hls) {
    prev.hls.destroy();
    prev.hls = null;
  }
  if (prev) {
    closeRemoteSession(prev.sessionId);
    instances.delete(key);
  }

  const generation = bumpGeneration(key);
  const inst: NativeInstance = {
    hls: null,
    sessionId: null,
    generation,
    video,
  };
  instances.set(key, inst);

  const isCurrent = () => {
    const live = instances.get(key);
    return !!live && live.generation === generation && generations.get(key) === generation;
  };

  try {
    // Retry transient capacity responses — server may queue, but bursts still 429.
    let res: Response | null = null;
    for (let attempt = 0; attempt < 3; attempt++) {
      if (!isCurrent()) return false;
      res = await fetch(`/api/hls/open?u=${encodeURIComponent(embedUrl)}`, {
        headers: { Accept: 'application/json' },
      });
      if (!isCurrent()) return false;
      if (res.ok || res.status !== 429 || attempt === 2) break;
      const delay = 400 * 2 ** attempt + Math.floor(Math.random() * 250);
      log('warn', 'HLS open busy, retrying', key, res.status, `attempt ${attempt + 1}`);
      await new Promise(r => setTimeout(r, delay));
    }
    if (!res || !isCurrent()) return false;
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      log('warn', 'HLS open failed', key, res.status, body.slice(0, 200));
      if (isCurrent()) destroyKey(key);
      return false;
    }
    const data = (await res.json()) as { sessionId?: string; masterUrl?: string };
    if (!data.sessionId || !data.masterUrl) {
      if (isCurrent()) destroyKey(key);
      return false;
    }
    if (!isCurrent()) return false;

    inst.sessionId = data.sessionId;

    await new Promise<void>((resolve, reject) => {
      if (!isCurrent()) {
        resolve();
        return;
      }

      // Streamed CDN playlists are standard live HLS (often …/high|low/mono.m3u8),
      // not LL-HLS. lowLatencyMode starves the buffer and makes audio crackle;
      // a conservative ABR estimate also strandes us on the low/mono rung.
      const hls = new Hls(nativeHlsConfig());
      inst.hls = hls;

      hls.on(Hls.Events.ERROR, (_e, info) => {
        if (!info.fatal) return;
        log('warn', 'HLS fatal', key, info.type, info.details);
        hls.destroy();
        if (instances.get(key)?.hls === hls) {
          const still = instances.get(key);
          if (still) still.hls = null;
        }
        reject(new Error(`HLS ${info.details}`));
      });

      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        if (!isCurrent()) {
          hls.destroy();
          resolve();
          return;
        }
        if (key === MAIN_PLAYER_KEY) {
          video.classList.remove('hidden');
        }
        video.muted = false;
        if (typeof video.volume === 'number' && video.volume < 0.2) {
          video.volume = 1;
        }
        onReady?.();
        void video.play().catch(() => {
          /* controls remain for a manual gesture */
        });
        resolve();
      });

      hls.loadSource(data.masterUrl!);
      hls.attachMedia(video);
    });

    return isCurrent() && instances.get(key)?.hls !== null;
  } catch (err) {
    log('warn', 'Native HLS failed, will fall back to iframe:', key, err);
    if (isCurrent()) destroyKey(key);
    return false;
  }
}

/** Shared hls.js knobs for Streamed live (exported for unit tests). */
export function nativeHlsConfig(): Record<string, unknown> {
  return {
    enableWorker: true,
    lowLatencyMode: false,
    // ~2 Mbps prior: try above the 700kbps low rung without insisting on
    // the often-gated 8 Mbps high/*.ts variant through the proxy.
    abrEwmaDefaultEstimate: 2_000_000,
    abrEwmaFastLive: 3,
    abrEwmaSlowLive: 9,
    abrBandWidthFactor: 0.85,
    abrBandWidthUpFactor: 0.7,
    maxBufferLength: 30,
    maxMaxBufferLength: 60,
    liveSyncDurationCount: 3,
    liveMaxLatencyDurationCount: 12,
    manifestLoadingTimeOut: 20_000,
    levelLoadingTimeOut: 20_000,
    fragLoadingTimeOut: 30_000,
  };
}

/** Prefer 1080p/high when the master lists multiple rungs (Burnley-style high|low/mono). */
export function preferHighestLevel(
  hls: {
    startLevel?: number;
    nextLevel?: number;
    loadLevel?: number;
    currentLevel?: number;
    levels?: Array<{ height?: number; bitrate?: number }>;
  },
  levels?: Array<{ height?: number; bitrate?: number }> | null,
): number {
  const list = levels && levels.length ? levels : hls.levels || [];
  if (!list.length) return -1;
  let best = 0;
  for (let i = 1; i < list.length; i++) {
    const a = list[i];
    const b = list[best];
    const ah = a.height || 0;
    const bh = b.height || 0;
    if (ah > bh || (ah === bh && (a.bitrate || 0) > (b.bitrate || 0))) best = i;
  }
  // Soft-prefer the high rung. Do not set currentLevel — that disables ABR and
  // prevents fallback when high/*.ts is gated (common through the proxy).
  hls.startLevel = best;
  try {
    hls.nextLevel = best;
  } catch {
    /* older hls.js */
  }
  return best;
}

export function getActiveHlsSessionId(key: string = MAIN_PLAYER_KEY): string | null {
  return instances.get(key)?.sessionId ?? null;
}
