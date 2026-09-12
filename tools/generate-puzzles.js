// Offline puzzle generator + grader for the Sudoku Notebook puzzle bank.
// Run with: node tools/generate-puzzles.js
// Produces data/puzzles.js containing 100 unique-solution puzzles per
// difficulty tier, graded by which human solving techniques are required
// (not just by how many clues are left).

'use strict';

const fs = require('fs');
const path = require('path');

const SIZE = 9;
const CELLS = 81;
const FULL_MASK = 0x1ff; // bits 0..8 represent digits 1..9

function bitFor(digit) { return 1 << (digit - 1); }
function popcount(mask) {
  let c = 0;
  while (mask) { mask &= mask - 1; c++; }
  return c;
}
function onlyBitDigit(mask) { return Math.log2(mask) + 1; }

// ---- static topology: rows, cols, boxes, units, peers ----
const ROW_OF = [], COL_OF = [], BOX_OF = [];
for (let i = 0; i < CELLS; i++) {
  ROW_OF[i] = Math.floor(i / 9);
  COL_OF[i] = i % 9;
  BOX_OF[i] = Math.floor(ROW_OF[i] / 3) * 3 + Math.floor(COL_OF[i] / 3);
}
const UNITS = []; // 27 units, each an array of 9 cell indices
for (let r = 0; r < 9; r++) UNITS.push([...Array(9)].map((_, c) => r * 9 + c));
for (let c = 0; c < 9; c++) UNITS.push([...Array(9)].map((_, r) => r * 9 + c));
for (let b = 0; b < 9; b++) {
  const br = Math.floor(b / 3) * 3, bc = (b % 3) * 3;
  const cells = [];
  for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) cells.push((br + r) * 9 + (bc + c));
  UNITS.push(cells);
}
const UNITS_OF_CELL = Array.from({ length: CELLS }, () => []);
UNITS.forEach((unit, ui) => unit.forEach((cell) => UNITS_OF_CELL[cell].push(ui)));
const PEERS = Array.from({ length: CELLS }, (_, i) => {
  const set = new Set();
  UNITS_OF_CELL[i].forEach((ui) => UNITS[ui].forEach((c) => { if (c !== i) set.add(c); }));
  return [...set];
});

// ---- RNG (seedable, so runs are reproducible) ----
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function shuffle(arr, rng) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// ---- generate a fully solved random grid ----
function candidateMaskFor(board, i) {
  let mask = FULL_MASK;
  for (const p of PEERS[i]) if (board[p]) mask &= ~bitFor(board[p]);
  return mask;
}
function solvedGridRandom(rng) {
  const board = new Array(CELLS).fill(0);
  function fill(pos) {
    if (pos === CELLS) return true;
    // choose the next empty cell with fewest candidates for speed
    let best = -1, bestCount = 10, bestMask = 0;
    for (let i = 0; i < CELLS; i++) {
      if (board[i]) continue;
      const mask = candidateMaskFor(board, i);
      const cnt = popcount(mask);
      if (cnt < bestCount) { best = i; bestCount = cnt; bestMask = mask; if (cnt === 0) break; }
    }
    if (best === -1) return true;
    if (bestMask === 0) return false;
    const digits = [];
    for (let d = 1; d <= 9; d++) if (bestMask & bitFor(d)) digits.push(d);
    shuffle(digits, rng);
    for (const d of digits) {
      board[best] = d;
      if (fill(pos + 1)) return true;
      board[best] = 0;
    }
    return false;
  }
  fill(0);
  return board;
}

// ---- brute-force solution counter (stops early at `limit`) ----
function countSolutions(board, limit) {
  const work = board.slice();
  let count = 0;
  function solve() {
    let best = -1, bestCount = 10, bestMask = 0;
    for (let i = 0; i < CELLS; i++) {
      if (work[i]) continue;
      const mask = candidateMaskFor(work, i);
      const cnt = popcount(mask);
      if (cnt < bestCount) { best = i; bestCount = cnt; bestMask = mask; if (cnt <= 1) break; }
    }
    if (best === -1) { count++; return count >= limit; }
    if (bestMask === 0) return false;
    for (let d = 1; d <= 9; d++) {
      if (!(bestMask & bitFor(d))) continue;
      work[best] = d;
      if (solve()) return true;
      work[best] = 0;
    }
    return false;
  }
  solve();
  return count;
}

function carvePuzzle(solved, targetGivens, rng) {
  const board = solved.slice();
  const order = shuffle([...Array(CELLS).keys()], rng);
  let givens = CELLS;
  for (const idx of order) {
    if (givens <= targetGivens) break;
    const backup = board[idx];
    board[idx] = 0;
    if (countSolutions(board, 2) === 1) {
      givens--;
    } else {
      board[idx] = backup;
    }
  }
  return { board, givens };
}

