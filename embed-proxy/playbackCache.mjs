/** Byte- and age-bounded media cache. Values never outlive the session. */
export function cacheMedia(session, url, data, now = Date.now()) {
  if (!data?.buf?.length || session.closed) return;
  session.bodyCache ??= new Map();
  session.bodyCache.delete(url);
  session.bodyCache.set(url, { ...data, at: now });
  let bytes = 0;
  for (const entry of session.bodyCache.values()) bytes += entry.buf.length;
  for (const [key, entry] of session.bodyCache) {
    if (now - (entry.at || 0) > 30_000 || bytes > 16 * 1024 * 1024 || session.bodyCache.size > 64) {
      session.bodyCache.delete(key);
      bytes -= entry.buf.length;
    }
  }
}

export function cachedMedia(session, url, now = Date.now()) {
  const hit = session.bodyCache?.get(url);
  if (!hit) return null;
  const playlist = url.includes('.m3u8') || hit.ct?.includes('mpegurl');
  const ttl = playlist ? 1_000 : 30_000;
  if (now - hit.at > ttl) {
    session.bodyCache.delete(url);
    return null;
  }
  return hit;
}

/** Coalesce retries/concurrent clients for one session's identical media request. */
export async function loadMedia(session, url, fetcher) {
  const hit = cachedMedia(session, url);
  if (hit) return hit;
  session.mediaInFlight ??= new Map();
  if (session.mediaInFlight.has(url)) return session.mediaInFlight.get(url);
  const pending = Promise.resolve().then(fetcher).then(data => {
    cacheMedia(session, url, data);
    return data;
  }).finally(() => { session.mediaInFlight.delete(url); });
  session.mediaInFlight.set(url, pending);
  return pending;
}
