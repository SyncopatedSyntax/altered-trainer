import { useState, useEffect, useMemo, useRef, useCallback } from "react";
import { AppHeader, TabBar, ProgressBackup } from "@fretworks/design";

// ════════════════════════════════════════════════════════════════════════
//  AlteredTrainer — learn the altered scale (7th mode of melodic minor)
//  for jazz V7alt chords: shapes + where the lines resolve.
//  Part of the Jazz Guitar Toolbox. Single-file React PWA.
// ════════════════════════════════════════════════════════════════════════

// ── Degree colours (shared toolbox palette) ─────────────────────────────
const DC = {
  'R':'#ff4757','3':'#ffd93d','b3':'#ff9f43','7':'#ff6b6b','b7':'#fdcb6e',
  '9':'#2ed573','13':'#00b894','6':'#1e9e77','#11':'#0fbcf9','5':'#778ca3',
  'b9':'#7c5cbf','#9':'#6c5ce7','b13':'#9b2335','b5':'#fd79a8','#5':'#a29bfe',
  '4':'#74b9ff','2':'#b2d9ff','11':'#81ecec','Δ7':'#ff6b6b','1':'#ff4757',
};
const NOTE_NAMES = ['C','C#','D','Eb','E','F','F#','G','Ab','A','Bb','B'];
const OPEN_MIDI = [40,45,50,55,59,64];      // str0 lowE .. str5 high e
const STR_LABELS = ['E','A','D','G','B','e'];
const pc = n => ((n % 12) + 12) % 12;
const midiToHz = m => 440 * Math.pow(2, (m - 69) / 12);

// Altered scale: intervals from the dominant (altered) root.
const ALT = [0,1,3,4,6,8,10];
const ALT_LABEL = {0:'R',1:'b9',3:'#9',4:'3',6:'#11',8:'b13',10:'b7'};
const ALT_ORDER = ['R','b9','#9','3','#11','b13','b7'];
// Melodic-minor degree -> altered degree (altered root sits on mel-min's 7th).
const MM2ALT = {'1':'b9','2':'#9','b3':'3','4':'#11','5':'b13','6':'b7','7':'R'};

// ── 5 positions — transcribed & verified from the reference melodic-minor
// chart (C melodic minor). str0=lowE..5=high e; [fret, melMinDegree].
// Every dot verified against C-melodic-minor pitch classes. ───────────────
const CAGED_MM = [
  {0:[[3,'5'],[5,'6']],1:[[2,'7'],[3,'1'],[5,'2'],[6,'b3']],2:[[3,'4'],[5,'5']],3:[[2,'6'],[4,'7'],[5,'1']],4:[[3,'2'],[4,'b3'],[6,'4']],5:[[3,'5'],[5,'6']]},
  {0:[[5,'6'],[7,'7'],[8,'1']],1:[[5,'2'],[6,'b3'],[8,'4']],2:[[5,'5'],[7,'6']],3:[[4,'7'],[5,'1'],[7,'2'],[8,'b3']],4:[[6,'4'],[8,'5']],5:[[5,'6'],[7,'7'],[8,'1']]},
  {0:[[7,'7'],[8,'1'],[10,'2'],[11,'b3']],1:[[8,'4'],[10,'5']],2:[[7,'6'],[9,'7'],[10,'1']],3:[[7,'2'],[8,'b3'],[10,'4']],4:[[8,'5'],[10,'6']],5:[[7,'7'],[8,'1'],[10,'2'],[11,'b3']]},
  {0:[[10,'2'],[11,'b3'],[13,'4']],1:[[10,'5'],[12,'6']],2:[[9,'7'],[10,'1'],[12,'2'],[13,'b3']],3:[[10,'4'],[12,'5']],4:[[10,'6'],[12,'7'],[13,'1']],5:[[10,'2'],[11,'b3'],[13,'4']]},
  {0:[[13,'4'],[15,'5']],1:[[12,'6'],[14,'7'],[15,'1']],2:[[12,'2'],[13,'b3'],[15,'4']],3:[[12,'5'],[14,'6']],4:[[12,'7'],[13,'1'],[15,'2'],[16,'b3']],5:[[13,'4'],[15,'5']]},
];

// ── Music engine ─────────────────────────────────────────────────────────
const altDegOf = (midi, root) => ALT_LABEL[(pc(midi) - root + 12) % 12];

// transpose one melodic-minor pattern to the parent key & relabel to altered
function transposeCaged(pat, parentPc) {
  let cells = [];
  for (let s = 0; s < 6; s++) (pat[s]||[]).forEach(([f,mm]) => cells.push({s, f: f + parentPc, deg: MM2ALT[mm]}));
  let mn = Math.min(...cells.map(c => c.f));
  while (mn >= 12) { cells.forEach(c => c.f -= 12); mn -= 12; }
  while (mn < 0)   { cells.forEach(c => c.f += 12); mn += 12; }
  return cells;
}
// ── Stable shape identity ────────────────────────────────────────────────
// The CAGED_MM index IS the shape's identity: transposing only shifts frets,
// never degrees, so pattern 2 is the same grip in every key.
//
// It did not used to be labelled that way. The old code sorted the five shapes
// by lowest fret and only THEN named them `Position ${i+1}` — but the sort is a
// cyclic rotation that depends on the parent key, so "Position 3" meant a
// different shape in C than in G, and changing key silently swapped the shape
// under a label that had not changed. That is fatal for anything that tracks
// what you know, and it is the likeliest reason a shape felt impossible to
// settle on.
//
// So the number now comes from the pattern and travels with it. The list is
// still returned in neck order, so the arrows still walk up the neck — which
// means in a given key they may read 3, 4, 5, 1, 2. That is honest: the five
// shapes are a cycle, and which one sits lowest depends on the key.
//
// Position 1 is the shape whose lowest note on the low E is the root — the
// index-finger-on-the-root grip, and the anchor everything else refers back to.
// The five anchors then ascend through the scale: R, #9, #11, b13, b7.
// scripts/verify.mjs pins all of this.
const SHAPE_ORDER = [2, 3, 4, 0, 1];                    // position (1-based) -> CAGED_MM index
const SHAPE_NUM   = [4, 5, 1, 2, 3];                    // CAGED_MM index -> position
const SHAPE_ANCHOR = ['b13', 'b7', 'R', '#9', '#11'];   // CAGED_MM index -> its lowest low-E degree

// 5 altered positions for a given altered root, ordered low->high on the neck
function getCagedPositions(root) {
  const parentPc = (root + 1) % 12;
  const list = CAGED_MM.map((pat, idx) => {
    const cells = transposeCaged(pat, parentPc);
    const fs = cells.map(c => c.f);
    return { idx, num: SHAPE_NUM[idx], name: `Position ${SHAPE_NUM[idx]}`, start: SHAPE_ANCHOR[idx],
             cells, lo: Math.min(...fs), hi: Math.max(...fs) };
  });
  return list.sort((a,b) => a.lo - b.lo);   // sorting reorders, it no longer renames
}
const getCagedShape = (root, num) => getCagedPositions(root).find(p => p.num === num) || null;
const neckIndexOfNum = (positions, num) => Math.max(0, positions.findIndex(p => p.num === num));
// 7 three-notes-per-string patterns for a given altered root
function getTnpsPositions(root) {
  const scale = new Set(ALT.map(i => pc(root + i)));
  const allM = [];
  for (let m = OPEN_MIDI[0] + 1; m <= OPEN_MIDI[5] + 18; m++) if (scale.has(pc(m))) allM.push(m);
  const starts = [];
  for (let f = 1; f <= 12; f++) if (scale.has(pc(OPEN_MIDI[0] + f))) starts.push(f);
  return starts.map((f0, i) => {
    const seq = allM.filter(m => m >= OPEN_MIDI[0] + f0).slice(0, 18);
    const cells = [];
    for (let s = 0; s < 6; s++) seq.slice(s*3, s*3+3).forEach(m => cells.push({s, f: m - OPEN_MIDI[s], deg: altDegOf(m, root)}));
    const fs = cells.map(c => c.f);
    return { cells, lo: Math.min(...fs), hi: Math.max(...fs), name: `Pattern ${i+1}`, start: altDegOf(OPEN_MIDI[0] + f0, root) };
  });
}
// full-neck cells
function getFullNeck(root, loF=0, hiF=15) {
  const scale = new Set(ALT.map(i => pc(root + i)));
  const cells = [];
  for (let s = 0; s < 6; s++) for (let f = loF; f <= hiF; f++) if (scale.has(pc(OPEN_MIDI[s] + f))) cells.push({s, f, deg: altDegOf(OPEN_MIDI[s] + f, root)});
  return cells;
}

// signed shortest semitone distance a->b
const sdist = (a, b) => { let d = ((b - a) % 12 + 12) % 12; if (d > 6) d -= 12; return d; };

// resolution analysis: each altered tone -> target chord-tone half-step pulls
const MAJ_TONES = {0:'R',4:'3',7:'5',11:'Δ7',2:'9',9:'13'};
const MIN_TONES = {0:'R',3:'b3',7:'5',10:'b7',11:'Δ7',2:'9'};
function getResolutions(root, kind) {  // kind: 'maj' | 'min' | 'sub'
  const targetRoot = (root + 5) % 12;
  const tones = kind === 'min' ? MIN_TONES : MAJ_TONES;  // sub resolves to I major
  return ALT.map(iv => {
    const np = pc(root + iv), cands = [];
    for (const ti in tones) {
      const tp = pc(targetRoot + (+ti)), d = sdist(np, tp);
      if (Math.abs(d) <= 1) cands.push({ tp, deg: tones[ti], d });
    }
    cands.sort((a,b) => Math.abs(a.d) - Math.abs(b.d));
    return { iv, altDeg: ALT_LABEL[iv], notePc: np, cands, guide: iv === 4 || iv === 10 };
  });
}
// target chord tones of the I (for the resolution overlay): pc -> I-degree label
function getTargetTones(root, kind) {   // kind: 'maj' | 'min'
  const tr = (root + 5) % 12;
  const tones = kind === 'min' ? MIN_TONES : MAJ_TONES;
  const map = {};
  for (const ti in tones) map[pc(tr + (+ti))] = tones[ti];
  return { targetRoot: tr, tones: map };
}

// ── Practice: shapes, drills, spaced repetition ──────────────────────────
// SM-2 copied verbatim from triads-trainer/src/TriadTrainer.jsx:32-46, which is
// byte-identical to Diatonic's. Do not re-derive it; a fix in one should be
// carried to all three.
const todayStr = () => new Date().toISOString().slice(0,10);
const addDays = (s,n) => { const d = new Date(s+'T00:00:00'); d.setDate(d.getDate()+n); return d.toISOString().slice(0,10); };
const dayDiff = (a,b) => Math.round((new Date(b+'T00:00:00') - new Date(a+'T00:00:00'))/86400000);
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
const isLearned = c => !!c && c.reps >= 2;
const ri = n => Math.floor(Math.random()*n);
const shuffle = a => { const b=[...a]; for (let i=b.length-1;i>0;i--){const j=ri(i+1);[b[i],b[j]]=[b[j],b[i]];} return b; };
const popcount = n => { let c=0; while(n){ n &= n-1; c++; } return c; };

