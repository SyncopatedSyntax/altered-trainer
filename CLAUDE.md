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
- Persistence: **two helpers, deliberately**. `store` is the original async
  string accessor and still carries the old prefs; `jstore` is a sync JSON one
  added for the practice data, because grading happens inside a tap handler and
  the queue advances immediately — an async write would race the next tap.
  Keys, all `at_`-prefixed so `ProgressBackup` sweeps them:
  `at_root` (last key — remembered), `at_label`, `at_settings`, `at_shape`
  (the CAGED shape you are on, as a stable number), `at_srs`, `at_focus`,
  `at_ios_hint`. `at_pos` is **retired** — it held a neck index, which the
  numbering fix made meaningless; it is migrated once and deleted.
- **Everything is written as JSON.** `ProgressBackup` JSON-parses on export and
  always JSON-stringifies on import, so a bare string round-trips back with
  quotes around it. `at_label` used to store `degrees` and would have come back
  as `"degrees"`, silently breaking the header toggle. `unq()` accepts raw,
  JSON and double-encoded forms on read.

## Position numbers are stable — do not re-break this

`getCagedPositions` used to sort the five shapes by lowest fret and *then* name
them `Position ${i+1}`. `transposeCaged` wraps frets mod 12, so that sort is a
cyclic rotation that depends on the parent key: Position 3 was `CAGED_MM[1]` in
C, `[3]` in F and `[4]` in G. Changing key silently swapped the shape under an
unchanged label.

The number now comes from the pattern (`SHAPE_NUM[idx]`) and is assigned
**before** the sort, so it travels with the shape. The array is still returned
in neck order, so the arrows still walk up the neck and may read 3, 4, 5, 1, 2
in a given key — that is correct, not a bug: the five shapes are a cycle.

