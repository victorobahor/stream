import { describe, it, expect } from 'vitest';
import { __test } from './vitePlugin';

const {
  isAllowedEmbedUrl,
  rewriteEmbedHtml,
  stripAdJunk,
  extractNestedPlayerUrl,
  ALLOWED_EMBED_HOSTS,
} = __test;

describe('embed proxy allowlist (unified)', () => {
  it('should accept embed.st https URLs', () => {
    const u = isAllowedEmbedUrl('https://embed.st/embed/admin/foo/1');
    expect(u?.hostname).toBe('embed.st');
  });

  it('should accept embed.streamapi.cc https URLs', () => {
    const u = isAllowedEmbedUrl('https://embed.streamapi.cc/sport/abc/');
    expect(u?.hostname).toBe('embed.streamapi.cc');
  });

  it('should reject arbitrary hosts', () => {
    expect(isAllowedEmbedUrl('https://evil.com/embed/x')).toBeNull();
  });

  it('should list Streamed and SportSRC hosts', () => {
    expect(ALLOWED_EMBED_HOSTS.has('embed.st')).toBe(true);
    expect(ALLOWED_EMBED_HOSTS.has('embed.streamapi.cc')).toBe(true);
  });

  it('should inject the ad-sink bootstrap into HTML', () => {
    const html = '<meta charset="utf-8"><body>hi</body>';
    const out = rewriteEmbedHtml(html, 'https://embed.streamapi.cc');
    expect(out).toContain('ad-sink');
    expect(out).toContain('window.open');
  });
});

describe('stripAdJunk (SportSRC V1 wrappers)', () => {
  const sample = `
<!DOCTYPE html><html><head>
<meta charset="UTF-8">
<script src="https://enteringlacquergiant.com/fd/ca/65/evil.js"></script>
</head><body>
<iframe id="video-iframe" src="https://embed.st/embed/admin/foo/1"></iframe>
<script type="text/javascript">var _Hasync= _Hasync|| [];
_Hasync.push(['Histats.start', '1,4993469,4,0,0,0,00010000']);
(function() {
var hs = document.createElement('script'); hs.src = ('//s10.histats.com/js15_as.js');
document.head.appendChild(hs);
})();</script>
<noscript><a href="/" target="_blank"><img src="//sstatic1.histats.com/0.gif?1" alt=""></a></noscript>
</body></html>`;

  it('should remove popunder and histats scripts but keep the player iframe', () => {
    const out = stripAdJunk(sample);
    expect(out).not.toContain('enteringlacquergiant.com');
    expect(out).not.toContain('Histats');
    expect(out).toContain('https://embed.st/embed/admin/foo/1');
  });

  it('should extract nested embed.st player URL from streamapi wrappers', () => {
    expect(extractNestedPlayerUrl(sample)).toBe('https://embed.st/embed/admin/foo/1');
    expect(extractNestedPlayerUrl('<div>no player</div>')).toBeNull();
  });

  it('should not strip unrelated inline scripts when removing Histats', () => {
    const html = `<script>if (window.top === window.self) throw new Error('x');</script>
<script>var _Hasync=[]; _Hasync.push(['Histats.start','1']);</script>`;
    const out = stripAdJunk(html);
    expect(out).toContain('window.top === window.self');
    expect(out).not.toContain('Histats');
  });
});
