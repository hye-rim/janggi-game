'use strict';
// 오락실 튜토리얼이 '진짜로 일어난 일'을 알아채는 신호 (arcade/public/tutorial.js 가 듣는다. 튜토리얼이 아니면 아무도 안 듣는다)
const tutorialSignal = (type) => window.dispatchEvent(new CustomEvent('arcade:tutorial', { detail: { type } }));

// 장기: 화면·입력·소리·온라인. 규칙과 컴퓨터는 logic.js (LOGIC_JANGGI), 방·매칭은 server.js
(() => {
const L = LOGIC_JANGGI;
const $ = (id) => document.getElementById(id);
const T = { cpu: 600, over: 900, banner: 1100 };                    // 시간(ms). 시험용으로 줄일 수 있다
const HANJA = [['', '將', '車', '包', '馬', '象', '士', '卒'], ['', '將', '車', '包', '馬', '象', '士', '兵']];
const KOR = ['', '장', '차', '포', '마', '상', '사', '졸'];
const SIDE_NAME = ['초', '한'];
// 판 그림은 364x404 칸: 가장자리 22, 줄 간격 40
const MX = 22, MY = 22, STEP = 40, VW = 364, VH = 404;

// ---------- 저장소 ----------
const store = {
  get(k) { try { return localStorage.getItem(k); } catch (_) { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch (_) {} },
};
let wins = Number(store.get('janggiWins')) || 0;
const ONLINE_KEY = 'janggiOnline', SESSION_KEY = 'janggiSession';
const loadJson = (k) => { try { return JSON.parse(store.get(k)) || {}; } catch (_) { return {}; } };
function loadSession() { try { return JSON.parse(sessionStorage.getItem(SESSION_KEY)); } catch (_) { return null; } }
function saveSession(s) { try { s ? sessionStorage.setItem(SESSION_KEY, JSON.stringify(s)) : sessionStorage.removeItem(SESSION_KEY); } catch (_) {} }
const esc = (s) => String(s).replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[ch]);
const myName = () => store.get('janggiName') || '';

// ---------- 소리 ----------
let audio = null;
let muted = store.get('janggiMuted') === '1';
function tone(freq, dur, type = 'sine', vol = 0.09, slide = 0) {
  if (muted) return;
  try {
    audio = audio || new (window.AudioContext || window.webkitAudioContext)();
    const t = audio.currentTime;
    const o = audio.createOscillator(), g = audio.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(40, freq + slide), t + dur);
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g).connect(audio.destination);
    o.start(t);
    o.stop(t + dur);
  } catch (_) {}
}
const seq = (notes, step, type = 'triangle', vol = 0.09) => notes.forEach((f, i) => setTimeout(() => tone(f, step * 0.0009, type, vol), i * step));
const sfx = {
  select: () => tone(700, 0.04, 'triangle', 0.07),
  move: () => tone(230, 0.07, 'square', 0.07, -60),
  take: () => seq([260, 160], 70, 'square', 0.08),
  check: () => seq([880, 660, 880], 110, 'sawtooth', 0.06),
  pass: () => tone(400, 0.08, 'triangle', 0.06),
  bad: () => tone(150, 0.1, 'square', 0.05),
  found: () => seq([392, 523], 90, 'triangle', 0.08),
  win: () => seq([523, 659, 784, 1047], 110, 'triangle', 0.1),
  lose: () => seq([392, 330, 262, 196], 150, 'sawtooth', 0.06),
};
function toggleMute() { muted = !muted; store.set('janggiMuted', muted ? '1' : '0'); $('muteBtn').textContent = muted ? '🔇' : '🔊'; }
$('muteBtn').onclick = (e) => { e.currentTarget.blur(); toggleMute(); };
$('muteBtn').textContent = muted ? '🔇' : '🔊';

