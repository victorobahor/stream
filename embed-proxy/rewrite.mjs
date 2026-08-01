/** Shared embed HTML rewrite — used by the Vite plugin and the Docker/Node server. */

export const ALLOWED_EMBED_HOSTS = new Set(['embed.st', 'www.embed.st']);

// The HTML string uses double quotes inside a single-quoted JS string, so
// [^']* after ad.html already consumes through </iframe> — don't re-match it.
export const AD_INJECTOR_RE =
  /<script>\(\(\)=>\{let a=\(\)=>\{document\.body\.insertAdjacentHTML\('beforeend','[^']*ad\.html[^']*'\);[\s\S]*?\}\)\(\);<\/script>/i;

export const SINK_BOOTSTRAP = `<script>
(function () {
  var SINK = '/__ad_sink';
  function stub() {
    return {
      closed: false,
      location: {
        href: SINK,
        replace: function (u) { this.href = String(u); },
        assign: function (u) { this.href = String(u); }
      },
      document: { write: function () {}, writeln: function () {}, close: function () {}, open: function () { return this; } },
      focus: function () {},
      blur: function () {},
      close: function () { this.closed = true; },
      moveTo: function () {},
      resizeTo: function () {},
      open: function () { return null; }
    };
  }
  window.open = function (url, name, features) {
    try { console.debug('[ad-sink] window.open', url, name, features); } catch (e) {}
    return stub();
  };
  var _ins = Element.prototype.insertAdjacentHTML;
  Element.prototype.insertAdjacentHTML = function (pos, text) {
    if (typeof text === 'string' && /ad\\.html/i.test(text)) return;
    return _ins.call(this, pos, text);
  };
})();
</script>`;

export const AD_SINK_HTML =
  '<!doctype html><title>ad-sink</title><body style="margin:0;background:#0b0f17"></body>';

export function isAllowedEmbedUrl(raw) {
  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    return null;
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return null;
  if (!ALLOWED_EMBED_HOSTS.has(parsed.hostname)) return null;
  return parsed;
}

export function rewriteEmbedHtml(html, origin) {
  let out = html.replace(AD_INJECTOR_RE, '');
  out = out.replace(/(\s)(src|href)="(\/[^"]*)"/g, `$1$2="${origin}$3"`);
  if (out.includes('<meta charset="utf-8">')) {
    out = out.replace('<meta charset="utf-8">', `<meta charset="utf-8">${SINK_BOOTSTRAP}`);
  } else {
    out = SINK_BOOTSTRAP + out;
  }
  return out;
}

export async function readUpstream(url) {
  const res = await fetch(url, {
    headers: {
      Accept: 'text/html,application/xhtml+xml',
      'User-Agent':
        'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/144.0.0.0 Safari/537.36',
      Referer: 'https://embed.st/',
    },
  });
  return {
    status: res.status,
    body: await res.text(),
    contentType: res.headers.get('content-type') || 'text/html; charset=utf-8',
  };
}
