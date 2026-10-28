'use strict';

// 장기: 규칙과 컴퓨터만 모아 둔 파일 (그리기·입력 없음). 브라우저·서버·테스트(Node)가 같이 쓴다.
//
// - 판은 가로 9줄 x 세로 10줄의 **교차점**에 말을 놓는다. 초(아래, 먼저 둠)와 한(위). 각자 장 1 · 차 2 · 포 2 · 마 2 · 상 2 · 사 2 · 졸 5
// - 장·사: 궁성(3x3) 안에서 한 칸씩, 궁성의 대각선 줄을 따라서도 움직인다
// - 차: 가로·세로로 막힐 때까지 몇 칸이든 (궁성 안에서는 대각선 줄도). 상대 말은 잡는다
// - 포: 말 하나(포 제외)를 **뛰어넘어서만** 움직이고 잡는다. 포는 포를 넘지도 잡지도 못한다 (궁성 대각선 줄도 같다)
// - 마: 한 칸 곧게 간 다음 바깥쪽 대각선으로 한 칸. 곧게 가는 칸에 말이 있으면 못 간다 (멱)
// - 상: 한 칸 곧게, 대각선으로 두 칸. 지나는 두 칸에 말이 있으면 못 간다
// - 졸·병: 앞이나 옆으로 한 칸 (뒤로는 못 감). 상대 궁성 안에서는 대각선 줄로 앞 대각선도 간다
// - 장군: 상대 장을 잡을 수 있게 되면 장군. 내 장이 잡히는 수와 두 장이 아무 말 없이 마주 서게 되는 수(빅장)는 둘 수 없다
// - 한 수 쉼: 장군을 받는 중이 아니면 한 수를 쉴 수 있다
// - 끝: 장군을 피할 수 없으면(외통) 진다. 같은 판이 세 번 나오거나(반복), 잡는 일 없이 120수가 지나거나, 서로 연달아 쉬면 무승부
// - 쉽게 하려고 정식 대회 규칙의 빅장 처리·점수 계산은 넣지 않았다 (빅장이 되는 수는 아예 못 두게 했다)
const LOGIC_JANGGI = (() => {
const ROWS = 10, COLS = 9;
const K = 1, R = 2, C = 3, H = 4, E = 5, A = 6, P = 7;           // 장 차 포 마 상 사 졸
const NAMES = ['', '장', '차', '포', '마', '상', '사', '졸'];
const VALUE = [0, 0, 13, 7, 5, 3, 3, 2];                          // 말의 값 (장은 따로)
const NO_CAPTURE_LIMIT = 120;

const typeOf = (v) => v & 7;
const sideOf = (v) => (v >> 3);                                   // 0 초, 1 한 (빈칸은 0 이니 typeOf 로 먼저 거른다)
const make = (t, s) => t + (s ? 8 : 0);
const idx = (r, c) => r * COLS + c;
const onBoard = (r, c) => r >= 0 && r < ROWS && c >= 0 && c < COLS;

// 궁성: 초는 아래 3줄(7~9), 한은 위 3줄(0~2), 가운데 3열(3~5). 대각선 줄 위의 점은 안쪽 좌표의 합이 짝수인 점
const palaceTop = (side) => (side === 0 ? 7 : 0);
const inPalaceOf = (side, r, c) => c >= 3 && c <= 5 && r >= palaceTop(side) && r <= palaceTop(side) + 2;
const palaceAt = (r, c) => (c < 3 || c > 5 ? -1 : r <= 2 ? 1 : r >= 7 ? 0 : -1);
const diagPoint = (r, c) => { const p = palaceAt(r, c); return p >= 0 && ((r - palaceTop(p)) + (c - 3)) % 2 === 0; };
const ORTHO = [[-1, 0], [1, 0], [0, -1], [0, 1]];
const DIAG = [[-1, -1], [-1, 1], [1, -1], [1, 1]];

// ---------- 처음 판 ----------
// 뒷줄(왼쪽부터): 차 마 상 사 · 사 상 마 차 (안상차림). 장은 궁성 한가운데, 포는 둘째 줄 끝에서 두 번째, 졸은 한 칸 건너
function newBoard() {
  const b = new Array(ROWS * COLS).fill(0);
  const back = [R, H, E, A, 0, A, E, H, R];
  for (let s = 0; s < 2; s++) {
    const rBack = s === 0 ? 9 : 0, rKing = s === 0 ? 8 : 1, rCan = s === 0 ? 7 : 2, rSol = s === 0 ? 6 : 3;
    back.forEach((t, c) => { if (t) b[idx(rBack, c)] = make(t, s); });
    b[idx(rKing, 4)] = make(K, s);
    b[idx(rCan, 1)] = make(C, s); b[idx(rCan, 7)] = make(C, s);
    for (let c = 0; c < COLS; c += 2) b[idx(rSol, c)] = make(P, s);
  }
  return b;
}
function newGame() {
  const st = { board: newBoard(), turn: 0, plies: 0, noCapture: 0, passes: 0, seen: {}, taken: [[], []], check: false, over: false, winner: -1, reason: '', last: null };
  st.seen[posKey(st)] = 1;
  return st;
}
const posKey = (st) => st.board.join(',') + '|' + st.turn;
const clone = (st) => ({ board: st.board.slice(), turn: st.turn, plies: st.plies, noCapture: st.noCapture, passes: st.passes, seen: Object.assign({}, st.seen), taken: [st.taken[0].slice(), st.taken[1].slice()], check: st.check, over: st.over, winner: st.winner, reason: st.reason, last: st.last });

// ---------- 말 움직임 (장군 여부는 따지지 않는 수) ----------
// 반환: [from, to] 목록
function pseudoMoves(b, side, out = []) {
  for (let i = 0; i < b.length; i++) {
    const v = b[i];
    if (!v || sideOf(v) !== side) continue;
    pieceMoves(b, i, v, side, out);
  }
  return out;
}
function pieceMoves(b, i, v, side, out) {
  const r = (i / COLS) | 0, c = i % COLS, t = typeOf(v);
  const add = (nr, nc) => { const j = idx(nr, nc); const w = b[j]; if (!w || sideOf(w) !== side) out.push([i, j]); };
  if (t === K || t === A) {
    for (const [dr, dc] of ORTHO) { const nr = r + dr, nc = c + dc; if (inPalaceOf(side, nr, nc)) add(nr, nc); }
    if (diagPoint(r, c)) for (const [dr, dc] of DIAG) { const nr = r + dr, nc = c + dc; if (inPalaceOf(side, nr, nc)) add(nr, nc); }
  } else if (t === R) {
    for (const [dr, dc] of ORTHO) {
      for (let nr = r + dr, nc = c + dc; onBoard(nr, nc); nr += dr, nc += dc) {
        const w = b[idx(nr, nc)];
        if (!w) { out.push([i, idx(nr, nc)]); continue; }
        if (sideOf(w) !== side) out.push([i, idx(nr, nc)]);
        break;
      }
    }
    if (diagPoint(r, c)) {
      const p = palaceAt(r, c);
      for (const [dr, dc] of DIAG) {
        for (let nr = r + dr, nc = c + dc; inPalaceOf(p, nr, nc); nr += dr, nc += dc) {
          const w = b[idx(nr, nc)];
          if (!w) { out.push([i, idx(nr, nc)]); continue; }
          if (sideOf(w) !== side) out.push([i, idx(nr, nc)]);
          break;
        }
      }
    }
  } else if (t === C) {
    const jump = (dr, dc, inside) => {                          // inside: 궁성 안에서만 가는 대각선이면 그 궁성 번호
      let nr = r + dr, nc = c + dc;
      const ok = (a, d) => (inside >= 0 ? inPalaceOf(inside, a, d) : onBoard(a, d));
      while (ok(nr, nc) && !b[idx(nr, nc)]) { nr += dr; nc += dc; }
      if (!ok(nr, nc) || typeOf(b[idx(nr, nc)]) === C) return;  // 넘을 말이 없거나 포
      nr += dr; nc += dc;
      while (ok(nr, nc)) {
        const w = b[idx(nr, nc)];
        if (!w) { out.push([i, idx(nr, nc)]); nr += dr; nc += dc; continue; }
        if (sideOf(w) !== side && typeOf(w) !== C) out.push([i, idx(nr, nc)]);
        break;
      }
    };
    for (const [dr, dc] of ORTHO) jump(dr, dc, -1);
    if (diagPoint(r, c)) { const p = palaceAt(r, c); for (const [dr, dc] of DIAG) jump(dr, dc, p); }
  } else if (t === H) {
    for (const [dr, dc] of ORTHO) {
      const lr = r + dr, lc = c + dc;
      if (!onBoard(lr, lc) || b[idx(lr, lc)]) continue;          // 멱
      const sides = dr ? [[dr, -1], [dr, 1]] : [[-1, dc], [1, dc]];
      for (const [er, ec] of sides) { const nr = lr + er, nc = lc + ec; if (onBoard(nr, nc)) add(nr, nc); }
    }
  } else if (t === E) {
    for (const [dr, dc] of ORTHO) {
      const lr = r + dr, lc = c + dc;
      if (!onBoard(lr, lc) || b[idx(lr, lc)]) continue;
      const turns = dr ? [-1, 1].map((s) => [dr, s]) : [-1, 1].map((s) => [s, dc]);
      for (const [er, ec] of turns) {
        const mr = lr + er, mc = lc + ec;                        // 첫 대각선 칸
        if (!onBoard(mr, mc) || b[idx(mr, mc)]) continue;
        const nr = mr + er, nc = mc + ec;
        if (onBoard(nr, nc)) add(nr, nc);
      }
    }
  } else if (t === P) {
    const fwd = side === 0 ? -1 : 1;
    for (const [dr, dc] of [[fwd, 0], [0, -1], [0, 1]]) { const nr = r + dr, nc = c + dc; if (onBoard(nr, nc)) add(nr, nc); }
    if (palaceAt(r, c) === 1 - side && diagPoint(r, c)) {
      for (const dc of [-1, 1]) { const nr = r + fwd, nc = c + dc; if (inPalaceOf(1 - side, nr, nc)) add(nr, nc); }
    }
  }
}

const kingIdx = (b, side) => b.indexOf(make(K, side));
function attacked(b, target, bySide) {
  const ms = pseudoMoves(b, bySide);
  for (const m of ms) if (m[1] === target) return true;
  return false;
}
function inCheck(b, side) {
  const k = kingIdx(b, side);
  return k >= 0 && attacked(b, k, 1 - side);
}
// 두 장이 같은 줄에서 사이에 아무 말도 없이 마주 보는가 (빅장)
function facing(b) {
  const a = kingIdx(b, 0), z = kingIdx(b, 1);
  if (a < 0 || z < 0 || a % COLS !== z % COLS) return false;
  for (let i = z + COLS; i < a; i += COLS) if (b[i]) return false;
  return true;
}

function legalMoves(st) {
  const side = st.turn, out = [];
  for (const m of pseudoMoves(st.board, side)) {
    const b = st.board.slice();
    b[m[1]] = b[m[0]]; b[m[0]] = 0;
    if (facing(b) || inCheck(b, side)) continue;
    out.push(m);
  }
  return out;
}
const canPass = (st) => !st.over && !inCheck(st.board, st.turn);

// 동작: { type: 'move', from, to } 또는 { type: 'pass' }. 규칙에 어긋나면 null
function apply(st, action) {
  if (st.over || !action || typeof action !== 'object') return null;
  const side = st.turn;
  let ev;
  if (action.type === 'pass') {
    if (!canPass(st)) return null;
    st.passes++;
    ev = { who: side, type: 'pass' };
    st.noCapture++;
  } else if (action.type === 'move') {
    if (!Number.isInteger(action.from) || !Number.isInteger(action.to)) return null;
    if (!legalMoves(st).some((m) => m[0] === action.from && m[1] === action.to)) return null;
    const piece = st.board[action.from], cap = st.board[action.to];
    st.board[action.to] = piece; st.board[action.from] = 0;
    st.passes = 0;
    if (cap) { st.taken[side].push(cap); st.noCapture = 0; } else st.noCapture++;
    ev = { who: side, type: 'move', from: action.from, to: action.to, piece, captured: cap };
  } else return null;
  st.plies++;
  st.turn = 1 - side;
  st.check = inCheck(st.board, st.turn);
  ev.check = st.check;
  st.last = ev;
  const key = posKey(st);
  st.seen[key] = (st.seen[key] || 0) + 1;
  if (st.check && legalMoves(st).length === 0) end(st, side, 'checkmate');
  else if (st.seen[key] >= 3) end(st, 2, 'repetition');
  else if (st.passes >= 2) end(st, 2, 'pass');
  else if (st.noCapture >= NO_CAPTURE_LIMIT) end(st, 2, 'limit');
  ev.over = st.over;
  return ev;
}
function end(st, winner, reason) { st.over = true; st.winner = winner; st.reason = reason; }

// ---------- 컴퓨터 ----------
const WIN = 100000;
const VAL = [0, 0, 1300, 700, 500, 300, 300, 200];
const POS_W = 6;
// 한쪽 시점의 점수: 말의 값 + 졸이 앞으로 나온 만큼 + 사·상이 남아 장을 지키는 만큼
function evaluate(b, side) {
  let s = 0;
  const kr = [-1, -1], kc = [-1, -1];                           // 두 장의 자리 (공격하는 말이 상대 장에 가까울수록 점수)
  for (let i = 0; i < b.length; i++) { const v = b[i]; if (v && typeOf(v) === K) { kr[sideOf(v)] = (i / COLS) | 0; kc[sideOf(v)] = i % COLS; } }
  for (let i = 0; i < b.length; i++) {
    const v = b[i];
    if (!v) continue;
    const t = typeOf(v), sd = sideOf(v), r = (i / COLS) | 0, c = i % COLS;
    let x = VAL[t];
    if (t === P) { const adv = sd === 0 ? 6 - r : r - 3; x += Math.max(0, adv) * POS_W + (c >= 2 && c <= 6 ? 4 : 0); }
    else if (t === R || t === H || t === C) {
      x += (4 - Math.abs(c - 4)) * 2 + ((sd === 0 ? 9 - r : r) < 8 ? 6 : 0);
      const e = 1 - sd;
      if (kr[e] >= 0) x += Math.max(0, 12 - Math.abs(r - kr[e]) - Math.abs(c - kc[e])) * 3;
    }
    s += sd === side ? x : -x;
  }
  return s;
}
function search(b, side, depth, alpha, beta) {
  if (depth === 0) return evaluate(b, side);
  const ms = pseudoMoves(b, side);
  // 잡는 수를 먼저 (큰 말부터). 마지막에 '한 수 쉼'도 따져 본다 (장군을 받는 중에 쉬면 다음 수에 장을 잡히니 저절로 걸러진다)
  ms.sort((x, y) => VAL[typeOf(b[y[1]])] - VAL[typeOf(b[x[1]])]);
  ms.push(null);
  let best = -Infinity;
  for (const m of ms) {
    if (m === null) {
      const sc = -search(b, 1 - side, depth - 1, -beta, -alpha);
      if (sc > best) best = sc;
      break;
    }
    const cap = b[m[1]];
    if (typeOf(cap) === K) return WIN + depth;                    // 장을 잡으면 이긴 것
    const mover = b[m[0]];
    b[m[1]] = mover; b[m[0]] = 0;
    let sc;
    if (facing(b)) sc = -Infinity;                                // 빅장이 되는 수는 못 둔다
    else sc = -search(b, 1 - side, depth - 1, -beta, -alpha);
    b[m[0]] = mover; b[m[1]] = cap;
    if (sc > best) best = sc;
    if (best > alpha) alpha = best;
    if (alpha >= beta) break;
  }
  return best === -Infinity ? -WIN : best;
}
const DEPTH = { easy: 1, hard: 3 };
const HARD_SLIP = 0.15;                  // 어려움이 일곱 번에 한 번쯤은 쉬움처럼 둔다 (사람이 이길 만하게)
function pickMove(st, depth, rand, tol) {
  const moves = legalMoves(st);
  if (!moves.length) return null;
  const b = st.board.slice();
  const scored = moves.map((m) => {
    const cap = b[m[1]], mover = b[m[0]];
    b[m[1]] = mover; b[m[0]] = 0;
    const sc = -search(b, 1 - st.turn, depth - 1, -Infinity, Infinity);
    b[m[0]] = mover; b[m[1]] = cap;
    return { m, sc };
  });
  const top = Math.max(...scored.map((x) => x.sc));
  const near = scored.filter((x) => x.sc >= top - tol);
  return near[Math.floor(rand() * near.length)].m;
}
function aiPick(st, level, rand = Math.random) {
  if (st.over) return null;
  const legal = legalMoves(st);
  if (!legal.length) return canPass(st) ? { type: 'pass' } : null;
  let m;
  if (level === 'hard' && rand() >= HARD_SLIP) m = pickMove(st, DEPTH.hard, rand, 8);
  else if (level === 'hard1') m = pickMove(st, DEPTH.hard, rand, 8);
  else m = rand() < 0.3 ? legal[Math.floor(rand() * legal.length)] : pickMove(st, DEPTH.easy, rand, 150);
  return { type: 'move', from: m[0], to: m[1] };
}

// 화면용: 한 말이 갈 수 있는 곳
function movesFrom(st, from) { return legalMoves(st).filter((m) => m[0] === from).map((m) => m[1]); }

return { ROWS, COLS, K, R, C, H, E, A, P, NAMES, VALUE, NO_CAPTURE_LIMIT, DEPTH, HARD_SLIP, typeOf, sideOf, make, idx, onBoard, inPalaceOf, palaceAt, diagPoint, newBoard, newGame, clone, pseudoMoves, inCheck, facing, legalMoves, canPass, apply, evaluate, aiPick, movesFrom, kingIdx };
})();
if (typeof module !== 'undefined') module.exports = LOGIC_JANGGI;
