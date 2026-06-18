import { useState, useEffect, useMemo, useRef, useCallback } from "react";

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
// 5 altered positions for a given altered root, ordered low->high on the neck
function getCagedPositions(root) {
  const parentPc = (root + 1) % 12;
  const list = CAGED_MM.map(pat => {
    const cells = transposeCaged(pat, parentPc);
    const fs = cells.map(c => c.f);
    return { cells, lo: Math.min(...fs), hi: Math.max(...fs) };
  });
  list.sort((a,b) => a.lo - b.lo);
  return list.map((p,i) => ({ ...p, name: `Position ${i+1}` }));
}
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
const MIN_TONES = {0:'R',3:'b3',7:'5',11:'Δ7',2:'9'};
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

// ── Audio (Web Audio pluck) ──────────────────────────────────────────────
let _ctx = null, _unlocked = false;
function getCtx() { if (!_ctx) _ctx = new (window.AudioContext || window.webkitAudioContext)(); if (_ctx.state === 'suspended') _ctx.resume(); return _ctx; }
function unlockAudio() {
  if (_unlocked) return;
  try {
    const SILENT = 'data:audio/mpeg;base64,SUQzBAAAAAAAI1RTU0UAAAAPAAADTGF2ZjU4LjI5LjEwMAAAAAAAAAAAAAAA/+M4wAAAAAAAAAAAAFhpbmcAAAAPAAAAAwAAA7AAqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq1tbW1tbW1tbW1tbW1tbW1tbW1tbW1tbW1tb////////////////////////////////////////////////////////////////AAAA8ExBTUUzLjk5LjVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVU=';
    const a = new Audio(SILENT); a.volume = 0.001; const p = a.play(); if (p && p.then) p.then(()=>{}).catch(()=>{});
  } catch (e) {}
  const ctx = getCtx();
  const buf = ctx.createBuffer(1,1,22050), src = ctx.createBufferSource();
  src.buffer = buf; src.connect(ctx.destination); src.start(0);
  ctx.resume().then(() => { _unlocked = true; });
}
function pluck(ctx, freq, when, vol=0.16) {
  [[1,1.0],[2,0.45],[3,0.22],[4,0.09],[6,0.04]].forEach(([h,a]) => {
    const osc = ctx.createOscillator(), g = ctx.createGain(), filt = ctx.createBiquadFilter();
    osc.type='sine'; osc.frequency.value=freq*h; filt.type='lowpass'; filt.frequency.value=Math.min(3200,freq*h*3);
    g.gain.setValueAtTime(0,when); g.gain.linearRampToValueAtTime(vol*a,when+0.005); g.gain.exponentialRampToValueAtTime(0.0001,when+(h===1?1.6:0.9));
    osc.connect(filt); filt.connect(g); g.connect(ctx.destination); osc.start(when); osc.stop(when+2);
  });
}
function playMidis(midis, gap=0.12) {
  unlockAudio();
  const ctx = getCtx(), now = ctx.currentTime + 0.05;
  midis.forEach((m, i) => pluck(ctx, midiToHz(m), now + i * gap));
}

