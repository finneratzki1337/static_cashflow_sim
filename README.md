# Static Cashflow Simulator

A fully client-side cashflow simulator that runs in the browser and can be hosted on GitHub Pages.

## Run locally

Option 1: open `index.html` directly in your browser.

Option 2: serve the folder with a simple HTTP server:

```bash
python -m http.server
```

Then visit `http://localhost:8000`.

## GitHub Pages deployment

This repository ships with a GitHub Actions workflow (`.github/workflows/pages.yml`) that automatically deploys the static site to GitHub Pages on every push to `main`.

To enable Pages:

1. Go to **Settings → Pages** in your GitHub repo.
2. Under **Build and deployment**, select **GitHub Actions** as the source.
3. Push to `main` (or run the workflow manually) and your site will be published.

## Share link

Use the **“Share link with these Parameters”** button to encode the current simulator state into the URL hash. The app restores the full state from the hash on load, and falls back to localStorage if no hash exists.
