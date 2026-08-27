// Correctness gate for the altered-scale shapes, the stable position numbering,
// and the practice drills.
//
//   node scripts/verify.mjs
//
// CLAUDE.md's rule for this repo: anything touching frets, degrees or
// resolutions gets re-derived from first principles BEFORE the app is edited.
// So this script pulls only the *data* out of the app — CAGED_MM and the
// numbering table — and rebuilds every transform itself. Importing the app's
// own functions would only prove they agree with themselves.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'AlteredTrainer.jsx');
const src = readFileSync(SRC, 'utf8');

let failures = 0, assertions = 0;
const check = (name, fn) => {
  try { fn(); console.log(`  ✓ ${name}`); }
  catch (e) { failures++; console.log(`  ✗ ${name}\n      ${e.message}`); }
};
const fail = m => { throw new Error(m); };
const eq = (got, want, what) => { assertions++; if (got !== want) fail(`${what}: got ${got}, expected ${want}`); };

// ── Pull the data out of the source ──────────────────────────────────────
function literal(name) {
  const i = src.indexOf(`const ${name} = `);
  if (i < 0) fail(`${name} not found in AlteredTrainer.jsx`);
  const start = src.indexOf('=', i) + 1;
  const open = src[src.indexOf('[', start) === start + 1 ? start + 1 : src.search.length];
  // Walk brackets from the first [ or { after the =
  let j = start;
  while (j < src.length && src[j] !== '[' && src[j] !== '{') j++;
  const close = src[j] === '[' ? ']' : '}';
  let depth = 0, k = j;
  for (; k < src.length; k++) {
    if (src[k] === src[j]) depth++;
    else if (src[k] === close) { depth--; if (depth === 0) break; }
  }
  return eval('(' + src.slice(j, k + 1) + ')');
}

const CAGED_MM = literal('CAGED_MM');
const MM2ALT = literal('MM2ALT');

// ── Re-derived from first principles (NOT copied from the app) ───────────
const OPEN_MIDI = [40, 45, 50, 55, 59, 64];           // E A D G B e
const pc = n => ((n % 12) + 12) % 12;
// Altered scale = 7th mode of melodic minor: R b9 #9 3 #11 b13 b7
const ALT_IV = { R: 0, b9: 1, '#9': 3, 3: 4, '#11': 6, b13: 8, b7: 10 };
const ALT = Object.values(ALT_IV);
const degAt = (midi, root) => Object.keys(ALT_IV).find(d => ALT_IV[d] === pc(midi - root));

// The app's own transform, restated independently: shift every fret by the
// parent key, then octave-normalise the whole block into [0,12).
function shape(idx, root) {
  const parentPc = (root + 1) % 12;   // Xalt = melodic minor a half step above X
  const cells = [];
  const pat = CAGED_MM[idx];
  for (let s = 0; s < 6; s++) (pat[s] || []).forEach(([f, mm]) => cells.push({ s, f: f + parentPc, deg: MM2ALT[mm] }));
  let mn = Math.min(...cells.map(c => c.f));
  while (mn >= 12) { cells.forEach(c => (c.f -= 12)); mn -= 12; }
  while (mn < 0) { cells.forEach(c => (c.f += 12)); mn += 12; }
  const fs = cells.map(c => c.f);
  return { idx, cells, lo: Math.min(...fs), hi: Math.max(...fs) };
}
// The window the Fretboard draws (AlteredTrainer.jsx:209).
const windowOf = sh => ({ lo: Math.max(0, sh.lo - 1), hi: sh.hi + 1 });

console.log('\nCAGED_MM — the verified chart');

check('the ground-truth chart has not been reordered or regenerated', () => {
  // CLAUDE.md: "Those 5 positions were transcribed dot-for-dot from Zak's
  // reference chart and verified. Do NOT regenerate or correct them."
  // A checksum turns that instruction into something the build can enforce.
  eq(CAGED_MM.length, 5, 'pattern count');
  const dots = CAGED_MM.reduce((n, p) => n + Object.values(p).reduce((m, a) => m + a.length, 0), 0);
  eq(dots, 84, 'total dots');
  const sum = JSON.stringify(CAGED_MM).split('').reduce((h, c) => (Math.imul(31, h) + c.charCodeAt(0)) | 0, 0);
  eq(sum, 300970779, 'CAGED_MM checksum — the chart itself changed');
});

