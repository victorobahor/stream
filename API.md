# Streamed API Documentation

> Base URL: `https://streamed.pk`  
> Mirror: `https://strmd.link`  
> All endpoints return JSON. No authentication required.

---

## Quick Start

```javascript
// Fetch all football matches
fetch('https://streamed.pk/api/matches/football')
  .then(response => response.json())
  .then(matches => {
    console.log(matches);

    // Get streams for the first match
    if (matches.length > 0) {
      const match = matches[0];
      const source = match.sources[0];

      fetch(`https://streamed.pk/api/stream/${source.source}/${source.id}`)
        .then(response => response.json())
        .then(streams => console.log(streams))
        .catch(error => console.error('Error fetching streams:', error));
    }
  })
  .catch(error => console.error('Error fetching matches:', error));
```

## Guidelines

- All endpoints return JSON
- No authentication required
- No rate limits (may change in the future)
- HTTP status codes follow standard conventions (200, 404, etc.)

---

## 1. Sports API

> `GET /api/sports`

Provides all available sport categories. Use sport IDs to filter matches.

### Object Structure

```typescript
interface Sport {
  id: string;    // Sport identifier (used in Matches API endpoints)
  name: string;  // Display name of the sport
}
```

### Example Response

```json
[
  { "id": "football",   "name": "Football"   },
  { "id": "basketball", "name": "Basketball" },
  { "id": "tennis",     "name": "Tennis"     },
  { "id": "hockey",     "name": "Hockey"     },
  { "id": "baseball",   "name": "Baseball"   },
  { "id": "mma",        "name": "MMA"        },
  { "id": "boxing",     "name": "Boxing"     }
]
```

### Usage Example

```javascript
fetch('https://streamed.pk/api/sports')
  .then(response => response.json())
  .then(sports => {
    // Build a sport selector dropdown
    const select = document.createElement('select');
    sports.forEach(sport => {
      const option = document.createElement('option');
      option.value = sport.id;
      option.textContent = sport.name;
      select.appendChild(option);
    });

    select.addEventListener('change', (event) => {
      const sportId = event.target.value;
      if (sportId) {
        fetch(`https://streamed.pk/api/matches/${sportId}`)
          .then(response => response.json())
          .then(matches => {
            console.log(`Found ${matches.length} matches for ${sportId}`);
          });
      }
    });
  });
```

---

## 2. Matches API

> Provides sports events data including match details, team info, and stream sources.

### Object Structure

```typescript
interface APIMatch {
  id: string;        // Unique identifier for the match
  title: string;     // Match title (e.g. "Team A vs Team B")
  category: string;  // Sport category (e.g. "football", "basketball")
  date: number;      // Unix timestamp in milliseconds
  poster?: string;   // URL path to match poster image
  popular: boolean;  // Whether the match is marked as popular
  teams?: {
    home?: {
      name: string;   // Home team name
      badge: string;  // URL path to home team badge
    };
    away?: {
      name: string;   // Away team name
      badge: string;  // URL path to away team badge
    };
  };
  sources: {
    source: string;  // Stream source identifier (e.g. "alpha", "bravo")
    id: string;      // Source-specific match ID
  }[];
}
```

### Available Endpoints

#### Sport-Specific Matches

| Endpoint | Description |
|---|---|
| `GET /api/matches/[SPORT]` | Matches for a specific sport |
| `GET /api/matches/[SPORT]/popular` | Popular matches for a sport |

> Replace `[SPORT]` with a sport ID from the Sports API (e.g. `football`, `basketball`).

#### All Matches

| Endpoint | Description |
|---|---|
| `GET /api/matches/all` | All matches across all sports |
| `GET /api/matches/all/popular` | All popular matches |

#### Today's Matches

| Endpoint | Description |
|---|---|
| `GET /api/matches/all-today` | Matches scheduled for today |
| `GET /api/matches/all-today/popular` | Popular matches scheduled for today |

#### Live Matches

| Endpoint | Description |
|---|---|
| `GET /api/matches/live` | Currently live matches |
| `GET /api/matches/live/popular` | Popular live matches |

### Example Response

```json
[
  {
    "id": "match_123",
    "title": "Manchester United vs Liverpool",
    "category": "football",
    "date": 1720598400000,
    "poster": "man-utd-liverpool-poster",
    "popular": true,
    "teams": {
      "home": {
        "name": "Manchester United",
        "badge": "man-utd-badge"
      },
      "away": {
        "name": "Liverpool",
        "badge": "liverpool-badge"
      }
    },
    "sources": [
      { "source": "alpha", "id": "mu-liv-123" },
      { "source": "bravo", "id": "456-mu-liv" }
    ]
  }
]
```

### Usage Example

```javascript
fetch('https://streamed.pk/api/matches/live')
  .then(response => {
    if (!response.ok) throw new Error('Network response was not ok');
    return response.json();
  })
  .then(matches => {
    matches.forEach(match => {
      console.log(`Match: ${match.title}, Time: ${new Date(match.date).toLocaleString()}`);

      // Access team information
      if (match.teams) {
        if (match.teams.home) console.log(`Home: ${match.teams.home.name}`);
        if (match.teams.away) console.log(`Away: ${match.teams.away.name}`);
      }

      // Get stream sources
      console.log('Available sources:', match.sources.map(s => s.source).join(', '));
    });
  })
  .catch(error => console.error('Error fetching matches:', error));
