import { isAllowedEmbedUrl, readUpstream } from './rewrite.mjs';

function nativeTarget(url) {
  return ['embed.st', 'www.embed.st'].includes(url.hostname) && url.pathname.startsWith('/embed/');
}

/** Unwrap provider HTML as data. None of its scripts execute in the viewer. */
export async function resolveNativeEmbed(raw, read = readUpstream) {
  let target = isAllowedEmbedUrl(raw);
  const visited = new Set();
  for (let depth = 0; target && depth < 4; depth++) {
    if (target.protocol !== 'https:' || target.username || target.password || target.port) break;
    if (nativeTarget(target)) return target.toString();
    if (visited.has(target.href)) break;
    visited.add(target.href);
    const response = await read(target.href);
    if (response.status >= 300 && response.status < 400 && response.location) {
      target = isAllowedEmbedUrl(new URL(response.location, target).href);
      continue;
    }
    if (response.status !== 200) throw new Error(`Provider player HTTP ${response.status}`);
    const frames = [...String(response.body).matchAll(/<iframe\b[^>]*\bsrc\s*=\s*["']([^"']+)["']/gi)];
    const urls = frames.map(match => {
      try { return isAllowedEmbedUrl(new URL(match[1].replace(/&amp;/g, '&'), target).href); }
      catch { return null; }
    }).filter(Boolean);
    target = urls.find(nativeTarget) || urls.find(url => !visited.has(url.href));
  }
  throw Object.assign(new Error('This provider has no supported ad-free player'), { statusCode: 422 });
}
