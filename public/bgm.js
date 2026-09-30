/* ==========================================================
   BGM —— Web Audio API 实时合成的爵士氛围乐
   设计目标：连续不断、响度适中、久听不腻、零文件零依赖

   为什么用合成而不是 mp3：
     · 零文件体积（不占仓库、不占带宽）
     · 永远不会因为外链失效/被墙而静音
     · 完全原创，无版权问题

   关键设计（相比初版的修正）：
     · 【无缝调度】用 look-ahead 调度器，提前 1.5 秒排好下一小节，
       绝不留空档（初版 4.6 秒排一次，中间有 63% 时间是静音）
     · 【连续铺底】每小节的和弦音持续整小节，形成连绵的 pad，
       而不是"叮"一下就消失
     · 【响度提升】整体增益提高约 4 倍，达到可听清的舒适音量
     · 【柔和音色】三角波 + 低通滤波 + 慢起音，像电钢琴，不刺耳
   ========================================================== */
'use strict';

const BGM = (() => {
  let ctx = null;
  let masterGain = null;
  let playing = false;
  let timer = null;

  // 音量（0~1），持久化；默认 0.5（比初版 0.35 更大）
  let volume = parseFloat(localStorage.getItem('poker_bgm_vol') || '0.5');
  if (!(volume >= 0 && volume <= 1)) volume = 0.5;

  /* ---------- 音乐素材 ---------- */

  // 和弦进行：舒缓的 ii-V-I + 小调色彩（单位：MIDI 音高）
  const PROGRESSION = [
    { root: 50, notes: [50, 53, 57, 60] },   // Dm7  : D F A C
    { root: 55, notes: [55, 59, 62, 65] },   // G7   : G B D F
    { root: 48, notes: [48, 52, 55, 59] },   // Cmaj7: C E G B
    { root: 45, notes: [45, 48, 52, 55] },   // Am7  : A C E G
    { root: 50, notes: [50, 53, 57, 60] },   // Dm7
    { root: 55, notes: [55, 59, 62, 65] },   // G7
    { root: 52, notes: [52, 55, 59, 62] },   // Em7  : E G B D
    { root: 45, notes: [45, 49, 52, 55] },   // A7   : A C# E G
  ];

  const BEAT = 1.25;          // 每拍秒数（慢速，约 48 BPM）
  const BAR_BEATS = 4;        // 每小节 4 拍
  const BAR_SEC = BEAT * BAR_BEATS;   // 每小节 5 秒
  const LOOK_AHEAD = 2.0;     // 提前 2 秒调度（避免 setTimeout 抖动造成断音）

  let chordIndex = 0;
  let nextBarTime = 0;

  /** MIDI 音高 -> 频率 */
  const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);

  /* ---------- 音色 ---------- */

  /**
   * 一个柔和的持续音（用于铺底 pad）
   * 慢起音 + 长保持 + 长释放，营造连绵不断的氛围
   */
  function padVoice(midi, when, dur, level) {
    const osc = ctx.createOscillator();
    const osc2 = ctx.createOscillator();   // 轻微失谐，声音更厚
    const g = ctx.createGain();
    const filt = ctx.createBiquadFilter();

    osc.type = 'triangle';
    osc.frequency.value = mtof(midi);
    osc2.type = 'sine';
    osc2.frequency.value = mtof(midi) * 1.004;   // 微失谐

    filt.type = 'lowpass';
    filt.frequency.setValueAtTime(1800, when);
    filt.frequency.linearRampToValueAtTime(1000, when + dur);
    filt.Q.value = 0.6;

    const atk = Math.min(0.9, dur * 0.28);   // 慢起音
    const rel = Math.min(1.4, dur * 0.35);   // 长释放
    g.gain.setValueAtTime(0.0001, when);
    g.gain.linearRampToValueAtTime(level, when + atk);
    g.gain.setValueAtTime(level, when + dur - rel);
    g.gain.linearRampToValueAtTime(0.0001, when + dur);

    osc.connect(filt);
    osc2.connect(filt);
    filt.connect(g);
    g.connect(masterGain);

    osc.start(when);  osc.stop(when + dur + 0.1);
    osc2.start(when); osc2.stop(when + dur + 0.1);
  }

  /** 一个清脆的点缀音（像钢琴单音，用于旋律） */
  function pluckVoice(midi, when, dur, level) {
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    const filt = ctx.createBiquadFilter();
    osc.type = 'triangle';
    osc.frequency.value = mtof(midi);
    filt.type = 'lowpass';
    filt.frequency.setValueAtTime(2600, when);
    filt.frequency.exponentialRampToValueAtTime(900, when + dur);
    g.gain.setValueAtTime(0.0001, when);
    g.gain.exponentialRampToValueAtTime(level, when + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, when + dur);
    osc.connect(filt); filt.connect(g); g.connect(masterGain);
    osc.start(when); osc.stop(when + dur + 0.05);
  }

  /** 低音（贝斯） */
  function bassVoice(midi, when, dur, level) {
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    const filt = ctx.createBiquadFilter();
    osc.type = 'sine';
    osc.frequency.value = mtof(midi);
    filt.type = 'lowpass'; filt.frequency.value = 400;
    g.gain.setValueAtTime(0.0001, when);
    g.gain.linearRampToValueAtTime(level, when + 0.15);
    g.gain.setValueAtTime(level, when + dur - 0.5);
    g.gain.linearRampToValueAtTime(0.0001, when + dur);
    osc.connect(filt); filt.connect(g); g.connect(masterGain);
    osc.start(when); osc.stop(when + dur + 0.1);
  }

  /** 极轻的踩镲（提供节奏感，不抢戏） */
  function hatVoice(when, level) {
    const dur = 0.06;
    const buf = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * dur), ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) {
      d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / d.length, 2.5);
    }
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass'; hp.frequency.value = 6500;
    const g = ctx.createGain();
    g.gain.value = level;
    src.connect(hp); hp.connect(g); g.connect(masterGain);
    src.start(when);
  }

  /* ---------- 调度 ---------- */

  /**
   * 排一小节（现在的核心：铺底贯穿整小节，保证连续不断）
   */
  function scheduleBar(chord, when) {
    const dur = BAR_SEC;

    // 1) 贝斯：根音，撑满整小节（音量适中，提供厚度）
    bassVoice(chord.root - 24, when, dur, 0.30);

    // 2) 铺底 pad：和弦音持续整小节（这是"不断音"的关键）
    chord.notes.forEach((n) => {
      padVoice(n, when + 0.02, dur - 0.1, 0.16);
    });

    // 3) 轮廓：每拍一个轻柔的点缀音（琶音感）
    for (let b = 0; b < BAR_BEATS; b++) {
      if (Math.random() < 0.75) {
        const n = chord.notes[Math.floor(Math.random() * chord.notes.length)];
        const oct = Math.random() < 0.3 ? 12 : 0;   // 偶尔高八度
        pluckVoice(n + oct, when + b * BEAT + 0.02, BEAT * 0.85, 0.13);
      }
    }

    // 4) 高音点缀：随机撒几颗亮音（爵士的"星光"感）
    const sparks = 1 + Math.floor(Math.random() * 3);
    for (let i = 0; i < sparks; i++) {
      const n = chord.notes[Math.floor(Math.random() * chord.notes.length)] + 12;
      const t = when + Math.random() * dur * 0.9;
      pluckVoice(n, t, 0.9, 0.07);
    }

    // 5) 踩镲：2、4 拍（提供轻微摇摆感）
    hatVoice(when + BEAT, 0.05);
    hatVoice(when + BEAT * 3, 0.05);
  }

  /**
   * look-ahead 调度循环：
   * 每次检查是否需要排新小节，提前 LOOK_AHEAD 秒排好，
   * 用较短的检查间隔（200ms）保证永不落空
   */
  function tick() {
    if (!playing || !ctx) return;

    const now = ctx.currentTime;
    // 只要下一小节的开始时间在"未来 2 秒内"，就排它
    while (nextBarTime < now + LOOK_AHEAD) {
      const chord = PROGRESSION[chordIndex % PROGRESSION.length];
      chordIndex++;
      // 第一次调度时，把起点放在当前时间稍后，避免排到过去
      if (nextBarTime < now) nextBarTime = now + 0.15;
      scheduleBar(chord, nextBarTime);
      nextBarTime += BAR_SEC;
    }

    timer = setTimeout(tick, 200);
  }

  /* ---------- 开关 ---------- */

  function ensureCtx() {
    if (ctx) return true;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return false;
    ctx = new AC();
    masterGain = ctx.createGain();
    // 主增益：把整体响度提到可听清的水平
    // （初版合成后只有 -31 dBFS 左右，几乎听不见）
    masterGain.gain.value = 0;
    // 加一个软限幅，防止和弦叠加时爆音
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -18;
    comp.knee.value = 12;
    comp.ratio.value = 4;
    comp.attack.value = 0.006;
    comp.release.value = 0.25;
    masterGain.connect(comp);
    comp.connect(ctx.destination);
    return true;
  }

  function start() {
    if (playing) return false;
    try {
      if (!ensureCtx()) return false;
      if (ctx.state === 'suspended') ctx.resume();
      playing = true;
      chordIndex = 0;
      nextBarTime = ctx.currentTime + 0.15;

      // 淡入（3 秒，避免突然响起）
      const t = ctx.currentTime;
      masterGain.gain.cancelScheduledValues(t);
      masterGain.gain.setValueAtTime(0.0001, t);
      masterGain.gain.linearRampToValueAtTime(effectiveGain(), t + 3.0);

      tick();
      return true;
    } catch (e) {
      playing = false;
      return false;
    }
  }

  function stop() {
    if (!playing) return false;
    playing = false;
    if (timer) { clearTimeout(timer); timer = null; }
    if (ctx && masterGain) {
      try {
        const t = ctx.currentTime;
        masterGain.gain.cancelScheduledValues(t);
        masterGain.gain.setValueAtTime(masterGain.gain.value, t);
        masterGain.gain.linearRampToValueAtTime(0.0001, t + 0.6);
      } catch (e) { /* 忽略 */ }
    }
    return false;
  }

  function toggle() { return playing ? stop() : start(); }

  /** 用户音量 -> 实际增益（保留足够响度，最高约 0.9） */
  function effectiveGain() {
    return Math.max(0.0001, Math.min(0.95, volume * 1.5));
  }

  function setVolume(v) {
    volume = Math.max(0, Math.min(1, Number(v) || 0));
    localStorage.setItem('poker_bgm_vol', String(volume));
    if (playing && ctx && masterGain) {
      try {
        const t = ctx.currentTime;
        masterGain.gain.cancelScheduledValues(t);
        masterGain.gain.setValueAtTime(masterGain.gain.value, t);
        masterGain.gain.linearRampToValueAtTime(effectiveGain(), t + 0.3);
      } catch (e) { /* 忽略 */ }
    }
    return volume;
  }

  const getVolume = () => volume;
  const isPlaying = () => playing;

  /** 兼容：暴露给调试 */
  const _debug = () => ({
    playing, ctxState: ctx && ctx.state,
    gain: masterGain && masterGain.gain.value, volume,
  });

  return { start, stop, toggle, setVolume, getVolume, isPlaying, _debug };
})();
