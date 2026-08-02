/**
 * Tiny indirection so helpers can stop native HLS without importing hlsPlayer
 * (hlsPlayer imports helpers for `log`).
 */
let stopNative: ((key?: string) => void) | null = null;

export function registerNativeStop(fn: (key?: string) => void): void {
  stopNative = fn;
}

/** Stop one instance by key, or every native player when `key` is omitted. */
export function stopNativePlayback(key?: string): void {
  stopNative?.(key);
}