// The three drills. All of them are about the one thing this app is for: an
// altered shape is a launch pad into the I chord.
//
// `ires` and `ithird` are answered on frets with NO dot - both targets are
// outside the altered scale - so they cannot be read off a label.
//
// `ithird` is MAJOR-ONLY and must not follow settings.defKind. Over a minor I
// the third is root+8, which IS in the scale (it is the b13); it would sit
// under an existing dot and destroy the premise. verify.mjs pins this.
const DRILLS = ['root','ires','ithird'];
const DRILL_META = {
  root:   { label:'The root',    short:'Root',     ask:'Tap the root of the altered scale.' },
  ires:   { label:'Resolves to', short:'Resolves', ask:'Tap the root of the key it resolves to.' },
  ithird: { label:'Lands on',    short:'Lands on', ask:'The b7 falls a half step. Tap where it lands.' },
};
const cardId = (num, drill) => `${num}|${drill}`;
const buildCards = drills => { const out=[]; for (let num=1;num<=5;num++) for (const d of drills) out.push({ id:cardId(num,d), shape:num, drill:d }); return out; };

const ckey = (st,f) => st+'_'+f;
// Every acceptable answer, plus (for the root drill) the near misses that are
// the right note in the wrong place. Any matching cell counts - "identify the
// root" means point at one, and there are always several.
function answerSet(drill, shape, root, win) {
  const ok = new Set(), near = new Set();
  if (drill === 'root') {
    shape.cells.filter(c => c.deg==='R').forEach(c => ok.add(ckey(c.s,c.f)));
    for (let st=0;st<6;st++) for (let f=win.lo;f<=win.hi;f++)
      if (pc(OPEN_MIDI[st]+f)===root && !ok.has(ckey(st,f))) near.add(ckey(st,f));
    return { ok, near };
  }
  const tp = pc(root + (drill==='ires' ? 5 : 9));
  for (let st=0;st<6;st++) for (let f=win.lo;f<=win.hi;f++) if (pc(OPEN_MIDI[st]+f)===tp) ok.add(ckey(st,f));
  return { ok, near };
}
const winOf = sh => ({ lo: Math.max(0, sh.lo-1), hi: sh.hi+1 });

// Where one shape stands. Two different bars on purpose: `mastered` uses the
// toolbox's isLearned so the chip means what it means in every sibling app,
// while promotion is stricter. With a random key every rep, reps>=2 can be
// earned twice in one sitting in two keys - which is not knowing a shape. The
// 12-bit keysSeen mask is what makes "across N keys" measurable.
const READY_REPS = 3, READY_KEYS = 6;
function shapeProgress(num, srs, drills) {
  const st = drills.map(d => srs[cardId(num,d)]);
  const td = todayStr();
  const mastered = st.filter(isLearned).length;
  const nw = st.filter(c => !c).length;
  const due = st.filter(c => c && dayDiff(td, c.nextDue) <= 0).length;
  const keys = st.reduce((m,c) => m & (c?.keysSeen ?? 0), 0xFFF);
  const keyCount = popcount(keys);
  const ready = st.every(c => (c?.reps ?? 0) >= READY_REPS) && keyCount >= READY_KEYS;
  return { mastered, total: drills.length, nw, due, keyCount, ready };
}

// Three tiers, not two. A focus deck is 2-3 cards; with due-then-new only, a
// session would end after three taps. The modulo cycle keeps it going so the
// same shape comes round several times in DIFFERENT keys, which is the whole
// point of drilling one shape.
function buildQueue(cards, srs, count, pickKey) {
  const td = todayStr();
  const due  = shuffle(cards.filter(c =>  srs[c.id] && dayDiff(td, srs[c.id].nextDue) <= 0));
  const nw   = shuffle(cards.filter(c => !srs[c.id]));
  const rest = shuffle(cards.filter(c =>  srs[c.id] && dayDiff(td, srs[c.id].nextDue) >  0));
  const pool = [...due, ...nw, ...rest];
  if (!pool.length) return [];
  const q = [];
  while (q.length < count) q.push(pool[q.length % pool.length]);
  return q.map(c => ({ ...c, root: pickKey() }));
}

// ── Audio (Web Audio pluck) ──────────────────────────────────────────────
let _ctx = null, _unlocked = false;
// ── iOS silent-switch bypass (toolbox standard, see root CLAUDE.md → Audio) ──
// Layer 1 (iOS 16.4+): declare real media playback — Web Audio then ignores
// the hardware ringer switch, same as the Music app. Feature-detected.
try { if (navigator.audioSession) navigator.audioSession.type = 'playback'; } catch (e) {}
// Layer 2 (older iOS): the "playback" promotion from a real <audio> element
// only holds while it is PLAYING, so keep a silent element looping for the
// life of the page (a fire-once silent MP3 does not stick — don't regress).
const SILENT_MP3 = 'data:audio/mpeg;base64,SUQzBAAAAAAAI1RTU0UAAAAPAAADTGF2ZjU4LjI5LjEwMAAAAAAAAAAAAAAA/+M4wAAAAAAAAAAAAFhpbmcAAAAPAAAAAwAAA7AAqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq1tbW1tbW1tbW1tbW1tbW1tbW1tbW1tbW1tb////////////////////////////////////////////////////////////////AAAA8ExBTUUzLjk5LjVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVU=';
let _silentLoop = null;
function startSilentLoop() {
  if (navigator.audioSession || !/iphone|ipad|ipod/i.test(navigator.userAgent)) return;
  try {
    if (!_silentLoop) { _silentLoop = new Audio(SILENT_MP3); _silentLoop.loop = true; }
    if (_silentLoop.paused) { // must run inside a user gesture — callers are tap handlers
      const p = _silentLoop.play(); if (p && p.catch) p.catch(() => { _silentLoop = null; });
    }
  } catch (e) { _silentLoop = null; }
}
function getCtx() { if (!_ctx) _ctx = new (window.AudioContext || window.webkitAudioContext)(); if (_ctx.state === 'suspended') _ctx.resume(); return _ctx; }
function unlockAudio() {
  startSilentLoop(); // re-checked every play: iOS pauses media on backgrounding
  if (_unlocked) return;
  const ctx = getCtx();
  const buf = ctx.createBuffer(1,1,22050), src = ctx.createBufferSource();
  src.buffer = buf; src.connect(ctx.destination); src.start(0);
  ctx.resume().then(() => { _unlocked = true; });
}
// Shared bus + gentle limiter so rapid overlapping notes don't stack/swell.
let _bus = null;
function getBus(ctx) {
  if (!_bus || _bus.context !== ctx) {
    const g = ctx.createGain(); g.gain.value = 1;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -10; comp.knee.value = 20; comp.ratio.value = 4;
    comp.attack.value = 0.003; comp.release.value = 0.25;
    g.connect(comp); comp.connect(ctx.destination);
    _bus = g;
  }
  return _bus;
}
// Idle-suspend: release the audio session when quiet so iOS drops "now playing";
// getCtx() resumes on the next play. (Toolbox audio standard — root CLAUDE.md.)
let _idleTimer = null, _idleEnd = 0;
function bumpIdle(ctx, end) {
  _idleEnd = Math.max(_idleEnd, end);
  if (_idleTimer) clearTimeout(_idleTimer);
  _idleTimer = setTimeout(() => {
    _idleTimer = null;
    if (ctx.currentTime < _idleEnd - 0.05) return;
    if (ctx.state === 'running') ctx.suspend().catch(() => {});
  }, Math.max(0, (_idleEnd - ctx.currentTime) * 1000) + 400);
}
function pluck(ctx, freq, when, vol=0.16) {
  [[1,1.0],[2,0.45],[3,0.22],[4,0.09],[6,0.04]].forEach(([h,a]) => {
    const osc = ctx.createOscillator(), g = ctx.createGain(), filt = ctx.createBiquadFilter();
    osc.type='sine'; osc.frequency.value=freq*h; filt.type='lowpass'; filt.frequency.value=Math.min(3200,freq*h*3);
    g.gain.setValueAtTime(0,when); g.gain.linearRampToValueAtTime(vol*a,when+0.005); g.gain.exponentialRampToValueAtTime(0.0001,when+(h===1?1.6:0.9));
    osc.connect(filt); filt.connect(g); g.connect(getBus(ctx)); osc.start(when); osc.stop(when+2);
  });
}
function playMidis(midis, gap=0.12) {
  unlockAudio();
  const ctx = getCtx(), now = ctx.currentTime + 0.05;
  midis.forEach((m, i) => pluck(ctx, midiToHz(m), now + i * gap));
  bumpIdle(ctx, now + (midis.length - 1) * gap + 2);
}

// ── Persistent storage (guarded; falls back to sandbox) ──────────────────
// Sync JSON accessor for the structured progress data. It sits alongside the
// async string `store` below rather than replacing it — the older raw-string
// prefs still load through that one, and grading happens inside a tap handler
// where an async write would race the queue advancing.
const jstore = {
  get(k, dflt) { try { const v = localStorage.getItem(k); return v === null ? dflt : JSON.parse(v); } catch (e) { return dflt; } },
  set(k, v) {
    const s = JSON.stringify(v);
    try { localStorage.setItem(k, s); } catch (e) {}
    try { if (typeof window.storage !== 'undefined') window.storage.set(k, s); } catch (e) {}
  },
  del(k) { try { localStorage.removeItem(k); } catch (e) {} },
};

// ProgressBackup JSON-parses on export and always JSON-stringifies on import,
// so a value stored as a bare string comes back wrapped in quotes. Accept raw,
// JSON, and double-encoded forms on the way in; everything is written as JSON
// from here on.
const unq = v => { let out = String(v); try { const p = JSON.parse(out); if (typeof p === 'string' || typeof p === 'number') out = String(p); } catch (e) {} return out; };

const store = {
  async get(k) { try { const v = localStorage.getItem(k); if (v !== null) return { value: v }; } catch (e) {} try { if (typeof window.storage !== 'undefined') { const r = await window.storage.get(k); if (r) return r; } } catch (e) {} return null; },
  async set(k, v) { try { localStorage.setItem(k, v); } catch (e) {} try { if (typeof window.storage !== 'undefined') await window.storage.set(k, v); } catch (e) {} },
};

const txtOn = hex => { const r=parseInt(hex.slice(1,3),16),g=parseInt(hex.slice(3,5),16),b=parseInt(hex.slice(5,7),16); return (0.299*r+0.587*g+0.114*b) > 150 ? '#111' : '#fff'; };

