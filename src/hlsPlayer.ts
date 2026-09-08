import type Hls from 'hls.js';
import { log, isAllowedEmbedHost } from './helpers';
import { registerNativeStop } from './mediaStop';

export const MAIN_PLAYER_KEY = 'main';

interface NativeInstance {
  hls: Hls | null;
  sessionId: string | null;
  video: HTMLVideoElement;
  dispose: () => void;
}

const instances = new Map<string, NativeInstance>();

// Playback always stays in our video element. Never expose upstream ad scripts.
export function isHlsNativeEnabled(): boolean { return true; }

export function isHlsUnsupportedEmbed(embedUrl: string): boolean {
  return !isAllowedEmbedHost(embedUrl);
}

function closeRemoteSession(sessionId: string | null): void {
  if (!sessionId) return;
  const url = `/api/hls/${sessionId}/close`;
  try {
    if (navigator.sendBeacon?.(url)) return;
  } catch { /* use keepalive */ }
  void fetch(url, { method: 'POST', keepalive: true }).catch(() => {});
}

export function stopNativeHls(key?: string): void {
  for (const [k, inst] of instances) {
    if (key && key !== k) continue;
    instances.delete(k);
    inst.dispose();
    inst.hls?.destroy();
    closeRemoteSession(inst.sessionId);
    inst.video.pause();
    inst.video.removeAttribute('src');
    inst.video.load();
    if (k === MAIN_PLAYER_KEY) inst.video.classList.add('hidden');
  }
}
registerNativeStop(stopNativeHls);

export function hasNativeHls(key: string): boolean { return instances.has(key); }

export type PlayNativeOptions = {
  video: HTMLVideoElement;
  key: string;
  onReady?: () => void;
  /** Called after playback started and bounded recovery has been exhausted. */
  onError?: () => void;
};

/** Native playback with owned sessions, bounded recovery, and no iframe fallback. */
export async function playNativeHls(embedUrl: string, opts: PlayNativeOptions): Promise<boolean> {
  const { video, key, onReady, onError } = opts;
  stopNativeHls(key);
  if (!video || !key || isHlsUnsupportedEmbed(embedUrl)) return false;

  let settled = false;
  let started = false;
  let disposed = false;
  let reopening = false;
  let recoveries = 0;
  let recoveryWindow = Date.now();
  let lastTime = video.currentTime;
  let lastProgress = Date.now();
  let startupTimer: ReturnType<typeof setTimeout> | undefined;
  let watchdog: ReturnType<typeof setInterval> | undefined;
  let resolveResult: (ok: boolean) => void = () => {};
  const result = new Promise<boolean>(resolve => { resolveResult = resolve; });
  const settle = (ok: boolean) => {
    if (settled) return;
    settled = true;
    resolveResult(ok);
  };
  const inst: NativeInstance = {
    hls: null, sessionId: null, video,
    dispose: () => {
      disposed = true;
      clearTimeout(startupTimer);
      clearInterval(watchdog);
      video.removeEventListener('playing', ready);
      video.removeEventListener('loadeddata', ready);
      video.removeEventListener('error', fail);
      settle(false);
    },
  };
  instances.set(key, inst);
  const current = () => !disposed && instances.get(key) === inst;

  function ready(): void {
    if (!current()) return;
    clearTimeout(startupTimer);
    lastProgress = Date.now();
    if (started) return;
    started = true;
    onReady?.();
    settle(true);
  }
  function fail(): void {
    if (!current()) return;
    const wasPlaying = started;
    stopNativeHls(key);
    if (wasPlaying) onError?.();
  }
  video.addEventListener('playing', ready);
  video.muted = shouldStartMuted(key);

  // An obsolete open still needs its response read so its server session can be
  // closed. Stops settle immediately; the bounded open cleans up in the background.
  async function openSession(refresh = false): Promise<{ sessionId: string; masterUrl: string } | null> {
    return withHlsOpenSlot(async () => {
      for (let attempt = 0; attempt < 3; attempt++) {
        if (!current()) return null;
        const response = await fetch(`/api/hls/open?u=${encodeURIComponent(embedUrl)}${refresh ? '&refresh=1' : ''}`, {
          headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(100_000),
        });
        if (!response.ok) {
          if (!current()) return null;
          if (!shouldRetryHlsOpen(response.status) || attempt === 2) throw new Error(`HLS open ${response.status}`);
          await new Promise(r => setTimeout(r, 500 * 2 ** attempt));
          continue;
        }
        const data = await response.json() as { sessionId?: string; masterUrl?: string };
        if (!current() || !data.sessionId || !data.masterUrl ||
            !/^\/api\/hls\/[a-f0-9]+\/master\.m3u8$/.test(data.masterUrl)) {
          closeRemoteSession(data.sessionId ?? null);
          return null;
        }
        return { sessionId: data.sessionId, masterUrl: data.masterUrl };
      }
      return null;
    });
  }

  async function recover(): Promise<void> {
    if (!current() || reopening) return;
    if (Date.now() - recoveryWindow > 120_000) { recoveries = 0; recoveryWindow = Date.now(); }
    if (++recoveries > 2) { fail(); return; }
    reopening = true;
    try {
      const data = await openSession(true);
      if (!current() || !data) { if (current()) fail(); return; }
      closeRemoteSession(inst.sessionId);
      inst.sessionId = data.sessionId;
      inst.hls?.loadSource(data.masterUrl);
      inst.hls?.startLoad(-1);
      lastProgress = Date.now();
    } catch (error) {
      log('warn', 'Stream reconnect failed', error);
      fail();
    } finally { reopening = false; }
  }

  void (async () => {
    try {
      const { default: Hls } = await import('hls.js');
      if (!current()) return;
      const supported = Hls.isSupported();
      if (!supported && !video.canPlayType('application/vnd.apple.mpegurl')) { fail(); return; }
      const data = await openSession();
      if (!current() || !data) { if (current()) fail(); return; }
      inst.sessionId = data.sessionId;
      startupTimer = setTimeout(fail, 45_000);
      video.classList.remove('hidden');
      const startVideo = () => {
        if (!current()) return;
        void video.play().catch(() => {
          // Autoplay may require a user gesture. Expose the native controls.
          if (video.readyState >= 2) ready();
          else video.addEventListener('loadeddata', ready, { once: true });
        });
      };
      if (supported) {
        const hls = new Hls(nativeHlsConfig({ compact: key.startsWith('mv-') }));
        inst.hls = hls;
        let mediaRecoveries = 0;
        let playRequested = false;
        const startWhenBuffered = () => {
          if (!current() || playRequested) return;
          let ahead = 0;
          for (let i = 0; i < video.buffered.length; i++) {
            if (video.currentTime >= video.buffered.start(i) - 0.5 && video.currentTime < video.buffered.end(i)) {
              ahead = video.buffered.end(i) - video.currentTime;
              break;
            }
          }
          const target = key.startsWith('mv-') ? 8 : 4;
          const shortVod = Number.isFinite(video.duration) && video.duration > 0 && ahead >= video.duration - video.currentTime - 0.1;
          if (ahead < target && !shortVod) return;
          playRequested = true;
          startVideo();
        };
        hls.on(Hls.Events.ERROR, (_event, info) => {
          if (!current() || !info.fatal) return;
          log('warn', 'HLS playback error', key, info.type, info.details);
          if (info.type === Hls.ErrorTypes.MEDIA_ERROR && mediaRecoveries++ < 1) {
            hls.recoverMediaError();
          } else if (started && info.type === Hls.ErrorTypes.NETWORK_ERROR) {
            void recover();
          } else { fail(); }
        });
        hls.on(Hls.Events.MANIFEST_PARSED, () => { playRequested = false; });
        hls.on(Hls.Events.BUFFER_APPENDED, startWhenBuffered);
        hls.loadSource(data.masterUrl);
        hls.attachMedia(video);
      } else {
        video.addEventListener('error', fail);
        video.src = data.masterUrl;
        startVideo();
      }
      watchdog = setInterval(() => {
        if (!current() || !started || reopening) return;
        if (video.paused || video.seeking || video.currentTime > lastTime + 0.1) {
          lastProgress = Date.now();
          lastTime = video.currentTime;
          return;
        }
        if (Date.now() - lastProgress > 20_000) {
          // Native Safari has no hls.js recovery controller; move to another source.
          if (!inst.hls) fail(); else void recover();
        }
      }, 3_000);
    } catch (error) {
      log('warn', 'Native stream unavailable', error);
      fail();
    }
  })();
  return result;
}

