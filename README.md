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

## Tech Stack

- **Vanilla JavaScript (ES6+)** — no frameworks, no build step, zero dependencies
- **HTML5 / CSS3** — custom properties, CSS variables
- **Nginx** — served via Docker

## Getting Started

### Docker (recommended)

```bash
docker-compose up -d
```

The app will be available at `http://localhost:8080`.

### Static file server

```bash
python3 -m http.server 8080
```

Then open `http://localhost:8080`.

## Project Structure

```
├── index.html          # Single HTML page
├── app.js              # Application logic
├── style.css           # All styles
├── Dockerfile          # Nginx-based Docker image
├── docker-compose.yml  # Docker Compose configuration
```

## API

All match and stream data is fetched from the [Streamed API](https://streamed.pk). This project is a client-side UI layer with no backend of its own.