// ════════════════════════════════════════════════════════════════════════
//  COMPONENTS
// ════════════════════════════════════════════════════════════════════════

// Horizontal fretboard: high e on top, low E bottom, frets L->R.
// resolve (optional): { tones: {pc: I-degree} } overlays target chord tones
// as teal squares (clearly NOT part of the altered scale).
const TGT_COLOR = '#2dd4bf';
// visual hierarchy for resolution targets: 3rd most prominent, root prominent, rest muted
function targetStyle(deg, thirdDeg) {
  if (deg === thirdDeg) return { stroke:'#ef4444', text:'#ef4444', sw:2.8, solid:false, big:true  }; // 3rd: red outline, largest
  if (deg === 'R')      return { stroke:'#2dd4bf', text:'#2dd4bf', sw:2.4, solid:false, big:false }; // root: bright teal outline
  return { stroke:'#3f7d74', text:'#6fb6ab', sw:1.4, solid:false, big:false };                       // others: muted teal
}
// Drill props (all optional, all no-ops when omitted, so the Positions view is
// byte-identical without them):
//   mono         every dot one flat grey, no root ring, no label — the answer
//                cannot be read off the diagram. DC['R'] is bright red, so the
//                root drill is meaningless without this.
//   hideLabels   keep the degree colours but drop the text (a gentler step).
//   highlight    Set of "s_f"; members pulse, everything else dims. Ported from
//                MelodicMinorTrainer. Exact cell match, not by degree, so a
//                duplicate of the same note elsewhere stays quiet.
//   onTapCell    (s,f) => void. See the grid at the bottom of the svg.
//   marks        [{s,f,kind:'ok'|'bad'|'reveal'}] answer feedback.
//   win          {lo,hi} overriding the window derived from the cells. Load
//                bearing: the answer set and the drawn board MUST share one
//                window or an accepted answer can land off-screen.
//   rowH / fill  taller rows and a width-driven layout, for 44px tap targets.
function Fretboard({ cells, root, labelMode, resolve, sc=1,
                     mono, hideLabels, highlight, onTapCell, marks, win, rowH=27, fill }) {
  if (!cells.length) return null;
  const fs = cells.map(c => c.f);
  let lo = win ? win.lo : Math.max(0, Math.min(...fs) - 1), hi = win ? win.hi : Math.max(...fs) + 1;
  const FW=36, RH=rowH, padL=22, padT=14, padB=20, padR=10, nf=hi-lo+1;
  const hl = highlight || null;
  const reduced = typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  const MARK_COLOR = { ok:'#2ed573', bad:'#ef4444', reveal:'#2dd4bf' };
  const W = padL + nf*FW + padR, H = padT + 6*RH + padB;
  const fx = f => padL + (f - lo + 0.5)*FW, fxl = f => padL + (f - lo)*FW, ry = r => padT + r*RH;
  const dotMidi = c => OPEN_MIDI[c.s] + c.f;
  const lbl = c => labelMode === 'notes' ? NOTE_NAMES[pc(dotMidi(c))] : c.deg;
  const isRoot = c => c.deg === 'R';
  const cellSet = new Set(cells.map(c => c.s + ',' + c.f));
  // target chord-tone markers across the visible window
  const tmarks = [];
  if (resolve) {
    for (let s = 0; s < 6; s++) for (let f = lo; f <= hi; f++) {
      const deg = resolve.tones[pc(OPEN_MIDI[s] + f)];
      if (deg === undefined) continue;
      tmarks.push({ s, f, deg, shared: cellSet.has(s + ',' + f) });
    }
  }
  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={fill
      ? { display:'block', margin:'0 auto', width:'100%', height:'auto', userSelect:'none', WebkitUserSelect:'none', touchAction:'manipulation' }
      : { display:'block', margin:'0 auto', width:'auto', maxWidth:'100%', height:280, userSelect:'none', WebkitUserSelect:'none' }}>
      {Array.from({length:6},(_,r)=><line key={'s'+r} x1={padL} y1={ry(r)} x2={padL+nf*FW} y2={ry(r)} stroke="#2a2840" strokeWidth={1.4}/>)}
      {Array.from({length:nf+1},(_,j)=>{const f=lo+j;const nut=f===0;return <line key={'f'+j} x1={fxl(f)} y1={ry(0)} x2={fxl(f)} y2={ry(5)} stroke={nut?'#cccccc':'#2a2840'} strokeWidth={nut?3:1.4}/>;})}
      {[3,5,7,9,12,15].filter(f=>f>=lo&&f<=hi).map(f=><circle key={'m'+f} cx={fx(f)} cy={ry(2)+RH/2} r={2.6} fill="#2a2840"/>)}
      {STR_LABELS.map((s,r)=><text key={'l'+r} x={6} y={ry(5-r)+3.5} fontSize={10} fill="#777" fontFamily="monospace">{s}</text>)}
      {Array.from({length:nf},(_,j)=>{const f=lo+j;if(f===0)return null;const mark=[3,5,7,9,15,17,19,21].includes(f);return <g key={'n'+j}><text x={fx(f)} y={H-9} fontSize={9} fill={mark||f===12?'#888':'#555'} textAnchor="middle" fontFamily="monospace">{f}</text>{mark&&<circle cx={fx(f)} cy={H-3} r={1.8} fill="#555"/>}{f===12&&<><circle cx={fx(f)-3} cy={H-3} r={1.8} fill="#555"/><circle cx={fx(f)+3} cy={H-3} r={1.8} fill="#555"/></>}</g>;})}
      {/* target chord tones — 3rd most prominent, root prominent, others muted */}
      {tmarks.map((t,i)=>{
        const cx=fx(t.f),cy=ry(5-t.s),L=labelMode==='notes'?NOTE_NAMES[pc(OPEN_MIDI[t.s]+t.f)]:t.deg;
        const st=targetStyle(t.deg, resolve.thirdDeg), hw=t.shared?13.5:11;
        return (
        <g key={'t'+i}>
          <rect x={cx-hw} y={cy-hw} width={hw*2} height={hw*2} rx={4}
            fill={t.shared?'none':(st.solid?st.stroke:'#0f0e17')} stroke={st.stroke} strokeWidth={st.sw}/>
          {!t.shared && <text x={cx} y={cy+0.5} fontSize={L.length>2?7:9.5} fill={st.solid?st.text:st.stroke} textAnchor="middle" dominantBaseline="central" fontWeight="bold">{L}</text>}
        </g>);})}
      {/* altered-scale dots on top */}
      {cells.map((c,i)=>{
        const col = mono ? '#4a4a6a' : (DC[c.deg]||'#888');
        const cx=fx(c.f), cy=ry(5-c.s), L=lbl(c);
        const lit = !hl || hl.has(c.s+'_'+c.f), dim = hl && !lit;
        return (
        <g key={i} opacity={dim?0.28:1}>
          <circle cx={cx} cy={cy} r={11} fill={col} stroke={(!mono&&isRoot(c))?'#fff':'none'} strokeWidth={(!mono&&isRoot(c))?2:0}>
            {hl && lit && !reduced && <animate attributeName="r" values="11;13.5;11" dur="1.1s" repeatCount="indefinite"/>}
          </circle>
          {!mono && !hideLabels && <text x={cx} y={cy+0.5} fontSize={L.length>2?7:9} fill={txtOn(col)} textAnchor="middle" dominantBaseline="central" fontWeight="bold">{L}</text>}
        </g>);})}

      {/* Answer feedback, painted over the dots but under the tap grid. */}
      {(marks||[]).map((m,i)=>{const cx=fx(m.f), cy=ry(5-m.s), col=MARK_COLOR[m.kind]||'#fff';
        if (m.kind==='bad') return (
          <g key={'m'+i} pointerEvents="none" stroke={col} strokeWidth={3} strokeLinecap="round">
            <line x1={cx-8} y1={cy-8} x2={cx+8} y2={cy+8}/><line x1={cx+8} y1={cy-8} x2={cx-8} y2={cy+8}/>
          </g>);
        return <circle key={'m'+i} pointerEvents="none" cx={cx} cy={cy} r={15} fill="none" stroke={col}
          strokeWidth={m.kind==='ok'?3:2.2} strokeDasharray={m.kind==='reveal'?'4 3':undefined}/>;})}

      {/* Tap grid — last child on purpose. SVG has no z-index, so paint order
          decides hit testing, and a transparent fill still receives events.
          It must cover the whole window rather than just the dots: two of the
          three drills are answered on a fret with no dot on it. */}
      {onTapCell && (
        <g>
          {Array.from({length:6}).flatMap((_,st)=>Array.from({length:nf}).map((_,j)=>{
            const f = lo+j;
            return <rect key={`t${st}_${f}`} x={fxl(f)} y={ry(5-st)-RH/2} width={FW} height={RH}
              fill="transparent" style={{ cursor:'pointer', touchAction:'manipulation' }}
              onClick={()=>onTapCell(st,f)} />;
          }))}
        </g>
      )}
    </svg>
  );
}

function Chip({ deg, note }) {
  const col = DC[deg] || '#888';
  return <span style={{ display:'inline-block', padding:'2px 8px', borderRadius:6, fontWeight:800, fontSize:11, background:col, color:txtOn(col), margin:'2px 4px 2px 0' }}>{deg}{note!=null?` · ${note}`:''}</span>;
}

function PlayBtn({ onClick, label='▶ Play', small }) {
  const [hot, setHot] = useState(false);
  return <button onClick={()=>{setHot(true);onClick();setTimeout(()=>setHot(false),500);}}
    style={{ background:hot?'#ffd93d15':'transparent', border:`1px solid ${hot?'#ffd93d':'#2a2840'}`, color:hot?'#ffd93d':'#aaa', borderRadius:7, padding:small?'4px 9px':'7px 13px', fontSize:small?11:12, fontWeight:700, cursor:'pointer', minHeight:small?30:38, touchAction:'manipulation' }}>{label}</button>;
}