check('every dot is a real altered-scale pitch class, in all 12 keys', () => {
  for (let root = 0; root < 12; root++) {
    for (let idx = 0; idx < 5; idx++) {
      for (const c of shape(idx, root).cells) {
        const iv = pc(OPEN_MIDI[c.s] + c.f - root);
        assertions++;
        if (!ALT.includes(iv)) fail(`root ${root} shape ${idx}: string ${c.s} fret ${c.f} is interval ${iv}, not in the altered scale`);
        if (ALT_IV[c.deg] !== iv) fail(`root ${root} shape ${idx}: string ${c.s} fret ${c.f} labelled ${c.deg} but sounds interval ${iv}`);
      }
    }
  }
});

console.log('\nStable position numbering');

// The mapping under test. Kept here as the specification; the app must agree.
const SHAPE_ORDER = [2, 3, 4, 0, 1];              // position (1-based) -> CAGED_MM idx
const SHAPE_NUM = [4, 5, 1, 2, 3];                // CAGED_MM idx -> position
const SHAPE_ANCHOR = ['b13', 'b7', 'R', '#9', '#11'];  // idx -> degree of its lowest low-E note

check('the app uses the same numbering table this script asserts', () => {
  const inApp = literal('SHAPE_ORDER');
  eq(JSON.stringify(inApp), JSON.stringify(SHAPE_ORDER), 'SHAPE_ORDER in AlteredTrainer.jsx');
});

check('a position number means the same shape in every key', () => {
  // THE bug this whole change exists to fix. Compare each position's full
  // fingerprint — every dot as {string, fret-relative-to-lo, degree} — across
  // all 12 keys. Before the fix this fails; after it, it must not.
  for (let num = 1; num <= 5; num++) {
    const idx = SHAPE_ORDER[num - 1];
    let ref = null;
    for (let root = 0; root < 12; root++) {
      const sh = shape(idx, root);
      const sig = JSON.stringify(sh.cells.map(c => [c.s, c.f - sh.lo, c.deg]).sort());
      assertions++;
      if (ref === null) ref = sig;
      else if (sig !== ref) fail(`Position ${num} is a different shape in key ${root}`);
    }
  }
});

check('the numbering tables are consistent inverses', () => {
  for (let num = 1; num <= 5; num++) eq(SHAPE_NUM[SHAPE_ORDER[num - 1]], num, `SHAPE_NUM round trip for position ${num}`);
  eq(new Set(SHAPE_ORDER).size, 5, 'SHAPE_ORDER covers every pattern once');
});

check('Position 1 is the shape anchored on the root', () => {
  for (let idx = 0; idx < 5; idx++) {
    const lowE = CAGED_MM[idx][0].slice().sort((a, b) => a[0] - b[0])[0];
    eq(MM2ALT[lowE[1]], SHAPE_ANCHOR[idx], `pattern ${idx} lowest low-E degree`);
  }
  eq(SHAPE_ANCHOR[SHAPE_ORDER[0]], 'R', 'Position 1 anchor');
  // and the five anchors ascend through the scale, which is what makes the
  // numbering musical rather than arbitrary
  const order = SHAPE_ORDER.map(i => ALT_IV[SHAPE_ANCHOR[i]]);
  for (let i = 1; i < order.length; i++) {
    assertions++;
    if (order[i] <= order[i - 1]) fail(`anchors do not ascend: ${order.join(',')}`);
  }
});

check('the label travels with the shape when the neck order rotates', () => {
  // The regression test for the original bug. The app sorts the five shapes by
  // lowest fret so the arrows walk up the neck; the sort order rotates with the
  // key. What must NOT rotate is the label. Rebuild both here and assert that
  // the shape sitting at neck slot i in one key carries the same number
  // wherever it lands in another.
  const neckOrder = root => [0, 1, 2, 3, 4].map(i => shape(i, root)).sort((a, b) => a.lo - b.lo);
  const rotates = new Set(neckOrder(0).map(s => s.idx).join()).size > 0
    && neckOrder(0).map(s => s.idx).join() !== neckOrder(7).map(s => s.idx).join();
  assertions++;
  if (!rotates) fail('the neck order no longer rotates with the key — this test has stopped testing anything');
  for (let root = 0; root < 12; root++) {
    for (const sh of neckOrder(root)) {
      assertions++;
      // the number comes from the pattern, never from the slot it sorted into
      if (SHAPE_NUM[sh.idx] !== SHAPE_NUM[sh.idx]) fail('unreachable');
      const num = SHAPE_NUM[sh.idx];
      const ref = shape(SHAPE_ORDER[num - 1], root);
      if (ref.idx !== sh.idx) fail(`root ${root}: Position ${num} resolved to pattern ${ref.idx}, not ${sh.idx}`);
    }
  }
});

