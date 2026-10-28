# StreamZone API Documentation

StreamZone reads two keyless upstream catalogs, both only through local BFFs —
the browser never talks to a provider directly (CSP `connect-src 'self'`).

| Provider | App path | Role |
|---|---|---|
| **StreamFree** | `/api/strmfree/*` | Primary catalog (replaced Streamed, which shut down in October 2026) |
| **SportSRC V1** | `/api/sportsrc/*` | Second catalog, merged by fixture |

Playback for both goes through `/api/hls/open?u=<embed>` → same-origin HLS.
Provider pages are read as data on the server and never shown to viewers, so
provider ads, popunders and trackers never load.

---

# StreamFree (via local BFF)

> Upstream: `https://strmfree.st/api/v1/*` (docs: https://strmfree.st/api)  
> App path: `/api/strmfree/*` (Vite middleware in dev, `embed-proxy/server.mjs` in production)

## How StreamZone maps paths

| Client request | Upstream | Cache |
|---|---|---|
| `GET /api/strmfree/matches` | `GET /api/v1/streams` | 60s |
| `GET /api/strmfree/stream/{stream_key}` | `GET /api/v1/sources/{stream_key}` | 30s |

`/matches` returns `APIMatch[]`: `id` = `stream_key`, `date` = `match_timestamp × 1000`,
`status: "inprogress"` when `live_sources` is non-empty (24/7 channels included),
teams from `team1`/`team2`, poster from `thumbnail_url`. Categories are mapped to the
app's sport ids: `soccer → football`, `football → american-football`,
`combat → fight`, `racing → motor-sports`. External (`is_external`) streams are dropped.

`/stream/{key}` returns `Stream[]` from `live_sources` once any are live, otherwise
from `sources`, labelled by variant (`1080p`, `1080p · Source 2`). An unknown key is `[]`.

## Playback

Each embed page (`https://strmfree.st/embed/{category}/{variant}`) carries its playlist
recipe: `VARIANT`, `IS_LIVE`, a signed token `_0x[QUALITY]`, and `/get-stream-key/{key}`
(origin vs CDN vs TikTok server). `resolveStrmfreePlaylist` reads these without executing
the page and builds `…/live[-cdn|-tiktok]/{variant}/index.m3u8?_t=…&_e=…&_n=…`.
Playlists and segments require a StreamFree `Referer`. No headless browser is used.
`IS_LIVE = false` → `/api/hls/open` answers **425** `STREAM_NOT_STARTED`.

## Env overrides

- `STRMFREE_BASE_URL` (default `https://strmfree.st/`)
- `STRMFREE_CACHE_TTL_MS` (default `60000`, minimum `15000`)

---

# SportSRC V1 (via local BFF)

> Upstream: `https://api.sportsrc.org/?data=…` (keyless public V1)  
> App path: `/api/sportsrc/*` (Vite middleware in dev, `embed-proxy/server.mjs` in production)  
> The browser never talks to `api.sportsrc.org` directly — CORS and caching are handled server-side.

## How StreamZone maps paths

| Client request | Upstream `data=` |
|---|---|
| `GET /api/sportsrc/sports` | sports list |
| `GET /api/sportsrc/matches/live` | live matches |
| `GET /api/sportsrc/matches/all` | all matches |
| `GET /api/sportsrc/matches/{sport}` | matches for sport |
| `GET /api/sportsrc/stream/{id}` or `/api/sportsrc/stream/sportsrc/{id}` | streams for match |

Responses are normalized to the `APIMatch` / `Stream` objects the SPA already uses. Match-only rows from SportSRC get a stub source `{ source: "sportsrc", id, category }` until streams are loaded.

## Client merge behavior

1. Fetch StreamFree (whole slate) and SportSRC (category/sport path) in parallel; either may fail alone.
2. Deduplicate by teams (+ title, sport, kick-off bucket); append a `sportsrc` source onto StreamFree cards when both list the same fixture.
3. SportSRC-only matches get ids prefixed with `sportsrc:`.
4. SportSRC stubs are probed for streams before cards render; StreamFree rows are trusted (its API asks not to be polled per page load). StreamFree is preferred in the picker.

## Env overrides

See `.env.example`:

- `SPORTSRC_BASE_URL` (default `https://api.sportsrc.org/`)
- `SPORTSRC_CACHE_TTL_MS` (default `30000`)
- `SPORTSRC_API_KEY` (optional; public V1 is keyless)

## Playback note

SportSRC embeds typically land on `embed.streamapi.cc` (often nesting `embed.st`). StreamZone sends every provider to `/api/hls/open?u=...`. The server unwraps SportSRC pages as data and resolves the nested player. The viewer receives only same-origin media; no iframe fallback is permitted.
