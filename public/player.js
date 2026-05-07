// dB minor — Shared persistent bottom player
// Exposes: window.DBMPlayer.play(track, queue, index)
//          window.DBMPlayer.queue — current queue
//          window.DBMPlayer.index — current index

(function () {
  const API = 'http://localhost:4000';
  const STATE_KEY = 'dbm_player_v2';

  // ── State ──────────────────────────────────────────────────────────────────
  let audio = new Audio();
  audio.preload = 'auto';
  let queue = [];
  let idx = 0;
  let isReady = false;
  let isSeeking = false;

  function fmt(s) {
    if (!s || isNaN(s)) return '0:00';
    const m = Math.floor(s / 60), sec = Math.floor(s % 60);
    return `${m}:${sec.toString().padStart(2, '0')}`;
  }

  // ── DOM ───────────────────────────────────────────────────────────────────
  const bar = document.createElement('div');
  bar.id = 'dbm-player';
  bar.innerHTML = `
    <div id="dbmp-artwork"><img id="dbmp-art-img" src="" alt=""></div>
    <div id="dbmp-meta">
      <div id="dbmp-title">—</div>
      <div id="dbmp-sub">dB minor</div>
    </div>
    <div id="dbmp-controls">
      <button id="dbmp-prev" title="Previous">&#9664;&#9664;</button>
      <button id="dbmp-play" title="Play">&#9654;</button>
      <button id="dbmp-next" title="Next">&#9654;&#9654;</button>
    </div>
    <div id="dbmp-timeline">
      <span id="dbmp-cur">0:00</span>
      <div id="dbmp-track">
        <div id="dbmp-buf"></div>
        <div id="dbmp-prog"></div>
        <div id="dbmp-thumb"></div>
      </div>
      <span id="dbmp-dur">0:00</span>
    </div>
    <div id="dbmp-right">
      <span id="dbmp-idx">— / —</span>
      <div id="dbmp-vol-wrap" title="Volume">
        <svg viewBox="0 0 20 20" width="16" height="16" fill="currentColor">
          <path d="M9 4L5 7H2v6h3l4 3V4zm4.5 1.5a7 7 0 010 9M12 7a4 4 0 010 6"/>
        </svg>
        <input id="dbmp-vol" type="range" min="0" max="1" step="0.02" value="1">
      </div>
    </div>
  `;
  // Loading bar — sits at top edge of player, becomes visible during buffering
  const loadBar = document.createElement('div');
  loadBar.id = 'dbmp-loading-bar';
  bar.style.position = 'fixed';
  bar.appendChild(loadBar);

  document.body.appendChild(bar);

  const $ = id => document.getElementById(id);
  const artImg = $('dbmp-art-img');
  const titleEl = $('dbmp-title');
  const subEl = $('dbmp-sub');
  const playBtn = $('dbmp-play');
  const prevBtn = $('dbmp-prev');
  const nextBtn = $('dbmp-next');
  const curEl = $('dbmp-cur');
  const durEl = $('dbmp-dur');
  const progEl = $('dbmp-prog');
  const bufEl = $('dbmp-buf');
  const thumbEl = $('dbmp-thumb');
  const trackEl = $('dbmp-track');
  const idxEl = $('dbmp-idx');
  const volEl = $('dbmp-vol');

  // ── CSS ───────────────────────────────────────────────────────────────────
  const style = document.createElement('style');
  style.textContent = `
    #dbm-player {
      position: fixed; bottom: 0; left: 0; right: 0;
      height: 72px;
      background: rgba(10,10,14,0.97);
      backdrop-filter: blur(20px);
      -webkit-backdrop-filter: blur(20px);
      border-top: 1px solid rgba(255,255,255,0.10);
      display: flex; align-items: center; gap: 16px;
      padding: 0 24px;
      z-index: 200;
      font-family: 'Inter', sans-serif;
      user-select: none;
    }
    #dbmp-artwork {
      width: 48px; height: 48px; flex-shrink: 0;
      border-radius: 6px; overflow: hidden;
      background: #1a1a1a;
      border: 1px solid rgba(255,255,255,0.08);
    }
    #dbmp-art-img { width:100%; height:100%; object-fit:cover; display:block; }
    #dbmp-meta { flex: 0 0 200px; min-width: 0; }
    #dbmp-title {
      font-size: 13px; font-weight: 500;
      color: #fafafa;
      white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
    }
    #dbmp-sub {
      font-size: 11px; color: #71717a;
      font-family: 'DM Mono', monospace;
      letter-spacing: 1px;
      white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
    }
    #dbmp-controls {
      display: flex; align-items: center; gap: 4px;
      flex-shrink: 0;
    }
    #dbmp-controls button {
      background: none; border: none; cursor: pointer;
      color: #a1a1aa; font-size: 13px;
      width: 32px; height: 32px;
      display: flex; align-items: center; justify-content: center;
      border-radius: 50%;
      transition: color 0.15s, background 0.15s;
    }
    #dbmp-controls button:hover { color: #fff; background: rgba(255,255,255,0.08); }
    #dbmp-play {
      font-size: 18px !important;
      width: 40px !important; height: 40px !important;
      background: rgba(147,51,234,0.20) !important;
      border: 1px solid rgba(147,51,234,0.50) !important;
      color: #e2d4f8 !important;
    }
    #dbmp-play:hover { background: rgba(147,51,234,0.35) !important; color: #fff !important; }
    #dbmp-play.loading {
      color: transparent !important;
      position: relative;
      animation: dbmp-pulse 1.2s ease-in-out infinite;
    }
    #dbmp-play.loading::after {
      content: '';
      position: absolute;
      top: 50%; left: 50%;
      width: 22px; height: 22px;
      margin: -11px 0 0 -11px;
      border: 2.5px solid rgba(226, 212, 248, 0.25);
      border-top-color: #fff;
      border-right-color: #fff;
      border-radius: 50%;
      animation: dbmp-spin 0.65s linear infinite;
    }
    @keyframes dbmp-spin { to { transform: rotate(360deg); } }
    @keyframes dbmp-pulse {
      0%, 100% { box-shadow: 0 0 0 0 rgba(147,51,234,0.7); }
      50%      { box-shadow: 0 0 0 10px rgba(147,51,234,0); }
    }

    /* Loading bar above the player to make it impossible to miss */
    #dbmp-loading-bar {
      position: absolute; top: -2px; left: 0; right: 0;
      height: 2px; pointer-events: none;
      overflow: hidden; opacity: 0;
      transition: opacity 0.15s;
    }
    #dbmp-loading-bar.active { opacity: 1; }
    #dbmp-loading-bar::before {
      content: ''; position: absolute; top: 0; bottom: 0;
      width: 40%;
      background: linear-gradient(90deg, transparent, #9333ea, #c084fc, #9333ea, transparent);
      animation: dbmp-bar 1.1s ease-in-out infinite;
    }
    @keyframes dbmp-bar {
      0%   { left: -40%; }
      100% { left: 100%; }
    }

    /* Track row spinner */
    .dbm-play-row-btn.loading {
      color: transparent !important;
      position: relative;
    }
    .dbm-play-row-btn.loading::after {
      content: ''; position: absolute;
      top: 50%; left: 50%;
      width: 12px; height: 12px;
      margin: -6px 0 0 -6px;
      border: 2px solid rgba(226,212,248,0.25);
      border-top-color: #fff;
      border-radius: 50%;
      animation: dbmp-spin 0.6s linear infinite;
    }
    #dbmp-timeline {
      flex: 1; display: flex; align-items: center; gap: 10px;
      min-width: 0;
    }
    #dbmp-cur, #dbmp-dur {
      font-family: 'DM Mono', monospace;
      font-size: 11px; color: #71717a;
      flex-shrink: 0; width: 34px;
    }
    #dbmp-dur { text-align: right; }
    #dbmp-track {
      flex: 1; height: 4px; background: rgba(255,255,255,0.10);
      border-radius: 2px; position: relative; cursor: pointer;
    }
    #dbmp-buf {
      position: absolute; top:0; left:0; bottom:0;
      background: rgba(255,255,255,0.12); border-radius:2px;
      width: 0;
    }
    #dbmp-prog {
      position: absolute; top:0; left:0; bottom:0;
      background: #9333ea; border-radius:2px;
      width: 0; transition: width 0.25s linear;
    }
    #dbmp-thumb {
      position: absolute; top: 50%; transform: translate(-50%,-50%);
      width: 12px; height: 12px; border-radius: 50%;
      background: #fff; left: 0;
      box-shadow: 0 0 6px rgba(147,51,234,0.8);
      opacity: 0; transition: opacity 0.15s;
    }
    #dbmp-track:hover #dbmp-thumb { opacity: 1; }
    #dbmp-right {
      flex-shrink: 0; display: flex; align-items: center; gap: 16px;
    }
    #dbmp-idx {
      font-family: 'DM Mono', monospace;
      font-size: 10px; color: #52525b; letter-spacing: 1px;
      width: 44px; text-align: center;
    }
    #dbmp-vol-wrap {
      display: flex; align-items: center; gap: 6px; color: #52525b;
    }
    #dbmp-vol {
      width: 72px; accent-color: #9333ea;
      cursor: pointer;
    }
    /* push page content up */
    body { padding-bottom: 72px; }

    /* playing indicator on track rows */
    .dbm-playing-row { background: rgba(147,51,234,0.10) !important; }
    .dbm-play-row-btn.playing::before { content: '⏸'; }
    .dbm-play-row-btn:not(.playing)::before { content: '▶'; }
  `;
  document.head.appendChild(style);

  // ── Audio events ──────────────────────────────────────────────────────────
  audio.addEventListener('timeupdate', () => {
    if (isSeeking || !audio.duration) return;
    const p = (audio.currentTime / audio.duration) * 100;
    progEl.style.width = p + '%';
    thumbEl.style.left = p + '%';
    curEl.textContent = fmt(audio.currentTime);
  });

  audio.addEventListener('durationchange', () => {
    durEl.textContent = fmt(audio.duration);
  });

  audio.addEventListener('progress', () => {
    if (!audio.duration || !audio.buffered.length) return;
    const b = (audio.buffered.end(audio.buffered.length - 1) / audio.duration) * 100;
    bufEl.style.width = b + '%';
  });

  audio.addEventListener('play', () => {
    playBtn.innerHTML = '&#9646;&#9646;';
    setLoading(false);
    updateRowHighlight();
  });

  audio.addEventListener('waiting', () => setLoading(true));
  audio.addEventListener('stalled', () => setLoading(true));
  audio.addEventListener('playing', () => setLoading(false));
  audio.addEventListener('error', () => setLoading(false));

  audio.addEventListener('pause', () => {
    playBtn.innerHTML = '&#9654;';
    clearRowHighlight();
  });

  audio.addEventListener('ended', () => {
    if (idx < queue.length - 1) { idx++; loadCurrent(true); }
    else { playBtn.innerHTML = '&#9654;'; clearRowHighlight(); }
  });

  audio.addEventListener('canplay', () => {
    isReady = true;
    setLoading(false);
    updateRowHighlight();
  });

  // ── Scrubber ──────────────────────────────────────────────────────────────
  trackEl.addEventListener('mousedown', e => {
    isSeeking = true;
    seek(e);
  });
  document.addEventListener('mousemove', e => { if (isSeeking) seek(e); });
  document.addEventListener('mouseup', () => { isSeeking = false; });

  function seek(e) {
    const rect = trackEl.getBoundingClientRect();
    const p = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    if (audio.duration) {
      audio.currentTime = p * audio.duration;
      progEl.style.width = (p * 100) + '%';
      thumbEl.style.left = (p * 100) + '%';
    }
  }

  // ── Volume ────────────────────────────────────────────────────────────────
  volEl.addEventListener('input', () => { audio.volume = parseFloat(volEl.value); });

  // ── Buttons ───────────────────────────────────────────────────────────────
  playBtn.addEventListener('click', () => {
    if (!queue.length) return;
    if (audio.paused) audio.play();
    else audio.pause();
  });

  prevBtn.addEventListener('click', () => {
    if (audio.currentTime > 3) { audio.currentTime = 0; return; }
    if (idx > 0) { idx--; loadCurrent(true); }
  });

  nextBtn.addEventListener('click', () => {
    if (idx < queue.length - 1) { idx++; loadCurrent(true); }
  });

  // ── Load & play ───────────────────────────────────────────────────────────
  function loadCurrent(autoPlay) {
    if (!queue.length) return;
    const t = queue[idx];
    setLoading(true);
    audio.src = `${API}/api/audio/${t.id}`;
    audio.load();
    titleEl.textContent = t.title;
    subEl.textContent = 'Benoît J. Dobbelstein';
    artImg.src = t.artworkUrl ? t.artworkUrl.startsWith("/") ? t.artworkUrl : `${API}/api/artwork?url=${encodeURIComponent(t.artworkUrl)}` : '';
    idxEl.textContent = `${idx + 1} / ${queue.length}`;
    progEl.style.width = '0';
    thumbEl.style.left = '0';
    curEl.textContent = '0:00';
    durEl.textContent = fmt(t.duration);
    isReady = false;
    if (autoPlay) {
      audio.addEventListener('canplay', () => audio.play().catch(()=>{}), { once: true });
    }
    saveState();
    highlightRows();
  }

  // ── Row highlight across the page ─────────────────────────────────────────
  function updateRowHighlight() { highlightRows(); }
  function clearRowHighlight() {
    document.querySelectorAll('.dbm-playing-row').forEach(el => el.classList.remove('dbm-playing-row'));
    document.querySelectorAll('.dbm-play-row-btn').forEach(b => b.classList.remove('playing'));
  }
  function setLoading(on) {
    if (on) {
      playBtn.classList.add('loading');
      loadBar.classList.add('active');
      // also spin the active row button
      if (queue.length) {
        document.querySelectorAll(`[data-track-id="${queue[idx].id}"] .dbm-play-row-btn`).forEach(b => b.classList.add('loading'));
      }
    } else {
      playBtn.classList.remove('loading');
      loadBar.classList.remove('active');
      document.querySelectorAll('.dbm-play-row-btn.loading').forEach(b => b.classList.remove('loading'));
    }
  }
  function highlightRows() {
    clearRowHighlight();
    if (!queue.length) return;
    const t = queue[idx];
    document.querySelectorAll(`[data-track-id="${t.id}"]`).forEach(el => {
      el.classList.add('dbm-playing-row');
      const btn = el.querySelector('.dbm-play-row-btn');
      if (btn) btn.classList.add('playing');
    });
  }

  // ── Public API ────────────────────────────────────────────────────────────
  window.DBMPlayer = {
    play(newQueue, startIdx = 0) {
      queue = newQueue;
      idx = startIdx;
      loadCurrent(true);
    },
    add(track) {
      queue.push(track);
      if (queue.length === 1) loadCurrent(true);
      idxEl.textContent = `${idx + 1} / ${queue.length}`;
    },
    get queue() { return queue; },
    get index() { return idx; }
  };

  // ── State persistence ─────────────────────────────────────────────────────
  function saveState() {
    try {
      localStorage.setItem(STATE_KEY, JSON.stringify({ queue, idx, time: audio.currentTime }));
    } catch(e) {}
  }

  function restoreState() {
    try {
      const s = JSON.parse(localStorage.getItem(STATE_KEY));
      if (!s || !s.queue || !s.queue.length) return;
      queue = s.queue; idx = s.idx || 0;
      const t = queue[idx];
      titleEl.textContent = t.title;
      subEl.textContent = 'Benoît J. Dobbelstein';
      artImg.src = t.artworkUrl ? t.artworkUrl.startsWith("/") ? t.artworkUrl : `${API}/api/artwork?url=${encodeURIComponent(t.artworkUrl)}` : '';
      idxEl.textContent = `${idx + 1} / ${queue.length}`;
      durEl.textContent = fmt(t.duration);
      audio.src = `${API}/api/audio/${t.id}`;
      if (s.time) audio.currentTime = s.time;
    } catch(e) {}
  }

  audio.addEventListener('timeupdate', () => {
    if (!isSeeking && Math.floor(audio.currentTime) % 5 === 0) saveState();
  });

  restoreState();
})();
