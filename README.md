# Anytype Web Clipper

A Chrome/Edge extension that clips web pages directly to your local [Anytype](https://anytype.io/) app. No server or middleware required — just open Anytype and click the extension.

## Features

- **One-click clip** — Save any web page to Anytype with title, tags, and full content
- **Quick Save mode** — Bookmark a URL without extracting page content
- **Smart duplicate detection** — Update existing objects or create new ones
- **Tag management** — Create, edit, rename, and recolor tags inline
- **100-level milestone system** — Track your clipping progress with 10 tiers of achievements
- **Multi-space support** — Switch between Anytype spaces; preferences saved per space
- **i18n** — English and Traditional Chinese (zh-TW)
- **Fully local** — All data stays on your machine via Anytype's local API (`127.0.0.1:31009`)

## Install

### From source (Developer mode)

1. Clone this repository:
   ```bash
   git clone https://github.com/marskingx/anytype-web-clipper.git
   ```
2. Open Chrome/Edge and go to `chrome://extensions` (or `edge://extensions`)
3. Enable **Developer mode**
4. Click **Load unpacked** and select the cloned folder

### Prerequisites

- [Anytype](https://anytype.io/) desktop app must be running locally

## Usage

1. Open any web page
2. Click the extension icon
3. Choose **Space**, **Save As** (Anytype Type), and optionally add **Tags**
4. Click **Save**
5. If the URL already exists, choose to **Update** or **Save as New**
6. Done — click **Open in Anytype** to view the saved object

## How it works

```
Browser Tab
  ↓ content script (Readability + Turndown)
  ↓ extracts article → Markdown
  ↓
Popup.js ←→ Background.js (Service Worker)
                ↓
          Anytype Local API (127.0.0.1:31009)
                ↓
          Creates/Updates Object in Anytype
```

1. **Content extraction** — Injects [Readability](https://github.com/mozilla/readability) + [Turndown](https://github.com/mixmark-io/turndown) to extract clean article content as Markdown
2. **Authentication** — Uses Anytype's challenge-based auth (4-digit code shown in the desktop app)
3. **Object creation** — Sends structured data to Anytype's local API with properties, tags, and body content

## Development

### Run tests

```bash
npm install
npm test          # 261 unit tests
npm run test:e2e  # 7 E2E tests (requires Chrome)
```

### Project structure

```
├── manifest.json          # Chrome Extension manifest v3
├── background.js          # Service worker (message router)
├── popup.html/js/css      # Extension popup UI
├── options.html/js        # Settings page
├── lib/
│   ├── anytype-api.js     # Anytype API client
│   ├── clip-pipeline.js   # Clip orchestration logic
│   ├── content-extractor.js # Injected content script
│   ├── i18n-helper.js     # Internationalization helper
│   ├── markdown-post.js   # Markdown post-processing
│   └── milestones.js      # 100-level milestone system
├── vendor/
│   ├── readability.js     # Mozilla Readability (bundled)
│   └── turndown.js        # Turndown HTML→Markdown (bundled)
├── _locales/              # i18n messages (en, zh_TW)
├── icons/                 # Extension icons
└── tests/e2e/             # Playwright E2E tests
```

## Contributing

Contributions are welcome! Please open an issue first to discuss what you'd like to change.

1. Fork the repo
2. Create a feature branch (`git checkout -b feat/my-feature`)
3. Run tests (`npm test`)
4. Submit a Pull Request

## License

[MIT](LICENSE)