// ── Explorer ─────────────────────────────────────────────────────────────
function ExplorerTab({ root, labelMode }) {
  const parentPc = (root + 1) % 12;
  const subPc = (root + 6) % 12;
  const spelling = ALT.map(iv => ({ deg: ALT_LABEL[iv], note: NOTE_NAMES[pc(root + iv)] }));
  const rootMidi = 48 + root;
  const playScale = () => playMidis([...ALT.map(i=>rootMidi+i), rootMidi+12], 0.2);
  const card = { background:'#13121f', border:'1px solid #1a1928', borderRadius:12, padding:'12px 13px', marginBottom:12 };
  const h = { fontSize:11, color:'#888', fontWeight:700, textTransform:'uppercase', letterSpacing:'.5px', marginBottom:6 };
  return (
    <div style={{ padding:'14px 12px' }}>
      <div style={card}>
        <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', flexWrap:'wrap', gap:8, marginBottom:8 }}>
          <div style={{ fontSize:22, fontWeight:900 }}><span style={{color:'#e17055'}}>{NOTE_NAMES[root]}7alt</span></div>
          <PlayBtn onClick={playScale} label="▶ Hear scale" />
        </div>
        <div style={{ fontSize:13, lineHeight:1.8, marginBottom:4 }}>
          {spelling.map((s,i)=><Chip key={i} deg={s.deg} note={labelMode==='notes'?s.note:undefined} />)}
        </div>
        <div style={{ fontSize:11, color:'#888' }}>Formula: R&nbsp;b9&nbsp;#9&nbsp;3&nbsp;#11&nbsp;b13&nbsp;b7 — every tension stacked over the dominant.</div>
      </div>

      <div style={card}>
        <div style={h}>🔑 The shortcut</div>
        <div style={{ fontSize:14, lineHeight:1.6 }}>
          <b style={{color:'#e17055'}}>{NOTE_NAMES[root]}7alt</b> = <b style={{color:'#74b9ff'}}>{NOTE_NAMES[parentPc]} melodic minor</b> — the melodic minor a <b>half step above</b> the chord root. If you know your melodic-minor shapes, you already know this scale; just start on the dominant root.
        </div>
      </div>

      <div style={card}>
        <div style={h}>Tritone-sub equivalence</div>
        <div style={{ fontSize:14, lineHeight:1.6 }}>
          The same seven notes are <b style={{color:'#00b894'}}>{NOTE_NAMES[subPc]}7♯11</b> (lydian dominant). So {NOTE_NAMES[root]}7alt and its tritone sub {NOTE_NAMES[subPc]}7 share one scale — handy when the chart shows either chord.
        </div>
      </div>

      <div style={card}>
        <div style={h}>When to use it</div>
        <div style={{ fontSize:13, lineHeight:1.6, color:'#ccc' }}>
          Over a <b>V7alt</b> resolving down a fifth (e.g. {NOTE_NAMES[root]}7alt → {NOTE_NAMES[(root+5)%12]}). Maximum tension — it wants to resolve. On the <b style={{color:'#e17055'}}>Positions</b> tab, turn on a resolution target to see exactly where each note lands.
        </div>
      </div>
    </div>
  );
}

// ── Positions (with per-note resolution overlay) ────────────────────────
const DEG_AVAIL = { maj:['R','3','5','Δ7','9','13'], min:['R','b3','5','b7','Δ7','9'] };
const dirLabel = d => d===0 ? 'common tone' : Math.abs(d)===1 ? (d<0?'down ½':'up ½') : (d<0?'down whole':'up whole');
function PositionsTab({ root, labelMode, settings, shapeNum, onShapeNum, focusNum, onFocus, onPractise }) {
  const init = settings || {};
  const [system, setSystem] = useState(init.defSystem || 'caged');   // 'caged' | 'tnps'
  // The CAGED shape lives in App (as a stable number); the tnps track keeps its
  // own cursor. They used to share one key, which meant nothing across systems.
  const [tnpsIdx, setTnpsIdx] = useState(0);
  const [fullNeck, setFullNeck] = useState(false);
  const [kind, setKind] = useState(init.defKind || 'maj');          // 'off' | 'maj' | 'min'
  const [sel, setSel] = useState(() => {
    const k = init.defKind || 'maj';
    const base = (init.defNotes && init.defNotes.length) ? init.defNotes : ['R','3'];
    const avail = DEG_AVAIL[k === 'off' ? 'maj' : k], ns = new Set();
    base.forEach(d => { let m = d; if (k==='min'&&d==='3') m='b3'; if (avail.includes(m)) ns.add(m); });
    if (ns.size === 0) { ns.add('R'); ns.add(k==='min'?'b3':'3'); }
    return ns;
  });
  const positions = useMemo(() => system === 'caged' ? getCagedPositions(root) : getTnpsPositions(root), [system, root]);
  const i = system === 'caged' ? neckIndexOfNum(positions, shapeNum) : Math.min(tnpsIdx, positions.length - 1);
  const cur = positions[i];
  // Arrows step through the neck; for CAGED that writes back the shape's stable
  // number, so the label follows the shape rather than the slot.
  const step = d => {
    const n = (i + d + positions.length) % positions.length;
    if (system === 'caged') onShapeNum(positions[n].num); else setTnpsIdx(n);
  };
  const cells = fullNeck ? getFullNeck(root) : cur.cells;
  const targetRoot = (root + 5) % 12;
  const targetName = kind === 'min' ? `${NOTE_NAMES[targetRoot]}m` : `${NOTE_NAMES[targetRoot]}maj7`;
  const rootMidi = 48 + root;

  // overlay only the selected target degrees
  const thirdDeg = kind === 'min' ? 'b3' : '3';
  const tgt = useMemo(() => {
    if (kind === 'off') return null;
    const full = getTargetTones(root, kind).tones, tones = {};
    for (const p in full) if (sel.has(full[p])) tones[p] = full[p];
    return { tones, thirdDeg };
  }, [root, kind, sel, thirdDeg]);

  const switchKind = (k) => {
    if (k !== 'off') setSel(prev => {
      const avail = DEG_AVAIL[k], ns = new Set();
      prev.forEach(d => { let m = d; if (k==='min'&&d==='3') m='b3'; if (k==='maj'&&d==='b3') m='3'; if (avail.includes(m)) ns.add(m); });
      if (ns.size === 0) { ns.add('R'); ns.add(k==='min'?'b3':'3'); }
      return ns;
    });
    setKind(k);
  };
  const toggleDeg = (d) => setSel(prev => { const ns = new Set(prev); ns.has(d) ? ns.delete(d) : ns.add(d); return ns; });

  // guide-tone resolutions (kind-aware)
  const thirdIv = kind === 'min' ? 3 : 4;
  const g3 = sdist(pc(root+4), targetRoot);             // 3 -> root of I
  const g7 = sdist(pc(root+10), pc(targetRoot+thirdIv)); // b7 -> 3rd of I
  const playPos = () => {
    unlockAudio();
    const ctx = getCtx(), start = ctx.currentTime + 0.05, gap = 0.17;
    const seq = cells.map(c => OPEN_MIDI[c.s] + c.f).sort((a,b)=>a-b);
    seq.forEach((m, i) => pluck(ctx, midiToHz(m), start + i * gap));
    let endT = start + (seq.length - 1) * gap + 2;
    // resolve: land on the nearest 3rd, then strum the I major7 / minor7
    if (kind !== 'off') {
      const thirdIv = kind === 'maj' ? 4 : 3;
      const chord = kind === 'maj' ? [0,4,7,11] : [0,3,7,10];
      // lowest root of the resolving chord in the current shape's register
      let chordRoot = seq[0];
      while (pc(chordRoot) !== targetRoot) chordRoot++;
      // nearest 3rd to the last (highest) note played in the run
      const last = seq[seq.length - 1], thirdPc = pc(targetRoot + thirdIv);
      let down = last; while (pc(down) !== thirdPc) down--;
      let up = last;   while (pc(up)   !== thirdPc) up++;
      const third = (last - down) <= (up - last) ? down : up;
      let t = start + seq.length * gap + 0.4;
      pluck(ctx, midiToHz(third), t);              // resolve onto the 3rd
      t += 0.55;                                    // brief pause, then the chord
      chord.forEach((iv, j) => pluck(ctx, midiToHz(chordRoot + iv), t + j * 0.05));
      endT = t + (chord.length - 1) * 0.05 + 2;
    }
    bumpIdle(ctx, endT);
  };
  const playGuides = () => {
    playMidis([rootMidi + 4, rootMidi + 4 + g3], 0.34);
    setTimeout(() => playMidis([rootMidi + 10, rootMidi + 10 + g7], 0.34), 850);
  };

  const segBtn = on => ({ flex:1, padding:'8px', background:on?'#e17055':'transparent', color:on?'#fff':'#aaa', border:`1px solid ${on?'#e17055':'#2a2840'}`, borderRadius:8, fontSize:12, fontWeight:700, cursor:'pointer', minHeight:38, touchAction:'manipulation' });
  const kindBtn = on => ({ flex:1, padding:'7px 4px', background:on?'#2dd4bf':'transparent', color:on?'#06281f':'#9fe', border:`1px solid ${on?'#2dd4bf':'#2dd4bf55'}`, borderRadius:8, fontSize:11.5, fontWeight:700, cursor:'pointer', minHeight:36, touchAction:'manipulation' });
  const degChip = on => ({ padding:'6px 12px', borderRadius:16, fontSize:12.5, fontWeight:800, cursor:'pointer', minHeight:34, border:`1.5px solid ${on?'#2dd4bf':'#2dd4bf44'}`, background:on?'#2dd4bf':'transparent', color:on?'#06281f':'#7fdfd0', touchAction:'manipulation' });
  const navBtn = { background:'transparent', border:'1px solid #2a2840', color:'#ccc', borderRadius:8, padding:'9px 16px', fontSize:16, fontWeight:700, cursor:'pointer', minHeight:42, touchAction:'manipulation' };

  return (
    <div style={{ padding:'14px 12px' }}>
      <div style={{ display:'flex', gap:6, marginBottom:8 }}>
        <button onClick={()=>setSystem('caged')} style={segBtn(system==='caged')}>5 Positions</button>
        <button onClick={()=>{setSystem('tnps');setTnpsIdx(0);}} style={segBtn(system==='tnps')}>3 notes/string</button>
      </div>

      {/* resolution target chord */}
      <div style={{ fontSize:9, color:'#666', textTransform:'uppercase', letterSpacing:'.5px', margin:'4px 2px 4px' }}>Resolve to</div>
      <div style={{ display:'flex', gap:6, marginBottom:kind==='off'?10:7 }}>
        <button onClick={()=>switchKind('off')} style={kindBtn(kind==='off')}>Off</button>
        <button onClick={()=>switchKind('maj')} style={kindBtn(kind==='maj')}>{NOTE_NAMES[targetRoot]} major</button>
        <button onClick={()=>switchKind('min')} style={kindBtn(kind==='min')}>{NOTE_NAMES[targetRoot]} minor</button>
      </div>
      {/* per-note toggles */}
      {kind !== 'off' && (
        <div style={{ marginBottom:10 }}>
          <div style={{ fontSize:9, color:'#666', textTransform:'uppercase', letterSpacing:'.5px', margin:'2px 2px 5px' }}>Target notes ({targetName})</div>
          <div style={{ display:'flex', flexWrap:'wrap', gap:6 }}>
            {DEG_AVAIL[kind].map(d => <button key={d} onClick={()=>toggleDeg(d)} style={degChip(sel.has(d))}>{d}</button>)}
          </div>
        </div>
      )}

      <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', gap:8, marginBottom:6 }}>
        <div style={{ fontSize:13, fontWeight:800, color:'#fff' }}>
          {fullNeck ? 'Full neck' : cur.name}
          {!fullNeck && system==='caged' && cur.num===focusNum &&
            <span style={{ marginLeft:6, fontSize:10, fontWeight:800, color:'#e17055', border:'1px solid #e1705566', borderRadius:12, padding:'2px 7px' }}>FOCUS</span>}
          {!fullNeck && <span style={{ color:'#888', fontWeight:600, fontSize:11 }}> · starts on {cur.start} · frets {cur.lo}–{cur.hi}</span>}
        </div>
        <button onClick={()=>setFullNeck(f=>!f)} style={{ background:fullNeck?'#74b9ff':'transparent', color:fullNeck?'#111':'#74b9ff', border:'1px solid #74b9ff55', borderRadius:7, padding:'6px 11px', fontSize:11, fontWeight:700, cursor:'pointer', minHeight:34, touchAction:'manipulation' }}>{fullNeck?'◧ Full neck':'◫ Full neck'}</button>
      </div>

      <div style={{ background:'#13121f', border:'1px solid #1a1928', borderRadius:12, padding:'10px 8px', overflowX:'auto', WebkitOverflowScrolling:'touch' }}>
        <Fretboard cells={cells} root={root} labelMode={labelMode} resolve={tgt} sc={1.15} />
      </div>

      {!fullNeck && (
        <div style={{ display:'flex', alignItems:'center', justifyContent:'center', gap:12, marginTop:10 }}>
          <button onClick={()=>step(-1)} style={navBtn}>‹</button>
          <div style={{ fontSize:12, color:'#888', minWidth:96, textAlign:'center' }}>
            {cur.name}<br /><span style={{ fontSize:10, color:'#666' }}>{i+1}{['st','nd','rd','th','th'][i]||'th'} on the neck</span>
          </div>
          <button onClick={()=>step(1)} style={navBtn}>›</button>
        </div>
      )}

      <div style={{ display:'flex', justifyContent:'center', gap:8, marginTop:12, flexWrap:'wrap' }}>
        <PlayBtn onClick={playPos} label="▶ Play this shape" />
        {!fullNeck && system==='caged' && (
          cur.num === focusNum
            ? <button onClick={onPractise} style={{ background:'#e17055', color:'#fff', border:'none', borderRadius:7, padding:'7px 13px', fontSize:12, fontWeight:700, cursor:'pointer', minHeight:38, touchAction:'manipulation' }}>Practise this</button>
            : <button onClick={()=>onFocus(cur.num)} style={{ background:'transparent', color:'#e17055', border:'1px solid #e1705555', borderRadius:7, padding:'7px 13px', fontSize:12, fontWeight:700, cursor:'pointer', minHeight:38, touchAction:'manipulation' }}>Make this my focus</button>
        )}
      </div>

      {kind !== 'off' && (
        <div style={{ background:'#13121f', border:'1px solid #2dd4bf44', borderRadius:12, padding:'12px 13px', marginTop:14 }}>
          <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', gap:8, marginBottom:8 }}>
            <div style={{ fontSize:13, fontWeight:800 }}>Resolving to <span style={{ color:'#2dd4bf' }}>{targetName}</span></div>
            <PlayBtn onClick={playGuides} label="▶ Guide tones" small />
          </div>
          <div style={{ fontSize:12, lineHeight:1.6, color:'#ccc', marginBottom:8 }}>
            <span style={{ color:'#2dd4bf', fontWeight:800 }}>Teal squares</span> = the selected chord tones of {targetName} — your landing notes. Slide a tension into the nearest square.
          </div>
          <div style={{ fontSize:12, lineHeight:1.9 }}>
            <span style={{ color:'#ffd93d', fontWeight:800 }}>★ Guide tones:</span><br/>
            <Chip deg="3" /> {NOTE_NAMES[pc(root+4)]} → {NOTE_NAMES[targetRoot]} (root) <span style={{color:'#888'}}>{dirLabel(g3)}</span><br/>
            <Chip deg="b7" /> {NOTE_NAMES[pc(root+10)]} → {NOTE_NAMES[pc(targetRoot+thirdIv)]} ({kind==='min'?'♭3rd':'3rd'}) <span style={{color:'#888'}}>{dirLabel(g7)}</span>
          </div>
          <div style={{ display:'flex', alignItems:'center', gap:13, marginTop:10, paddingTop:9, borderTop:'1px solid #1a1928', fontSize:10, color:'#aaa', flexWrap:'wrap' }}>
            <span style={{ display:'flex', alignItems:'center', gap:5 }}><span style={{ width:13, height:13, borderRadius:3, border:'2.8px solid #ef4444', display:'inline-block' }}/>3rd — primary target</span>
            <span style={{ display:'flex', alignItems:'center', gap:5 }}><span style={{ width:13, height:13, borderRadius:3, border:'2.4px solid #2dd4bf', display:'inline-block' }}/>root</span>
            <span style={{ display:'flex', alignItems:'center', gap:5 }}><span style={{ width:13, height:13, borderRadius:3, border:'1.4px solid #3f7d74', display:'inline-block' }}/>other tones</span>
            <span style={{ display:'flex', alignItems:'center', gap:5 }}><span style={{ width:13, height:13, borderRadius:'50%', background:'#778ca3', display:'inline-block' }}/>scale note</span>
          </div>
        </div>
      )}

      {kind === 'off' && (
        <div style={{ display:'flex', flexWrap:'wrap', gap:8, marginTop:14, justifyContent:'center' }}>
          {ALT_ORDER.map(d=><span key={d} style={{ display:'flex', alignItems:'center', gap:5, fontSize:10, color:'#aaa' }}><span style={{width:12,height:12,borderRadius:'50%',background:DC[d],display:'inline-block'}}/>{d}</span>)}
        </div>
      )}
    </div>
  );
}

