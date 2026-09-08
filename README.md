# RecRoster

A tiny personal app for tracking **books, audiobooks, movies and TV shows you were recommended** —
what you want to read/watch, who suggested it, plus a rating + notes library once you're done.

- **No build step, no backend.** Plain HTML/CSS/JS. Deploys as a static site.
- **Installable PWA** — open it in mobile Safari/Chrome and *Add to Home Screen*.
- **Your data stays on your device** (browser `localStorage`). Export/import JSON to move phones.
- Book/audiobook metadata: Open Library (no key), Google Books as fallback.
- Movie/TV metadata: [TMDB](https://www.themoviedb.org/) — paste your free v3 API key in **Settings**.

## Features

- **Queue** grouped by type; **Library** with search, type/rating filters, and a compact list toggle (**≡**).
- Add by **search**, by **scanning a book's barcode** (camera — needs HTTPS, so works once deployed), or **manually**.
- Per-item: status, 1–5 star rating, "recommended by", notes.
- **TV progress** — track the season/episode you're up to; **+1 ep** button right on the card.
- Export / import JSON for backups and moving devices.

The barcode scanner loads [ZXing](https://github.com/zxing-js/library) from a CDN on first use;
everything else works offline.

## Run locally

Any static server, e.g.:

```bash
python3 -m http.server 8080
```

Then open http://localhost:8080

## Deploy to GitHub Pages

1. Push this folder to a GitHub repo (`main` branch).
2. Repo **Settings → Pages → Build and deployment → Source: GitHub Actions**.
3. The included workflow publishes on every push. Your app: `https://<user>.github.io/<repo>/`
4. Open that URL on your phone → Share → **Add to Home Screen**.
5. In the app, open **Settings** and paste your TMDB API key.

## Moving to a new phone

**Settings → Export JSON** on the old device, then **Import JSON** on the new one.

> This product uses the TMDB API but is not endorsed or certified by TMDB.
