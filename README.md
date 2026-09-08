# StreamZone

Live sports streaming web application — browse, search, and watch live sports streams from **Streamed** and **SportSRC**, merged into one catalog.

## Features

- **Dual providers** — Streamed ([streamed.pk](https://streamed.pk)) as primary catalog, SportSRC V1 merged in parallel
- **Browse matches** by category: Live, All Matches, Today, Popular
- **Filter by sport** — dynamically loaded sports list with emoji icons
- **Search** matches by title, team name, or category
- **Ad-free player** — both providers use native video; SportSRC wrappers are resolved on the server, and iframe playback is blocked by CSP. Ads already embedded in the broadcast itself are not removed.
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
- **Node embed proxy** — production server: static SPA + `/__embed` rewrite + `/api/hls/*` + `/api/sportsrc/*` BFF
- **Vitest** — unit tests for API merge, CSP, rewrite, and SportSRC dispatch
- **Docker** — multi-stage build (Vite + Playwright Chromium for HLS resolve)
- **Streamed API** — match/stream data from [streamed.pk](https://streamed.pk) / [strmd.link](https://strmd.link)
- **SportSRC V1** — keyless catalog via [api.sportsrc.org](https://api.sportsrc.org/) (proxied under `/api/sportsrc/*`)

## Getting Started

### Development

```bash
npm install
cp .env.example .env   # optional SportSRC / HLS overrides
npm run dev            # Vite + SportSRC BFF + embed proxy on http://localhost:3000
```

Changes to any `.ts` file in `src/` refresh instantly via HMR. The Vite plugin mounts the same embed/SportSRC handlers used in production.

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
| `npm run dev` | Vite dev server with HMR + embed/SportSRC proxy |
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
├── .env.example             # Optional SportSRC / HLS env overrides
├── vite.config.ts
├── tsconfig.json
├── package.json
├── embed-proxy/
│   ├── server.mjs           # Production: static dist + HLS + SportSRC + /__embed
│   ├── vitePlugin.ts        # Dev middleware (same handlers)
│   ├── rewrite.mjs          # Embed HTML rewrite / ad strip / allowlist
│   ├── hlsNative.mjs        # Native HLS mint via Playwright
│   └── sportsrc.mjs         # SportSRC V1 BFF → api.sportsrc.org
└── src/
    ├── app.ts               # Entry point: init(), auto-refresh, UI orchestration
    ├── types.ts             # Sport, APIMatch, Stream, AppState... interfaces
    ├── state.ts             # Typed state, API hosts, CSP connect-src union
    ├── helpers.ts           # Sanitization, category filters, shouldProxyEmbed()
    ├── format.ts            # Dates, sport emoji, posters
    ├── api.ts               # Streamed + SportSRC fetch, mergeMatchLists(), loadStreams()
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
| **Streamed** | Direct browser → `streamed.pk` / `strmd.link` | `/api/stream/...` | Native video via `/api/hls/*`; try another stream on failure |
| **SportSRC** | Browser → `/api/sportsrc/*` (server BFF) | Same BFF for stream list | Server unwraps the provider page → same native HLS path |

Matches present in both catalogs are merged into one card with both sources (Admin-style Streamed sources ranked above SportSRC). SportSRC-only rows use ids prefixed with `sportsrc:`.

Optional env (see `.env.example`):

- `SPORTSRC_BASE_URL` — default `https://api.sportsrc.org/`
- `SPORTSRC_API_KEY` — unused for public V1; reserved for keyed variants
- `SPORTSRC_CACHE_TTL_MS` — BFF response cache (default 30s)
- Native playback is mandatory. The old `VITE_HLS_NATIVE=0` iframe fallback is no longer supported.

## Playback reliability

The server resolves provider pages with Playwright when required, then prefers Node media fetching. CDNs that require a browser retain a paused resolver page and use a remembered working transport. The app never receives provider scripts or iframe documents during playback. Unsupported wrappers show an unavailable/retry state.

Each player closes its server session when stopped, including late responses from abandoned opens. Multi View waits for eight seconds of video before starting; the main player waits for four. This adds startup time in exchange for protection against immediate stalls. Network failures after startup trigger at most two session renewals per two minutes, then try the remaining streams/providers. A 20-second no-progress watchdog catches stalled live playlists. Multi View retains unaffected video elements during source and layout changes.

Media caches are limited to 16 MiB / 64 entries per session. Concurrent identical requests share a fetch; live playlists expire after one second. Expired live playlists and a different quality's playlist are never substituted to conceal upstream failures. AES key, initialization map, and audio playlist URLs remain behind the proxy.

For Cloud Run, the deployment enables [session affinity](https://docs.cloud.google.com/run/docs/configuring/session-affinity) because resolver sessions live in process memory. Affinity is best effort; the client reconnects if an instance loses a session. A long-lived container on a single host is also supported by Docker Compose. Provision enough memory for the two concurrent Chromium resolvers plus active sessions. Upstream outages, broadcast content, and viewer bandwidth still affect playback.

Run a real-provider check against a local production server after `npm run build` and `PORT=8080 npm start`:

```bash
BASE_URL=http://localhost:8080 PLAYBACK_MATCHES='Club Brugge|AEK Athens|NEC Nijmegen|Porto' npx playwright test e2e/multiview-playback.spec.ts
```

Use four unique titles from the current Today catalog; schedules and source availability change. The test selects SportSRC on two panes, requires all four to advance throughout a full minute, rejects iframe fallback, and attaches playback metrics. Local deterministic tests use generated HLS and need no live sports availability.

## Security

All user-controlled data (match titles, team names, stream URLs, poster paths) is sanitized before DOM insertion:

- `escapeHtml(str)` — escapes `& < > " '` for safe innerHTML usage
- `sanitizeUrl(url)` — blocks `javascript:`, `data:`, `vbscript:` protocols
- `matchTextIncludes(match, query)` — typed, reusable search filter
- Event handlers use `data-action` + delegated listeners (no inline handlers)
- No `eval`, no `innerHTML` with unsanitized external data
- Embed proxy allowlists Streamed + SportSRC player hosts; CSP `connect-src` is the union of both

## API

Streamed endpoints are documented in [API.md](API.md). SportSRC is consumed only through the local BFF (`/api/sportsrc/...`); see the SportSRC section at the end of that file.