// ── Settings ─────────────────────────────────────────────────────────────
function SettingsTab({ settings, onChange, onResetProgress }) {
  const set = patch => onChange({ ...settings, ...patch });
  const [confirmReset, setConfirmReset] = useState(false);
  const drills = (settings.drills && settings.drills.length) ? settings.drills : ['root','ires'];
  const toggleDrill = d => {
    const s = new Set(drills);
    s.has(d) ? s.delete(d) : s.add(d);
    if (!s.size) return;              // at least one drill, or Practice has nothing to ask
    set({ drills: DRILLS.filter(x => s.has(x)) });
  };
  const toggleNote = d => { const s = new Set(settings.defNotes); s.has(d) ? s.delete(d) : s.add(d); set({ defNotes: [...s] }); };
  const [banner, setBanner] = useState('idle');
  const resetBanner = () => { try { localStorage.removeItem('at_ios_hint'); } catch(e){} setBanner('done'); setTimeout(()=>setBanner('idle'), 1800); };

  const card = { background:'#13121f', border:'1px solid #1a1928', borderRadius:12, padding:'13px', marginBottom:12 };
  const h = { fontSize:11, color:'#888', fontWeight:700, textTransform:'uppercase', letterSpacing:'.5px', marginBottom:9 };
  const seg = on => ({ flex:1, padding:'9px 4px', background:on?'#e17055':'transparent', color:on?'#fff':'#aaa', border:`1px solid ${on?'#e17055':'#2a2840'}`, borderRadius:8, fontSize:12, fontWeight:700, cursor:'pointer', minHeight:40, touchAction:'manipulation' });
  const tseg = on => ({ flex:1, padding:'9px 4px', background:on?'#2dd4bf':'transparent', color:on?'#06281f':'#9fe', border:`1px solid ${on?'#2dd4bf':'#2dd4bf55'}`, borderRadius:8, fontSize:12, fontWeight:700, cursor:'pointer', minHeight:40, touchAction:'manipulation' });
  const chip = on => ({ padding:'7px 13px', borderRadius:16, fontSize:13, fontWeight:800, cursor:'pointer', minHeight:36, border:`1.5px solid ${on?'#2dd4bf':'#2dd4bf44'}`, background:on?'#2dd4bf':'transparent', color:on?'#06281f':'#7fdfd0', touchAction:'manipulation' });

  return (
    <div style={{ padding:'14px 12px' }}>
      <a href="https://ko-fi.com/syncopatedsyntax" target="_blank" rel="noopener noreferrer"
        style={{ display:'flex', alignItems:'center', justifyContent:'center', gap:8, background:'#FF5E5B', color:'#fff', borderRadius:11, padding:'12px 20px', textDecoration:'none', fontWeight:800, fontSize:14, boxShadow:'0 4px 14px #FF5E5B55', marginBottom:14, touchAction:'manipulation', WebkitTapHighlightColor:'transparent' }}>
        <span style={{ fontSize:18 }}>☕</span> Buy me a coffee
      </a>

      <div style={card}>
        <div style={h}>Default key selector</div>
        <div style={{ display:'flex', gap:6 }}>
          <button onClick={()=>set({defKeyMode:'dom'})} style={seg(settings.defKeyMode!=='tonic')}>V7alt root</button>
          <button onClick={()=>set({defKeyMode:'tonic'})} style={tseg(settings.defKeyMode==='tonic')}>Resolves to</button>
        </div>
        <div style={{ fontSize:11, color:'#777', marginTop:8, lineHeight:1.5 }}>Which value the note grid sets by default — the other is computed automatically.</div>
      </div>

      <div style={card}>
        <div style={h}>Key memory</div>
        <div style={{ fontSize:12.5, color:'#ccc', lineHeight:1.6 }}>
          🔑 The app remembers the last key you used and reopens there next time. Change keys anytime from the grid at the top of any tab.
        </div>
      </div>

      <div style={card}>
        <div style={h}>Default fingering</div>
        <div style={{ display:'flex', gap:6 }}>
          <button onClick={()=>set({defSystem:'caged'})} style={seg(settings.defSystem==='caged')}>5 Positions</button>
          <button onClick={()=>set({defSystem:'tnps'})} style={seg(settings.defSystem==='tnps')}>3 notes/string</button>
        </div>
      </div>

      <div style={card}>
        <div style={h}>Default resolution target</div>
        <div style={{ display:'flex', gap:6 }}>
          <button onClick={()=>set({defKind:'off'})} style={tseg(settings.defKind==='off')}>Off</button>
          <button onClick={()=>set({defKind:'maj'})} style={tseg(settings.defKind==='maj')}>I major</button>
          <button onClick={()=>set({defKind:'min'})} style={tseg(settings.defKind==='min')}>I minor</button>
        </div>
      </div>

      <div style={card}>
        <div style={h}>Default target notes</div>
        <div style={{ display:'flex', flexWrap:'wrap', gap:7 }}>
          {DEG_AVAIL[settings.defKind === 'min' ? 'min' : 'maj'].map(d => <button key={d} onClick={()=>toggleNote(d)} style={chip(settings.defNotes.includes(d))}>{d}</button>)}
        </div>
        <div style={{ fontSize:11, color:'#777', marginTop:8, lineHeight:1.5 }}>{settings.defKind === 'min' ? 'Both ♭7 (standard minor) and Δ7 (melodic minor) are available.' : 'Over a minor target, the 3 shows as ♭3 automatically. 13 applies to major only.'}</div>
      </div>

      <div style={card}>
        <div style={h}>Notifications</div>
      <div style={card}>
        <div style={h}>Practice drills</div>
        <div style={{ display:'flex', flexDirection:'column', gap:7 }}>
          {DRILLS.map(d => {
            const on = drills.includes(d);
            return (
              <button key={d} onClick={()=>toggleDrill(d)}
                style={{ textAlign:'left', padding:'10px 11px', borderRadius:9, cursor:'pointer', minHeight:44, touchAction:'manipulation',
                  border:`1px solid ${on?'#e17055':'#2a2840'}`, background:on?'#e1705518':'transparent', color:on?'#fff':'#999' }}>
                <div style={{ fontSize:12.5, fontWeight:800 }}>{on?'●':'○'} {DRILL_META[d].label}</div>
                <div style={{ fontSize:11, color:'#888', marginTop:3 }}>{DRILL_META[d].ask}</div>
              </button>
            );
          })}
        </div>
        <div style={{ fontSize:10.5, color:'#666', marginTop:9, lineHeight:1.6 }}>
          "Lands on" always uses the major I. Over a minor I the third is the ♭13 — a note
          that is already in the scale — so the drill would have you tapping a dot that is
          right there in front of you.
        </div>
        <div style={{ ...h, marginTop:14 }}>Questions per session</div>
        <div style={{ display:'flex', gap:6 }}>
          {[8,12,20].map(n => <button key={n} onClick={()=>set({ sessionN:n })} style={seg((settings.sessionN||12)===n)}>{n}</button>)}
        </div>
        <div style={{ ...h, marginTop:14 }}>Key for each question</div>
        <div style={{ display:'flex', gap:6 }}>
          {[['random','All 12'],['common','Common'],['fixed','Current key']].map(([v,l]) =>
            <button key={v} onClick={()=>set({ keyMode:v })} style={seg((settings.keyMode||'random')===v)}>{l}</button>)}
        </div>
        <div style={{ fontSize:10.5, color:'#666', marginTop:8, lineHeight:1.6 }}>
          A new key every question is the point — a shape you only know in one place is a
          picture, not a shape. Pin it to the current key for a first pass at something new.
        </div>
      </div>

      <div style={card}>
        <div style={h}>Progress</div>
        <ProgressBackup toolKey="alt" prefix="at_" />
        <button onClick={()=>{ if (confirmReset) { onResetProgress(); setConfirmReset(false); } else setConfirmReset(true); }}
          style={{ width:'100%', marginTop:10, background:'transparent', border:`1px solid ${confirmReset?'#ef4444':'#2a2840'}`,
            color:confirmReset?'#ff8f8f':'#888', borderRadius:9, padding:'10px', fontSize:12, fontWeight:700, cursor:'pointer', minHeight:42 }}>
          {confirmReset ? 'Tap again to erase every drill result' : 'Reset practice progress'}
        </button>
      </div>

        <button onClick={resetBanner} style={{ background:'transparent', border:'1px solid #2a2840', color:banner==='done'?'#2dd4bf':'#ccc', borderRadius:8, padding:'9px 14px', fontSize:12, fontWeight:700, cursor:'pointer', minHeight:40, touchAction:'manipulation' }}>
          {banner==='done' ? '✓ Reset — banner will show again' : 'Reset install banner'}
        </button>
      </div>

      <div style={{ fontSize:10, color:'#555', textAlign:'center', marginTop:6 }}>Defaults apply next time you open the Positions tab.</div>
    </div>
  );
}

