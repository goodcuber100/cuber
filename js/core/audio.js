// Procedural sound: everything is synthesised with WebAudio, no audio files.
// Also wraps speechSynthesis for the classic MTA announcements.
window.SC = window.SC || {};
(function (SC) {
  'use strict';
  const U = SC.util;
  const A = { enabled: true, voice: true, ctx: null, master: null };
  const settings = U.load('standclear.audio', { enabled: true, voice: true, volume: 0.7 });
  A.enabled = settings.enabled; A.voice = settings.voice; A.volume = settings.volume;
  A.saveSettings = () => U.save('standclear.audio', { enabled: A.enabled, voice: A.voice, volume: A.volume });

  A.unlock = () => {
    if (A.ctx) { if (A.ctx.state === 'suspended') A.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return;
    try {
      A.ctx = new AC();
      A.master = A.ctx.createGain(); A.master.gain.value = A.enabled ? A.volume : 0; A.master.connect(A.ctx.destination);
      const len = A.ctx.sampleRate * 2; const buf = A.ctx.createBuffer(1, len, A.ctx.sampleRate); const d = buf.getChannelData(0);
      let b = 0; for (let i = 0; i < len; i++) { const w = Math.random() * 2 - 1; b = (b + 0.02 * w) / 1.02; d[i] = b * 3.5; } // brown-ish noise
      A.noiseBuf = buf;
      const wbuf = A.ctx.createBuffer(1, len, A.ctx.sampleRate); const wd = wbuf.getChannelData(0); for (let i = 0; i < len; i++) wd[i] = Math.random() * 2 - 1; A.whiteBuf = wbuf;
    } catch (e) { A.ctx = null; }
  };
  ['pointerdown', 'keydown', 'touchstart'].forEach(ev => window.addEventListener(ev, A.unlock, { passive: true }));

  A.setEnabled = (on) => { A.enabled = on; if (A.master) A.master.gain.setTargetAtTime(on ? A.volume : 0, A.ctx.currentTime, 0.05); if (!on) A.stopLoops(); A.saveSettings(); };
  A.setVoice = (on) => { A.voice = on; if (!on && window.speechSynthesis) speechSynthesis.cancel(); A.saveSettings(); };
  const ok = () => A.ctx && A.enabled;

  function tone(freq, dur, { type = 'sine', vol = 0.3, attack = 0.005, release = null, delay = 0, slideTo = null, filter = null } = {}) {
    if (!ok()) return;
    const t0 = A.ctx.currentTime + delay; const o = A.ctx.createOscillator(); const g = A.ctx.createGain();
    o.type = type; o.frequency.setValueAtTime(freq, t0); if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t0 + dur);
    g.gain.setValueAtTime(0, t0); g.gain.linearRampToValueAtTime(vol, t0 + attack); g.gain.exponentialRampToValueAtTime(0.0001, t0 + (release || dur));
    let node = o; if (filter) { const f = A.ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = filter; o.connect(f); node = f; }
    node.connect(g); g.connect(A.master); o.start(t0); o.stop(t0 + (release || dur) + 0.05);
  }
  function noise(dur, { vol = 0.2, freq = 1200, q = 1, type = 'bandpass', delay = 0, white = false } = {}) {
    if (!ok()) return;
    const t0 = A.ctx.currentTime + delay; const s = A.ctx.createBufferSource(); s.buffer = white ? A.whiteBuf : A.noiseBuf;
    const f = A.ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
    const g = A.ctx.createGain(); g.gain.setValueAtTime(vol, t0); g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    s.connect(f); f.connect(g); g.connect(A.master); s.start(t0, Math.random()); s.stop(t0 + dur + 0.05);
  }

  // --- one-shots ---
  A.click = () => tone(900, 0.05, { type: 'square', vol: 0.06 });
  A.pop = () => tone(520, 0.12, { type: 'sine', vol: 0.2, slideTo: 980 });
  A.tap = () => { tone(1320, 0.07, { type: 'square', vol: 0.05 }); tone(1760, 0.09, { type: 'square', vol: 0.04, delay: 0.07 }); };
  A.coin = () => { tone(1568, 0.08, { type: 'triangle', vol: 0.15 }); tone(2093, 0.25, { type: 'triangle', vol: 0.15, delay: 0.07 }); };
  A.cash = () => { noise(0.08, { vol: 0.2, freq: 3000, white: true }); [1319, 1568, 2093].forEach((f, i) => tone(f, 0.18, { type: 'triangle', vol: 0.12, delay: 0.05 + i * 0.06 })); };
  A.success = () => [523, 659, 784, 1047].forEach((f, i) => tone(f, 0.25, { type: 'triangle', vol: 0.14, delay: i * 0.08 }));
  A.fail = () => { tone(330, 0.3, { type: 'sawtooth', vol: 0.12, filter: 1200 }); tone(247, 0.45, { type: 'sawtooth', vol: 0.12, delay: 0.22, filter: 1000 }); };
  A.stinger = () => { [392, 523, 659].forEach((f, i) => tone(f, 0.35, { type: 'square', vol: 0.06, delay: i * 0.05, filter: 2400 })); tone(196, 0.5, { type: 'triangle', vol: 0.2 }); };
  A.alarm = () => { for (let i = 0; i < 3; i++) { tone(880, 0.18, { type: 'square', vol: 0.07, delay: i * 0.36, filter: 3000 }); tone(660, 0.18, { type: 'square', vol: 0.07, delay: i * 0.36 + 0.18, filter: 3000 }); } };
  // The two-tone "bing-bong" door chime.
  A.chime = () => { const p = (f, d) => { tone(f, 1.0, { type: 'sine', vol: 0.22, delay: d }); tone(f * 2, 0.6, { type: 'sine', vol: 0.05, delay: d }); }; p(659.3, 0); p(523.3, 0.42); };
  A.horn = () => { if (!ok()) return; [233, 277, 349].forEach(f => tone(f, 0.75, { type: 'sawtooth', vol: 0.07, attack: 0.03, filter: 1600, release: 0.8 })); };
  A.doors = () => { noise(0.7, { vol: 0.12, freq: 500, q: 0.7 }); tone(110, 0.5, { type: 'sine', vol: 0.06 }); };
  A.thud = () => { tone(90, 0.25, { type: 'sine', vol: 0.35, slideTo: 40 }); noise(0.15, { vol: 0.15, freq: 300 }); };
  A.whoosh = () => noise(1.6, { vol: 0.35, freq: 600, q: 0.4, type: 'lowpass' });
  A.clack = (vol = 0.15) => { noise(0.05, { vol, freq: 2200, q: 2 }); noise(0.05, { vol: vol * 0.8, freq: 1800, q: 2, delay: 0.09 }); };
  A.trip = () => { noise(1.2, { vol: 0.4, freq: 4000, q: 4 }); tone(1800, 1.2, { type: 'sawtooth', vol: 0.05, filter: 5000, slideTo: 900 }); };

  // --- continuous train loops (motor whine, rumble, brake squeal) ---
  let loops = null;
  A.startLoops = () => {
    if (!ok() || loops) return;
    const c = A.ctx; const mk = (type) => { const o = c.createOscillator(); o.type = type; return o; };
    const motor = mk('sawtooth'), motor2 = mk('square'); const mf = c.createBiquadFilter(); mf.type = 'lowpass'; mf.frequency.value = 900; mf.Q.value = 4;
    const mg = c.createGain(); mg.gain.value = 0; motor.connect(mf); motor2.connect(mf); mf.connect(mg); mg.connect(A.master);
    const rs = c.createBufferSource(); rs.buffer = A.noiseBuf; rs.loop = true; const rf = c.createBiquadFilter(); rf.type = 'lowpass'; rf.frequency.value = 300;
    const rg = c.createGain(); rg.gain.value = 0; rs.connect(rf); rf.connect(rg); rg.connect(A.master);
    const sq = mk('sine'), sq2 = mk('sine'); const sg = c.createGain(); sg.gain.value = 0; sq.connect(sg); sq2.connect(sg); sg.connect(A.master);
    sq.frequency.value = 3150; sq2.frequency.value = 4720;
    [motor, motor2, rs, sq, sq2].forEach(n => n.start());
    loops = { motor, motor2, mf, mg, rs, rf, rg, sq, sq2, sg, nodes: [motor, motor2, rs, sq, sq2] };
  };
  A.stopLoops = () => { if (!loops) return; loops.nodes.forEach(n => { try { n.stop(); } catch (e) { /* noop */ } }); loops = null; };
  // speed m/s, power 0..1, brake 0..1, tunnel bool
  const SCALE = [0, 2, 4, 5, 7, 9, 11, 12, 14, 16]; // the famous "do-re-mi" stepping whine on acceleration
  A.updateLoops = (speed, power, brake, tunnel) => {
    if (!loops || !ok()) return; const t = A.ctx.currentTime;
    let f = 80 + speed * 14;
    if (power > 0 && speed < 12) { const step = SCALE[Math.min(SCALE.length - 1, Math.floor(speed / 1.3))]; f = 175 * Math.pow(2, step / 12); }
    loops.motor.frequency.setTargetAtTime(f, t, 0.06); loops.motor2.frequency.setTargetAtTime(f * 1.5, t, 0.06);
    loops.mg.gain.setTargetAtTime(Math.min(0.06, (power * 0.05 + (speed > 0.5 ? 0.012 : 0))), t, 0.1);
    loops.rf.frequency.setTargetAtTime(180 + speed * 25, t, 0.2);
    loops.rg.gain.setTargetAtTime(Math.min(0.55, speed * 0.028 * (tunnel ? 1.5 : 0.9)), t, 0.2);
    const squeal = brake > 0.2 && speed > 0.3 && speed < 6 ? 0.025 * brake : 0;
    loops.sg.gain.setTargetAtTime(squeal, t, 0.08);
  };

  // --- speech ---
  let voice = null;
  const pickVoice = () => { if (!window.speechSynthesis) return; const vs = speechSynthesis.getVoices(); voice = vs.find(v => /en-US/i.test(v.lang) && /male|david|alex|guy|daniel/i.test(v.name)) || vs.find(v => /en-US/i.test(v.lang)) || vs[0] || null; };
  if (window.speechSynthesis) { pickVoice(); speechSynthesis.onvoiceschanged = pickVoice; }
  A.speak = (text, { interrupt = true, rate = 1.02, pitch = 0.9 } = {}) => {
    if (!A.voice || !A.enabled || !window.speechSynthesis) return;
    try {
      if (interrupt) speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(text.replace(/\bSt\b/g, 'Street').replace(/\bAv\b/g, 'Avenue').replace(/\bSq\b/g, 'Square').replace(/\bBlvd\b/g, 'Boulevard').replace(/\bPkwy\b/g, 'Parkway').replace(/\bHts\b/g, 'Heights').replace(/\bJct\b/g, 'Junction').replace(/-/g, ' '));
      if (voice) u.voice = voice; u.rate = rate; u.pitch = pitch; u.volume = A.volume;
      speechSynthesis.speak(u);
    } catch (e) { /* ignore */ }
  };

  SC.audio = A;
})(window.SC);