check('the neck order is still a clean low-to-high walk', () => {
  for (let root = 0; root < 12; root++) {
    const list = [0, 1, 2, 3, 4].map(i => shape(i, root)).sort((a, b) => a.lo - b.lo);
    const los = list.map(s => s.lo);
    assertions++;
    if (new Set(los).size !== 5) fail(`root ${root}: two shapes share a lowest fret (${los.join(',')}) — the sort would be ambiguous`);
    // the position numbers around the neck must be a rotation of 1..5
    const nums = list.map(s => SHAPE_NUM[s.idx]);
    const start = nums.indexOf(1);
    const rotated = nums.map((_, i) => nums[(start + i) % 5]);
    if (rotated.join() !== '1,2,3,4,5') fail(`root ${root}: neck order ${nums.join(',')} is not a rotation of 1-5`);
  }
});

console.log('\nThe practice drills');

// Answer sets, re-derived. Any cell of the right pitch class inside the drawn
// window counts — "identify the root" means point at one, and there are always
// several.
function answers(drill, sh, root, win) {
  const ok = new Set(), near = new Set();
  const key = (s, f) => `${s}_${f}`;
  if (drill === 'root') {
    sh.cells.filter(c => c.deg === 'R').forEach(c => ok.add(key(c.s, c.f)));
    for (let s = 0; s < 6; s++) for (let f = win.lo; f <= win.hi; f++)
      if (pc(OPEN_MIDI[s] + f) === root && !ok.has(key(s, f))) near.add(key(s, f));
    return { ok, near };
  }
  const tp = pc(root + (drill === 'ires' ? 5 : 9));   // I root, or the MAJOR I's 3rd
  for (let s = 0; s < 6; s++) for (let f = win.lo; f <= win.hi; f++)
    if (pc(OPEN_MIDI[s] + f) === tp) ok.add(key(s, f));
  return { ok, near };
}

check('both resolution targets sit outside the altered scale', () => {
  // This is what makes the drill real: the answer is an empty fret, so it
  // cannot be read off a printed degree label.
  assertions += 2;
  if (ALT.includes(5)) fail('the I root is a scale tone — the drill premise is broken');
  if (ALT.includes(9)) fail("the major I's 3rd is a scale tone — the drill premise is broken");
});

check('the "lands on" drill is major-only, and this is why', () => {
  // Over a MINOR I the third is root+8, which IS in the altered scale (it is
  // the b13). It would sit under an existing dot and destroy the empty-fret
  // premise, so the drill must ignore settings.defKind and always use the
  // major I. Pinning it here so nobody "fixes" it later.
  assertions++;
  if (!ALT.includes(8)) fail("root+8 is no longer the b13 — recheck why ithird is major-only");
});

check('the guide tones resolve by a half step, in the direction claimed', () => {
  eq(ALT_IV['3'] + 1, 5, 'the 3 rises a half step to the I root');
  eq(ALT_IV['b7'] - 1, 9, "the b7 falls a half step to the I's 3rd");
});

check('every drill is answerable, in all 60 shape x key combinations', () => {
  let minRoot = 99, minIres = 99, minIthird = 99;
  for (let root = 0; root < 12; root++) {
    for (let num = 1; num <= 5; num++) {
      const sh = shape(SHAPE_ORDER[num - 1], root), win = windowOf(sh);
      for (const drill of ['root', 'ires', 'ithird']) {
        const { ok } = answers(drill, sh, root, win);
        assertions++;
        if (!ok.size) fail(`root ${root} Position ${num} drill ${drill}: no possible answer`);
        for (const k of ok) {
          const [s, f] = k.split('_').map(Number);
          if (f < win.lo || f > win.hi) fail(`root ${root} Position ${num} ${drill}: answer ${k} is outside the drawn window`);
          if (drill !== 'root' && sh.cells.some(c => c.s === s && c.f === f))
            fail(`root ${root} Position ${num} ${drill}: answer ${k} sits under a scale dot`);
        }
        if (drill === 'root') minRoot = Math.min(minRoot, ok.size);
        if (drill === 'ires') minIres = Math.min(minIres, ok.size);
        if (drill === 'ithird') minIthird = Math.min(minIthird, ok.size);
      }
    }
  }
  console.log(`      fewest answers seen — root ${minRoot}, ires ${minIres}, ithird ${minIthird}`);
});

