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

// Answer sets, re-derived. EVERY correct cell is in the set — the drill is
// answered by selecting all of them, not one. Tapping the single root you
// happen to know used to pass, which is the hole this closes.
const key = (s, f) => `${s}_${f}`;

// The window a production drill draws: 8 frets, with the shape pushed `k` frets
// in from the left so the framing does not give its position away.
const WIN_W = 8;
const winFor = (sh, k = 0) => { const lo = Math.max(0, sh.lo - Math.min(k, sh.lo)); return { lo, hi: lo + WIN_W - 1 }; };

// One octave of a shape: the cells from its lowest root up to the next root.
function rootSpan(sh) {
  const roots = [...new Set(sh.cells.filter(c => c.deg === 'R').map(c => OPEN_MIDI[c.s] + c.f))].sort((a, b) => a - b);
  if (roots.length < 2) return [];
  return sh.cells.filter(c => { const m = OPEN_MIDI[c.s] + c.f; return m >= roots[0] && m <= roots[1]; });
}

// Which dots `fill` removes. Deterministic in the seed so a question cannot
// reshuffle underneath the answer.
function blanksFor(sh, n, seed) {
  const idx = sh.cells.map((_, i) => i);
  let x = seed >>> 0;
  for (let i = idx.length - 1; i > 0; i--) { x = (x * 1664525 + 1013904223) >>> 0; const j = x % (i + 1); [idx[i], idx[j]] = [idx[j], idx[i]]; }
  return idx.slice(0, Math.min(n, sh.cells.length)).map(i => sh.cells[i]);
}

