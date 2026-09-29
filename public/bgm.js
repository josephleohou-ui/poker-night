/* ==========================================================
   BGM —— 用 Web Audio API 实时合成氛围爵士乐
   为什么用合成而不是加载 mp3：
     · 零文件体积（不占仓库、不占带宽）
     · 永远不会因为外链失效/被墙而静音
     · 完全原创，无版权问题
   风格：慢速爵士和弦进行 + 柔和低音 + 轻swing节奏，适合牌桌
   ========================================================== */
'use strict';

const BGM = (() => {
  let ctx = null;
  let masterGain = null;
  let playing = false;
  let timer = null;

  // 音量（0~1），持久化
  let volume = parseFloat(localStorage.getItem('poker_bgm_vol') || '0.35');
  if (!(volume >= 0 && volume <= 1)) volume = 0.35;

  // 爵士和弦进行（ii-V-I 变体 + 小调色彩），用半音表示
  // 每个和弦: [根音, 三音, 五音, 七音]
  const PROGRESSION = [
    { name: 'Dm7',  notes: [50, 53, 57, 60] },  // D F A C
    { name: 'G7',   notes: [55, 59, 62, 65] },  // G B D F
    { name: 'Cmaj7',notes: [48, 52, 55, 59] },  // C E G B
    { name: 'Am7',  notes: [45, 48, 52, 55] },  // A C E G
    { name: 'Dm7',  notes: [50, 53, 57, 60] },
    { name: 'G7',   notes: [55, 59, 62, 65] },
    { name: 'Em7',  notes: [52, 55, 59, 62] },  // E G B D
    { name: 'A7',   notes: [45, 49, 52, 55] },  // A C# E G
  ];

  let chordIndex = 0;

  /** MIDI 音高 -> 频率 */
  function mtof(m) { return 440 * Math.pow(2, (m - 69) / 12); }

  /** 建一个柔和音色（三角波 + 低通，像电钢琴） */
  function makeVoice(midi, when, dur, gainVal = 0.12, type = 'triangle') {
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    const filt = ctx.createBiquadFilter();

    osc.type = type;
    osc.frequency.value = mtof(midi);

    filt.type = 'lowpass';
    filt.frequency.setValueAtTime(1400, when);
    filt.frequency.exponentialRampToValueAtTime(600, when + dur);
    filt.Q.value = 0.7;

    // 柔和起音 + 自然衰减
    g.gain.setValueAtTime(0.0001, when);
    g.gain.exponentialRampToValueAtTime(gainVal, when + 0.06);
    g.gain.exponentialRampToValueAtTime(0.0001, when + dur);

    osc.connect(filt);
    filt.connect(g);
    g.connect(masterGain);

    osc.start(when);
    osc.stop(when + dur + 0.05);
  }

  /** 弹一个和弦（琶音 + 同时按下的柔和铺底） */
  function playChord(notes, when, beat) {
    // 铺底：低音 + 和弦音，轻一点
    const root = notes[0] - 12;
    makeVoice(root, when, beat * 1.9, 0.10, 'sine');

    // 琶音：和弦音依次轻轻落下（爵士的感觉）
    notes.forEach((n, i) => {
      makeVoice(n, when + i * 0.055, beat * 1.6, 0.055 + Math.random() * 0.02, 'triangle');
    });

    // 偶尔来个高音点缀
    if (Math.random() < 0.45) {
      const spark = notes[Math.floor(Math.random() * notes.length)] + 12;
      makeVoice(spark, when + beat * (0.5 + Math.random() * 0.4), beat * 0.7, 0.035, 'sine');
    }
  }

  /** 轻 swing 鼓点：底鼓 + 踩镲 */
  function playPulse(when, beat) {
    // 踩镲（噪声，短促）
    if (Math.random() < 0.85) {
      const buf = ctx.createBuffer(1, ctx.sampleRate * 0.05, ctx.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < d.length; i++) {
        d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / d.length, 3);
      }
      const src = ctx.createBufferSource();
      src.buffer = buf;
      const hp = ctx.createBiquadFilter();
      hp.type = 'highpass';
      hp.frequency.value = 7000;
      const hg = ctx.createGain();
      hg.gain.value = 0.05;
      src.connect(hp); hp.connect(hg); hg.connect(masterGain);
      src.start(when);
    }
    // 底鼓（偶尔）
    if (Math.random() < 0.5) {
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(110, when);
      osc.frequency.exponentialRampToValueAtTime(45, when + 0.12);
      g.gain.setValueAtTime(0.09, when);
      g.gain.exponentialRampToValueAtTime(0.0001, when + 0.16);
      osc.connect(g); g.connect(masterGain);
      osc.start(when); osc.stop(when + 0.18);
    }
  }

  /** 调度下一小节 */
  function scheduleBar() {
    if (!playing || !ctx) return;
    const beat = 1.15;                       // 每拍时长（慢速）
    const chord = PROGRESSION[chordIndex % PROGRESSION.length];
    chordIndex++;

    const now = ctx.currentTime + 0.12;
    playChord(chord.notes, now, beat);
    // 4 拍，swing 感：第 2、4 拍加上鼓点
    playPulse(now, beat);
    playPulse(now + beat * 2, beat);

    // 一小节 = 4 拍
    const barMs = beat * 4 * 1000;
    timer = setTimeout(scheduleBar, barMs);
  }

  /** 启动 BGM */
  function start() {
    if (playing) return;
    try {
      if (!ctx) {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return;
        ctx = new AC();
        masterGain = ctx.createGain();
        masterGain.gain.value = 0;
        masterGain.connect(ctx.destination);
      }
      if (ctx.state === 'suspended') ctx.resume();
      playing = true;
      chordIndex = 0;

      // 淡入，避免突兀
      const t = ctx.currentTime;
      masterGain.gain.cancelScheduledValues(t);
      masterGain.gain.setValueAtTime(0.0001, t);
      masterGain.gain.exponentialRampToValueAtTime(Math.max(0.001, volume), t + 2.0);

      scheduleBar();
    } catch (e) { playing = false; }
  }

  /** 停止 BGM（淡出） */
  function stop() {
    if (!playing || !ctx) { playing = false; return; }
    playing = false;
    if (timer) { clearTimeout(timer); timer = null; }
    try {
      const t = ctx.currentTime;
      masterGain.gain.cancelScheduledValues(t);
      masterGain.gain.setValueAtTime(masterGain.gain.value, t);
      masterGain.gain.exponentialRampToValueAtTime(0.0001, t + 0.8);
    } catch (e) { /* 忽略 */ }
  }

  function toggle() { playing ? stop() : start(); return playing; }

  function setVolume(v) {
    volume = Math.max(0, Math.min(1, v));
    localStorage.setItem('poker_bgm_vol', String(volume));
    if (playing && ctx && masterGain) {
      try {
        masterGain.gain.cancelScheduledValues(ctx.currentTime);
        masterGain.gain.setValueAtTime(Math.max(0.0001, volume), ctx.currentTime);
      } catch (e) {}
    }
    return volume;
  }

  const getVolume = () => volume;
  const isPlaying = () => playing;

  return { start, stop, toggle, setVolume, getVolume, isPlaying };
})();