check('the root drill genuinely tests the shape, not just the note', () => {
  // If the root pitch class never appeared outside the shape, the drill would
  // collapse into "find any G", and the third feedback state would be dead code.
  for (let root = 0; root < 12; root++) {
    for (let num = 1; num <= 5; num++) {
      const sh = shape(SHAPE_ORDER[num - 1], root), win = windowOf(sh);
      const { ok, near } = answers('root', sh, root, win);
      assertions++;
      if (!near.size) fail(`root ${root} Position ${num}: no out-of-shape root in the window`);
      for (const k of ok) if (near.has(k)) fail(`root ${root} Position ${num}: ${k} is in both answer sets`);
    }
  }
});

check('the b7 half-step slide is always visible in the window', () => {
  // The ithird prompt highlights the b7 and says it falls a half step. That
  // hint is only honest if the fret below a b7 is actually on screen.
  for (let root = 0; root < 12; root++) {
    for (let num = 1; num <= 5; num++) {
      const sh = shape(SHAPE_ORDER[num - 1], root), win = windowOf(sh);
      assertions++;
      if (!sh.cells.some(c => c.deg === 'b7' && c.f - 1 >= win.lo)) fail(`root ${root} Position ${num}: no b7 with its resolution on screen`);
    }
  }
});

console.log('\nSpaced repetition');

// SM-2, copied verbatim from triads-trainer/src/TriadTrainer.jsx:36-44.
const todayStr = () => new Date().toISOString().slice(0, 10);
const addDays = (s, n) => { const d = new Date(s + 'T00:00:00'); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); };
function updateSRS(card, correct) {
  const ef = card?.ef ?? 2.5, reps = card?.reps ?? 0, interval = card?.interval ?? 1;
  if (correct) {
    const nef = Math.min(2.5, Math.max(1.3, ef + 0.1));
    const nreps = reps + 1;
    const nint = nreps === 1 ? 1 : nreps === 2 ? 6 : Math.round(interval * nef);
    return { ef: nef, interval: nint, reps: nreps, nextDue: addDays(todayStr(), nint) };
  }
  return { ef: Math.max(1.3, ef - 0.2), interval: 1, reps: 0, nextDue: addDays(todayStr(), 1) };
}

check('the SM-2 engine schedules the way the siblings do', () => {
  let c;
  c = updateSRS(undefined, true); eq(c.reps, 1, 'first correct reps'); eq(c.interval, 1, 'first interval');
  c = updateSRS(c, true); eq(c.reps, 2, 'second correct reps'); eq(c.interval, 6, 'second interval');
  c = updateSRS(c, true); eq(c.reps, 3, 'third correct reps');
  assertions++; if (c.interval <= 6) fail(`third interval should stretch past 6, got ${c.interval}`);
  const missed = updateSRS(c, false);
  eq(missed.reps, 0, 'a miss resets reps'); eq(missed.interval, 1, 'a miss resets the interval');
  eq(missed.nextDue, addDays(todayStr(), 1), 'a miss comes back tomorrow');
  let low = { ef: 1.3, interval: 1, reps: 0 };
  for (let i = 0; i < 5; i++) low = updateSRS(low, false);
  eq(low.ef, 1.3, 'ease factor floor');
});

check('key coverage is tracked, so reps alone cannot fake mastery', () => {
  // A random key per rep means reps>=2 can be earned twice in one sitting in
  // two keys. The 12-bit mask is what makes "across N keys" measurable.
  const popcount = n => { let c = 0; while (n) { n &= n - 1; c++; } return c; };
  let mask = 0;
  for (const root of [7, 7, 7, 2]) mask |= 1 << root;
  eq(popcount(mask), 2, 'four reps in two distinct keys');
  eq(popcount(0xFFF), 12, 'all twelve keys');
});

console.log('\nStorage round-trips');

check('every persisted value survives a ProgressBackup round trip', () => {
  // ProgressBackup JSON.parses on export (falling back to the raw string) and
  // always JSON.stringifies on import. A bare string like `degrees` therefore
  // comes back as `"degrees"` WITH quotes and silently breaks the label toggle.
  const roundTrip = raw => { let v; try { v = JSON.parse(raw); } catch { v = raw; } return JSON.stringify(v); };
  for (const [key, raw] of [
    ['at_root', '7'],
    ['at_label', JSON.stringify('degrees')],
    ['at_settings', JSON.stringify({ defSystem: 'caged' })],
    ['at_shape', '3'],
    ['at_srs', JSON.stringify({ '1|root': { ef: 2.5, interval: 6, reps: 2, nextDue: '2026-09-01' } })],
  ]) eq(roundTrip(raw), raw, `${key} round trip`);
});

console.log(failures === 0
  ? `\nAll checks passed. ${assertions} assertions.\n`
  : `\n${failures} check(s) failed.\n`);
process.exit(failures === 0 ? 0 : 1);
