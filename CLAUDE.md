# AlteredTrainer — project context

A single-file React PWA that teaches the **altered scale** (7th mode of melodic
minor) for jazz V7alt chords: scale shapes + where lines resolve. Part of the
**Fretworks** toolbox (sibling to ChordTrainer, DiatonicChordsTrainer,
MelodicMinorTrainer, Circle of Fifths, Triad Trainer). Sole developer + end
user: Zak. Shared publicly via Ko-fi `syncopatedsyntax`.

## Commands
- `npm install` then `npm run dev` — local dev
- `npm run build` — production build to `dist/` (this is what Vercel runs)
- Deploy: push to GitHub → Vercel auto-deploys (Vite preset, output `dist`)

## Architecture
- Everything lives in `src/AlteredTrainer.jsx` (default-exported `App`).
  `src/main.jsx` just mounts it. Keep it **single-file, inline styles, no deps
  beyond React** — matches the rest of the toolbox.
- Key pure functions (verify any change to these with a Node script):
  - `getCagedPositions(root)` — 5 positions; transposes `CAGED_MM` to the parent
    key `(root+1)%12`, relabels mel-min degrees → altered via `MM2ALT`, wraps each
    pattern onto the neck, sorts low→high.
  - `getTnpsPositions(root)` — 7 three-notes-per-string patterns, generated from
    the altered scale's pitch classes.
  - `getResolutions` / `getTargetTones(root, kind)` — I-chord tones + half-step pulls.
- Persistence via `store` (localStorage, guarded, falls back to `window.storage`).
  Keys: `at_root` (last key — remembered), `at_label`, `at_settings`.

## Music facts — VERIFIED, do not "fix" without re-verifying
- Altered scale = 7th mode of melodic minor. `Xalt` = melodic minor a **half step
  above** X. Intervals `[0,1,3,4,6,8,10]` = R b9 #9 3 #11 b13 b7.
- **`CAGED_MM` is ground truth.** Those 5 positions were transcribed dot-for-dot
  from Zak's reference melodic-minor chart and verified (all 84 dots checked
  against C-melodic-minor pitch classes). Do NOT regenerate or "correct" them.
- `MM2ALT = {1:b9, 2:#9, b3:3, 4:#11, 5:b13, 6:b7, 7:R}` (altered root sits on
  mel-min's 7th).
- Target I = `(root+5)%12`. Tritone sub = `(root+6)%12` (same scale = lydian
  dominant). Guide tones: 3→root of I (up ½), b7→3rd of I (down ½ for major,
  whole step for minor).
- Any change touching frets/degrees/resolutions: write a Node script that checks
  every (string,fret) is the correct pitch class BEFORE editing the app. Zak's
  standard is exact correctness — partial matches are failures.

## Colour language (consistent across the toolbox)
- `DC` = shared scale-degree colour map. Scale dots use it.
- **Teal `#2dd4bf` = resolution / "Resolves to" / I-chord target.** Used for the
  Resolves-to key selector and target-note markers.
- **Red `#ef4444`, hollow = the 3rd of the I** (primary landing note; most prominent).
- Blue `#74b9ff` = parent melodic minor reference + the full-neck toggle ONLY
  (not resolution).
- Orange `#e17055` = V7alt / dominant root.
- Fretboard markers: filled circle = scale note (root has white ring); hollow
  square = I chord tone you resolve to; square ringing a circle = scale note
  that's also a chord tone. Markers match the root's size unless overlapping a
  scale dot (then larger so the ring shows).
- Diagram orientation: `ry(r)` = row 0 at top → row 5 at bottom. Dots/markers
  use `cy = ry(5 - s)`, so string s=0 (low `E`) sits at the BOTTOM and s=5
  (high `e`) at the TOP (standard horizontal fretboard view). String-name
  labels must match this — render `STR_LABELS[r]` (the mapped element), NOT
  `STR_LABELS[5-r]`, or the labels invert relative to the dots.
- The Fretboard `<svg>` has `margin:0 auto` so every diagram centers in its
  container (full-neck views wider than the container still scroll via the
  parent's `overflowX:auto`).

## UX conventions (mobile-first; learned from ChordTrainer on iOS)
- Phone-first. On desktop the app renders as a centered ~430px column.
- Position nav arrows go BELOW the diagram, not beside it (SVG fills width).
- `onClick` only — no `onPointerDown`/`onTouchEnd`. Wrap risky state updates in
  `setTimeout(...,0)`. Notifications are `position:fixed` floating cards.
- Scroll-lock to (0,0) on mount (iOS standalone safe-area quirk). Audio unlocked
  via a silent-MP3 + AudioContext resume on first gesture.
- Header has a Degrees↔Notes label toggle and a V7alt-root↔Resolves-to key
  selector (picking one auto-sets the other). App remembers the last key.

## Tabs (current scope)
- **Explorer** — spelling, half-step shortcut, tritone-sub equivalence.
- **Positions** — 5 positions / 3nps toggle, full-neck, per-note resolution
  overlay (default targets: R + 3rd), audio.
- **Settings** — defaults (fingering, resolution, target notes, key-selector
  mode), reset install banner, Ko-fi button. (Key is remembered, not a default.)

## Not built yet (roadmap)
- Licks tab (canonical altered lines that land on the I), resolution quiz / SRS.

## Before shipping any change
- `npx @babel/core` transform or just run `npm run build` to confirm the JSX
  compiles. Test on a real iPhone in standalone mode for touch/scroll issues.