// ── Install / iOS banner (trimmed) ───────────────────────────────────────
function BannerStack() {
  const [dp, setDp] = useState(null);
  const [show, setShow] = useState(false);
  const standalone = typeof window !== 'undefined' && (window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true);
  const isIOS = typeof navigator !== 'undefined' && /iphone|ipad|ipod/i.test(navigator.userAgent);
  useEffect(() => {
    if (standalone) return;
    const onBip = e => { e.preventDefault(); setDp(e); setShow(true); };
    window.addEventListener('beforeinstallprompt', onBip);
    if (isIOS) { try { if (!localStorage.getItem('at_ios_hint')) setShow(true); } catch(e){ setShow(true);} }
    return () => window.removeEventListener('beforeinstallprompt', onBip);
  }, [standalone, isIOS]);
  if (!show || standalone) return null;
  const wrap = { position:'fixed', bottom:'max(14px,env(safe-area-inset-bottom))', left:'50%', transform:'translateX(-50%)', width:'calc(100% - 24px)', maxWidth:406, boxSizing:'border-box', background:'#1a1830', border:'1px solid #2a2840', borderRadius:12, padding:'11px 13px', display:'flex', alignItems:'center', gap:10, boxShadow:'0 8px 30px #0008', zIndex:50 };
  const close = () => { setShow(false); try { localStorage.setItem('at_ios_hint','1'); } catch(e){} };
  return (
    <div style={wrap} onClick={e=>e.stopPropagation()}>
      <div style={{ fontSize:12, color:'#ddd', flex:1, lineHeight:1.4 }}>
        {isIOS && !dp ? <>Add to Home Screen: tap <b>Share</b> ⃞↑ then <b>Add to Home Screen</b>.</> : <>Install AlteredTrainer for offline practice.</>}
      </div>
      {dp && <button onClick={async()=>{dp.prompt();await dp.userChoice;setShow(false);}} style={{ background:'#e17055', color:'#fff', border:'none', borderRadius:8, padding:'8px 13px', fontSize:12, fontWeight:700, cursor:'pointer' }}>Install</button>}
      <button onClick={close} style={{ background:'transparent', color:'#888', border:'none', fontSize:18, cursor:'pointer', padding:'0 4px' }}>×</button>
    </div>
  );
}