// ---------- 상태 ----------
let mode = 'easy';                  // 'easy' · 'hard' (컴퓨터) · 'online'
let phase = 'title';                // title · play · over
let st = null;                      // 컴퓨터 대전 판 (나는 0번 = 초, 아래, 먼저)
let room = null, view = null, waitingNet = false, netDown = false, turnEnd = 0, recorded = '', seenMove = 0;
let cpuTimer = 0, overTimer = 0, thinking = false, bannerTimer = 0;
let sel = -1;                       // 고른 말의 칸 번호
let lastMark = null;                // 방금 둔 수 { from, to }
const online = () => mode === 'online';

// 화면이 쓰는 모양으로: { v: { board, turn, check, taken, legal: [[from,to]..], canPass }, you, state, winner, reason, names }
function model() {
  if (online()) {
    if (!room || !view) return null;
    return { v: view, you: room.you, state: room.state, winner: room.winner, reason: room.reason,
      names: [0, 1].map((c) => (c === room.you ? '나' : ((room.players.find((p) => p.color === c) || {}).name || '상대'))) };
  }
  if (!st) return null;
  const mine = st.turn === 0 && !st.over;
  return { v: { board: st.board, turn: st.turn, check: st.check, taken: st.taken, legal: mine ? L.legalMoves(st) : [], canPass: mine && L.canPass(st) },
    you: 0, state: st.over ? 'over' : 'playing', winner: st.winner, reason: st.reason, names: ['나', '컴퓨터'] };
}
const viewFromRoom = (r) => ({ board: r.board, turn: r.turn, check: r.check, taken: r.taken, legal: r.legal || [], canPass: !!r.canPass });
const myTurn = (m) => !!m && m.state === 'playing' && m.v.turn === m.you && !netDown && !thinking;
const canAct = (m) => myTurn(m) && !waitingNet;

// ---------- 판 그리기 ----------
const board = $('bwrap');
function drawBoard() {
  const x = (c) => MX + c * STEP, y = (r) => MY + r * STEP;
  let s = `<rect x="0" y="0" width="${VW}" height="${VH}" rx="12" fill="#f0c37a"/><rect x="${MX - 8}" y="${MY - 8}" width="${8 * STEP + 16}" height="${9 * STEP + 16}" fill="none" stroke="#5a3b1a" stroke-width="3"/>`;
  s += '<g stroke="#5a3b1a" stroke-width="1.6" stroke-linecap="round">';
  for (let r = 0; r < 10; r++) s += `<line x1="${x(0)}" y1="${y(r)}" x2="${x(8)}" y2="${y(r)}"/>`;
  for (let c = 0; c < 9; c++) s += `<line x1="${x(c)}" y1="${y(0)}" x2="${x(c)}" y2="${y(9)}"/>`;
  for (const top of [0, 7]) {
    s += `<line x1="${x(3)}" y1="${y(top)}" x2="${x(5)}" y2="${y(top + 2)}"/><line x1="${x(5)}" y1="${y(top)}" x2="${x(3)}" y2="${y(top + 2)}"/>`;
  }
  s += '</g>';
  s += `<text x="${VW / 2}" y="${y(4.5) + 7}" text-anchor="middle" font-size="20" fill="rgba(90,59,26,.35)" letter-spacing="26">楚 河 漢 界</text>`;
  $('bsvg').innerHTML = s;
}
// 보는 쪽에 따라 판을 뒤집는다 (한으로 두는 사람은 자기 말이 아래에 오게)
let flip = false;
const pos = (i) => { let r = (i / 9) | 0, c = i % 9; if (flip) { r = 9 - r; c = 8 - c; } return { left: ((MX + c * STEP) / VW) * 100, top: ((MY + r * STEP) / VH) * 100 }; };
function sizeUnit() { board.style.setProperty('--u', (board.getBoundingClientRect().width / 100) + 'px'); }
new ResizeObserver(sizeUnit).observe(board);

