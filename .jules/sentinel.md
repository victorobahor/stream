## 2024-05-29 - [Sanitize URL Control Characters]
**Vulnerability:** XSS protocol bypass using control characters
**Learning:** `new URL()` parser throws or fails when control characters are present, while the browser ignores them in `<a href>` and `<iframe src>`, bypassing URL sanitation checks (like `javascript:`).
**Prevention:** Remove all control characters (`/[\x00-\x1F\x7F-\x9F]/g`) from URLs before doing protocol validation.
