## 2024-05-18 - URL Sanitization Bypass via Control Characters
**Vulnerability:** XSS bypass due to incomplete URL sanitization. The `sanitizeUrl` function only stripped `\n`, `\r`, and `\t` before checking against blocked protocols like `javascript:`.
**Learning:** Browsers typically ignore all ASCII control characters (`\x00-\x1F` and `\x7F`) when parsing URLs. Attackers can inject these characters (e.g. `\x01javascript:alert(1)`) to bypass simple string-matching blocklists, leading to XSS vulnerabilities.
**Prevention:** Always strip all control characters `[\x00-\x1F\x7F]` when sanitizing URLs, and utilize ESLint ignore directives for regexes containing control characters if necessary.
