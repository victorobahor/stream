# StreamZone

Live sports streaming web application — browse, search, and watch live sports streams from multiple categories.

## Features

- **Browse matches** by category: Live, All Matches, Today, Popular
- **Filter by sport** — dynamically loaded sports list with emoji icons
- **Search** matches by title, team name, or category
- **Watch streams** via embedded iframes with source selection and automatic fallback
- **Multi-View mode** — watch up to 4 streams simultaneously in 1x2 or 2x2 layouts
- **Drag-and-drop** matches into stream slots, with session persistence via localStorage
- **EPL detection** — Premier League matches get a special badge and priority sorting
- **Live auto-refresh** — updates every 60 seconds in the Live category
- **Responsive design** — desktop, tablet, and mobile breakpoints
- **Dark theme** with animated orb background and glassmorphism UI
- **DOM XSS hardened** — all external data sanitized via `escapeHtml`, `sanitizeUrl`, and delegated event handlers

## Tech Stack

- **TypeScript** — strict mode, fully typed state and API layer
- **Vite** — dev server with HMR, esbuild-based production builds
- **ES modules** — code-split into 15 focused modules
- **Vitest** — test runner (config ready, tests in progress)
- **Nginx** — production serving via Docker
- **Streamed API** — match/stream data from [streamed.pk](https://streamed.pk)

## Getting Started

### Development

```bash
npm install
npm run dev          # Vite dev server on http://localhost:3000
```

Changes to any `.ts` file in `src/` refresh instantly via HMR.

### Production build

```bash
npm run build        # typecheck + bundle → dist/
npm run preview      # preview production build locally
```

### Docker

```bash
docker-compose up -d
# or
docker build -t streamzone .
docker run -p 8080:80 streamzone
```

The app will be available at `http://localhost:8080`.

### Commands

| Command | Description |
|---|---|
| `npm run dev` | Vite dev server with HMR (port 3000) |
| `npm run build` | TypeScript check + Vite production build → `dist/` |
| `npm run preview` | Preview production build locally |
| `npm run typecheck` | TypeScript check only (`tsc --noEmit`) |
| `npm test` | Run Vitest tests |

## Project Structure

```
├── index.html               # Single HTML page (data-action delegation, no inline handlers)
├── style.css                # All styles
├── Dockerfile               # Multi-stage: Node.js build + Nginx serve
├── docker-compose.yml
├── vite.config.ts            # Vite configuration
├── tsconfig.json             # TypeScript configuration
├── package.json
└── src/
    ├── app.ts                # Entry point: init(), auto-refresh, UI orchestration
    ├── types.ts              # Sport, APIMatch, Stream, AppState... interfaces
    ├── state.ts              # Typed state object, API_HOSTS, getImgUrl()
    ├── helpers.ts            # el(), escapeHtml(), sanitizeUrl(), matchTextIncludes(), log()
    ├── format.ts             # formatDate(), capitalize(), getSportEmoji(), getPosterUrl()
    ├── api.ts                # fetchJSON<T>(), loadSports(), loadMatches(), loadStreams()
    ├── cards.ts              # buildMatchCard(), buildCardPoster(), renderMatches()
    ├── filters.ts            # filterCategory(), filterSport(), applyFilters()
    ├── player.ts             # openPlayer(), renderPlayerInfo(), selectStream()
    ├── related.ts            # renderRelated()
    ├── ui.ts                 # showHome(), showSkeleton(), renderSportsBar()
    ├── delegates.ts          # Global click/input/keyboard event delegation
    ├── vite-env.d.ts
    └── multiview/
        ├── grid.ts           # renderMultiviewGrid(), buildFilledSlotContent()
        ├── sidebar.ts        # renderMultiviewSidebar(), applyMultiviewSidebarFilters()
        ├── slots.ts          # loadMultiviewSlotStream(), saveMultiviewState()
        └── modal.ts          # openMvModal(), filterMvModalMatches(), selectMvModalMatch()
```

## Security

All user-controlled data (match titles, team names, stream URLs, poster paths) is sanitized before DOM insertion:

- `escapeHtml(str)` — escapes `& < > " '` for safe innerHTML usage
- `sanitizeUrl(url)` — blocks `javascript:`, `data:`, `vbscript:` protocols
- `matchTextIncludes(match, query)` — typed, reusable search filter
- All 26 inline `onclick`/`oninput` handlers replaced with `data-action` + delegated event listeners
- No `eval`, no `innerHTML` with unsanitized external data

## API

All match and stream data is fetched from the [Streamed API](https://streamed.pk). This project is a client-side UI layer with no backend of its own. See [API.md](API.md) for full endpoint documentation.