// ── PRACTICE TAB ─────────────────────────────────────────────────────────
// The answer to "which shape am I on, and when do I move on".
//
// Recommended but open: the app names ONE focus shape and defaults to it, but
// the ladder underneath stays tappable and nothing is locked. at_focus (the
// recommendation) is deliberately separate from at_shape (where you happen to
// be browsing) so wandering off in Positions does not silently rewrite the plan.
function PracticeTab({ root, labelMode, settings, srs, onGrade, focus, onFocus, onSession }) {
  const drills = (settings.drills && settings.drills.length) ? settings.drills : ['root','ires'];
  const sessionN = settings.sessionN || 12;
  const keyMode = settings.keyMode || 'random';
  const [queue, setQueue] = useState(null);
  const [qi, setQi] = useState(0);
  const [answer, setAnswer] = useState(null);   // { correct, tapped, verdict }
  const [tally, setTally] = useState({ ok:0, miss:0 });

  const pickKey = () => keyMode === 'fixed' ? root
    : keyMode === 'common' ? [0,2,4,5,7,9,11][ri(7)]
    : ri(12);

  const focusNum = focus?.shape || 1;
  const prog = useMemo(() => shapeProgress(focusNum, srs, drills), [focusNum, srs, drills]);
  const ladder = useMemo(() => [1,2,3,4,5].map(n => ({ n, ...shapeProgress(n, srs, drills) })), [srs, drills]);
  const focusShape = useMemo(() => getCagedShape(root, focusNum), [root, focusNum]);
  const dueTotal = useMemo(() => {
    const td = todayStr();
    return buildCards(drills).filter(c => srs[c.id] && dayDiff(td, srs[c.id].nextDue) <= 0).length;
  }, [srs, drills]);

  // Each rep picks its own key, so the app-wide key selector would be showing
  // something different from the card. Tell App to hide it while we run.
  useEffect(() => { onSession?.(!!queue); }, [queue, onSession]);
  useEffect(() => () => onSession?.(false), [onSession]);

  const start = (nums) => {
    const cards = buildCards(drills).filter(c => nums.includes(c.shape));
    setQueue(buildQueue(cards, srs, sessionN, pickKey));
    setQi(0); setAnswer(null); setTally({ ok:0, miss:0 });
  };
  const quit = () => { setQueue(null); setAnswer(null); };

  const card = { background:'#13121f', border:'1px solid #1a1928', borderRadius:12, padding:12, marginBottom:12 };
  const h = { fontSize:11, color:'#888', letterSpacing:'.5px', textTransform:'uppercase', fontWeight:800, marginBottom:8 };
  const primary = { width:'100%', background:'#e17055', color:'#fff', border:'none', borderRadius:10, padding:'14px', fontSize:15, fontWeight:800, cursor:'pointer', minHeight:48, touchAction:'manipulation' };
  const ghost = { width:'100%', background:'transparent', color:'#aaa', border:'1px solid #2a2840', borderRadius:9, padding:'10px', fontSize:12.5, fontWeight:700, cursor:'pointer', minHeight:42, touchAction:'manipulation', marginTop:8 };

  // ── A running session ──────────────────────────────────────────────────
  if (queue) {
    if (qi >= queue.length) {
      const pct = Math.round((tally.ok / Math.max(1, tally.ok + tally.miss)) * 100);
      return (
        <div>
          <div style={{ ...card, textAlign:'center', padding:'24px 14px' }}>
            <div style={{ fontSize:34, marginBottom:6 }}>{pct >= 80 ? '⭐' : pct >= 60 ? '🎸' : '💪'}</div>
            <div style={{ fontSize:22, fontWeight:900, color:'#fff' }}>{tally.ok} / {tally.ok + tally.miss}</div>
            <div style={{ fontSize:12, color:'#999', marginTop:6 }}>Every rep was in a different key. That is the part that sticks.</div>
          </div>
          <button onClick={()=>start(queue.map(q=>q.shape).filter((v,i,a)=>a.indexOf(v)===i))} style={primary}>Go again</button>
          <button onClick={quit} style={ghost}>Done</button>
        </div>
      );
    }
    const it = queue[qi];
    const sh = getCagedShape(it.root, it.shape);
    const win = winOf(sh);
    const { ok, near } = answerSet(it.drill, sh, it.root, win);
    const meta = DRILL_META[it.drill];
    const targetPc = it.drill === 'root' ? it.root : pc(it.root + (it.drill === 'ires' ? 5 : 9));

    const tap = (st, f) => {
      if (answer) return;
      const k = ckey(st, f);
      const correct = ok.has(k);
      const isNear = !correct && near.has(k);
      const deg = altDegOf(OPEN_MIDI[st] + f, it.root);
      const verdict = correct ? 'Yes.'
        : isNear ? `That is ${NOTE_NAMES[pc(OPEN_MIDI[st]+f)]} — the right note, but not one in this shape.`
        : deg ? `That is ${NOTE_NAMES[pc(OPEN_MIDI[st]+f)]}, the ${deg} of ${NOTE_NAMES[it.root]}alt.`
        : `That is ${NOTE_NAMES[pc(OPEN_MIDI[st]+f)]}, which is not in the scale.`;
      setAnswer({ correct, tapped:k, verdict });
      setTally(t => ({ ok: t.ok + (correct?1:0), miss: t.miss + (correct?0:1) }));
      onGrade(it.id, correct, it.root);
      playMidis([OPEN_MIDI[st] + f]);
      if (correct) setTimeout(() => { setAnswer(null); setQi(i=>i+1); }, 850);
    };

    const marks = [];
    if (answer) {
      const [ts, tf] = answer.tapped.split('_').map(Number);
      marks.push({ s:ts, f:tf, kind: answer.correct ? 'ok' : 'bad' });
      if (!answer.correct) for (const k of ok) { const [a,b] = k.split('_').map(Number); marks.push({ s:a, f:b, kind:'reveal' }); }
    }
    // For "lands on", light up the b7s so the half-step slide is visible.
    const hl = it.drill === 'ithird' && !answer
      ? new Set(sh.cells.filter(c=>c.deg==='b7').map(c=>ckey(c.s,c.f))) : null;

    return (
      <div>
        <div style={{ display:'flex', alignItems:'center', gap:10, marginBottom:8 }}>
          <button onClick={quit} aria-label="End session" style={{ background:'transparent', border:'1px solid #2a2840', color:'#aaa', borderRadius:8, padding:'6px 11px', fontSize:12, fontWeight:700, cursor:'pointer', minHeight:40, touchAction:'manipulation' }}>End</button>
          <div style={{ flex:1 }}>
            <div style={{ fontSize:12, color:'#888' }}>Position {it.shape} · {qi+1} / {queue.length}</div>
            <div style={{ height:4, background:'#1a1928', borderRadius:2, marginTop:4, overflow:'hidden' }}>
              <div style={{ width:`${(qi/queue.length)*100}%`, height:'100%', background:'#e17055' }} />
            </div>
          </div>
        </div>

        <div style={{ ...card, textAlign:'center' }}>
          <div style={{ fontSize:18, fontWeight:900, color:'#e17055' }}>{NOTE_NAMES[it.root]}7alt</div>
          <div style={{ fontSize:13.5, color:'#ddd', marginTop:6, lineHeight:1.5 }}>{meta.ask}</div>
          {it.drill !== 'root' && (
            <div style={{ fontSize:11, color:'#777', marginTop:5 }}>
              resolving to {NOTE_NAMES[pc(it.root+5)]} · not a note in the shape
            </div>
          )}
        </div>

        <div style={{ background:'#13121f', border:'1px solid #1a1928', borderRadius:12, padding:'10px 6px' }}>
          <Fretboard cells={sh.cells} root={it.root} labelMode={labelMode} mono
            win={win} rowH={36} fill highlight={hl} marks={marks}
            onTapCell={answer ? undefined : tap} />
        </div>

        {answer && (
          <div style={{ ...card, marginTop:12, borderColor: answer.correct ? '#2ed57355' : '#ef444455' }}>
            <div style={{ fontSize:13, color: answer.correct ? '#2ed573' : '#ffb4b4', fontWeight:700, lineHeight:1.5 }}>{answer.verdict}</div>
            {!answer.correct && (
              <>
                <div style={{ fontSize:11.5, color:'#999', marginTop:6, lineHeight:1.6 }}>
                  {it.drill === 'root' ? 'The roots in this shape are ringed.'
                    : `Every ${NOTE_NAMES[targetPc]} in view is ringed.`}
                </div>
                <button onClick={()=>{ setAnswer(null); setQi(i=>i+1); }} style={{ ...primary, marginTop:10 }}>Next ›</button>
              </>
            )}
          </div>
        )}
      </div>
    );
  }

  // ── Idle ───────────────────────────────────────────────────────────────
  const pips = n => drills.map(d => {
    const c = srs[cardId(n,d)];
    return { d, on: isLearned(c), part: !!c && !isLearned(c) };
  });

  return (
    <div>
      <div style={{ ...card, borderColor:'#e1705544' }}>
        <div style={h}>Your focus</div>
        <div style={{ display:'flex', alignItems:'baseline', gap:8, flexWrap:'wrap' }}>
          <div style={{ fontSize:22, fontWeight:900, color:'#fff' }}>Position {focusNum}</div>
          <div style={{ fontSize:11.5, color:'#888' }}>starts on {focusShape?.start} · frets {focusShape?.lo}–{focusShape?.hi} in {NOTE_NAMES[root]}</div>
        </div>
        <div style={{ marginTop:10, marginBottom:10 }}>
          <Fretboard cells={focusShape?.cells || []} root={root} labelMode={labelMode} />
        </div>
        <div style={{ display:'flex', gap:8, flexWrap:'wrap', marginBottom:10 }}>
          {pips(focusNum).map(({d,on,part}) => (
            <span key={d} style={{ fontSize:11, fontWeight:700, padding:'4px 9px', borderRadius:14,
              border:`1px solid ${on?'#2ed573':part?'#74b9ff':'#2a2840'}`,
              color:on?'#2ed573':part?'#74b9ff':'#777' }}>
              {on?'●':part?'◐':'○'} {DRILL_META[d].short}
            </span>
          ))}
          <span style={{ fontSize:11, color:'#777', padding:'4px 0' }}>{prog.keyCount}/12 keys</span>
        </div>
        <button onClick={()=>start([focusNum])} style={primary}>▶ Practise Position {focusNum}</button>
        <button onClick={()=>start([1,2,3,4,5])} style={ghost}>Practise all five{dueTotal ? ` · ${dueTotal} due` : ''}</button>
      </div>

      {prog.ready && focusNum < 5 && (
        <div style={{ ...card, borderColor:'#2ed57355' }}>
          <div style={{ fontSize:13.5, color:'#2ed573', fontWeight:800, marginBottom:4 }}>Position {focusNum} is solid.</div>
          <div style={{ fontSize:12, color:'#bbb', lineHeight:1.6, marginBottom:10 }}>
            Every drill at {READY_REPS}+ reps, across {prog.keyCount} keys. Ready for Position {focusNum+1}?
          </div>
          <div style={{ display:'flex', gap:8 }}>
            <button onClick={()=>onFocus(focusNum+1)} style={{ ...primary, background:'#2ed573', color:'#06281f', flex:1 }}>Move on</button>
            <button onClick={()=>onFocus(focusNum)} style={{ ...ghost, marginTop:0, width:'auto', padding:'10px 16px' }}>Not yet</button>
          </div>
        </div>
      )}

      <div style={card}>
        <div style={h}>The five shapes</div>
        {ladder.map(l => {
          const isFocus = l.n === focusNum;
          return (
            <div key={l.n} style={{ display:'flex', alignItems:'center', gap:9, padding:'9px 8px', borderRadius:9, marginBottom:5,
              border:`1px solid ${isFocus?'#e17055':'#1f1e2e'}`, background:isFocus?'#e1705511':'transparent' }}>
              <div style={{ flex:1, minWidth:0 }}>
                <div style={{ fontSize:12.5, fontWeight:800, color:'#fff' }}>
                  Position {l.n} <span style={{ color:'#777', fontWeight:600, fontSize:11 }}>starts on {SHAPE_ANCHOR[SHAPE_ORDER[l.n-1]]}</span>
                </div>
                <div style={{ display:'flex', height:5, borderRadius:3, overflow:'hidden', background:'#1a1928', marginTop:5 }}>
                  <div style={{ flex:l.mastered, background:'#2ed573' }} />
                  <div style={{ flex:l.total-l.mastered-l.nw, background:'#74b9ff' }} />
                  <div style={{ flex:l.nw, background:'transparent' }} />
                </div>
                <div style={{ fontSize:10, color:'#777', marginTop:4 }}>
                  {l.ready ? `solid · ${l.keyCount} keys` : l.nw === l.total ? 'not started' : `${l.mastered}/${l.total} drills${l.due?` · ${l.due} due`:''}`}
                </div>
              </div>
              <button onClick={()=>onFocus(l.n)} disabled={isFocus}
                style={{ background:'transparent', border:`1px solid ${isFocus?'#e17055':'#2a2840'}`, color:isFocus?'#e17055':'#888',
                  borderRadius:8, padding:'8px 10px', fontSize:11, fontWeight:700, cursor:isFocus?'default':'pointer', minHeight:44, minWidth:44, touchAction:'manipulation' }}>
                {isFocus ? 'focus' : 'set'}
              </button>
            </div>
          );
        })}
        <div style={{ fontSize:10.5, color:'#666', lineHeight:1.6, marginTop:8 }}>
          Nothing is locked — the focus is a suggestion. "Solid" is not "finished" either:
          cards keep coming back on a schedule, which is what makes them stay.
        </div>
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════
//  APP
// ════════════════════════════════════════════════════════════════════════
export default function App() {
  const [root, setRoot] = useState(7);          // G7alt default
  const [labelMode, setLabelMode] = useState('degrees');
  // Practice is the landing screen: the problem it solves is "which shape am I
  // supposed to be working on", and that has to be the first thing you see.
  const [tab, setTab] = useState('practice');
  const [keyMode, setKeyMode] = useState('dom'); // 'dom' (V7alt root) | 'tonic' (resolution key)
  const [settings, setSettings] = useState({ defSystem:'caged', defKind:'maj', defNotes:['R','3'], defKeyMode:'dom' });
  // Which CAGED shape you are on, as a stable position number (1-5). Lives here
  // rather than in PositionsTab because Practice has to agree with it, and
  // because migrating the old at_pos needs the restored key.
  const [shapeNum, setShapeNum] = useState(1);
  const [srs, setSrs] = useState({});
  const [focus, setFocus] = useState({ shape: 1, since: null });
  const [drilling, setDrilling] = useState(false);
  const prefsLoaded = useRef(false);
  const scrollRef = useRef(null);

  // load prefs
  useEffect(() => { (async () => {
    // Guarded: a corrupt at_root used to give setRoot(NaN), which collapses
    // every position computation downstream.
    try { const r = await store.get('at_root'); if (r) { const n = parseInt(unq(r.value),10); if (Number.isFinite(n) && n >= 0 && n < 12) setRoot(n); } } catch(e){}
    try { const l = await store.get('at_label'); if (l) setLabelMode(unq(l.value) === 'notes' ? 'notes' : 'degrees'); } catch(e){}
    try { const s = await store.get('at_settings'); if (s) setSettings(prev => ({ ...prev, ...JSON.parse(s.value) })); } catch(e){}
    // at_pos held a NECK index (0-6). Its range overlaps the new stable numbers
    // (1-5), so it cannot be reinterpreted — convert it once, in the key it was
    // recorded in, so the shape actually on screen is the one preserved.
    try {
      let num = jstore.get('at_shape', null);
      if (num == null) {
        let legacy = null;
        try { const v = localStorage.getItem('at_pos'); if (v !== null) legacy = parseInt(v, 10); } catch(e){}
        const r = await store.get('at_root');
        const rootNow = r ? (parseInt(unq(r.value),10) || 0) : 7;
        const positions = getCagedPositions(rootNow);
        num = Number.isFinite(legacy)
          ? positions[Math.min(Math.max(legacy, 0), positions.length - 1)].num
          : 1;
        jstore.set('at_shape', num);
        jstore.del('at_pos');
      }
      if (num >= 1 && num <= 5) setShapeNum(num);
    } catch(e){}
    try { setSrs(jstore.get('at_srs', {}) || {}); } catch(e){}
    try { const f = jstore.get('at_focus', null); if (f && f.shape >= 1 && f.shape <= 5) setFocus(f); } catch(e){}
    prefsLoaded.current = true;
  })(); }, []);
  useEffect(() => { store.set('at_root', String(root)); }, [root]);
  useEffect(() => { store.set('at_label', JSON.stringify(labelMode)); }, [labelMode]);
  useEffect(() => { store.set('at_settings', JSON.stringify(settings)); }, [settings]);
  // Gated on the load: this effect also runs on mount, and without the guard it
  // would write the default 1 over a stored value before the async read above
  // has got to it.
  useEffect(() => { if (prefsLoaded.current) jstore.set('at_shape', shapeNum); }, [shapeNum]);

  // Grading writes synchronously — it happens inside a tap handler and the
  // queue advances immediately, so an async write would race the next tap.
  // keysSeen is a 12-bit mask: with a random key per rep, the rep count alone
  // cannot tell you whether a shape is known or just memorised in one place.
  const grade = useCallback((id, correct, atRoot) => {
    setSrs(prev => {
      const next = { ...prev, [id]: {
        ...updateSRS(prev[id], correct),
        keysSeen: (prev[id]?.keysSeen || 0) | (correct ? (1 << atRoot) : 0),
        seen: (prev[id]?.seen || 0) + 1,
      } };
      jstore.set('at_srs', next);
      return next;
    });
  }, []);
  const resetProgress = useCallback(() => {
    setSrs({}); jstore.set('at_srs', {});
    const f = { shape: 1, since: null };
    setFocus(f); jstore.set('at_focus', f);
  }, []);
  const moveFocus = useCallback(n => {
    const f = { shape: Math.min(5, Math.max(1, n)), since: todayStr() };
    setFocus(f); jstore.set('at_focus', f); setShapeNum(f.shape);
  }, []);
  useEffect(() => { setKeyMode(settings.defKeyMode === 'tonic' ? 'tonic' : 'dom'); }, [settings.defKeyMode]);

  // PWA: manifest, icon, theme, iOS scroll fix
  useEffect(() => {
    const style = document.createElement('style');
    style.textContent = `*{-webkit-tap-highlight-color:transparent}body{margin:0}`;
    document.head.appendChild(style);

    const makeIcon = (size) => {
      const c = document.createElement('canvas'); c.width = c.height = size;
      const x = c.getContext('2d'); const u = size/512;
      x.fillStyle = '#0f0e17'; x.beginPath();
      const rr = 96*u; x.moveTo(rr,0); x.arcTo(size,0,size,size,rr); x.arcTo(size,size,0,size,rr); x.arcTo(0,size,0,0,rr); x.arcTo(0,0,size,0,rr); x.fill();
      const dots = [['b9','#7c5cbf'],['#9','#6c5ce7'],['3','#ffd93d'],['#11','#0fbcf9'],['b13','#9b2335']];
      dots.forEach((d,i) => { x.beginPath(); x.arc((110+i*73)*u,(256)*u,30*u,0,7); x.fillStyle=d[1]; x.fill(); });
      x.fillStyle = '#fff'; x.font = `bold ${70*u}px sans-serif`; x.textAlign='center';
      x.fillText('alt', size/2, 150*u);
      return c.toDataURL('image/png');
    };
    const i512 = makeIcon(512), i180 = makeIcon(180);
    const setLink = (rel, sizes, href) => { let l = document.querySelector(`link[rel="${rel}"]${sizes?`[sizes="${sizes}"]`:''}`); if(!l){l=document.createElement('link');l.rel=rel;if(sizes)l.sizes=sizes;document.head.appendChild(l);} l.href=href; };
    setLink('apple-touch-icon','180x180',i180); setLink('icon','512x512',i512);
    const setMeta = (n,c) => { let m=document.querySelector(`meta[name="${n}"]`); if(!m){m=document.createElement('meta');m.name=n;document.head.appendChild(m);} m.content=c; };
    setMeta('theme-color','#0f0e17');
    setMeta('viewport','width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no,viewport-fit=cover');
    setMeta('apple-mobile-web-app-capable','yes');
    setMeta('apple-mobile-web-app-status-bar-style','black-translucent');
    setMeta('apple-mobile-web-app-title','Fretworks');
    // Single PWA: reference the unified shell manifest (one manifest per origin)
    // instead of generating a competing per-app manifest.
    let mlink = document.querySelector('link[rel="manifest"]'); if(!mlink){mlink=document.createElement('link');mlink.rel='manifest';document.head.appendChild(mlink);} mlink.href = '/manifest.webmanifest';

    window.scrollTo(0,0);
    const lock = () => { if (window.scrollY !== 0 || window.scrollX !== 0) window.scrollTo(0,0); };
    window.addEventListener('scroll', lock, { passive:true });
    return () => { document.head.removeChild(style); window.removeEventListener('scroll', lock); };
  }, []);

  const TABS = [{id:'practice',label:'Practice',icon:'🎯'},{id:'explorer',label:'Explorer',icon:'🧭'},{id:'positions',label:'Positions',icon:'🎸'},{id:'settings',label:'Settings',icon:'⚙️'}];
  const CW = 600; // centered content max-width (matches ChordTrainer)

  return (
    <div style={{ background:'#0f0e17', height:'100dvh', width:'100%', boxSizing:'border-box', display:'flex', flexDirection:'column', color:'#fffffe', fontFamily:"var(--font-body)", WebkitFontSmoothing:'antialiased' }}>
      <AppHeader toolKey="alt">
        <button className={`fw-header-btn${labelMode==='degrees'?' is-on':''}`} onClick={()=>setLabelMode(m=>m==='degrees'?'notes':'degrees')}>
          {labelMode==='degrees'?'✦ Degrees':'Note names'}
        </button>
      </AppHeader>

      <TabBar toolKey="alt" tabs={TABS} active={tab} onChange={(id)=>{setTab(id); if(scrollRef.current)scrollRef.current.scrollTop=0;}} />

      {/* key selector: V7alt root <-> resolution key — below the tabs, full-bleed border, centered inner.
          Hidden during a drill: every question picks its own key, so leaving this
          up would show a key that contradicts the card in front of you. */}
      {!drilling && <div style={{ borderBottom:'1px solid #1a1928' }}>
       <div style={{ padding:'8px 10px', maxWidth:CW, margin:'0 auto' }}>
        <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', gap:8, marginBottom:7 }}>
          <div style={{ display:'flex', gap:5 }}>
            <button onClick={()=>setKeyMode('dom')} style={{ padding:'5px 10px', borderRadius:14, fontSize:11, fontWeight:700, cursor:'pointer', minHeight:30, border:`1px solid ${keyMode==='dom'?'#e17055':'#2a2840'}`, background:keyMode==='dom'?'#e17055':'transparent', color:keyMode==='dom'?'#fff':'#999', touchAction:'manipulation' }}>V7alt root</button>
            <button onClick={()=>setKeyMode('tonic')} style={{ padding:'5px 10px', borderRadius:14, fontSize:11, fontWeight:700, cursor:'pointer', minHeight:30, border:`1px solid ${keyMode==='tonic'?'#2dd4bf':'#2a2840'}`, background:keyMode==='tonic'?'#2dd4bf':'transparent', color:keyMode==='tonic'?'#06281f':'#999', touchAction:'manipulation' }}>Resolves to</button>
          </div>
          <div style={{ fontSize:12.5, fontWeight:800, whiteSpace:'nowrap' }}>
            <span style={{color:'#e17055'}}>{NOTE_NAMES[root]}7alt</span>
            <span style={{color:'#666'}}> → </span>
            <span style={{color:'#2dd4bf'}}>{NOTE_NAMES[(root+5)%12]}</span>
          </div>
        </div>
        <div style={{ display:'grid', gridTemplateColumns:'repeat(12,1fr)', gap:3 }}>
          {NOTE_NAMES.map((n,i)=>{
            const active = keyMode==='dom' ? root===i : ((root+5)%12)===i;
            const accent = keyMode==='dom' ? '#e17055' : '#2dd4bf';
            return (
              <button key={i} onClick={()=>setRoot(keyMode==='dom' ? i : (i+7)%12)}
                style={{ padding:'7px 0', borderRadius:6, fontSize:11, fontWeight:800, cursor:'pointer', minHeight:34, border:`1px solid ${active?accent:'#2a2840'}`, background:active?accent:'transparent', color:active?(keyMode==='tonic'?'#06281f':'#fff'):'#999', touchAction:'manipulation' }}>{n}</button>
            );
          })}
        </div>
       </div>
      </div>}

      {/* content — centered inner */}
      <div ref={scrollRef} style={{ flex:1, overflowY:'auto', WebkitOverflowScrolling:'touch', overscrollBehaviorY:'none' }}>
        <div style={{ maxWidth:CW, margin:'0 auto', paddingBottom:'max(80px,env(safe-area-inset-bottom))' }}>
          {tab==='explorer' && <ExplorerTab root={root} labelMode={labelMode} />}
          {tab==='practice' && <PracticeTab root={root} labelMode={labelMode} settings={settings} srs={srs} onGrade={grade} focus={focus} onFocus={moveFocus} onSession={setDrilling} />}
          {tab==='positions' && <PositionsTab root={root} labelMode={labelMode} settings={settings} shapeNum={shapeNum} onShapeNum={setShapeNum} focusNum={focus.shape} onFocus={moveFocus} onPractise={()=>setTab('practice')} />}
          {tab==='settings' && <SettingsTab settings={settings} onChange={setSettings} onResetProgress={resetProgress} />}
        </div>
      </div>

      <BannerStack />
    </div>
  );
}
