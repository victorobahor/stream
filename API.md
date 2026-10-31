# StreamZone API Documentation

StreamZone reads two upstream catalogs, both only through local BFFs —
the browser never talks to a provider directly (CSP `connect-src 'self'`).

| Provider | App path | Role |
|---|---|---|
| **StreamFree** | `/api/strmfree/*` | Primary catalog (replaced Streamed, which shut down in October 2026) |
| **PPV** | `/api/ppv/*` | Second catalog, merged by fixture (replaced SportSRC) |

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

`/stream/{key}` returns `Stream[]` from `live_sources` (`{ quality, url }` objects) once
any are live, otherwise from `sources`, labelled by variant (`1080p`, `1080p · Source 2`). An unknown key is `[]`.

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

# PPV (via local BFF)

> Upstream: `GET https://api.ppv.st/api/streams` — every category and stream in one payload  
> App path: `/api/ppv/*` (Vite middleware in dev, `embed-proxy/server.mjs` in production)  
> The browser never talks to `api.ppv.st` directly. The payload is cached server-side for 60s.

## How StreamZone maps paths

| Client request | Served from |
|---|---|
| `GET /api/ppv/sports` | Static sport list (the ids the sports bar filters on) |
| `GET /api/ppv/matches` | Every catalog row as an `APIMatch` |
| `GET /api/ppv/stream/{id}` | The row's main stream and substreams as `Stream[]` |

A row is live when `always_live` is set or the clock is between `starts_at` and `ends_at`. Every `always_live` row gets category `24-7`, including channels PPV files under a sport, and that chip ignores the Today and Popular tabs because channels have no kick-off. `popular` means live with 50+ viewers. PPV lists no team data, so its cards show the poster and title.

## Client merge behavior

1. Fetch both whole slates in parallel; either may fail alone. Category and sport filtering happens client-side.
2. Deduplicate by teams (+ title, sport, kick-off bucket); append a `ppv` source onto StreamFree cards when both list the same fixture.
3. PPV-only matches get ids prefixed with `ppv:`.
4. Neither catalog is probed per row. StreamFree is preferred in the picker.

## Env overrides

See `.env.example`:

- `PPV_BASE_URL` (default `https://api.ppv.st/`)
- `PPV_CACHE_TTL_MS` (default `60000`, minimum `15000`)

## Playback note

PPV `iframe` URLs sit on throwaway domains, so `Stream.embedUrl` is a stable handle, `https://ppv.st/embed/<uri_name>`. `/api/hls/open` looks up the row's current iframe in the catalog, so Chromium only opens URLs the catalog lists. A stream more than 30 minutes from kick-off answers 425 `STREAM_NOT_STARTED` without opening a browser.

The player mints its playlist with WASM, so each session costs one Chromium open (cached 2 minutes per stream). Segments are MPEG-TS in the EXIF chunk of a WebP; the proxy strips the wrapper. Media hosts are allowlisted in `PPV_MEDIA_HOSTS` and `ALLOWED_CDN_SUFFIXES`. If PPV moves its CDN, playback fails until the allowlist is updated.