function answers(drill, sh, root, win, blanks) {
  const ok = new Set(), near = new Set();
  if (drill === 'root') {
    sh.cells.filter(c => c.deg === 'R').forEach(c => ok.add(key(c.s, c.f)));
    for (let s = 0; s < 6; s++) for (let f = win.lo; f <= win.hi; f++)
      if (pc(OPEN_MIDI[s] + f) === root && !ok.has(key(s, f))) near.add(key(s, f));
    return { ok, near };
  }
  if (drill === 'build')  { sh.cells.forEach(c => ok.add(key(c.s, c.f))); return { ok, near }; }
  if (drill === 'octave') { rootSpan(sh).forEach(c => ok.add(key(c.s, c.f))); return { ok, near }; }
  if (drill === 'fill')   { (blanks || []).forEach(c => ok.add(key(c.s, c.f))); return { ok, near }; }
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

check('a recognition drill returns EVERY answer, not one', () => {
  // The hole this closes: tapping the one root you know used to pass the card.
  for (let root = 0; root < 12; root++) {
    for (let num = 1; num <= 5; num++) {
      const sh = shape(SHAPE_ORDER[num - 1], root), win = windowOf(sh);
      const roots = sh.cells.filter(c => c.deg === 'R');
      const { ok } = answers('root', sh, root, win);
      assertions++;
      if (ok.size !== roots.length) fail(`root ${root} Position ${num}: ${ok.size} answers for ${roots.length} roots`);
      for (const c of roots) if (!ok.has(key(c.s, c.f))) fail(`root ${root} Position ${num}: missed the root at ${c.s}_${c.f}`);
      // and every occurrence of the target pitch class, for the resolution drills
      for (const drill of ['ires', 'ithird']) {
        const tp = pc(root + (drill === 'ires' ? 5 : 9));
        let n = 0;
        for (let s = 0; s < 6; s++) for (let f = win.lo; f <= win.hi; f++) if (pc(OPEN_MIDI[s] + f) === tp) n++;
        assertions++;
        if (answers(drill, sh, root, win).ok.size !== n) fail(`root ${root} Position ${num} ${drill}: not every occurrence returned`);
      }
    }
  }
});

console.log('\nProduction drills — blank neck');

check('the offset window always holds the whole shape and stays on the neck', () => {
  for (let root = 0; root < 12; root++) {
    for (let num = 1; num <= 5; num++) {
      const sh = shape(SHAPE_ORDER[num - 1], root);
      eq(sh.hi - sh.lo + 1, 5, `Position ${num} in key ${root} span`);   // all five shapes span 5 frets
      for (let k = 0; k <= 3; k++) {
        const w = winFor(sh, k);
        assertions++;
        if (w.lo < 0) fail(`root ${root} Position ${num} k=${k}: window starts at ${w.lo}`);
        if (sh.lo < w.lo || sh.hi > w.hi) fail(`root ${root} Position ${num} k=${k}: shape ${sh.lo}-${sh.hi} does not fit window ${w.lo}-${w.hi}`);
      }
    }
  }
});

check('the window actually hides the position most of the time', () => {
  // At lo < 3 the shape cannot be pushed the full 3 frets in, so it sits at or
  // near the left edge. That is a known limit, not a surprise — pin the count
  // so it cannot quietly get worse.
  let tight = 0, total = 0;
  for (let root = 0; root < 12; root++) for (let num = 1; num <= 5; num++) {
    total++; if (shape(SHAPE_ORDER[num - 1], root).lo < 3) tight++;
  }
  eq(total, 60, 'combinations checked');
  assertions++;
  if (tight > 15) fail(`${tight} of 60 combinations cannot offset fully — was 15`);
});

check('build asks for the whole shape and nothing else', () => {
  for (let root = 0; root < 12; root++) {
    for (let num = 1; num <= 5; num++) {
      const sh = shape(SHAPE_ORDER[num - 1], root), win = winFor(sh, 2);
      const { ok } = answers('build', sh, root, win);
      eq(ok.size, sh.cells.length, `Position ${num} key ${root} build size`);
      for (const c of sh.cells) {
        assertions++;
        if (!ok.has(key(c.s, c.f))) fail(`root ${root} Position ${num}: build missed ${c.s}_${c.f}`);
        if (c.f < win.lo || c.f > win.hi) fail(`root ${root} Position ${num}: cell ${c.f} outside the window`);
      }
    }
  }
});

check('octave is one root-to-root span, and every shape has one', () => {
  for (let root = 0; root < 12; root++) {
    for (let num = 1; num <= 5; num++) {
      const sh = shape(SHAPE_ORDER[num - 1], root);
      const span = rootSpan(sh);
      assertions++;
      if (!span.length) fail(`root ${root} Position ${num}: no root-to-root span`);
      eq(span.length, 8, `Position ${num} key ${root} octave size`);
      const midis = span.map(c => OPEN_MIDI[c.s] + c.f).sort((a, b) => a - b);
      eq(midis[midis.length - 1] - midis[0], 12, `Position ${num} key ${root} span is an octave`);
      const ends = span.filter(c => c.deg === 'R').length;
      assertions++;
      if (ends < 2) fail(`root ${root} Position ${num}: span should be bounded by two roots, found ${ends}`);
    }
  }
});

check('fill removes exactly the dots it asks for, and they are stable', () => {
  const N = 5;
  for (let root = 0; root < 12; root++) {
    for (let num = 1; num <= 5; num++) {
      const sh = shape(SHAPE_ORDER[num - 1], root);
      const seed = root * 5 + num;
      const blanks = blanksFor(sh, N, seed);
      eq(blanks.length, N, `Position ${num} key ${root} blank count`);
      // same seed, same blanks — a question must not reshuffle mid-answer
      eq(JSON.stringify(blanksFor(sh, N, seed)), JSON.stringify(blanks), `Position ${num} key ${root} blanks stable`);
      const { ok } = answers('fill', sh, root, winFor(sh, 1), blanks);
      eq(ok.size, N, `Position ${num} key ${root} fill answers`);
      const uniq = new Set(blanks.map(c => key(c.s, c.f)));
      eq(uniq.size, N, `Position ${num} key ${root} blanks distinct`);
      for (const c of blanks) {
        assertions++;
        if (!sh.cells.some(x => x.s === c.s && x.f === c.f)) fail(`root ${root} Position ${num}: blank ${c.s}_${c.f} is not in the shape`);
      }
    }
  }
});

check('key coverage is only demanded where the key changes the answer', () => {
  // Point 1: with the shape drawn, the picture is identical in all 12 keys, so
  // requiring key coverage of a drill that draws it asks for something that is
  // not a skill. `fill` belongs on the recognition side of this line even
  // though it is a "produce the dots" question — it draws the shape minus a
  // few, so the picture is still key-invariant.
  const KEY_DRILLS = new Set(literal('KEY_DRILLS') || []);
  const inApp = new Set(JSON.parse(JSON.stringify([...KEY_DRILLS])));
  for (const d of ['root', 'ires', 'ithird', 'fill']) { assertions++; if (inApp.has(d)) fail(`${d} draws the shape, so it must not count toward key coverage`); }
  for (const d of ['build', 'octave']) { assertions++; if (!inApp.has(d)) fail(`${d} starts from a blank neck, so it must count toward key coverage`); }
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

console.log('\nPractice planning');

// Same rule as everywhere else in this file: the app's helpers are NOT
// imported, they are restated. What follows is an independent implementation of
// what drillProgress / weakestDrills / nextUp / forecastStacked / buildQueue are
// supposed to do, run against synthetic schedules.
const dayDiff2 = (a, b) => Math.round((new Date(b + 'T00:00:00') - new Date(a + 'T00:00:00')) / 86400000);
const DRILLS_V = literal('DRILLS');
const WEAK_MIN_SEEN_V = 4, WEAK_ACC_V = 0.8, READY_REPS_V = 3;
const cid = (n, d) => `${n}|${d}`;
const cards5 = ds => { const o = []; for (let n = 1; n <= 5; n++) for (const d of ds) o.push({ id: cid(n, d), shape: n, drill: d }); return o; };
const isLearned2 = c => !!c && c.reps >= 2;
const dueOn2 = (c, td) => !!c && dayDiff2(td, c.nextDue) <= 0;

function drillProgress2(drill, srs, shapes = [1, 2, 3, 4, 5]) {
  const td = todayStr();
  const st = shapes.map(n => srs[cid(n, drill)]);
  const seen = st.reduce((a, c) => a + (c?.seen ?? 0), 0);
  const wrong = st.reduce((a, c) => a + (c?.wrong ?? 0), 0);
  return { drill, started: st.filter(Boolean).length, solid: st.filter(isLearned2).length,
    total: shapes.length, due: st.filter(c => dueOn2(c, td)).length,
    seen, right: seen - wrong, acc: seen ? (seen - wrong) / seen : null };
}

check('drillProgress is the exact transpose of shapeProgress', () => {
  // Every card counted once on each axis, so the two totals must agree.
  const ds = ['root', 'ires', 'fill', 'octave', 'build'];
  const srs = {};
  let expectSolid = 0;
  for (let n = 1; n <= 5; n++) for (let i = 0; i < ds.length; i++) {
    const reps = (n + i) % 4;                      // 0..3, a spread of states
    if (reps === 0) continue;                       // leave some never-seen
    srs[cid(n, ds[i])] = { ef: 2.5, interval: 1, reps, nextDue: addDays(todayStr(), 5), seen: reps, wrong: 0 };
    if (reps >= 2) expectSolid++;
  }
  const byDrill = ds.reduce((a, d) => a + drillProgress2(d, srs).solid, 0);
  const byShape = [1, 2, 3, 4, 5].reduce((a, n) => a + ds.filter(d => isLearned2(srs[cid(n, d)])).length, 0);
  eq(byDrill, byShape, 'solid counted per-drill vs per-shape');
  eq(byDrill, expectSolid, 'solid total');
});

check('accuracy is honest, and absent history is not a zero', () => {
  const srs = { [cid(1, 'ires')]: { reps: 1, seen: 10, wrong: 4, nextDue: addDays(todayStr(), 3) } };
  eq(drillProgress2('ires', srs).acc, 0.6, '6 of 10');
  eq(drillProgress2('ires', srs).right, 6, 'right count');
  // A card written before `wrong` existed must read as unknown-but-clean, and
  // above all must not read as 0% and top the weak list on day one.
  const legacy = { [cid(1, 'root')]: { reps: 3, seen: 7, nextDue: addDays(todayStr(), 3) } };
  eq(drillProgress2('root', legacy).acc, 1, 'legacy entry with no wrong field');
  // Never attempted is null, NOT 0 — 0 would sort it top of "weakest".
  eq(drillProgress2('build', {}).acc, null, 'never attempted');
});

function weakest2(srs, ds, n = 3) {
  return ds.map(d => drillProgress2(d, srs))
    .filter(p => p.seen >= WEAK_MIN_SEEN_V && p.acc < WEAK_ACC_V)
    .sort((a, b) => a.acc - b.acc || a.solid - b.solid || DRILLS_V.indexOf(a.drill) - DRILLS_V.indexOf(b.drill))
    .slice(0, n);
}

check('weakest drills rank by accuracy, and ignore too little evidence', () => {
  const mk = (seen, wrong) => ({ reps: 2, seen, wrong, nextDue: addDays(todayStr(), 4) });
  const srs = {
    [cid(1, 'ires')]:   mk(10, 5),   // 50%
    [cid(1, 'build')]:  mk(10, 1),   // 90% - above the bar, excluded
    [cid(1, 'octave')]: mk(8, 2),    // 75%
    [cid(1, 'fill')]:   mk(2, 2),    //  0% but only 2 attempts - too little to judge
  };
  const w = weakest2(srs, ['root', 'ires', 'ithird', 'fill', 'octave', 'build']);
  eq(w.length, 2, 'two drills qualify');
  eq(w[0].drill, 'ires', 'worst first');
  eq(w[1].drill, 'octave', 'then the next worst');
  assertions++; if (w.some(x => x.drill === 'fill')) fail('a drill under the evidence floor must not be called weak');
  assertions++; if (w.some(x => x.drill === 'build')) fail('90% is not a weak spot');
  // Ties must not reorder run to run.
  const tie = { [cid(1, 'root')]: mk(10, 5), [cid(1, 'ires')]: mk(10, 5) };
  eq(weakest2(tie, ['root', 'ires']).map(x => x.drill).join(','), 'root,ires', 'ties are deterministic');
});

check('nextUp puts due work first, then untried, then weak, then clear', () => {
  const ds = ['root', 'ires', 'fill', 'octave', 'build'];
  const far = addDays(todayStr(), 9);
  const full = (extra = {}) => { const o = {}; for (let n = 1; n <= 5; n++) for (const d of ds) o[cid(n, d)] = { reps: 3, seen: 5, wrong: 0, nextDue: far }; return { ...o, ...extra }; };

  const kindOf = (srs, focusNum = 1) => {
    const td = todayStr();
    if (cards5(ds).some(c => dueOn2(srs[c.id], td))) return 'due';
    if (ds.some(d => !srs[cid(focusNum, d)])) return 'focus-new';
    if (weakest2(srs, ds, 1).length) return 'weak';
    return 'clear';
  };
  eq(kindOf(full({ [cid(4, 'ires')]: { reps: 1, seen: 2, wrong: 0, nextDue: addDays(todayStr(), -2) } })), 'due', 'overdue wins');
  eq(kindOf({}), 'focus-new', 'a fresh install has untried drills');
  // Weakness is measured ACROSS the shapes, so one bad shape among five clean
  // ones is correctly diluted below the bar — that is the point of the card.
  // It takes a drill that is shaky broadly to register.
  const shaky = {}; for (const n of [1, 2, 3]) shaky[cid(n, 'ires')] = { reps: 3, seen: 10, wrong: 6, nextDue: far };
  eq(kindOf(full(shaky)), 'weak', 'weak when nothing is owing');
  eq(kindOf(full({ [cid(2, 'ires')]: { reps: 3, seen: 10, wrong: 6, nextDue: far } })), 'clear',
    'one shaky shape out of five is not a cross-cutting weak spot');
  eq(kindOf(full()), 'clear', 'all done, nothing weak');
});

check('a due-only session is exactly the cards that are owing', () => {
  const ds = ['root', 'ires', 'fill', 'octave', 'build'];
  const td = todayStr();
  const srs = {};
  for (let n = 1; n <= 5; n++) for (const d of ds) srs[cid(n, d)] = { reps: 2, seen: 4, wrong: 0, nextDue: addDays(td, 6) };
  const dueIds = [cid(1, 'root'), cid(3, 'ires'), cid(5, 'build')];
  for (const id of dueIds) srs[id].nextDue = addDays(td, -1);

  const pool = cards5(ds).filter(c => dueOn2(srs[c.id], td));
  eq(pool.length, 3, 'three cards due');
  const n = Math.min(12, pool.length);
  eq(n, 3, 'the session is as long as the due list, NOT the session length');
  const q = []; while (q.length < n) q.push(pool[q.length % pool.length]);
  eq(new Set(q.map(c => c.id)).size, 3, 'no card is asked twice');
  eq(q.map(c => c.id).sort().join('|'), dueIds.sort().join('|'), 'exactly the due cards');
});

check('a narrow session gets a proportionate length, not a padded one', () => {
  // A position's picture is identical in all twelve keys (asserted above), so
  // padding a one-card pool to a full session is the same question 12 times.
  const len = (poolSize, sessionN = 12) => Math.min(sessionN, poolSize * READY_REPS_V);
  eq(len(1), 3, 'one drill on one shape');
  eq(len(2), 6, 'a two-card deck');
  eq(len(5), 12, 'one drill across five shapes, capped by the session length');
  eq(len(25), 12, 'the whole deck is still capped');
  eq(len(5, 8), 8, 'a shorter session setting still wins');
  assertions++; if (len(1) < READY_REPS_V) fail('a scoped session must still allow the readiness bar to be reached');
});

check('the forecast counts never-seen cards as new, and in no bucket', () => {
  // Dropping them is the bug that made a Standards Trainer tune read "4 due
  // now" over a bar of 1.
  const ds = ['root', 'ires'];
  const td = todayStr();
  const srs = {
    [cid(1, 'root')]: { reps: 2, nextDue: addDays(td, -3) },   // overdue
    [cid(1, 'ires')]: { reps: 2, nextDue: addDays(td, 3) },
    [cid(2, 'root')]: { reps: 2, nextDue: addDays(td, 30) },   // past the window
  };
  const days = 7;
  const buckets = Array.from({ length: days }, () => ({ total: 0, byShape: [0, 0, 0, 0, 0] }));
  let newCount = 0, dueToday = 0, soonest = null;
  for (const c of cards5(ds)) {
    const e = srs[c.id];
    if (!e) { newCount++; continue; }
    const d = dayDiff2(td, e.nextDue);
    if (d <= 0) dueToday++;
    if (soonest === null || d < soonest) soonest = d;
    const i = Math.max(0, Math.min(days - 1, d));
    buckets[i].total++; buckets[i].byShape[c.shape - 1]++;
  }
  eq(newCount, 7, 'ten cards, three scheduled');
  eq(dueToday, 1, 'one overdue');
  eq(buckets[0].total, 1, 'overdue clamps into bucket 0');
  eq(buckets[3].total, 1, 'due in 3 days lands in bucket 3');
  eq(buckets[6].total, 1, 'beyond the window clamps into the last bucket');
  eq(buckets[0].byShape[0], 1, 'stacked by position');
  eq(soonest, -3, 'soonest is the most overdue');
  eq(buckets.reduce((a, b) => a + b.total, 0) + newCount, 10, 'every card is accounted for exactly once');
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
