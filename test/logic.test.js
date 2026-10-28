'use strict';

// 규칙 시험: 처음 판, 말마다 움직임(막힘·뛰어넘기·궁성 대각선), 장군·외통·빅장, 한 수 쉼, 무승부 조건, 무작위 판, 어려움이 쉬움을 이김
// 실행: npm test  (Node 18 이상, 별도 설치 없이 node:test)
const test = require('node:test');
const assert = require('node:assert');
const L = require('../public/logic.js');
const { K, R, C, H, E, A, P } = L;

const rngOf = (seed) => { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; };
const sq = (r, c) => L.idx(r, c);
// 빈 판에 말을 놓는다: [행, 열, 종류, 편(0 초 · 1 한)]
function setup(list, turn = 0) {
  const st = L.newGame();
  st.board = new Array(90).fill(0);
  list.forEach(([r, c, t, s]) => { st.board[sq(r, c)] = L.make(t, s); });
  st.turn = turn;
  st.check = L.inCheck(st.board, turn);
  st.seen = { [st.board.join(',') + '|' + st.turn]: 1 };
  return st;
}
// 한 칸에서 갈 수 있는 곳 (장군은 따지지 않는 수). "행,열" 문자열을 정렬해서 돌려준다
const pm = (st, r, c) => L.pseudoMoves(st.board, L.sideOf(st.board[sq(r, c)])).filter((m) => m[0] === sq(r, c)).map((m) => `${(m[1] / 9) | 0},${m[1] % 9}`).sort();
const set = (...pairs) => pairs.map(([r, c]) => `${r},${c}`).sort();
const legalSet = (st) => L.legalMoves(st).map((m) => `${(m[0] / 9) | 0},${m[0] % 9}>${(m[1] / 9) | 0},${m[1] % 9}`).sort();
const mv = (st, a, b) => L.apply(st, { type: 'move', from: sq(...a), to: sq(...b) });
const count = (b) => b.filter(Boolean).length;

test('start position: 16 pieces each in the standard layout', () => {
  const st = L.newGame();
  assert.strictEqual(count(st.board), 32);
  for (const s of [0, 1]) {
    const mine = st.board.filter((v) => v && L.sideOf(v) === s).map(L.typeOf);
    const n = (t) => mine.filter((x) => x === t).length;
    assert.deepStrictEqual([n(K), n(R), n(C), n(H), n(E), n(A), n(P)], [1, 2, 2, 2, 2, 2, 5], `side ${s}`);
  }
  assert.strictEqual(st.board[sq(8, 4)], L.make(K, 0));
  assert.strictEqual(st.board[sq(1, 4)], L.make(K, 1));
  assert.strictEqual(st.board[sq(9, 0)], L.make(R, 0));
  assert.strictEqual(st.board[sq(0, 8)], L.make(R, 1));
  assert.strictEqual(st.board[sq(7, 1)], L.make(C, 0));
  assert.strictEqual(st.board[sq(2, 7)], L.make(C, 1));
  assert.strictEqual(st.turn, 0);
  assert.ok(!st.check && !st.over);
});

test('start position: the first moves of each kind', () => {
  const st = L.newGame();
  assert.deepStrictEqual(pm(st, 9, 1), set([7, 0], [7, 2]), 'horse');
  assert.deepStrictEqual(pm(st, 9, 2), [], 'elephant is boxed in');
  assert.deepStrictEqual(pm(st, 7, 1), [], 'cannon has nothing to jump');
  assert.deepStrictEqual(pm(st, 9, 3), set([8, 3], [9, 4]), 'guard');
  assert.deepStrictEqual(pm(st, 8, 4), set([7, 4], [9, 4], [8, 3], [8, 5], [7, 3], [7, 5]), 'king uses the palace diagonals');
  assert.deepStrictEqual(pm(st, 6, 4), set([5, 4], [6, 3], [6, 5]), 'soldier');
  assert.ok(L.legalMoves(st).length > 20);
  assert.strictEqual(L.evaluate(st.board, 0), 0, 'the start is even');
  assert.strictEqual(L.evaluate(st.board, 1), 0);
});

