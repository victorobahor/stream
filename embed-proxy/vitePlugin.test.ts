import { describe, it, expect } from 'vitest';
import { isAllowedEmbedUrl, rewriteEmbedHtml, AD_INJECTOR_RE } from './rewrite.mjs';

describe('embed proxy allowlist', () => {
  it('should accept embed.st https URLs', () => {
    const u = isAllowedEmbedUrl('https://embed.st/embed/admin/x/1');
    expect(u?.hostname).toBe('embed.st');
  });

  it('should reject unrelated hosts', () => {
    expect(isAllowedEmbedUrl('https://evil.example/embed')).toBeNull();
  });

  it('should reject non-http(s)', () => {
    expect(isAllowedEmbedUrl('javascript:alert(1)')).toBeNull();
  });
});

describe('rewriteEmbedHtml', () => {
  const injector =
    `<script>(()=>{let a=()=>{document.body.insertAdjacentHTML('beforeend','<iframe style="visibility:hidden"id="close"width="1"height="1"scrolling="no"frameborder="0"src="/ad.html"></iframe>');setTimeout(()=>{document.querySelector("#close").remove();},9000);setTimeout(a,600000)};a()})();</script>`;

  it('should match the live ad.html injector pattern', () => {
    expect(AD_INJECTOR_RE.test(injector)).toBe(true);
  });

  it('should strip the ad.html injector and inject the open sink', () => {
    const html =
      `<!doctypehtml><html lang="en"><meta charset="utf-8"><script src="https://cdn.example/player.js"></script>${injector}`;
    const out = rewriteEmbedHtml(html, 'https://embed.st');
    expect(out).toContain('[ad-sink]');
    expect(out).toContain('window.open');
    expect(out).not.toContain("src=\"/ad.html\"");
    expect(out).not.toContain('insertAdjacentHTML(\'beforeend\'');
  });

  it('should absolutize root-relative asset URLs', () => {
    const html = `<!doctypehtml><meta charset="utf-8"><iframe src="/ad.html">`;
    const out = rewriteEmbedHtml(html, 'https://embed.st');
    expect(out).toContain('src="https://embed.st/ad.html"');
  });
});