function render() {
  const m = model();
  if (!m) { renderHud(null); return; }
  flip = m.you === 1;
  const v = m.v, mine = canAct(m);
  if (sel >= 0 && (!mine || !v.board[sel] || L.sideOf(v.board[sel]) !== m.you)) sel = -1;
  const legalFrom = sel >= 0 ? v.legal.filter((x) => x[0] === sel).map((x) => x[1]) : [];
  const kingChk = v.check ? v.board.indexOf(L.make(L.K, v.turn)) : -1;
  // 말
  const host = $('pieces');
  const keep = new Set();
  v.board.forEach((val, i) => {
    if (!val) return;
    const t = L.typeOf(val), s = L.sideOf(val);
    const key = `p${i}`;
    keep.add(key);
    let el = host.querySelector(`[data-k="${key}"]`);
    if (!el) { el = document.createElement('div'); el.dataset.k = key; host.appendChild(el); }
    el.className = `pc s${s} t${t}${i === sel ? ' sel' : ''}${i === kingChk ? ' chk' : ''}`;
    el.textContent = HANJA[s][t];
    const p = pos(i); el.style.left = p.left + '%'; el.style.top = p.top + '%';
    el.dataset.i = i;
  });
  host.querySelectorAll('[data-k]').forEach((el) => { if (!keep.has(el.dataset.k)) el.remove(); });
  // 표시: 갈 수 있는 곳 · 방금 둔 수
  board.querySelectorAll('.dot, .mark').forEach((e) => e.remove());
  const add = (cls, i) => { const d = document.createElement('div'); d.className = cls; const p = pos(i); d.style.left = p.left + '%'; d.style.top = p.top + '%'; board.appendChild(d); };
  if (lastMark) { add('mark', lastMark.from); add('mark', lastMark.to); }
  legalFrom.forEach((i) => add(`dot${v.board[i] ? ' cap' : ''}`, i));
  // 잡은 말
  const opp = 1 - m.you;
  const tk = (side) => (v.taken[side] || []).slice().sort((a, b) => L.VALUE[L.typeOf(b)] - L.VALUE[L.typeOf(a)]).map((val) => `<span class="tkp s${L.sideOf(val)}">${HANJA[L.sideOf(val)][L.typeOf(val)]}</span>`).join('');
  const pts = (side) => (v.taken[side] || []).reduce((a, val) => a + L.VALUE[L.typeOf(val)], 0);
  $('capTop').innerHTML = `<span class="who s${opp}${m.state === 'playing' && v.turn === opp ? ' on' : ''}">${esc(m.names[opp])} (${SIDE_NAME[opp]}) · ${pts(opp)}점</span><span class="tk">${tk(opp)}</span>`;
  $('capBottom').innerHTML = `<span class="who s${m.you}${m.state === 'playing' && v.turn === m.you ? ' on' : ''}">나 (${SIDE_NAME[m.you]}) · ${pts(m.you)}점</span><span class="tk">${tk(m.you)}</span>`;
  $('passBtn').disabled = !(mine && v.canPass);
  renderHud(m);
}
function renderHud(m = model()) {
  $('wins').textContent = wins.toLocaleString('ko-KR');
  let text = '장기';
  if (m && phase === 'play' && m.state === 'playing') {
    const sec = Math.max(0, Math.ceil((turnEnd - performance.now()) / 1000));
    if (online() && netDown) text = '연결 다시 붙이는 중…';
    else if (m.v.turn === m.you) text = `내 차례${m.v.check ? ' · 장군!' : ''}${online() ? ` · ${sec}초` : ''}`;
    else text = online() ? `${m.names[m.v.turn]} 차례 · ${sec}초` : '컴퓨터 차례…';
  }
  $('turn').textContent = text;
  $('resignBtn').style.display = online() && room && room.state === 'playing' ? '' : 'none';
}
function say(t) { $('msg').textContent = t; }
function banner(text, color) {
  const b = $('banner');
  b.textContent = text; b.style.color = color || '#fff'; b.classList.add('show');
  clearTimeout(bannerTimer); bannerTimer = setTimeout(() => b.classList.remove('show'), T.banner);
}