// ---- human-technique grader ----
// Level 1: naked single, hidden single
// Level 2: level 1 + locked candidates (pointing/box-line) + naked/hidden pair
// Level 3: level 2 + naked/hidden triple + X-wing
function gradeHumanSolve(board) {
  const cands = new Array(CELLS).fill(0);
  for (let i = 0; i < CELLS; i++) cands[i] = board[i] ? 0 : candidateMaskFor(board, i);
  let maxLevel = 1;
  let filled = board.filter(Boolean).length;

  function assign(i, digit) {
    board[i] = digit;
    cands[i] = 0;
    filled++;
    for (const p of PEERS[i]) if (!board[p]) cands[p] &= ~bitFor(digit);
  }

  function tryLevel1() {
    let progressed = false;
    // naked single
    for (let i = 0; i < CELLS; i++) {
      if (board[i]) continue;
      if (popcount(cands[i]) === 1) { assign(i, onlyBitDigit(cands[i])); progressed = true; }
    }
    if (progressed) return true;
    // hidden single
    for (const unit of UNITS) {
      for (let d = 1; d <= 9; d++) {
        const bit = bitFor(d);
        let where = -1, cnt = 0;
        for (const c of unit) {
          if (!board[c] && (cands[c] & bit)) { cnt++; where = c; }
        }
        if (cnt === 1) { assign(where, d); progressed = true; }
      }
    }
    return progressed;
  }

  function tryLevel2() {
    let progressed = false;
    // locked candidates: pointing (box -> row/col) and box-line reduction (row/col -> box)
    for (let b = 0; b < 9; b++) {
      const boxCells = UNITS[18 + b];
      for (let d = 1; d <= 9; d++) {
        const bit = bitFor(d);
        const cells = boxCells.filter((c) => !board[c] && (cands[c] & bit));
        if (cells.length < 2) continue;
        const rows = new Set(cells.map((c) => ROW_OF[c]));
        const cols = new Set(cells.map((c) => COL_OF[c]));
        if (rows.size === 1) {
          const row = [...rows][0];
          for (const c of UNITS[row]) {
            if (BOX_OF[c] !== b && !board[c] && (cands[c] & bit)) { cands[c] &= ~bit; progressed = true; }
          }
        }
        if (cols.size === 1) {
          const col = [...cols][0];
          for (const c of UNITS[9 + col]) {
            if (BOX_OF[c] !== b && !board[c] && (cands[c] & bit)) { cands[c] &= ~bit; progressed = true; }
          }
        }
      }
    }
    for (const unit of UNITS) {
      for (let d = 1; d <= 9; d++) {
        const bit = bitFor(d);
        const cells = unit.filter((c) => !board[c] && (cands[c] & bit));
        if (cells.length !== 1) continue;
        const box = BOX_OF[cells[0]];
        for (const c of UNITS[18 + box]) {
          if (!unit.includes(c) && !board[c] && (cands[c] & bit)) { cands[c] &= ~bit; progressed = true; }
        }
      }
    }
    // naked pair
    for (const unit of UNITS) {
      const empties = unit.filter((c) => !board[c]);
      for (let a = 0; a < empties.length; a++) {
        for (let b2 = a + 1; b2 < empties.length; b2++) {
          const ca = empties[a], cb = empties[b2];
          if (popcount(cands[ca]) === 2 && cands[ca] === cands[cb]) {
            for (const c of empties) {
              if (c !== ca && c !== cb && (cands[c] & cands[ca])) { cands[c] &= ~cands[ca]; progressed = true; }
            }
          }
        }
      }
    }
    // hidden pair
    for (const unit of UNITS) {
      const empties = unit.filter((c) => !board[c]);
      for (let d1 = 1; d1 <= 9; d1++) {
        for (let d2 = d1 + 1; d2 <= 9; d2++) {
          const bit1 = bitFor(d1), bit2 = bitFor(d2);
          const cellsWith = empties.filter((c) => cands[c] & (bit1 | bit2));
          const cellsWith1 = empties.filter((c) => cands[c] & bit1);
          const cellsWith2 = empties.filter((c) => cands[c] & bit2);
          if (cellsWith1.length === 2 && cellsWith2.length === 2 &&
              cellsWith1[0] === cellsWith2[0] && cellsWith1[1] === cellsWith2[1]) {
            for (const c of cellsWith1) {
              const restricted = cands[c] & (bit1 | bit2);
              if (cands[c] !== restricted) { cands[c] = restricted; progressed = true; }
            }
          }
          void cellsWith;
        }
      }
    }
    return progressed;
  }

  function tryLevel3() {
    let progressed = false;
    // naked triple (per unit)
    for (const unit of UNITS) {
      const empties = unit.filter((c) => !board[c] && popcount(cands[c]) <= 3 && popcount(cands[c]) >= 2);
      for (let a = 0; a < empties.length; a++) {
        for (let b2 = a + 1; b2 < empties.length; b2++) {
          for (let cc = b2 + 1; cc < empties.length; cc++) {
            const union = cands[empties[a]] | cands[empties[b2]] | cands[empties[cc]];
            if (popcount(union) === 3) {
              const triple = [empties[a], empties[b2], empties[cc]];
              for (const c of unit) {
                if (!board[c] && !triple.includes(c) && (cands[c] & union)) { cands[c] &= ~union; progressed = true; }
              }
            }
          }
        }
      }
    }
    // X-Wing: rows -> columns
    for (let d = 1; d <= 9; d++) {
      const bit = bitFor(d);
      const rowCols = [];
      for (let r = 0; r < 9; r++) {
        const cols = [];
        for (let c = 0; c < 9; c++) {
          const cell = r * 9 + c;
          if (!board[cell] && (cands[cell] & bit)) cols.push(c);
        }
        if (cols.length === 2) rowCols.push({ r, cols });
      }
      for (let a = 0; a < rowCols.length; a++) {
        for (let b2 = a + 1; b2 < rowCols.length; b2++) {
          if (rowCols[a].cols[0] === rowCols[b2].cols[0] && rowCols[a].cols[1] === rowCols[b2].cols[1]) {
            const [c1, c2] = rowCols[a].cols;
            const excludeRows = [rowCols[a].r, rowCols[b2].r];
            for (let r = 0; r < 9; r++) {
              if (excludeRows.includes(r)) continue;
              for (const c of [c1, c2]) {
                const cell = r * 9 + c;
                if (!board[cell] && (cands[cell] & bit)) { cands[cell] &= ~bit; progressed = true; }
              }
            }
          }
        }
      }
    }
    return progressed;
  }

  let guard = 0;
  while (filled < CELLS && guard++ < 500) {
    if (tryLevel1()) continue;
    if (tryLevel2()) { maxLevel = Math.max(maxLevel, 2); continue; }
    if (tryLevel3()) { maxLevel = Math.max(maxLevel, 3); continue; }
    break;
  }
  return { solved: filled === CELLS, maxLevel };
}

