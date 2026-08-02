import Hls from 'hls.js';
import { log } from './helpers';
import { registerNativeStop } from './mediaStop';

export const MAIN_PLAYER_KEY = 'main';

interface NativeInstance {
  hls: Hls | null;
  sessionId: string | null;
  generation: number;
  video: HTMLVideoElement;
}

const instances = new Map<string, NativeInstance>();
/** Monotonic per-key counter so in-flight opens cannot attach to a newer play. */
const generations = new Map<string, number>();

export function isHlsNativeEnabled(): boolean {
  const flag = import.meta.env.VITE_HLS_NATIVE;
  // Default ON for this experiment branch; set VITE_HLS_NATIVE=0 to force iframe.
  if (flag === '0' || flag === 'false') return false;
  return true;
}

function bumpGeneration(key: string): number {
  const next = (generations.get(key) ?? 0) + 1;
  generations.set(key, next);
  return next;
}

function destroyKey(key: string): void {
  bumpGeneration(key);
  const inst = instances.get(key);
  if (!inst) return;
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
  if (!Hls.isSupported()) return false;

  const { video, key, onReady } = opts;
  if (!video || !key) return false;

  // Tear down any current instance, then claim a fresh generation for this open.
  const prev = instances.get(key);
  if (prev?.hls) {
    prev.hls.destroy();
    prev.hls = null;
  }
  if (prev) instances.delete(key);

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
    const res = await fetch(`/api/hls/open?u=${encodeURIComponent(embedUrl)}`, {
      headers: { Accept: 'application/json' },
    });
    if (!isCurrent()) return false;
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

      const hls = new Hls({
        enableWorker: true,
        lowLatencyMode: true,
        manifestLoadingTimeOut: 20_000,
        levelLoadingTimeOut: 20_000,
        fragLoadingTimeOut: 30_000,
      });
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

export function getActiveHlsSessionId(key: string = MAIN_PLAYER_KEY): string | null {
  return instances.get(key)?.sessionId ?? null;
}
