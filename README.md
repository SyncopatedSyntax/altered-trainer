# AlteredTrainer

Learn the altered scale (7th mode of melodic minor) for jazz V7alt chords —
positions, three-notes-per-string, and on-shape resolution targets.
Part of the Jazz Guitar Toolbox.

## Run locally
```bash
npm install
npm run dev      # open the printed localhost URL
npm run build    # production build into /dist
```

## Deploy

### Option A — GitHub website + Vercel dashboard (no command line)
1. github.com → **New repository** → name it `altered-trainer` → **Create** (leave it empty, no README).
2. On the new repo page click **uploading an existing file**, then drag in everything
   in this folder EXCEPT `node_modules` and `dist`
   (`package.json`, `vite.config.js`, `index.html`, `.gitignore`, `README.md`, and the `src/` folder).
   Click **Commit changes**.
3. vercel.com → **Add New… → Project** → **Import** your `altered-trainer` repo
   (authorize GitHub the first time).
4. Vercel auto-detects **Vite** (build = `vite build`, output = `dist`). Just click **Deploy**.
5. You get a `https://altered-trainer-xxxx.vercel.app` URL. Every future `git push` redeploys automatically.

### Option B — command line
```bash
cd altered-trainer
git init
git add .
git commit -m "AlteredTrainer v1"
# create the GitHub repo + push (needs the GitHub CLI `gh`, logged in):
gh repo create altered-trainer --public --source=. --remote=origin --push
# …or do it manually after creating an empty repo on github.com:
# git remote add origin https://github.com/<you>/altered-trainer.git
# git branch -M main && git push -u origin main

# then deploy with the Vercel CLI (optional — the dashboard import also works):
npm i -g vercel
vercel          # links/creates the project, follow prompts
vercel --prod   # production deploy
```

## Notes
- Don't commit `node_modules` or `dist` — `.gitignore` already excludes them; Vercel installs and builds for you.
- The PWA manifest and icons are injected at runtime, so "Add to Home Screen" works once deployed.
- For full offline support later, add `vite-plugin-pwa`.