// ---------- 창 ----------
const overlayOpen = () => !$('overlay').classList.contains('hidden');
function showOverlay(html) { $('overlay').innerHTML = html; $('overlay').classList.remove('hidden'); }
function hideOverlay() { $('overlay').classList.add('hidden'); }

// ---------- 입력 ----------
function nearest(e) {
  const bb = board.getBoundingClientRect(), k = bb.width / VW;
  const fx = (e.clientX - bb.left) / k, fy = (e.clientY - bb.top) / k;
  let c = Math.round((fx - MX) / STEP), r = Math.round((fy - MY) / STEP);
  if (Math.hypot(fx - (MX + c * STEP), fy - (MY + r * STEP)) > STEP * 0.62) return -1;
  if (r < 0 || r > 9 || c < 0 || c > 8) return -1;
  if (flip) { r = 9 - r; c = 8 - c; }
  return r * 9 + c;
}
board.addEventListener('pointerdown', (e) => {
  const m = model();
  if (!m || phase !== 'play') return;
  e.preventDefault();
  const i = nearest(e);
  if (i < 0) { sel = -1; render(); return; }
  if (!canAct(m)) return;
  const v = m.v;
  if (sel >= 0 && v.legal.some((x) => x[0] === sel && x[1] === i)) { const from = sel; sel = -1; dispatch({ type: 'move', from, to: i }); return; }
  const val = v.board[i];
  if (val && L.sideOf(val) === m.you) {
    if (i === sel) { sel = -1; render(); return; }
    sel = i; sfx.select(); render();
    if (v.legal.some((x) => x[0] === i)) tutorialSignal('select'); else say('이 말은 지금 움직일 수 없어요');
    return;
  }
  if (sel >= 0) { sfx.bad(); sel = -1; render(); }
});
$('passBtn').onclick = (e) => { e.currentTarget.blur(); const m = model(); if (canAct(m) && m.v.canPass) dispatch({ type: 'pass' }); };
addEventListener('keydown', (e) => { if (e.code === 'KeyM') toggleMute(); if (e.code === 'Escape') { sel = -1; render(); } });

// 내 동작 하나를 낸다 (컴퓨터 판은 바로 적용, 온라인은 서버로)
function dispatch(a) {
  const m = model();
  if (!canAct(m)) return;
  if (online()) { waitingNet = true; net.send('act', { action: a }); render(); return; }
  const ev = L.apply(st, a);
  if (!ev) return;
  afterMove(ev, true);
}
function afterMove(ev, mine) {
  lastMark = ev.type === 'move' ? { from: ev.from, to: ev.to } : lastMark;
  announce(ev);
  if (mine) tutorialSignal(ev.type === 'pass' ? 'pass' : 'move');
  render();
  if (!online()) {
    if (st.over) { overTimer = setTimeout(showOver, T.over); return; }
    if (st.turn === 1) scheduleCpu();
  }
}
// 받침에 따라 바뀌는 조사 (을/를, 로/으로)
const jong = (w) => (w.charCodeAt(w.length - 1) - 0xAC00) % 28;
const eulReul = (w) => (jong(w) === 0 ? '를' : '을');
const euro = (w) => (jong(w) === 0 || jong(w) === 8 ? '로' : '으로');
function announce(ev) {
  const m = model();
  if (!m) return;
  const mine = ev.who === m.you;
  const nm = mine ? '내가' : `${m.names[ev.who]}${/[가-힣]$/.test(m.names[ev.who]) && ((m.names[ev.who].charCodeAt(m.names[ev.who].length - 1) - 0xAC00) % 28 === 0) ? '가' : '이'}`;
  let t;
  if (ev.type === 'pass') { sfx.pass(); t = `${nm} 한 수 쉬었어요`; }
  else {
    const name = KOR[L.typeOf(ev.piece)];
    if (ev.captured) { sfx.take(); const cap = KOR[L.typeOf(ev.captured)]; t = `${nm} ${name}${euro(name)} ${cap}${eulReul(cap)} 잡았어요`; }
    else { sfx.move(); t = `${nm} ${name}${eulReul(name)} 옮겼어요`; }
  }
  if (ev.check && !(ev.over && (m.winner === 0 || m.winner === 1))) { setTimeout(sfx.check, 150); banner('장군!', '#ffd23f'); t += '\n장군! 장을 지켜야 해요'; }
  say(t);
}

