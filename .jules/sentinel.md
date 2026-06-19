## 2024-05-18 - URL Sanitization Bypass via Control Characters
**Vulnerability:** XSS bypass due to incomplete URL sanitization. The `sanitizeUrl` function only stripped `\n`, `\r`, and `\t` before checking against blocked protocols like `javascript:`.
**Learning:** Browsers typically ignore all ASCII control characters (`\x00-\x1F` and `\x7F`) when parsing URLs. Attackers can inject these characters (e.g. `\x01javascript:alert(1)`) to bypass simple string-matching blocklists, leading to XSS vulnerabilities.
**Prevention:** Always strip all control characters `[\x00-\x1F\x7F]` when sanitizing URLs, and utilize ESLint ignore directives for regexes containing control characters if necessary.

## 2024-05-18 - XSS bypass via unescaped HTML attributes
**Vulnerability:** XSS vulnerability in `buildSandboxedSrcdoc` due to lack of HTML escaping when injecting URLs into iframe `src` attributes. Although the URL was sanitized for protocols (like `javascript:`), an attacker could inject `"></iframe><script>alert(1)</script>` to breakout of the attribute and inject malicious HTML.
**Learning:** Sanitizing URLs (e.g., removing blocked protocols) is necessary but not sufficient when injecting those URLs directly into an HTML string template. The value must also be HTML-escaped to prevent attribute breakout.
**Prevention:** Always use `escapeHtml` (or equivalent HTML escaping function) on variables before injecting them into HTML attributes, even if the variable has already been passed through a URL sanitizer.