test('chariot slides until blocked, captures the first enemy, not its own', () => {
  const st = setup([[5, 4, R, 0], [2, 4, P, 1], [5, 1, P, 0], [9, 3, K, 0], [0, 5, K, 1]]);
  assert.deepStrictEqual(pm(st, 5, 4), set([4, 4], [3, 4], [2, 4], [5, 3], [5, 2], [5, 5], [5, 6], [5, 7], [5, 8], [6, 4], [7, 4], [8, 4], [9, 4]));
});

test('chariot also runs along the palace diagonals', () => {
  const st = setup([[7, 3, R, 0], [9, 4, K, 0], [0, 4, K, 1]]);
  const m = pm(st, 7, 3);
  assert.ok(m.includes('8,4') && m.includes('9,5'), 'down the diagonal through the center');
  const blocked = setup([[7, 3, R, 0], [8, 4, A, 0], [9, 4, K, 0], [0, 4, K, 1]]);
  assert.ok(!pm(blocked, 7, 3).includes('8,4') && !pm(blocked, 7, 3).includes('9,5'));
  const outside = setup([[5, 3, R, 0], [9, 4, K, 0], [0, 4, K, 1]]);
  assert.ok(pm(outside, 5, 3).every((s) => { const [r, c] = s.split(',').map(Number); return r === 5 || c === 3; }), 'no diagonals outside the palace');
});

test('cannon needs exactly one screen, never jumps or takes another cannon', () => {
  let st = setup([[7, 1, C, 0], [5, 1, P, 0], [1, 1, H, 1], [9, 3, K, 0], [0, 5, K, 1]]);
  assert.deepStrictEqual(pm(st, 7, 1).filter((s) => s.endsWith(',1')), set([4, 1], [3, 1], [2, 1], [1, 1]), 'over the soldier, taking the horse');
  st = setup([[7, 1, C, 0], [9, 3, K, 0], [0, 5, K, 1]]);
  assert.deepStrictEqual(pm(st, 7, 1).filter((s) => s.endsWith(',1')), [], 'no screen means no move that way');
  st = setup([[7, 1, C, 0], [5, 1, C, 1], [9, 3, K, 0], [0, 5, K, 1]]);
  assert.deepStrictEqual(pm(st, 7, 1).filter((s) => s.endsWith(',1')), [], 'cannot jump a cannon');
  st = setup([[7, 1, C, 0], [5, 1, P, 0], [3, 1, C, 1], [9, 3, K, 0], [0, 5, K, 1]]);
  assert.deepStrictEqual(pm(st, 7, 1).filter((s) => s.endsWith(',1')), set([4, 1]), 'cannot take a cannon');
  st = setup([[7, 1, C, 0], [6, 1, P, 1], [4, 1, P, 1], [9, 3, K, 0], [0, 5, K, 1]]);
  assert.deepStrictEqual(pm(st, 7, 1).filter((s) => s.endsWith(',1')), set([5, 1], [4, 1]), 'lands before the next piece or takes it');
});

test('cannon jumps along a palace diagonal over the center', () => {
  const st = setup([[7, 3, C, 0], [8, 4, A, 0], [9, 4, K, 0], [0, 4, K, 1]]);
  assert.ok(pm(st, 7, 3).includes('9,5'));
  const bare = setup([[7, 3, C, 0], [9, 4, K, 0], [0, 4, K, 1]]);
  assert.ok(!pm(bare, 7, 3).includes('9,5') && !pm(bare, 7, 3).includes('8,4'), 'no screen on the diagonal');
});

