(() => {
  'use strict';

  const SETTINGS_KEY = 'pacemaker.settings';
  const RUN_KEY = 'pacemaker.run';
  const HOLD_MS = 1200;
  const TICK_MS = 100;
  const VIB_ROUND = [300, 150, 300];
  const VIB_OVER = [600, 200, 600, 200, 600];

  const $ = (id) => document.getElementById(id);
  const el = {
    setup: $('setup'), run: $('run'),
    hrs: $('hrs'), mins: $('mins'), cnt: $('cnt'),
    perRound: $('perRound'), setupCount: $('setupCount'),
    setupClock: $('setupClock'), setupEnd: $('setupEnd'), startBtn: $('startBtn'),
    pausedBadge: $('pausedBadge'), lockBtn: $('lockBtn'),
    runCount: $('runCount'), roundNum: $('roundNum'), leftNum: $('leftNum'),
    timerLabel: $('timerLabel'), timerText: $('timerText'),
    elapsedText: $('elapsedText'), overallText: $('overallText'),
    overallFill: $('overallFill'), overallPct: $('overallPct'),
    runEnd: $('runEnd'), runClock: $('runClock'),
    prevBtn: $('prevBtn'), nextBtn: $('nextBtn'),
    pauseBtn: $('pauseBtn'), stopBtn: $('stopBtn'),
    lockLayer: $('lockLayer'), unlockBtn: $('unlockBtn'), holdFill: $('holdFill'),
  };

  // ---------- storage ----------
  const store = {
    get(key) {
      try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : null; } catch (e) { return null; }
    },
    set(key, val) {
      try { localStorage.setItem(key, JSON.stringify(val)); } catch (e) { /* ignore */ }
    },
    del(key) {
      try { localStorage.removeItem(key); } catch (e) { /* ignore */ }
    },
  };

  // ---------- state ----------
  const saved = store.get(SETTINGS_KEY) || {};
  const settings = {
    hours: saved.hours != null ? String(saved.hours) : '4',
    minutes: saved.minutes != null ? String(saved.minutes) : '0',
    count: saved.count != null ? String(saved.count) : '120',
  };

  // run: { total(sec), count, accum(ms), since(epoch ms|null), roundSeen, overEnd(epoch ms|null),
  //        doneBase, baseSec }
  // doneBase / baseSec：前へ・次へで個数を動かした時点の「済んだ個数」と経過秒。
  // そこから先は、残り時間を残り個数で割り直したペースで進む。
  let run = null;
  let locked = false;
  let holdAt = null;
  let holdRaf = 0;

  // ---------- helpers ----------
  const num = (v) => { const n = Number(v); return Number.isFinite(n) && n > 0 ? n : 0; };
  const settingsTotal = () => Math.floor(num(settings.hours)) * 3600 + Math.floor(num(settings.minutes)) * 60;
  const settingsCount = () => Math.max(0, Math.floor(num(settings.count)));

  const pad = (n) => (n < 10 ? '0' : '') + n;
  function fmt(sec) {
    sec = Math.max(0, Math.round(sec));
    const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
    return h > 0 ? h + ':' + pad(m) + ':' + pad(s) : m + ':' + pad(s);
  }
  function hhmm(ms) {
    const d = new Date(ms);
    return pad(d.getHours()) + ':' + pad(d.getMinutes());
  }

  function setText(node, text) {
    text = String(text);
    if (node.textContent !== text) node.textContent = text;
  }
  function setClass(node, cls, on) {
    if (node.classList.contains(cls) !== !!on) node.classList.toggle(cls, !!on);
  }
  function setHidden(node, hidden) {
    if (node.hidden !== hidden) node.hidden = hidden;
  }

  function buzz(pattern) {
    try { if (navigator.vibrate) navigator.vibrate(pattern); } catch (e) { /* ignore */ }
  }

  const elapsedSec = (now) => (run.accum + (run.since ? now - run.since : 0)) / 1000;
  const roundSec = () => (run.total - run.baseSec) / (run.count - run.doneBase);
  function roundAt(elSec) {
    return Math.min(run.count, run.doneBase + Math.floor((elSec - run.baseSec) / roundSec()) + 1);
  }

  // ---------- wake lock ----------
  let wakeLock = null;
  let wakePending = false;
  async function acquireWake() {
    if (!('wakeLock' in navigator) || wakeLock || wakePending) return;
    if (document.visibilityState !== 'visible') return;
    wakePending = true;
    try {
      const lock = await navigator.wakeLock.request('screen');
      wakeLock = lock;
      lock.addEventListener('release', () => { if (wakeLock === lock) wakeLock = null; });
      // 取得中に停止された場合はすぐ解除
      if (!isRunning()) releaseWake();
    } catch (e) {
      /* 失敗しても計測は続ける */
    } finally {
      wakePending = false;
    }
  }
  function releaseWake() {
    const lock = wakeLock;
    wakeLock = null;
    if (lock) lock.release().catch(() => {});
  }
  const isRunning = () => !!(run && run.since);

  // ---------- persistence ----------
  function saveSettings() {
    store.set(SETTINGS_KEY, settings);
  }
  function saveRun() {
    if (run) store.set(RUN_KEY, run); else store.del(RUN_KEY);
  }

  // ---------- actions ----------
  function start() {
    const total = settingsTotal();
    const count = settingsCount();
    if (!(total > 0 && count > 0)) return;
    saveSettings();
    run = { total, count, accum: 0, since: Date.now(), roundSeen: 1, overEnd: null, doneBase: 0, baseSec: 0 };
    saveRun();
    showScreen('run');
    acquireWake();
    render();
  }

  function togglePause() {
    if (!run) return;
    const t = Date.now();
    if (run.since) {
      run.accum += t - run.since;
      run.since = null;
      releaseWake();
    } else {
      run.since = t;
      acquireWake();
    }
    saveRun();
    render();
  }

  // 前の1個に戻る(-1)／次の1個に進む(+1)。終了予定は変えず、残り時間を残り個数で割り直す
  function step(dir) {
    if (!run) return;
    const elSec = elapsedSec(Date.now());
    if (elSec >= run.total) return;
    const target = roundAt(elSec) + dir;
    if (target < 1 || target > run.count) return;
    run.doneBase = target - 1;
    run.baseSec = elSec;
    run.roundSeen = target; // 手動で動かしたときは振動させない
    saveRun();
    render();
  }

  function stop() {
    run = null;
    saveRun();
    setLocked(false);
    releaseWake();
    showScreen('setup');
    render();
  }

  function setLocked(on) {
    locked = on;
    holdAt = null;
    cancelAnimationFrame(holdRaf);
    el.holdFill.style.clipPath = 'inset(0 0 0 0)';
    setHidden(el.lockLayer, !on);
  }

  function showScreen(name) {
    setHidden(el.setup, name !== 'setup');
    setHidden(el.run, name !== 'run');
    if (name === 'setup') syncInputs();
  }

  // ---------- render ----------
  function renderSetup(now) {
    const total = settingsTotal();
    const count = settingsCount();
    const ok = total > 0 && count > 0;
    setText(el.perRound, ok ? fmt(total / count) : '--:--');
    setText(el.setupCount, count);
    setText(el.setupClock, hhmm(now));
    setText(el.setupEnd, hhmm(now + total * 1000));
    if (el.startBtn.disabled === ok) el.startBtn.disabled = !ok;
  }

  function renderRun(now) {
    const rs = roundSec();
    const elSec = elapsedSec(now);
    const overSec = elSec - run.total;
    const isOver = overSec >= 0;
    const round = roundAt(elSec);
    const inRound = elSec - run.baseSec - (round - 1 - run.doneBase) * rs;
    const rem = Math.max(0, rs - inRound);

    // ラウンド切り替え・超過突入の検出
    const marker = isOver ? run.count + 1 : round;
    if (marker !== run.roundSeen) {
      buzz(isOver ? VIB_OVER : VIB_ROUND);
      run.roundSeen = marker;
      if (isOver && run.overEnd == null) run.overEnd = Math.round(now - overSec * 1000);
      saveRun();
    }
    if (isOver && run.overEnd == null) { run.overEnd = Math.round(now - overSec * 1000); saveRun(); }

    const paused = !run.since;
    setHidden(el.pausedBadge, !paused);
    setText(el.pauseBtn, paused ? '再開' : '一時停止');

    setText(el.runCount, run.count);
    setText(el.roundNum, isOver ? run.count : round);
    setText(el.leftNum, isOver ? '超過' : Math.max(0, run.count - round));
    setClass(el.leftNum, 'over', isOver);
    setClass(el.leftNum, 'd4', !isOver && String(el.leftNum.textContent).length >= 4);

    const prevOff = isOver || round <= 1;
    const nextOff = isOver || round >= run.count;
    if (el.prevBtn.disabled !== prevOff) el.prevBtn.disabled = prevOff;
    if (el.nextBtn.disabled !== nextOff) el.nextBtn.disabled = nextOff;

    setText(el.timerLabel, isOver ? '超過時間' : '次の1個まで（1個 ' + fmt(Math.ceil(rs)) + '）');
    setText(el.timerText, isOver ? '+' + fmt(Math.floor(overSec)) : fmt(Math.ceil(rem)));
    setClass(el.timerText, 'warn', isOver || rem <= 10);
    setClass(el.timerText, 'over', isOver && overSec < 3600);
    setClass(el.timerText, 'over-h', isOver && overSec >= 3600);

    const allPct = Math.min(100, (elSec / run.total) * 100);
    el.overallFill.style.width = allPct.toFixed(2) + '%';
    setClass(el.overallFill, 'warn', isOver);
    setText(el.overallPct, Math.floor(allPct) + '%');
    setClass(el.overallPct, 'warn', isOver);

    setText(el.elapsedText, fmt(Math.floor(elSec)));
    setText(el.overallText, isOver ? '+' + fmt(Math.floor(overSec)) : fmt(Math.ceil(run.total - elSec)));
    setClass(el.overallText, 'warn', isOver);

    const endMs = isOver ? run.overEnd : now + (run.total - elSec) * 1000;
    setText(el.runEnd, hhmm(endMs));
    setText(el.runClock, hhmm(now));
  }

  function render() {
    const now = Date.now();
    if (run) renderRun(now); else renderSetup(now);
  }

  // ---------- inputs ----------
  function syncInputs() {
    if (document.activeElement !== el.hrs) el.hrs.value = settings.hours;
    if (document.activeElement !== el.mins) el.mins.value = settings.minutes;
    if (document.activeElement !== el.cnt) el.cnt.value = settings.count;
  }
  function bindInput(input, key, normalize) {
    input.addEventListener('input', () => {
      settings[key] = input.value;
      saveSettings();
      render();
    });
    input.addEventListener('focus', () => { try { input.select(); } catch (e) { /* ignore */ } });
    input.addEventListener('blur', () => {
      const v = normalize(input.value);
      settings[key] = v;
      input.value = v;
      saveSettings();
      render();
    });
  }
  const toInt = (v, max) => {
    let n = Math.floor(Number(v));
    if (!Number.isFinite(n) || n < 0) n = 0;
    if (max != null && n > max) n = max;
    return String(n);
  };
  bindInput(el.hrs, 'hours', (v) => toInt(v));
  bindInput(el.mins, 'minutes', (v) => toInt(v, 59));
  bindInput(el.cnt, 'count', (v) => toInt(v));
  for (const input of [el.hrs, el.mins, el.cnt]) {
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') input.blur(); });
  }

  el.startBtn.addEventListener('click', () => {
    if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
    start();
  });
  el.pauseBtn.addEventListener('click', togglePause);
  el.stopBtn.addEventListener('click', stop);
  el.prevBtn.addEventListener('click', () => step(-1));
  el.nextBtn.addEventListener('click', () => step(1));
  el.lockBtn.addEventListener('click', () => setLocked(true));

  // ---------- lock / long press ----------
  function holdFrame() {
    if (holdAt == null) return;
    const p = Math.min(1, (performance.now() - holdAt) / HOLD_MS);
    el.holdFill.style.clipPath = 'inset(' + (p * 100).toFixed(1) + '% 0 0 0)';
    if (p >= 1) { setLocked(false); return; }
    holdRaf = requestAnimationFrame(holdFrame);
  }
  function holdStart(e) {
    e.preventDefault();
    if (holdAt != null) return;
    holdAt = performance.now();
    holdRaf = requestAnimationFrame(holdFrame);
  }
  function holdEnd() {
    if (holdAt == null) return;
    holdAt = null;
    cancelAnimationFrame(holdRaf);
    el.holdFill.style.clipPath = 'inset(0 0 0 0)';
  }
  el.unlockBtn.addEventListener('pointerdown', holdStart);
  for (const t of ['pointerup', 'pointerleave', 'pointercancel']) el.unlockBtn.addEventListener(t, holdEnd);
  // カバー上のタッチはすべて無効化
  for (const t of ['pointerdown', 'touchstart', 'touchmove', 'mousedown', 'click', 'dblclick']) {
    el.lockLayer.addEventListener(t, (e) => {
      if (e.target === el.lockLayer || !el.unlockBtn.contains(e.target)) e.preventDefault();
      if (t === 'click' || t === 'dblclick') e.preventDefault();
    }, { passive: false });
  }
  document.addEventListener('contextmenu', (e) => { if (run || locked) e.preventDefault(); });
  document.addEventListener('selectstart', (e) => { if (run) e.preventDefault(); });

  // ---------- lifecycle ----------
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      if (isRunning()) acquireWake();
      render();
    } else {
      holdEnd();
    }
  });
  window.addEventListener('pageshow', () => { if (isRunning()) acquireWake(); render(); });

  // 前回の計測が残っていれば再開（アプリが裏で終了された場合の復帰用）
  const savedRun = store.get(RUN_KEY);
  if (savedRun && savedRun.total > 0 && savedRun.count > 0 && typeof savedRun.accum === 'number') {
    run = {
      total: savedRun.total,
      count: savedRun.count,
      accum: savedRun.accum,
      since: savedRun.since || null,
      roundSeen: 0,
      overEnd: savedRun.overEnd != null ? savedRun.overEnd : null,
      doneBase: 0,
      baseSec: 0,
    };
    // 前へ・次への状態を復元（壊れた値なら最初からのペースに戻す）
    const db = savedRun.doneBase, bs = savedRun.baseSec;
    if (Number.isInteger(db) && db >= 0 && db < run.count && typeof bs === 'number' && bs >= 0 && bs < run.total) {
      run.doneBase = db;
      run.baseSec = bs;
    }
    // 復帰時は振動させずに現在ラウンドを既読扱いにする
    const elSec = elapsedSec(Date.now());
    run.roundSeen = elSec >= run.total ? run.count + 1 : roundAt(elSec);
    showScreen('run');
    if (run.since) acquireWake();
  } else {
    showScreen('setup');
  }

  render();
  setInterval(render, TICK_MS);

  // ---------- service worker ----------
  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('sw.js').catch(() => {});
    });
  }
})();
