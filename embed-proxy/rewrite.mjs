/** Shared embed HTML rewrite — used by the Vite plugin and the Docker/Node server. */

export const ALLOWED_EMBED_HOSTS = new Set([
  // Streamed native player (never always-proxy — WASM lock)
  'embed.st',
  'www.embed.st',
  // SportSRC V1 wrappers (always proxy + strip ads)
  'embed.streamapi.cc',
  'streamapi.cc',
  'football77.org',
  'www.football77.org',
  'embed.sportsrc.org',
  'www.embed.sportsrc.org',
]);

// The HTML string uses double quotes inside a single-quoted JS string, so
// [^']* after ad.html already consumes through </iframe> — don't re-match it.
export const AD_INJECTOR_RE =
  /<script>\(\(\)=>\{let a=\(\)=>\{document\.body\.insertAdjacentHTML\('beforeend','[^']*ad\.html[^']*'\);[\s\S]*?\}\)\(\);<\/script>/i;

/** Hosts commonly injected as popunder / tracker scripts on SportSRC V1 wrappers. */
export const AD_SCRIPT_HOST_RE =
  /enteringlacquergiant\.com|histats\.com|s10\.histats\.com|sstatic1\.histats\.com|pl203\d+\.pu(?:sh|b)lic/i;

export const SINK_BOOTSTRAP = `<script>
(function () {
  var SINK = '/__ad_sink';
  var AD_HOST = /enteringlacquergiant\\.com|histats\\.com|doubleclick\\.net|googlesyndication\\.com/i;
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
  // Block late-injected ad scripts (src set after createElement).
  var _setAttr = Element.prototype.setAttribute;
  Element.prototype.setAttribute = function (name, value) {
    if (
      this.tagName === 'SCRIPT' &&
      String(name).toLowerCase() === 'src' &&
      AD_HOST.test(String(value))
    ) {
      try { console.debug('[ad-sink] blocked script', value); } catch (e) {}
      return;
    }
    return _setAttr.call(this, name, value);
  };
  try {
    var desc = Object.getOwnPropertyDescriptor(HTMLScriptElement.prototype, 'src');
    if (desc && desc.set) {
      Object.defineProperty(HTMLScriptElement.prototype, 'src', {
        configurable: true,
        enumerable: desc.enumerable,
        get: desc.get,
        set: function (v) {
          if (AD_HOST.test(String(v))) {
            try { console.debug('[ad-sink] blocked script.src', v); } catch (e) {}
            return;
          }
          return desc.set.call(this, v);
        }
      });
    }
  } catch (e) {}
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

/** Strip known wrapper ad / tracker markup from SportSRC V1 outer pages. */
export function stripAdJunk(html) {
  let out = String(html || '');
  // External ad / tracker scripts
  out = out.replace(
    /<script\b[^>]*\bsrc=["'][^"']*["'][^>]*>\s*<\/script>/gi,
    m => (AD_SCRIPT_HOST_RE.test(m) ? '' : m),
  );
  // Inline Histats (match one script block at a time — do not cross tags)
  out = out.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, block =>
    /\bHistats\b/i.test(block) ? '' : block,
  );
  out = out.replace(/<noscript\b[^>]*>[\s\S]*?histats[\s\S]*?<\/noscript>/gi, '');
  // Football77-style injector
  out = out.replace(AD_INJECTOR_RE, '');
  return out;
}

export function rewriteEmbedHtml(html, origin) {
  let out = stripAdJunk(html);
  out = out.replace(/(\s)(src|href)="(\/[^"]*)"/g, `$1$2="${origin}$3"`);
  // Prefer injecting after <head> so our stubs run before remaining scripts.
  if (/<head\b[^>]*>/i.test(out)) {
    out = out.replace(/<head\b[^>]*>/i, m => `${m}${SINK_BOOTSTRAP}`);
  } else if (out.includes('<meta charset="utf-8">')) {
    out = out.replace('<meta charset="utf-8">', `<meta charset="utf-8">${SINK_BOOTSTRAP}`);
  } else if (out.includes('<meta charset="UTF-8">')) {
    out = out.replace('<meta charset="UTF-8">', `<meta charset="UTF-8">${SINK_BOOTSTRAP}`);
  } else {
    out = SINK_BOOTSTRAP + out;
  }
  return out;
}

export async function readUpstream(url) {
  let referer = 'https://embed.streamapi.cc/';
  try {
    referer = new URL(url).origin + '/';
  } catch {
    /* keep default */
  }
  const res = await fetch(url, {
    headers: {
      Accept: 'text/html,application/xhtml+xml',
      'User-Agent':
        'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/144.0.0.0 Safari/537.36',
      Referer: referer,
    },
  });
  return {
    status: res.status,
    body: await res.text(),
    contentType: res.headers.get('content-type') || 'text/html; charset=utf-8',
  };
}
