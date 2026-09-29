/* ==========================================================
   背景图库 —— 内置多套护眼配色主题，定时自动切换
   设计原则：
     · 全部用 CSS 渐变 + 程序生成，零图片文件（不占体积、不会失效）
     · 低饱和、低对比，长时间看眼睛不累
     · 每套主题含：桌面绒布色 + 环境光晕 + 卡片色调
   ========================================================== */
'use strict';

const BACKDROPS = (() => {
  /* 每套主题：
     felt   桌面主色（绿绒布系）
     glow1/glow2 环境光晕色
     accent 强调色（按钮/高亮）
     ink    文字色
     card   卡片底色
  */
  const THEMES = [
    {
      key: 'forest',
      name: '深林绒布',
      felt: '#1b3a2f',
      felt2: '#12281f',
      glow1: 'rgba(80,160,120,0.16)',
      glow2: 'rgba(30,80,60,0.22)',
      accent: '#7fc9a0',
      ink: '#e8f0ea',
      card: 'rgba(255,252,244,0.96)',
    },
    {
      key: 'ocean',
      name: '深海静谧',
      felt: '#17313f',
      felt2: '#0e2130',
      glow1: 'rgba(90,160,190,0.15)',
      glow2: 'rgba(25,60,85,0.24)',
      accent: '#84c4dd',
      ink: '#e6f1f6',
      card: 'rgba(250,253,255,0.96)',
    },
    {
      key: 'plum',
      name: '暮色紫檀',
      felt: '#2b2237',
      felt2: '#1d1626',
      glow1: 'rgba(150,110,190,0.15)',
      glow2: 'rgba(60,35,80,0.25)',
      accent: '#b79ae0',
      ink: '#efe8f6',
      card: 'rgba(253,251,255,0.96)',
    },
    {
      key: 'mocha',
      name: '暖棕咖啡',
      felt: '#3a2c24',
      felt2: '#281d18',
      glow1: 'rgba(190,140,95,0.14)',
      glow2: 'rgba(90,55,35,0.24)',
      accent: '#d2a276',
      ink: '#f5ece3',
      card: 'rgba(255,252,248,0.96)',
    },
    {
      key: 'slate',
      name: '青灰雾霭',
      felt: '#26332f',
      felt2: '#182220',
      glow1: 'rgba(120,170,155,0.13)',
      glow2: 'rgba(45,70,62,0.24)',
      accent: '#93c7b4',
      ink: '#e9f0ed',
      card: 'rgba(252,254,253,0.96)',
    },
    {
      key: 'midnight',
      name: '墨蓝夜空',
      felt: '#1c2436',
      felt2: '#121826',
      glow1: 'rgba(110,130,190,0.15)',
      glow2: 'rgba(35,45,80,0.26)',
      accent: '#9aabde',
      ink: '#e8ecf7',
      card: 'rgba(251,252,255,0.96)',
    },
    {
      key: 'sand',
      name: '暖沙米色',
      felt: '#37331f',
      felt2: '#252112',
      glow1: 'rgba(200,180,110,0.15)',
      glow2: 'rgba(90,80,40,0.24)',
      accent: '#cfc07d',
      ink: '#f6f3e6',
      card: 'rgba(255,254,249,0.96)',
    },
    {
      key: 'jade',
      name: '翡翠暗影',
      felt: '#1a3a34',
      felt2: '#102824',
      glow1: 'rgba(85,180,160,0.16)',
      glow2: 'rgba(20,70,60,0.24)',
      accent: '#7fd4bd',
      ink: '#e6f5f1',
      card: 'rgba(250,254,252,0.96)',
    },
  ];

  let idx = parseInt(localStorage.getItem('poker_bg_idx') || '0', 10);
  if (!(idx >= 0 && idx < THEMES.length)) idx = 0;
  let autoTimer = null;
  let autoMinutes = parseFloat(localStorage.getItem('poker_bg_auto') || '3');
  if (!(autoMinutes > 0)) autoMinutes = 3;

  /** 把主题应用到 CSS 变量 */
  function apply(theme) {
    const r = document.documentElement.style;
    r.setProperty('--felt', theme.felt);
    r.setProperty('--felt-2', theme.felt2);
    // 桌面边缘色：把主题主色压暗一档，保证桌面有立体收边
    r.setProperty('--felt-edge', theme.edge || shade(theme.felt2, -0.35));
    // 兼容旧变量名（部分样式仍在用）
    r.setProperty('--felt-1', theme.felt);
    r.setProperty('--glow-1', theme.glow1);
    r.setProperty('--glow-2', theme.glow2);
    r.setProperty('--accent', theme.accent);
    r.setProperty('--ink', theme.ink);
    r.setProperty('--card', theme.card);
    r.setProperty('--gold', theme.gold || theme.accent);
    r.setProperty('--bg-name', `"${theme.name}"`);
    document.body.dataset.theme = theme.key;
    localStorage.setItem('poker_bg_idx', String(idx));
  }

  /** 把 #rrggbb 按比例调亮/调暗 */
  function shade(hex, amt) {
    try {
      const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
      if (!m) return hex;
      const f = (v) => {
        const n = Math.round(parseInt(v, 16) * (1 + amt));
        return Math.max(0, Math.min(255, n)).toString(16).padStart(2, '0');
      };
      return '#' + f(m[1]) + f(m[2]) + f(m[3]);
    } catch (e) { return hex; }
  }

  function current() { return THEMES[idx]; }

  /** 切到下一套（带淡入过渡） */
  function next(animate = true) {
    idx = (idx + 1) % THEMES.length;
    if (animate) {
      document.body.classList.add('bg-fading');
      setTimeout(() => {
        apply(THEMES[idx]);
        document.body.classList.remove('bg-fading');
      }, 420);
    } else {
      apply(THEMES[idx]);
    }
    return THEMES[idx];
  }

  function prev() {
    idx = (idx - 1 + THEMES.length) % THEMES.length;
    document.body.classList.add('bg-fading');
    setTimeout(() => {
      apply(THEMES[idx]);
      document.body.classList.remove('bg-fading');
    }, 420);
    return THEMES[idx];
  }

  function goTo(i) {
    if (i >= 0 && i < THEMES.length) { idx = i; apply(THEMES[idx]); }
    return THEMES[idx];
  }

  /** 自动切换 */
  function startAuto(minutes) {
    stopAuto();
    if (minutes) { autoMinutes = minutes; localStorage.setItem('poker_bg_auto', String(minutes)); }
    autoTimer = setInterval(() => next(true), autoMinutes * 60 * 1000);
  }
  function stopAuto() {
    if (autoTimer) { clearInterval(autoTimer); autoTimer = null; }
  }
  function setAutoMinutes(m) {
    autoMinutes = m;
    localStorage.setItem('poker_bg_auto', String(m));
    if (m > 0) startAuto(m); else stopAuto();
  }
  const getAutoMinutes = () => autoMinutes;

  /** 初始化 */
  function init() {
    apply(THEMES[idx]);
    if (autoMinutes > 0) startAuto();
  }

  return {
    THEMES, init, next, prev, goTo, current,
    startAuto, stopAuto, setAutoMinutes, getAutoMinutes,
  };
})();