test('horse: eight jumps in the open, blocked by a piece on its first step', () => {
  const open = setup([[5, 4, H, 0], [9, 4, K, 0], [0, 3, K, 1]]);
  assert.deepStrictEqual(pm(open, 5, 4), set([3, 3], [3, 5], [7, 3], [7, 5], [4, 2], [6, 2], [4, 6], [6, 6]));
  const blocked = setup([[5, 4, H, 0], [4, 4, P, 1], [9, 4, K, 0], [0, 3, K, 1]]);
  assert.deepStrictEqual(pm(blocked, 5, 4), set([7, 3], [7, 5], [4, 2], [6, 2], [4, 6], [6, 6]), 'the soldier in front blocks both forward jumps');
});

test('elephant: three steps, blocked by either of the two squares it passes', () => {
  const open = setup([[5, 4, E, 0], [9, 4, K, 0], [0, 3, K, 1]]);
  assert.deepStrictEqual(pm(open, 5, 4), set([2, 2], [2, 6], [8, 2], [8, 6], [3, 1], [7, 1], [3, 7], [7, 7]));
  const leg = setup([[5, 4, E, 0], [4, 4, P, 1], [9, 4, K, 0], [0, 3, K, 1]]);
  assert.ok(!pm(leg, 5, 4).includes('2,2') && !pm(leg, 5, 4).includes('2,6'), 'first square blocked');
  const mid = setup([[5, 4, E, 0], [3, 3, P, 1], [9, 4, K, 0], [0, 3, K, 1]]);
  assert.ok(!pm(mid, 5, 4).includes('2,2') && pm(mid, 5, 4).includes('2,6'), 'second square blocked on one side only');
  const edge = setup([[0, 0, E, 0], [9, 4, K, 0], [0, 4, K, 1]]);
  assert.deepStrictEqual(pm(edge, 0, 0), set([3, 2], [2, 3]));
});

test('soldier: forward and sideways only, diagonals only inside the enemy palace', () => {
  const mid = setup([[5, 4, P, 0], [9, 3, K, 0], [0, 5, K, 1]]);
  assert.deepStrictEqual(pm(mid, 5, 4), set([4, 4], [5, 3], [5, 5]));
  const down = setup([[4, 4, P, 1], [9, 3, K, 0], [0, 5, K, 1]], 1);
  assert.deepStrictEqual(pm(down, 4, 4), set([5, 4], [4, 3], [4, 5]), 'the other side moves down the board');
  const corner = setup([[2, 3, P, 0], [9, 3, K, 0], [0, 5, K, 1]]);
  assert.deepStrictEqual(pm(corner, 2, 3), set([1, 3], [2, 2], [2, 4], [1, 4]));
  const center = setup([[1, 4, P, 0], [9, 3, K, 0], [0, 5, K, 1]]);
  assert.deepStrictEqual(pm(center, 1, 4), set([0, 4], [1, 3], [1, 5], [0, 3]).concat(['0,5']).sort());
  const theirs = setup([[7, 5, P, 1], [9, 3, K, 0], [0, 5, K, 1]], 1);
  assert.deepStrictEqual(pm(theirs, 7, 5), set([8, 5], [7, 4], [7, 6], [8, 4]));
  const own = setup([[8, 4, P, 0], [9, 3, K, 0], [0, 5, K, 1]]);
  assert.ok(!pm(own, 8, 4).includes('7,3'), 'no palace diagonals in your own palace for a soldier');
});

test('king and guard stay in the palace and follow its lines', () => {
  const open = setup([[8, 4, K, 0], [0, 4, K, 1]]);
  assert.strictEqual(pm(open, 8, 4).length, 8);
  const edge = setup([[9, 4, K, 0], [0, 4, K, 1]]);
  assert.deepStrictEqual(pm(edge, 9, 4), set([8, 4], [9, 3], [9, 5]), 'no diagonals from a side point');
  const guard = setup([[7, 3, A, 0], [9, 4, K, 0], [0, 4, K, 1]]);
  assert.deepStrictEqual(pm(guard, 7, 3), set([7, 4], [8, 3], [8, 4]), 'a corner goes only to the center on the diagonal');
  const wall = setup([[7, 4, A, 0], [9, 4, K, 0], [0, 4, K, 1]]);
  assert.ok(pm(wall, 7, 4).every((s) => { const [r, c] = s.split(',').map(Number); return r >= 7 && c >= 3 && c <= 5; }));
});