function toStr(board) { return board.map((d) => d || 0).join(''); }

function main() {
  const rng = mulberry32(20260913);
  const TIER_NAMES = ['easy', 'medium', 'hard'];
  const NEED = { easy: 100, medium: 100, hard: 100 };
  const buckets = { easy: [], medium: [], hard: [] };
  const seenPuzzles = new Set();

  let attempts = 0;
  const MAX_ATTEMPTS = 40000;
  const start = Date.now();

  while ((buckets.easy.length < NEED.easy || buckets.medium.length < NEED.medium || buckets.hard.length < NEED.hard)
         && attempts < MAX_ATTEMPTS) {
    attempts++;
    const deficits = { easy: NEED.easy - buckets.easy.length, medium: NEED.medium - buckets.medium.length, hard: NEED.hard - buckets.hard.length };
    const biasTier = Object.entries(deficits).sort((a, b) => b[1] - a[1])[0][0];
    let targetGivens;
    if (biasTier === 'easy') targetGivens = 38 + Math.floor(rng() * 8); // 38-45
    else if (biasTier === 'medium') targetGivens = 30 + Math.floor(rng() * 8); // 30-37
    else targetGivens = 24 + Math.floor(rng() * 6); // 24-29

    const solved = solvedGridRandom(rng);
    const { board, givens } = carvePuzzle(solved, targetGivens, rng);
    const puzzleStr = toStr(board);
    if (seenPuzzles.has(puzzleStr)) continue;

    const grade = gradeHumanSolve(board.slice());
    if (!grade.solved) continue; // needs guessing beyond our technique set; skip

    const tier = TIER_NAMES[grade.maxLevel - 1];
    if (buckets[tier].length >= NEED[tier]) continue;

    seenPuzzles.add(puzzleStr);
    buckets[tier].push({ puzzle: puzzleStr, solution: toStr(solved), givens });

    if (attempts % 200 === 0) {
      console.log(`[${((Date.now() - start) / 1000).toFixed(1)}s] attempts=${attempts} easy=${buckets.easy.length} medium=${buckets.medium.length} hard=${buckets.hard.length}`);
    }
  }

  for (const tier of TIER_NAMES) {
    buckets[tier].sort((a, b) => b.givens - a.givens); // more givens (gentler) first
  }

  console.log(`Done in ${(Date.now() - start) / 1000}s after ${attempts} attempts.`);
  console.log(`easy=${buckets.easy.length} medium=${buckets.medium.length} hard=${buckets.hard.length}`);

  const outDir = path.join(__dirname, '..', 'data');
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, 'puzzles.js');
  const banner = '// AUTO-GENERATED by tools/generate-puzzles.js — do not hand-edit.\n// Each entry: [puzzleString, solutionString, givensCount]. 0 = blank cell.\n';
  const body = 'window.PUZZLE_BANK = ' + JSON.stringify({
    easy: buckets.easy.map((p) => [p.puzzle, p.solution, p.givens]),
    medium: buckets.medium.map((p) => [p.puzzle, p.solution, p.givens]),
    hard: buckets.hard.map((p) => [p.puzzle, p.solution, p.givens]),
  }) + ';\n';
  fs.writeFileSync(outPath, banner + body, 'utf8');
  console.log('Wrote', outPath);
}

main();