// ---------- 컴퓨터 대전 ----------
function startCpu(level) {
  leaveOnline();
  clearTimeout(cpuTimer); clearTimeout(overTimer);
  mode = level; st = L.newGame(); phase = 'play'; sel = -1; thinking = false; turnEnd = 0; lastMark = null;
  hideOverlay(); drawBoard(); render();
  say('내 말(초록)을 눌러 움직여요\n상대 장(將)을 몰아 잡으면 이겨요');
}
function scheduleCpu() { thinking = true; render(); cpuTimer = setTimeout(cpuTurn, T.cpu); }
function cpuTurn() {
  if (phase !== 'play' || !st || online() || st.over || st.turn !== 1) { thinking = false; render(); return; }
  const a = L.aiPick(st, mode === 'hard' ? 'hard' : 'easy');
  const ev = a && L.apply(st, a);
  thinking = false;
  if (!ev) { render(); return; }
  afterMove(ev, false);
}
const reasonText = { checkmate: '외통! 장을 피할 수 없어요', repetition: '같은 판이 세 번 나와 비겼어요', pass: '서로 쉬어서 비겼어요', limit: '잡는 수 없이 120수가 지나 비겼어요' };
function showOver() {
  phase = 'over';
  const youWon = st.winner === 0, draw = st.winner === 2;
  if (youWon) { wins++; store.set('janggiWins', String(wins)); sfx.win(); } else if (draw) sfx.found(); else sfx.lose();
  const pts = (side) => st.taken[side].reduce((a, val) => a + L.VALUE[L.typeOf(val)], 0);
  showOverlay(`
    <h2>${draw ? '비겼어요! 🤝' : youWon ? '이겼어요! 🎉' : '아쉬워요! 😵'}</h2>
    <p>${esc(reasonText[st.reason] || '')}</p>
    <dl class="stats card2"><dt>잡은 말 (나)</dt><dd>${st.taken[0].length}개 · ${pts(0)}점</dd><dt>잡은 말 (컴퓨터)</dt><dd>${st.taken[1].length}개 · ${pts(1)}점</dd><dt>둔 수</dt><dd>${st.plies}</dd></dl>
    <p>컴퓨터 상대 승리 <b>${wins}</b>번</p>
    <div class="col"><button data-act="again">다시 하기</button><button class="sub" data-act="view">판 보기</button><button class="sub" data-act="home">처음으로</button></div>`);
  render();
}
function showTitle() {
  leaveOnline();
  clearTimeout(cpuTimer); clearTimeout(overTimer);
  mode = 'easy'; phase = 'title'; st = L.newGame(); sel = -1; thinking = false; lastMark = null;
  drawBoard(); say(''); render();
  const on = loadJson(ONLINE_KEY);
  showOverlay(`
    <h1>장기</h1>
    <p>상대 <b>장(將)</b>을 몰아 잡으면 이겨요!</p>
    <div class="card2" style="font-size:13px">내가 <b>초(초록, 아래)</b>, 먼저 둬요<br>차·포·마·상·사·졸이 저마다 다르게 움직여요<br>말을 누르면 <b>갈 수 있는 곳</b>이 점으로 보여요<br>장이 잡힐 상황이면 <b>장군</b>, 못 피하면 <b>외통</b>이에요</div>
    <div class="col"><button data-act="cpu" data-lv="easy">🤖 컴퓨터랑 · 쉬움</button><button class="sub" data-act="cpu" data-lv="hard">🤖 컴퓨터랑 · 어려움</button><button class="sub" data-act="online">🌐 온라인 대전${on.w || on.l ? ` · ${on.w || 0}승 ${on.l || 0}패` : ''}</button></div>`);
}

