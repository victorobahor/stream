# StreamZone

Live sports streaming web application — browse, search, and watch live sports streams from **StreamFree** and **PPV**, merged into one ad-free catalog.

## Features

- **Dual providers** — StreamFree ([strmfree.st](https://strmfree.st/api)) as primary catalog, PPV merged in parallel. Streamed shut down in October 2026 and has been removed.
- **Browse matches** by category: Live, All Matches, Today, Popular
- **Filter by sport** — dynamically loaded sports list with emoji icons
- **Search** matches by title, team name, or category
- **No ads** — every stream plays in the app's own `<video>`. Provider pages are read on the server as data and never framed (CSP `frame-src 'none'`), so provider ad scripts, popunders and trackers never load. Ads burned into the broadcast picture itself cannot be removed.
- **Multi-View mode** — watch up to 4 streams with adaptive quality, a 24-second forward buffer target, bounded back buffers, and independent recovery.
- **Drag-and-drop** matches into stream slots, with session persistence via localStorage
- **EPL detection** — Premier League matches get a special badge and priority sorting
- **Live auto-refresh** — updates every 60 seconds in the Live category
- **Responsive design** — desktop, tablet, and mobile breakpoints
- **Dark theme** with animated orb background and glassmorphism UI
- **DOM XSS hardened** — all external data sanitized via `escapeHtml`, `sanitizeUrl`, and delegated event handlers

## Tech Stack

- **TypeScript** — strict mode, fully typed state and API layer
- **Vite** — dev server with HMR, esbuild-based production builds
- **Node server** — production: static SPA + `/api/hls/*` native HLS proxy + `/api/strmfree/*` and `/api/ppv/*` BFFs
- **Vitest** — unit tests for API merge, CSP, and provider BFFs
- **Docker** — multi-stage build (Vite + Playwright Chromium for HLS resolve)
- **StreamFree API** — keyless catalog via [strmfree.st/api](https://strmfree.st/api) (proxied under `/api/strmfree/*`)
- **PPV** — catalog via [ppv.st](https://ppv.st/api) (proxied under `/api/ppv/*`)

## Getting Started

### Development

```bash
npm install
cp .env.example .env   # optional PPV / HLS overrides
npm run dev            # Vite + provider BFFs + embed proxy on http://localhost:3000
```

Changes to any `.ts` file in `src/` refresh instantly via HMR. The Vite plugin mounts the same provider and HLS handlers used in production.

### Production build

```bash
npm run build        # typecheck + bundle → dist/
PORT=8080 npm start   # full production server, including both providers and HLS
```

### Docker

```bash
docker-compose up -d --build
# or
docker build -t streamzone .
docker run -p 8080:80 --shm-size=2g streamzone
```

The app will be available at `http://localhost:8080`.

Chromium (Playwright) needs adequate `/dev/shm` for HLS resolve — `docker-compose.yml` sets `shm_size: "2gb"`.

### Commands

| Command | Description |
|---|---|
| `npm run dev` | Vite dev server with HMR + provider BFFs |
| `npm run build` | TypeScript check + Vite production build → `dist/` |
| `PORT=8080 npm start` | Full production server with HLS and provider endpoints |
| `npm run preview` | Static assets only; does not run the playback backend |
| `npm run test:e2e:local` | Real HLS playback with generated video, delays, and failures (requires FFmpeg + Playwright Chromium) |
| `npm run typecheck` | TypeScript check only (`tsc --noEmit`) |
| `npm test` | Run Vitest tests |

## Project Structure

```
├── index.html               # Single HTML page (data-action delegation, no inline handlers)
├── style.css                # All styles
├── Dockerfile               # Multi-stage: Vite build + Playwright Node server
├── docker-compose.yml
├── .env.example             # Optional PPV / HLS env overrides
├── vite.config.ts
├── tsconfig.json
├── package.json
├── embed-proxy/
│   ├── server.mjs           # Production: static dist + HLS + StreamFree/PPV BFFs
│   ├── vitePlugin.ts        # Dev middleware (same handlers)
│   ├── strmfree.mjs         # StreamFree BFF + browserless playlist resolver
│   ├── hlsNative.mjs        # Native HLS mint via Playwright
│   └── ppv.mjs              # PPV BFF → api.ppv.st
└── src/
    ├── app.ts               # Entry point: init(), auto-refresh, UI orchestration
    ├── types.ts             # Sport, APIMatch, Stream, AppState... interfaces
    ├── state.ts             # Typed state, API hosts, CSP connect-src union
    ├── helpers.ts           # Sanitization, category filters, shouldProxyEmbed()
    ├── format.ts            # Dates, sport emoji, posters
    ├── api.ts               # StreamFree + PPV fetch, mergeMatchLists(), loadStreams()
    ├── cards.ts             # Match cards / render
    ├── filters.ts           # Category + sport filters on merged list
    ├── player.ts            # openPlayer(), stream selection
    ├── hlsPlayer.ts         # Native video lifecycle, reconnect, and buffering
    ├── related.ts           # Related matches
    ├── ui.ts                # Home, skeleton, sports bar
    ├── delegates.ts         # Global event delegation
    └── multiview/           # Grid, sidebar, slots, modal
```

## Providers & playback

| Provider | Catalog | Streams | Playback |
|---|---|---|---|
| **StreamFree** | Browser → `/api/strmfree/matches` (server BFF) | `/api/strmfree/stream/{key}` | Server reads the signed playlist from the embed page (no browser) → native HLS |
| **PPV** | Browser → `/api/ppv/*` (server BFF) | Same BFF for stream list | Chromium mints the playlist on the server → same native HLS path |

Matches present in both catalogs are merged into one card with both sources (StreamFree ranked above PPV). PPV-only rows use ids prefixed with `ppv:`. When nothing is live on first load, the home page falls back to Today. Upcoming games say they haven't started instead of reporting an outage; earlier games that already finished sink below upcoming ones.

Optional env (see `.env.example`):

- `STRMFREE_BASE_URL` — default `https://strmfree.st/`
- `STRMFREE_CACHE_TTL_MS` — StreamFree list cache (default 60s; their API asks to be cached)
- `PPV_BASE_URL` — default `https://api.ppv.st/`
- `PPV_CACHE_TTL_MS` — BFF response cache (default 60s)
- Native playback is mandatory. The old `VITE_HLS_NATIVE=0` iframe fallback is no longer supported.

## Playback reliability

The server resolves provider pages with Playwright when required, then prefers Node media fetching. CDNs that require a browser retain a paused resolver page and use a remembered working transport. The app never receives provider scripts or iframe documents during playback. Unsupported wrappers show an unavailable/retry state.

The resolver validates the playlist body and allows provider retries. Three failures for the same playlist end the attempt early; navigation and capture share a 45-second deadline. `/api/hls/open` reports provider errors as HTTP 502 with `code: HLS_UPSTREAM_ERROR` and `upstreamStatus`, malformed playlists as 502 with `HLS_INVALID_PLAYLIST`, and no playlist as 504 with `HLS_RESOLVE_TIMEOUT`. Recent failures retain their status for 60 seconds, so clients can move to another source without repeating expensive resolves. Successful captures no longer wait for a provider-specific `mono.m3u8` filename before opening playback.

Delta troubleshooting: browser checks on 28–29 September 2026 found the Georgia–Ukraine, Belgium–France, and Latvia–Cyprus Delta playlists returning HTTP 500 in the provider's own player. Native HLS cannot repair an upstream outage; keep ad blocking enabled and use another available source or retry later. The local resolver tests reproduce this failure without relying on live broadcasts. The investigation used [Playwright network inspection](https://playwright.dev/docs/network) and [HLS.js error handling](https://github.com/video-dev/hls.js/blob/master/docs/API.md#errors).

Each player closes its server session when stopped, including late responses from abandoned opens. Multi View waits for eight seconds of video before starting; the main player waits for four. This adds startup time in exchange for protection against immediate stalls. Network failures after startup trigger at most two session renewals per two minutes, then try the remaining streams/providers. A 20-second no-progress watchdog catches stalled live playlists. Multi View retains unaffected video elements during source and layout changes.

Media caches are limited to 16 MiB / 64 entries per session. Concurrent identical requests share a fetch; live playlists expire after one second. Expired live playlists and a different quality's playlist are never substituted to conceal upstream failures. AES key, initialization map, and audio playlist URLs remain behind the proxy.

Production runs as one long-lived container via Docker Compose (resolver sessions live in process memory, so a single instance keeps them stable). CI pushes `streamzone:latest` to Docker Hub and GHCR on every push to `main`; update the host with `docker compose pull && docker compose up -d`. Provision enough memory for the two concurrent Chromium resolvers plus active sessions. Upstream outages, broadcast content, and viewer bandwidth still affect playback.

Run a real-provider check against a local production server after `npm run build` and `PORT=8080 npm start`:

```bash
BASE_URL=http://localhost:8080 PLAYBACK_MATCHES='Club Brugge|AEK Athens|NEC Nijmegen|Porto' npx playwright test e2e/multiview-playback.spec.ts
```

Use four unique titles that are live now; schedules and source availability change. The test uses the Live tab by default, selects PPV on panes whose cards carry it, requires all four to advance throughout a full minute, rejects iframe fallback, and attaches playback metrics. Local deterministic tests use generated HLS and need no live sports availability.

## Security

All user-controlled data (match titles, team names, stream URLs, poster paths) is sanitized before DOM insertion:

- `escapeHtml(str)` — escapes `& < > " '` for safe innerHTML usage
- `sanitizeUrl(url)` — blocks `javascript:`, `data:`, `vbscript:` protocols
- `matchTextIncludes(match, query)` — typed, reusable search filter
- Event handlers use `data-action` + delegated listeners (no inline handlers)
- No `eval`, no `innerHTML` with unsanitized external data
- The HLS proxy only opens StreamFree player pages and iframes listed in the PPV catalog and only fetches media from allowlisted hosts; CSP `connect-src 'self'` and `frame-src 'none'`

## API

Both providers are consumed only through local BFFs (`/api/strmfree/...`, `/api/ppv/...`); see [API.md](API.md).