- `SHAPE_ORDER = [2,3,4,0,1]` — position (1-based) → `CAGED_MM` index.
  **Position 1 is the shape whose lowest low-E note is the root**; the five
  anchors then ascend through the scale (R, #9, #11, b13, b7).
- `CAGED_MM` itself is never reordered. `scripts/verify.mjs` pins it by
  checksum, which turns the "do not regenerate" rule below into something the
  build enforces.

## Practice: focus shape + resolution drills

`scripts/verify.mjs` is the gate — run it before and after any change here.
It re-derives every transform from first principles rather than importing the
app's functions (importing them would only prove they agree with themselves).
1483 assertions.

- **Cards are `shape|drill`**, 5 shapes × up to 6 drills. The key is a per-rep
  variable, never part of the card id — the toolbox's rule that the unit of
  mastery is the movable shape.
- **Every drill is answered by selecting the COMPLETE set** and pressing Check.
  Grading is exact: every correct cell, no extras. Accepting any one correct
  cell meant the single root you already knew passed the card forever, which is
  the whole reason the first version did not teach anything.
- **The target count is never shown.** Telling you there are three roots is most
  of the answer. `fill` is the exception — the gaps are visible, so the count is
  free information already.
- **Six drills**, in two families:
  - *Recognition*, shape drawn (mono): `root` (every root in the shape — a root
    elsewhere in the window is a deliberate near-miss state), `ires` (every
    place the I root falls), `ithird` (every place the b7 lands, off by
    default), `fill` (the shape minus 5 dots, put them back).
  - *Production*, blank neck: `octave` (lowest root to the next, always exactly
    8 notes) and `build` (place the whole 16–18 note shape).

## Only the blank-neck drills care about the key

**A position's picture is identical in all twelve keys** — `verify.mjs` asserts
that as the numbering invariant. So when the shape is drawn, randomising the
key changes the fret numbers underneath and nothing else: the answer sits in
the same cell every time. The key is decoration there, not difficulty.

It only becomes real on an empty neck, where you have to find the root yourself.
Hence two different sets, and **do not merge them**:

- `BLANK = {build, octave}` — what gets *drawn* (empty neck ⇒ needs the hidden
  window).
- `KEY_DRILLS = {build, octave}` — what the *key* changes, so what counts toward
  key coverage in `shapeProgress`.

`fill` sits on the recognition side of the second line even though it is a
"produce the dots" question: it draws the shape minus a few, so its picture is
key-invariant too. Demanding key coverage of it would repeat the exact mistake
this change fixed.

## The hidden window

Blank-neck drills draw an **8-fret window with the shape pushed `k` frets in
from the left**, `k` random in `0..min(3, lo)`. Every shape spans exactly 5
frets, so 8 leaves 3 of slack and the framing no longer tells you where the
shape sits. 15 of 60 shape × key combinations have `lo < 3` and get less than
full ambiguity; at `lo = 0` the shape is left-aligned against the nut, which is
identifiable anyway. verify.mjs pins that count so it cannot quietly get worse.

The key, the offset and the `fill` blanks are all decided **once, at
queue-build time** and carried on the queue item, so nothing reshuffles under a
half-finished answer.
- **`ithird` is major-only and must not follow `settings.defKind`.** Over a
  minor I the target is root+8, which *is* in the altered scale — it is the
  b13 — so it would sit under an existing dot and destroy the "tap an empty
  fret" premise. verify.mjs pins this.
- **Two bars, on purpose.** `isLearned` (reps ≥ 2) is the toolbox's, kept so
  the chip means what it means elsewhere. Promotion is stricter: every drill at
  `READY_REPS` (3) *and* correct in `READY_KEYS` (6) distinct keys, tracked as
  a 12-bit `keysSeen` mask. With a random key per rep, reps alone can be earned
  twice in one sitting in two keys, which is not knowing a shape. Measured: one
  12-question session covers 4–6 keys, so promotion takes about two sessions.
- **Recommended but open.** `at_focus` is the app's suggestion; `at_shape` is
  where you happen to be browsing. They are separate so wandering off in
  Positions does not rewrite the plan, and nothing is ever locked.
- The queue is three-tier (due → new → not-yet-due) and **cycles with modulo**,
  so a 2-card focus deck still fills a 12-question session — in a different key
  each time, which is the whole point of drilling one shape.

## Fretboard drill props

All optional, all no-ops when omitted, so the Positions view is unchanged:
`mono` (uniform grey, no labels, no root ring — the root drill is meaningless
without it, since `DC['R']` is bright red), `hideLabels`, `highlight` (a Set of
`"s_f"`; ported from MelodicMinorTrainer, respects `prefers-reduced-motion`),
`onTapCell`, `marks`, `win`, `rowH`, `fill`.

Two things not to undo:
- **The tap grid is the last child of the `<svg>`.** SVG has no z-index, so
  paint order decides hit-testing. It covers the whole window, not just the
  dots, because two of the three drills are answered on an empty fret.
- **`rowH={36}` + `fill` in drill mode, and the board card is full-bleed**
  (`margin:'0 -12px'` against the tab's 12px padding). The default layout pins
  `height:280` with `width:auto`, which letterboxes to ~34px rows — under the
  44px touch minimum. Measured across a whole session: 6- and 7-fret windows
  give 50×50, the 8-fret blank-neck window gives exactly 44×44. Those 12px of
  side padding are the difference between 44.2 and 42.9, so do not put them
  back. Note `sc` is dead code: the inline style overrides the width/height
  attributes.
- **`cells` may be empty** when `win` is supplied — that is how a blank neck
  renders. The old `if (!cells.length) return null` guard bailed on it.
- **`selected`** draws the live pick before Check, deliberately unlike both a
  scale dot and a feedback mark: on a blank neck there is nothing else to
  compare it to, so it has to read as "I put this here".

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
- **Practice** (default) — the focus shape, its drills, the ready-to-move-on
  banner, and the five-shape ladder. The landing screen on purpose: the problem
  it solves is "which shape am I supposed to be working on".
- **Explorer** — spelling, half-step shortcut, tritone-sub equivalence.
- **Positions** — 5 positions / 3nps toggle, full-neck, per-note resolution
  overlay (default targets: R + 3rd), audio.
- **Settings** — defaults (fingering, resolution, target notes, key-selector
  mode), practice drills / session length / key mode, `ProgressBackup`, reset
  progress, reset install banner, Ko-fi button. (Key is remembered, not a
  default.)

## Audio
iOS silent-switch bypass: the toolbox-standard **two-layer fix** (audioSession
'playback' on iOS 16.4+, plus a looping silent `<audio>` fallback for older
iOS) sits at the top of the audio block; all play paths route through
`unlockAudio()` (directly or via `playMidis()`). See root `CLAUDE.md → Audio`;
reference implementation in `Chord-Trainer/App.jsx`. Don't regress to a
fire-once MP3. Also carries the shared bus + gentle limiter (`getBus()`) and
idle-suspend (`bumpIdle()`, in both `playMidis` and `playPos`) — rapid taps
don't swell, and iOS drops "now playing" once quiet (root `CLAUDE.md → Audio`).

## Not built yet (roadmap)
- The 7 three-notes-per-string patterns as a second practice track. Their
  `start` degree is already key-invariant, so they need no identity work — just
  a second ladder.
- A "play it from memory" self-graded drill, for the physical skill the tap
  drills cannot test.
- "Tap every scale note in this window", not bound to a position — the natural
  next production drill once the five shapes are solid.
- Licks tab (canonical altered lines that land on the I).

## Before shipping any change
- `node scripts/verify.mjs` must pass — it is the correctness gate for the
  shapes, the numbering invariant and the drill answers.
- `npm run build` to confirm the JSX compiles.
- Test on a real iPhone in standalone mode for touch/scroll issues. For the
  drill grid specifically, tap accuracy is the one thing a headless run cannot
  judge.