// ---------- 온라인: 연결 ----------
const net = {
  ws: null, pulse: null, outbox: [], retry: 0,
  connect() {
    if (this.ws && this.ws.readyState <= 1) return;
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(`${proto}//${location.host}${location.pathname}`);
    this.ws = ws;
    ws.onopen = () => {
      this.retry = 0;
      this.raw('hello', { name: myName() });
      const s = loadSession();
      if (s) this.raw('resume', s);
      for (const [t, p] of this.outbox.splice(0)) this.raw(t, p);
      clearInterval(this.pulse);
      this.pulse = setInterval(() => this.raw('pulse'), 10000);
    };
    ws.onmessage = (e) => { let m; try { m = JSON.parse(e.data); } catch (_) { return; } onNet(m); };
    ws.onclose = () => {
      clearInterval(this.pulse);
      if (this.ws !== ws) return;
      this.ws = null;
      if (!online()) return;
      if (room || loadSession()) {
        netDown = true; waitingNet = false; render();
        setTimeout(() => { if (online()) this.connect(); }, Math.min(4000, 500 * 2 ** this.retry++));
      } else showOnline('서버와 연결이 끊겼어요. 다시 시도해 주세요.');
    };
  },
  send(t, p = {}) {
    if (this.ws && this.ws.readyState === 1) this.raw(t, p);
    else { this.outbox.push([t, p]); this.connect(); }
  },
  raw(t, p = {}) { if (this.ws && this.ws.readyState === 1) this.ws.send(JSON.stringify({ t, ...p })); },
  close() {
    const ws = this.ws;
    this.ws = null; this.outbox = [];
    clearInterval(this.pulse);
    if (ws) ws.close();
  },
};

function onNet(m) {
  if (m.t === 'queued') showQueued();
  else if (m.t === 'room') applyRoom(m);
  else if (m.t === 'rejected') { waitingNet = false; render(); }
  else if (m.t === 'error') { room = null; saveSession(null); showOnline(m.msg); }
  else if (m.t === 'resumeFailed') {
    saveSession(null);
    if (room) { room = null; showOnline('대국이 끝나서 이어갈 수 없어요.'); }
    netDown = false; render();
  }
}

function leaveOnline() {
  if (!online()) return;
  net.send('leave'); net.close();
  saveSession(null);
  room = null; view = null; netDown = false; waitingNet = false; mode = 'easy'; phase = 'title'; sel = -1;
}

// ---------- 온라인: 대국 ----------
function applyRoom(r) {
  const prev = room;
  const fresh = !prev || prev.code !== r.code;
  const newGame = fresh || prev.games !== r.games;
  room = r;
  view = viewFromRoom(r);
  netDown = false; waitingNet = false;
  saveSession({ code: r.code, token: r.token });
  turnEnd = performance.now() + r.remain;
  if (newGame) { seenMove = r.lastMove ? r.lastMove.seq : 0; sel = -1; lastMark = null; say(''); }
  if (r.state === 'waiting') { phase = 'title'; showWaiting(); drawBoard(); render(); return; }
  phase = r.state === 'playing' ? 'play' : 'over';
  if (newGame) drawBoard();
  if (newGame && r.state === 'playing') { sfx.found(); say(r.turn === r.you ? `내가 먼저예요! 내 말은 ${SIDE_NAME[r.you]}(${r.you === 0 ? '초록' : '빨강'})` : `상대가 먼저 둬요. 내 말은 ${SIDE_NAME[r.you]}(${r.you === 0 ? '초록' : '빨강'})`); }
  if (!($('overlay').dataset.screen === 'confirm') && r.state !== 'over') hideOverlay();
  const lm = r.lastMove;
  if (lm && lm.seq > seenMove && !newGame) {
    seenMove = lm.seq;
    if (lm.type === 'move') lastMark = { from: lm.from, to: lm.to };
    announce(Object.assign({}, lm, { over: r.state === 'over' }));
  }
  render();
  if (r.state === 'over') afterOver();
}
function afterOver() {
  const r = room;
  const key = `${r.code}:${r.games}:${r.reason}:${r.winner}`;
  if (recorded !== key) {
    recorded = key;
    const rec = loadJson(ONLINE_KEY);
    if (r.winner === r.you) { rec.w = (rec.w || 0) + 1; sfx.win(); } else if (r.winner === 2) sfx.found(); else { rec.l = (rec.l || 0) + 1; sfx.lose(); }
    store.set(ONLINE_KEY, JSON.stringify(rec));
    setTimeout(() => { if (room && room.state === 'over') showResult(); }, T.over);
  } else if (overlayOpen()) showResult();
}