/** Shared hls.js knobs for Streamed live (exported for unit tests). */
export type NativeHlsConfigOptions = {
  /** Multiview: shorter live buffer and a low-rung ABR start so 4 panes stay playable. */
  compact?: boolean;
};

export function shouldRetryHlsOpen(status: number): boolean {
  return status === 429 || status === 503;
}

/** Multiview starts muted so four panes can autoplay; the slot audio button unmutes one. */
export function shouldStartMuted(key: string): boolean {
  return key.startsWith('mv-');
}

const MAX_CLIENT_HLS_OPENS = 2;
let clientHlsOpens = 0;
const clientHlsWaiters: Array<() => void> = [];

/** Four-slot multiview must not mint four Playwright sessions at once. */
export async function withHlsOpenSlot<T>(work: () => Promise<T>): Promise<T> {
  while (clientHlsOpens >= MAX_CLIENT_HLS_OPENS) {
    await new Promise<void>(resolve => {
      clientHlsWaiters.push(resolve);
    });
  }
  clientHlsOpens += 1;
  try {
    return await work();
  } finally {
    clientHlsOpens -= 1;
    clientHlsWaiters.shift()?.();
  }
}

export function nativeHlsConfig(opts: NativeHlsConfigOptions = {}): Record<string, unknown> {
  const compact = !!opts.compact;
  return {
    enableWorker: true,
    lowLatencyMode: false,
    // ~2 Mbps prior on the main player; compact starts on the ~700kbps low rung
    // so four panes do not all chase high/*.ts through the proxy.
    abrEwmaDefaultEstimate: compact ? 700_000 : 2_000_000,
    abrEwmaFastLive: compact ? 4 : 3,
    abrEwmaSlowLive: compact ? 12 : 9,
    abrBandWidthFactor: compact ? 0.7 : 0.85,
    abrBandWidthUpFactor: compact ? 0.5 : 0.7,
    maxBufferLength: compact ? 24 : 30,
    maxMaxBufferLength: compact ? 36 : 60,
    maxBufferSize: compact ? 24_000_000 : 60_000_000,
    backBufferLength: compact ? 15 : 30,
    capLevelToPlayerSize: compact,
    liveSyncDurationCount: compact ? 5 : 3,
    liveMaxLatencyDurationCount: compact ? 8 : 12,
    manifestLoadingTimeOut: 20_000,
    levelLoadingTimeOut: 20_000,
    fragLoadingTimeOut: compact ? 20_000 : 30_000,
    startFragPrefetch: !compact,
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