test('in check you must answer it: move, capture or block', () => {
  const st = setup([[9, 4, K, 0], [5, 4, R, 1], [6, 0, R, 0], [0, 4, K, 1]]);
  assert.ok(L.inCheck(st.board, 0));
  assert.deepStrictEqual(legalSet(st), ['6,0>6,4', '9,4>9,3', '9,4>9,5'].sort());
  assert.strictEqual(L.canPass(st), false, 'no passing in check');
  assert.strictEqual(L.apply(st, { type: 'pass' }), null);
  assert.strictEqual(st.turn, 0, 'nothing changed');
});

test('moves that leave the generals facing each other are refused', () => {
  const st = setup([[9, 4, K, 0], [0, 4, K, 1], [5, 4, P, 0]]);
  const soldier = L.legalMoves(st).filter((m) => m[0] === sq(5, 4)).map((m) => `${(m[1] / 9) | 0},${m[1] % 9}`);
  assert.deepStrictEqual(soldier, ['4,4'], 'only the forward step keeps the soldier between the kings');
  assert.strictEqual(L.apply(st, { type: 'move', from: sq(5, 4), to: sq(5, 3) }), null);
});

test('checkmate ends the game with the mover winning', () => {
  // 한의 장은 (0,4): 옆칸 둘은 차가 노리고, (1,4)는 가로줄의 차가 노린다. (5,0) 의 차가 (5,4) 로 와서 장군
  const st = setup([[9, 3, K, 0], [0, 4, K, 1], [5, 0, R, 0], [1, 0, R, 0], [7, 3, R, 0], [7, 5, R, 0]]);
  assert.ok(!L.inCheck(st.board, 1));
  const ev = mv(st, [5, 0], [5, 4]);
  assert.ok(ev && ev.check, 'it is check');
  assert.strictEqual(st.over, true);
  assert.strictEqual(st.winner, 0);
  assert.strictEqual(st.reason, 'checkmate');
  assert.strictEqual(L.apply(st, { type: 'pass' }), null, 'nothing after the end');
  assert.strictEqual(L.aiPick(st, 'hard'), null);
});

test('a pass is allowed when not in check, and two passes in a row draw', () => {
  const st = L.newGame();
  assert.ok(L.apply(st, { type: 'pass' }));
  assert.strictEqual(st.turn, 1);
  assert.strictEqual(st.over, false);
  assert.ok(L.apply(st, { type: 'pass' }));
  assert.strictEqual(st.over, true);
  assert.strictEqual(st.winner, 2);
  assert.strictEqual(st.reason, 'pass');
});

test('the same position three times is a draw', () => {
  const st = setup([[9, 3, K, 0], [0, 5, K, 1], [5, 0, R, 0], [4, 8, R, 1]]);
  const cycle = [[[5, 0], [5, 1]], [[4, 8], [4, 7]], [[5, 1], [5, 0]], [[4, 7], [4, 8]]];
  for (let round = 0; round < 2; round++) for (const [a, b] of cycle) { assert.ok(!st.over); assert.ok(mv(st, a, b)); }
  assert.strictEqual(st.over, true);
  assert.strictEqual(st.winner, 2);
  assert.strictEqual(st.reason, 'repetition');
  assert.strictEqual(st.plies, 8);
});