```

To get stream details for a specific match, use the `sources` values with the **Streams API**.

---

## 3. Streams API

> Provides live streaming sources for sports events. Returns stream details for embedding.

### Object Structure

```typescript
interface Stream {
  id: string;        // Unique identifier for the stream
  streamNo: number;  // Stream number/index
  language: string;  // Stream language (e.g. "English", "Spanish")
  hd: boolean;       // Whether the stream is in HD quality
  embedUrl: string;  // URL that can be used to embed the stream
  source: string;    // Source identifier (e.g. "alpha", "bravo")
}
```

### Available Endpoints

| Source | Endpoint |
|---|---|
| Alpha | `GET /api/stream/alpha/[id]` |
| Bravo | `GET /api/stream/bravo/[id]` |
| Charlie | `GET /api/stream/charlie/[id]` |
| Delta | `GET /api/stream/delta/[id]` |
| Echo | `GET /api/stream/echo/[id]` |
| Foxtrot | `GET /api/stream/foxtrot/[id]` |
| Golf | `GET /api/stream/golf/[id]` |
| Hotel | `GET /api/stream/hotel/[id]` |
| Intel | `GET /api/stream/intel/[id]` |

> Replace `[id]` with the `source.id` from the match's `sources` array.

### Example Response

```json
[
  {
    "id": "stream_456",
    "streamNo": 1,
    "language": "English",
    "hd": true,
    "embedUrl": "https://embed.example.com/watch?v=abcd1234",
    "source": "alpha"
  },
  {
    "id": "stream_457",
    "streamNo": 2,
    "language": "Spanish",
    "hd": false,
    "embedUrl": "https://embed.example.com/watch?v=efgh5678",
    "source": "alpha"
  }
]
```

### Usage Example

```javascript
// First, get match data to find available sources
fetch('https://streamed.pk/api/matches/live')
  .then(response => response.json())
  .then(matches => {
    if (matches.length > 0) {
      const match = matches[0];
      console.log(`Found match: ${match.title}`);

      if (match.sources && match.sources.length > 0) {
        const source = match.sources[0];
        console.log(`Using source: ${source.source}, ID: ${source.id}`);

        return fetch(`https://streamed.pk/api/stream/${source.source}/${source.id}`);
      } else {
        throw new Error('No sources available for this match');
      }
    } else {
      throw new Error('No matches found');
    }
  })
  .then(response => response.json())
  .then(streams => {
    console.log(`Found ${streams.length} streams`);

    streams.forEach(stream => {
      console.log(`Stream #${stream.streamNo}: ${stream.language} (${stream.hd ? 'HD' : 'SD'})`);
      console.log(`Embed URL: ${stream.embedUrl}`);

      // Embed the stream in an iframe:
      // document.getElementById('player').src = stream.embedUrl;
    });
  })
  .catch(error => console.error('Error:', error));