function showResult() {
  const r = room;
  const won = r.winner === r.you, draw = r.winner === 2;
  const why = Object.assign({}, reasonText, {
    resign: won ? '상대가 기권했어요' : '기권했어요',
    timeout: won ? '상대가 시간을 넘겼어요' : '시간을 넘겼어요',
    left: won ? '상대가 나갔어요' : '연결이 끊겨 패배했어요',
  })[r.reason] || '';
  const rec = loadJson(ONLINE_KEY);
  const opp = r.players.find((p) => p.color !== r.you);
  const iVoted = r.rematch.includes(r.you), theyVoted = opp && r.rematch.includes(opp.color);
  let again;
  if (!opp) again = '<p>상대가 방을 나갔어요</p>';
  else if (iVoted) again = '<p>상대를 기다리는 중…</p>';
  else again = `${theyVoted ? '<p>상대가 한 판 더 하고 싶어해요!</p>' : ''}<button data-act="rematch">한 판 더</button>`;
  showOverlay(`
    <h2>${draw ? '🤝 무승부' : won ? '🎉 승리!' : '😵 패배'}</h2>
    ${why ? `<p>${esc(why)}</p>` : ''}
    <span class="tag">온라인 ${rec.w || 0}승 ${rec.l || 0}패</span>
    <div class="col">${again}
      <div class="row"><button class="sub" data-act="view">판 보기</button><button class="sub" data-act="leave">나가기</button></div>
    </div>`);
}

function showOnline(error = '') {
  leaveOnline();
  clearTimeout(cpuTimer); clearTimeout(overTimer);
  mode = 'online'; phase = 'title'; room = null; view = null; st = L.newGame(); waitingNet = false; sel = -1; thinking = false; lastMark = null; flip = false; drawBoard();
  say(''); render();
  showOverlay(`
    <h2>🌐 온라인 대전</h2>
    <input id="nameInput" maxlength="10" placeholder="내 이름 (최대 10자)" value="${esc(myName())}" autocomplete="off">
    <div class="col">
      <button data-act="quick">⚡ 빠른 대전</button>
      <button class="sub" data-act="create">방 만들기</button>
      <div class="row join"><input id="codeInput" maxlength="4" placeholder="방 코드" autocomplete="off" autocapitalize="characters"><button class="sub" data-act="join">들어가기</button></div>
    </div>
    <span class="error">${esc(error)}</span>
    <button class="back" data-act="home">← 처음으로</button>
    <p style="font-size:12.5px">한 번 둘 때마다 90초 · 먼저 하는 쪽(초)은 한 판마다 바뀌어요</p>`);
}
function showQueued() {
  showOverlay(`
    <h2>상대를 찾는 중…</h2>
    <div class="dots"><span></span><span></span><span></span></div>
    <p>누군가 빠른 대전을 누르면 바로 시작해요</p>
    <button class="sub" data-act="cancel">취소</button>`);
}
const inviteUrl = () => `${location.origin}${location.pathname}?room=${room.code}`;
function showWaiting() {
  showOverlay(`
    <h2>친구를 기다리는 중…</h2>
    <p>방 코드</p>
    <div class="code">${esc(room.code)}</div>
    <p>친구가 <b>온라인 대전 → 들어가기</b>에<br>이 코드를 넣으면 시작해요</p>
    <button data-act="copy">🔗 초대 링크 복사</button>
    <button class="sub" data-act="cancel">취소</button>`);
}
function saveName() {
  const input = $('nameInput');
  if (!input) return;
  const name = input.value.trim().slice(0, 10);
  store.set('janggiName', name);
  net.send('hello', { name });
}
function confirmResign() {
  showOverlay(`<h2>기권할까요?</h2><p>이번 판은 패배로 기록돼요</p>
    <div class="row"><button data-act="close">계속하기</button><button class="sub" data-act="resign">🏳 기권</button></div>`);
  $('overlay').dataset.screen = 'confirm';
}