test('120 plies without a capture is a draw, and a capture resets the count', () => {
  const st = setup([[9, 3, K, 0], [0, 5, K, 1], [5, 0, R, 0], [4, 8, R, 1], [5, 8, P, 1]]);
  st.noCapture = 119;
  assert.ok(mv(st, [5, 0], [5, 1]));
  assert.strictEqual(st.reason, 'limit');
  const cap = setup([[9, 3, K, 0], [0, 5, K, 1], [5, 0, R, 0], [5, 8, P, 1]]);
  cap.noCapture = 100;
  assert.ok(mv(cap, [5, 0], [5, 8]));
  assert.strictEqual(cap.noCapture, 0);
  assert.deepStrictEqual(cap.taken[0], [L.make(P, 1)]);
});

test('illegal actions are refused and change nothing', () => {
  const st = L.newGame();
  const before = JSON.stringify(st);
  const bad = [null, {}, { type: 'x' }, { type: 'move' }, { type: 'move', from: 'a', to: 1 }, { type: 'move', from: 1.5, to: 2 }, { type: 'move', from: sq(5, 5), to: sq(4, 5) },
    { type: 'move', from: sq(0, 0), to: sq(1, 0) }, { type: 'move', from: sq(9, 0), to: sq(9, 1) }, { type: 'move', from: sq(9, 1), to: sq(7, 1) }, { type: 'move', from: -1, to: 200 }, 'move', 5];
  for (const a of bad) assert.strictEqual(L.apply(st, a), null, JSON.stringify(a));
  assert.strictEqual(JSON.stringify(st), before);
});

test('random games: every move is legal, kings stay, pieces only disappear, and the game can end', () => {
  const rand = rngOf(7);
  let ended = 0;
  for (let g = 0; g < 12; g++) {
    const st = L.newGame();
    let prev = count(st.board);
    for (let n = 0; n < 400 && !st.over; n++) {
      const a = L.aiPick(st, 'easy', rand);
      assert.ok(a, 'a move exists');
      assert.ok(L.apply(st, a), 'ai move is legal');
      const now = count(st.board);
      assert.ok(now <= prev, 'pieces never appear');
      prev = now;
      assert.ok(st.board.includes(L.make(K, 0)) && st.board.includes(L.make(K, 1)), 'kings are never taken');
      assert.ok(!L.facing(st.board), 'generals never face each other');
    }
    if (st.over) ended++;
  }
  assert.ok(ended >= 6, `most games end by themselves (${ended}/12)`);
});

test('the computer finds mate in one', () => {
  const st = setup([[9, 3, K, 0], [0, 4, K, 1], [5, 0, R, 0], [1, 0, R, 0], [7, 3, R, 0], [7, 5, R, 0]]);
  const a = L.aiPick(st, 'hard1', rngOf(3));
  const t = L.clone(st);
  assert.ok(L.apply(t, a));
  assert.strictEqual(t.reason, 'checkmate');
});

test('the computer takes a free chariot and avoids hanging its own', () => {
  const free = setup([[9, 3, K, 0], [0, 5, K, 1], [6, 2, R, 0], [6, 7, R, 1]]);
  const a = L.aiPick(free, 'hard1', rngOf(5));
  assert.strictEqual(a.to, sq(6, 7), 'takes the loose chariot');
  const guarded = setup([[9, 3, K, 0], [0, 5, K, 1], [6, 2, R, 0], [6, 7, R, 1], [6, 8, R, 1]]);
  const b = L.aiPick(guarded, 'hard1', rngOf(5));
  assert.notStrictEqual(b.to, sq(6, 7), 'does not trade into a recapture it would lose');
});

test('hard beats easy in most games (seats alternate)', () => {
  const rand = rngOf(11);
  let score = 0, games = 0;
  for (let g = 0; g < 16; g++) {
    const hardSide = g % 2;
    const st = L.newGame();
    for (let n = 0; n < 300 && !st.over; n++) st.over || L.apply(st, L.aiPick(st, st.turn === hardSide ? 'hard' : 'easy', rand));
    games++;
    if (st.winner === hardSide) score += 1; else if (st.winner === 2 || !st.over) score += 0.5;
  }
  assert.ok(score / games >= 0.75, `hard scored ${score}/${games}`);
});
