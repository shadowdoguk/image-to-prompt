# Image-to-Prompt Generator

An AI-powered web application that transforms uploaded images into refined, detailed text prompts optimized for AI image generation models (Stable Diffusion, Midjourney, DALL-E, Flux). Powered by MiniMax M3.

## Features

- **Image upload** with drag-and-drop and click-to-browse (JPG, PNG, WebP up to 10MB)
- **Optional base prompt** — guide the generation with your own intent
- **Secure backend** — API key stored server-side in environment variables
- **Real-time preview** of uploaded image before submission
- **Loading state** during API processing
- **Copy-to-clipboard** for generated prompts
- **Error handling** for API timeouts, rate limits, and invalid responses
- **Responsive design** — works on mobile, tablet, and desktop

## Architecture

- **Backend**: Node.js + Express, handles API communication with MiniMax M3
- **Frontend**: Vanilla HTML/CSS/JS (no build step), drag-and-drop upload, responsive UI
- **API**: MiniMax M3 (`MiniMax-Text-01`) for vision + prompt generation
- **Security**: API key never exposed to client; all uploads validated and sanitized

## Quick Start

### Prerequisites

- Node.js >= 18
- A MiniMax API key (sign up at https://api.minimaxi.chat)

### Local Development

1. **Clone and install dependencies:**
   ```bash
   npm install
   ```

2. **Configure environment variables:**
   ```bash
   cp .env.example .env
   ```
   Then edit `.env` and set your `MINIMAX_API_KEY`:
   ```
   MINIMAX_API_KEY=your-actual-api-key-here
   ```

3. **Start the server:**
   ```bash
   npm start
   ```

4. **Open the app:**
   Visit [http://localhost:3100](http://localhost:3100) (or whatever `PORT` you set in `.env`)

### Development Mode (auto-reload)

```bash
npm run dev
```

## Configuration

All configuration is via environment variables (see `.env.example`):

| Variable | Default | Description |
|----------|---------|-------------|
| `MINIMAX_API_KEY` | — | **Required.** Your MiniMax API key |
| `MINIMAX_BASE_URL` | `https://api.minimaxi.chat/v1` | MiniMax API base URL |
| `MINIMAX_MODEL` | `MiniMax-Text-01` | Model to use for generation |
| `PORT` | `3100` | Server port (change if 3100 is also taken) |
| `MAX_FILE_SIZE_BYTES` | `10485760` | Max upload size (10MB) |

## API Endpoints

### `GET /api/health`

Health check.

**Response:**
```json
{
  "success": true,
  "data": {
    "status": "ok",
    "provider": "minimax-m3",
    "configured": true
  }
}
```

### `POST /api/analyze`

Upload an image and a `presetId`; returns a structured JSON analysis across
the fields defined by the chosen preset.

**Request:** `multipart/form-data`
- `image` — image file (JPG, PNG, WebP, max 10MB)
- `presetId` — ID of an existing preset

**Response:**
```json
{
  "success": true,
  "data": {
    "preset_id": "preset_alla_prima_oil",
    "preset_name": "Alla Prima Oil Painting",
    "analysis": { "subject": "...", "style": "...", "...": "..." },
    "requested_fields": ["subject", "style", "..."],
    "model": "MiniMax-Text-01"
  }
}
```

### `POST /api/generate-prompt`

Take a (possibly edited) analysis + optional user directives and synthesize the
final image-generation prompt via Stage 2.

**Request:** `application/json`
- `presetId` — ID of the preset whose `stage2_system_prompt` should be used
- `analysis` — the (edited) Stage 1 analysis object
- `directives` — optional string of additional user instructions (≤ 1000 chars)

**Response:**
```json
{
  "success": true,
  "data": {
    "preset_id": "preset_alla_prima_oil",
    "preset_name": "Alla Prima Oil Painting",
    "prompt": "A serene mountain landscape at sunset...",
    "model": "MiniMax-Text-01"
  }
}
```

## Preset API

Presets are reusable Stage 1 / Stage 2 prompt configurations, persisted in
`data/presets.json`.

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/presets` | List all presets |
| `GET` | `/api/presets/:id` | Get a single preset |
| `POST` | `/api/presets` | Create a new preset |
| `PUT` | `/api/presets/:id` | Update an existing preset (partial) |
| `DELETE` | `/api/presets/:id` | Delete a preset |
| `GET` | `/api/presets/export/all` | Download all presets as `.i2p.json` |
| `GET` | `/api/presets/export/:id` | Download a single preset as `.i2p.json` |
| `POST` | `/api/presets/import` | Import an `.i2p.json` envelope |

The export envelope format is `image-to-prompt-preset` (version `1`); see
the `i2p.json` files exported from the UI for the exact shape.

## Project Structure

```
image-to-prompt/
├── server.js              # Express backend + MiniMax M3 integration
├── package.json
├── .env.example           # Environment variable template
├── .gitignore
├── README.md
├── CLAUDE.md              # Agent skills configuration
├── docs/
│   └── agents/
│       ├── issue-tracker.md
│       ├── triage-labels.md
│       └── domain.md
└── src/                   # Frontend (served as static files)
    ├── index.html
    ├── styles.css
    └── app.js
```

## Security

- **API key protection**: `MINIMAX_API_KEY` is read from `.env` server-side only; never sent to the client
- **Input validation**: file type and size validated before upload; base prompt sanitized to strip control characters and limit length
- **Error sanitization**: error messages are redacted to prevent API key/token leakage in client-facing responses
- **Upload cleanup**: uploaded files are deleted from disk after processing (success or error)

## Deployment

### Production Environment Variables

Set the following in your production environment:

```bash
MINIMAX_API_KEY=your-production-key
MINIMAX_BASE_URL=https://api.minimaxi.chat/v1
MINIMAX_MODEL=MiniMax-Text-01
PORT=3000
NODE_ENV=production
MAX_FILE_SIZE_BYTES=10485760
```

### Docker (example)

```dockerfile
FROM node:18-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production
COPY . .
EXPOSE 3000
CMD ["node", "server.js"]
```

### Reverse Proxy (Nginx)

```nginx
client_max_body_size 12M;  # Slightly larger than MAX_FILE_SIZE for headers
```

## Testing

End-to-end test checklist:

- [ ] Upload a valid JPG image (< 10MB) → expect refined prompt
- [ ] Upload a valid PNG image → expect refined prompt
- [ ] Upload a valid WebP image → expect refined prompt
- [ ] Upload with base prompt → expect prompt that builds on base
- [ ] Upload without base prompt → expect pure image-based prompt
- [ ] Upload an oversized file (> 10MB) → expect validation error
- [ ] Upload an invalid file type (e.g., GIF, PDF) → expect validation error
- [ ] Test with invalid/missing API key → expect friendly error
- [ ] Test copy-to-clipboard functionality
- [ ] Test regenerate button

## License

MIT

## Contributing

Issues and PRs welcome. This project uses GitHub Issues for tracking — see `docs/agents/issue-tracker.md`.