// ── Persistent storage (guarded; falls back to sandbox) ──────────────────
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
function Fretboard({ cells, root, labelMode, resolve, sc=1 }) {
  if (!cells.length) return null;
  const fs = cells.map(c => c.f);
  let lo = Math.max(0, Math.min(...fs) - 1), hi = Math.max(...fs) + 1;
  const FW=36, RH=27, padL=22, padT=14, padB=20, padR=10, nf=hi-lo+1;
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
    <svg viewBox={`0 0 ${W} ${H}`} width={W*sc} height={H*sc} style={{ display:'block', margin:'0 auto', maxWidth:'100%', height:'auto', userSelect:'none', WebkitUserSelect:'none' }}>
      {Array.from({length:6},(_,r)=><line key={'s'+r} x1={padL} y1={ry(r)} x2={padL+nf*FW} y2={ry(r)} stroke="#2a2840" strokeWidth={1.4}/>)}
      {Array.from({length:nf+1},(_,j)=>{const f=lo+j;const nut=f===0;return <line key={'f'+j} x1={fxl(f)} y1={ry(0)} x2={fxl(f)} y2={ry(5)} stroke={nut?'#cccccc':'#2a2840'} strokeWidth={nut?3:1.4}/>;})}
      {[3,5,7,9,12,15].filter(f=>f>=lo&&f<=hi).map(f=><circle key={'m'+f} cx={fx(f)} cy={ry(2)+RH/2} r={2.6} fill="#2a2840"/>)}
      {STR_LABELS.map((s,r)=><text key={'l'+r} x={6} y={ry(5-r)+3.5} fontSize={10} fill="#777" fontFamily="monospace">{s}</text>)}
      {Array.from({length:nf},(_,j)=>{const f=lo+j;if(f===0)return null;return <text key={'n'+j} x={fx(f)} y={H-6} fontSize={9} fill="#666" textAnchor="middle" fontFamily="monospace">{f}</text>;})}
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
      {cells.map((c,i)=>{const col=DC[c.deg]||'#888',cx=fx(c.f),cy=ry(5-c.s),L=lbl(c);return (
        <g key={i}>
          <circle cx={cx} cy={cy} r={11} fill={col} stroke={isRoot(c)?'#fff':'none'} strokeWidth={isRoot(c)?2:0}/>
          <text x={cx} y={cy+0.5} fontSize={L.length>2?7:9} fill={txtOn(col)} textAnchor="middle" dominantBaseline="central" fontWeight="bold">{L}</text>
        </g>);})}
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
const DEG_AVAIL = { maj:['R','3','5','Δ7','9','13'], min:['R','b3','5','Δ7','9'] };
const dirLabel = d => d===0 ? 'common tone' : Math.abs(d)===1 ? (d<0?'down ½':'up ½') : (d<0?'down whole':'up whole');
function PositionsTab({ root, labelMode, settings }) {
  const init = settings || {};
  const [system, setSystem] = useState(init.defSystem || 'caged');   // 'caged' | 'tnps'
  const [idx, setIdx] = useState(0);
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
  const i = Math.min(idx, positions.length - 1);
  const cur = positions[i];
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
    }
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
        <button onClick={()=>{setSystem('caged');setIdx(0);}} style={segBtn(system==='caged')}>5 Positions</button>
        <button onClick={()=>{setSystem('tnps');setIdx(0);}} style={segBtn(system==='tnps')}>3 notes/string</button>
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
          {!fullNeck && <span style={{ color:'#888', fontWeight:600, fontSize:11 }}> · frets {cur.lo}–{cur.hi}{cur.start?` · starts on ${cur.start}`:''}</span>}
        </div>
        <button onClick={()=>setFullNeck(f=>!f)} style={{ background:fullNeck?'#74b9ff':'transparent', color:fullNeck?'#111':'#74b9ff', border:'1px solid #74b9ff55', borderRadius:7, padding:'6px 11px', fontSize:11, fontWeight:700, cursor:'pointer', minHeight:34, touchAction:'manipulation' }}>{fullNeck?'◧ Full neck':'◫ Full neck'}</button>
      </div>

      <div style={{ background:'#13121f', border:'1px solid #1a1928', borderRadius:12, padding:'10px 8px', overflowX:'auto', WebkitOverflowScrolling:'touch' }}>
        <Fretboard cells={cells} root={root} labelMode={labelMode} resolve={tgt} sc={1.15} />
      </div>

      {!fullNeck && (
        <div style={{ display:'flex', alignItems:'center', justifyContent:'center', gap:12, marginTop:10 }}>
          <button onClick={()=>setIdx((i - 1 + positions.length) % positions.length)} style={navBtn}>‹</button>
          <div style={{ fontSize:12, color:'#888', minWidth:64, textAlign:'center' }}>{i+1} / {positions.length}</div>
          <button onClick={()=>setIdx((i + 1) % positions.length)} style={navBtn}>›</button>
        </div>
      )}

      <div style={{ display:'flex', justifyContent:'center', marginTop:12 }}>
        <PlayBtn onClick={playPos} label="▶ Play this shape" />
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
function SettingsTab({ settings, onChange }) {
  const set = patch => onChange({ ...settings, ...patch });
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
          {['R','3','5','Δ7','9','13'].map(d => <button key={d} onClick={()=>toggleNote(d)} style={chip(settings.defNotes.includes(d))}>{d}</button>)}
        </div>
        <div style={{ fontSize:11, color:'#777', marginTop:8, lineHeight:1.5 }}>Over a minor target, the 3 shows as ♭3 automatically. 13 applies to major only.</div>
      </div>

      <div style={card}>
        <div style={h}>Notifications</div>
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

// ════════════════════════════════════════════════════════════════════════
//  APP
// ════════════════════════════════════════════════════════════════════════
export default function App() {
  const [root, setRoot] = useState(7);          // G7alt default
  const [labelMode, setLabelMode] = useState('degrees');
  const [tab, setTab] = useState('positions');
  const [keyMode, setKeyMode] = useState('dom'); // 'dom' (V7alt root) | 'tonic' (resolution key)
  const [settings, setSettings] = useState({ defSystem:'caged', defKind:'maj', defNotes:['R','3'], defKeyMode:'dom' });
  const scrollRef = useRef(null);

  // load prefs
  useEffect(() => { (async () => {
    try { const r = await store.get('at_root'); if (r) setRoot(parseInt(r.value,10)); } catch(e){}
    try { const l = await store.get('at_label'); if (l) setLabelMode(l.value); } catch(e){}
    try { const s = await store.get('at_settings'); if (s) setSettings(prev => ({ ...prev, ...JSON.parse(s.value) })); } catch(e){}
  })(); }, []);
  useEffect(() => { store.set('at_root', String(root)); }, [root]);
  useEffect(() => { store.set('at_label', labelMode); }, [labelMode]);
  useEffect(() => { store.set('at_settings', JSON.stringify(settings)); }, [settings]);
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
    setMeta('apple-mobile-web-app-title','AlteredTrainer');
    const manifest = { name:'AlteredTrainer', short_name:'Altered', description:'Learn the altered scale for jazz V7alt chords — shapes and resolutions.', start_url:'.', display:'standalone', orientation:'portrait', background_color:'#0f0e17', theme_color:'#0f0e17', icons:[{src:i180,sizes:'180x180',type:'image/png'},{src:i512,sizes:'512x512',type:'image/png'}] };
    const blob = new Blob([JSON.stringify(manifest)],{type:'application/json'}); const murl = URL.createObjectURL(blob);
    let mlink = document.querySelector('link[rel="manifest"]'); if(!mlink){mlink=document.createElement('link');mlink.rel='manifest';document.head.appendChild(mlink);} mlink.href = murl;

    window.scrollTo(0,0);
    const lock = () => { if (window.scrollY !== 0 || window.scrollX !== 0) window.scrollTo(0,0); };
    window.addEventListener('scroll', lock, { passive:true });
    return () => { document.head.removeChild(style); window.removeEventListener('scroll', lock); URL.revokeObjectURL(murl); };
  }, []);

  const TABS = [{id:'explorer',label:'Explorer',icon:'🧭'},{id:'positions',label:'Positions',icon:'🎸'},{id:'settings',label:'Settings',icon:'⚙️'}];

  return (
    <div style={{ background:'#08080d', height:'100dvh', display:'flex', justifyContent:'center' }}>
    <div style={{ background:'#0f0e17', height:'100dvh', width:'100%', maxWidth:430, boxSizing:'border-box', borderLeft:'1px solid #1a1928', borderRight:'1px solid #1a1928', display:'flex', flexDirection:'column', color:'#fffffe', fontFamily:"'Segoe UI',system-ui,sans-serif", WebkitFontSmoothing:'antialiased', paddingTop:'env(safe-area-inset-top)' }}>
      {/* header */}
      <div style={{ padding:'10px 12px', borderBottom:'1px solid #1a1928', display:'flex', alignItems:'center', gap:8 }}>
        <div style={{ display:'flex', flexDirection:'column' }}>
          <div style={{ fontSize:16, fontWeight:900, lineHeight:1.1 }}>🎸 <span style={{ color:'#e17055' }}>Altered</span>Trainer</div>
          <div style={{ fontSize:9, color:'#555', letterSpacing:'1px', paddingLeft:22 }}>jazz guitar toolbox</div>
        </div>
        <div style={{ marginLeft:'auto' }}>
          <button onClick={()=>setLabelMode(m=>m==='degrees'?'notes':'degrees')}
            style={{ padding:'7px 12px', borderRadius:9, cursor:'pointer', fontSize:11, fontWeight:700, border:`2px solid ${labelMode==='degrees'?'#ffd93d':'#555'}`, background:labelMode==='degrees'?'#ffd93d':'transparent', color:labelMode==='degrees'?'#111':'#bbb', minHeight:36, whiteSpace:'nowrap', touchAction:'manipulation' }}>
            {labelMode==='degrees'?'✦ Degrees':'Note names'}
          </button>
        </div>
      </div>

      {/* key selector: V7alt root <-> resolution key, kept in sync */}
      <div style={{ padding:'8px 10px', borderBottom:'1px solid #1a1928' }}>
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

      {/* tabs */}
      <div style={{ display:'flex', borderBottom:'1px solid #1a1928' }}>
        {TABS.map(t=>(
          <button key={t.id} onClick={()=>{setTab(t.id); if(scrollRef.current)scrollRef.current.scrollTop=0;}}
            style={{ flex:1, padding:'11px 6px', background:'transparent', border:'none', cursor:'pointer', fontSize:11, fontWeight:700, color:tab===t.id?'#e17055':'#888', borderBottom:tab===t.id?'2px solid #e17055':'2px solid transparent', minHeight:44, touchAction:'manipulation' }}>{t.icon} {t.label}</button>
        ))}
      </div>

      {/* content */}
      <div ref={scrollRef} style={{ flex:1, overflowY:'auto', WebkitOverflowScrolling:'touch', overscrollBehaviorY:'none' }}>
        <div style={{ paddingBottom:'max(80px,env(safe-area-inset-bottom))' }}>
          {tab==='explorer' && <ExplorerTab root={root} labelMode={labelMode} />}
          {tab==='positions' && <PositionsTab root={root} labelMode={labelMode} settings={settings} />}
          {tab==='settings' && <SettingsTab settings={settings} onChange={setSettings} />}
        </div>
      </div>

      <BannerStack />
    </div>
    </div>
  );
}