```

### Embedding a Stream

```html
<iframe
  id="stream-player"
  width="640"
  height="360"
  frameborder="0"
  allowfullscreen>
</iframe>
```

```javascript
function loadStream(embedUrl) {
  document.getElementById('stream-player').src = embedUrl;
}
```

---

## 4. Images API

> Provides team badges, match posters, and proxied images. All images are served in WebP format.

### Available Endpoints

#### Team Badges

```
GET /api/images/badge/[id].webp
```

The `[id]` value comes from the `team.badge` field of a match object.

#### Match Posters

```
GET /api/images/poster/[badge]/[badge].webp
```

The `[badge]` values are typically derived from team badge IDs.

#### Proxied Images

```
GET /api/images/proxy/[poster].webp
```

The `[poster]` value comes from the `poster` field of a match object.

### Usage Example

```javascript
fetch('https://streamed.pk/api/matches/football')
  .then(response => response.json())
  .then(matches => {
    if (matches.length > 0) {
      const match = matches[0];

      // Team badges
      if (match.teams) {
        if (match.teams.home && match.teams.home.badge) {
          const badge = document.createElement('img');
          badge.src = `https://streamed.pk/api/images/badge/${match.teams.home.badge}.webp`;
          badge.alt = match.teams.home.name;
          badge.width = 50;
          badge.height = 50;
        }
      }

      // Match poster
      if (match.poster) {
        const poster = document.createElement('img');
        poster.src = `https://streamed.pk/${match.poster}.webp`;
        poster.alt = match.title;
        poster.style.maxWidth = '100%';
      }
    }
  });
```

### HTML Implementation

```html
<!-- Team Badge -->
<img
  src="https://streamed.pk/api/images/badge/man-utd-badge.webp"
  alt="Manchester United"
  width="50"
  height="50"
/>

<!-- Match Poster -->
<img
  src="https://streamed.pk/api/images/poster/man-utd-badge/liverpool-badge.webp"
  alt="Manchester United vs Liverpool"
  class="match-poster"
/>

<!-- Proxied Image -->
<img
  src="https://streamed.pk/api/images/proxy/custom-event-poster.webp"
  alt="Special Event"
  class="event-poster"
/>
```

### Tips

- All images use WebP format for optimal compression
- Use width/height attributes to prevent layout shifts
- Add `loading="lazy"` for images below the fold
- Style with CSS as needed for responsive design

---

## Full Workflow Example

```javascript
async function loadStreamForSport(sportId) {
  try {
    // 1. Get matches for the sport
    const matches = await fetch(`https://streamed.pk/api/matches/${sportId}`)
      .then(res => res.json());

    if (matches.length === 0) return console.log('No matches found');

    const match = matches[0];
    console.log(`Match: ${match.title}`);

    // 2. Display team badges
    if (match.teams?.home?.badge) {
      const badgeUrl = `https://streamed.pk/api/images/badge/${match.teams.home.badge}.webp`;
      console.log(`Home badge: ${badgeUrl}`);
    }

    // 3. Display poster
    if (match.poster) {
      const posterUrl = `https://streamed.pk/${match.poster}.webp`;
      console.log(`Poster: ${posterUrl}`);
    }

    // 4. Get streams from the first available source
    if (match.sources.length > 0) {
      const source = match.sources[0];
      const streams = await fetch(
        `https://streamed.pk/api/stream/${source.source}/${source.id}`
      ).then(res => res.json());

      streams.forEach(stream => {
        console.log(`Stream #${stream.streamNo}: ${stream.language} (${stream.hd ? 'HD' : 'SD'})`);
        console.log(`Embed: ${stream.embedUrl}`);
      });
    }
  } catch (error) {
    console.error('Error:', error);
  }
}

// Load football matches
loadStreamForSport('football');
```