let lastCpu = 'easy';
$('overlay').addEventListener('click', (e) => {
  const btn = e.target.closest('button');
  if (!btn) return;
  btn.blur();
  $('overlay').dataset.screen = '';
  const act = btn.dataset.act;
  if (act === 'cpu') { lastCpu = btn.dataset.lv; startCpu(lastCpu); }
  else if (act === 'again') startCpu(lastCpu);
  else if (act === 'home') showTitle();
  else if (act === 'online') showOnline();
  else if (act === 'quick') { saveName(); net.send('quick'); }
  else if (act === 'create') { saveName(); net.send('create'); }
  else if (act === 'join') {
    const code = ($('codeInput').value || '').trim().toUpperCase();
    if (code.length !== 4) { $('overlay').querySelector('.error').textContent = '방 코드 4자리를 넣어 주세요.'; return; }
    saveName();
    net.send('join', { code });
  } else if (act === 'cancel') { net.send('cancel'); showOnline(); }
  else if (act === 'copy') {
    const url = inviteUrl();
    const done = () => { btn.textContent = '✅ 복사했어요'; setTimeout(() => { btn.textContent = '🔗 초대 링크 복사'; }, 1500); };
    if (navigator.share && matchMedia('(pointer: coarse)').matches) navigator.share({ title: '장기 한 판 둬요!', url }).catch(() => {});
    else if (navigator.clipboard) navigator.clipboard.writeText(url).then(done, () => prompt('링크를 복사하세요', url));
    else prompt('링크를 복사하세요', url);
  } else if (act === 'rematch') { net.send('rematch'); }
  else if (act === 'view') hideOverlay();
  else if (act === 'leave') showOnline();
  else if (act === 'resign') { net.send('resign'); hideOverlay(); }
  else if (act === 'close') hideOverlay();
});
$('overlay').addEventListener('keydown', (e) => {
  if (e.key !== 'Enter') return;
  if (e.target.id === 'codeInput') $('overlay').querySelector('[data-act="join"]').click();
  if (e.target.id === 'nameInput') $('overlay').querySelector('[data-act="quick"]').click();
  e.stopPropagation();
});
$('resignBtn').onclick = (e) => { e.currentTarget.blur(); if (online() && room && room.state === 'playing') confirmResign(); };
setInterval(() => { if (online() && room && room.state === 'playing' && !netDown) renderHud(); }, 500);

// ---------- 시작 ----------
const invite = new URLSearchParams(location.search).get('room');
if (invite) { try { window.history.replaceState(null, '', location.pathname); } catch (_) {} }
function joinInvite(code) { showOnline(); net.send('join', { code: code.toUpperCase() }); }
if (loadSession()) {
  mode = 'online';
  view = null; drawBoard(); render();
  showOverlay('<h2>대국으로 돌아가는 중…</h2>');
  net.connect();
  const until = setInterval(() => {
    if (room || !loadSession()) { clearInterval(until); if (!room) invite ? joinInvite(invite) : showOnline(); }
  }, 100);
} else if (invite) joinInvite(invite);
else showTitle();

/* @test-hooks:start */
window.__jg = { get st() { return st; }, get mode() { return mode; }, get phase() { return phase; }, get room() { return room; }, get sel() { return sel; }, get thinking() { return thinking; }, T, dispatch, startCpu, render, model };
/* @test-hooks:end */
})();

