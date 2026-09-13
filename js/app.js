// Sudoku Notebook — app.js
// Pure vanilla JS game controller. Puzzles come pre-generated + pre-graded
// from data/puzzles.js (window.PUZZLE_BANK), so no solver runs in the browser.
(function () {
  'use strict';

  const LEVELS = ['easy', 'medium', 'hard'];
  const LEVEL_LABEL = { easy: '簡單', medium: '中等', hard: '困難' };
  const MAX_HINTS = 3;
  const PUZZLES_PER_LEVEL = 100;

  const KEY_PROGRESS = 'sn:progress';
  const KEY_THEME = 'sn:theme';
  const KEY_CURRENT = 'sn:current';
  const KEY_LAST_LEVEL = 'sn:lastLevel';

  // ---- topology helpers ----
  const ROW_OF = [], COL_OF = [], BOX_OF = [];
  for (let i = 0; i < 81; i++) {
    ROW_OF[i] = Math.floor(i / 9);
    COL_OF[i] = i % 9;
    BOX_OF[i] = Math.floor(ROW_OF[i] / 3) * 3 + Math.floor(COL_OF[i] / 3);
  }
  const PEERS = Array.from({ length: 81 }, (_, i) => {
    const set = new Set();
    for (let c = 0; c < 81; c++) {
      if (c === i) continue;
      if (ROW_OF[c] === ROW_OF[i] || COL_OF[c] === COL_OF[i] || BOX_OF[c] === BOX_OF[i]) set.add(c);
    }
    return [...set];
  });

  function strToBoard(s) { return s.split('').map(Number); }
  function pad2(n) { return n < 10 ? '0' + n : '' + n; }
  function fmtTime(totalSeconds) {
    const s = Math.max(0, Math.floor(totalSeconds));
    return pad2(Math.floor(s / 60)) + ':' + pad2(s % 60);
  }

  // ---- persistence ----
  function defaultProgress() {
    const mk = () => Array.from({ length: PUZZLES_PER_LEVEL }, () => ({ completed: false, bestTime: null }));
    return { easy: mk(), medium: mk(), hard: mk() };
  }
  function loadProgress() {
    try {
      const raw = JSON.parse(localStorage.getItem(KEY_PROGRESS));
      if (!raw) return defaultProgress();
      for (const lv of LEVELS) if (!Array.isArray(raw[lv]) || raw[lv].length !== PUZZLES_PER_LEVEL) return defaultProgress();
      return raw;
    } catch (e) { return defaultProgress(); }
  }
  function saveProgress(p) { localStorage.setItem(KEY_PROGRESS, JSON.stringify(p)); }

  function loadTheme() { return localStorage.getItem(KEY_THEME) || 'paper'; }
  function applyTheme(t) {
    document.documentElement.setAttribute('data-theme', t);
    localStorage.setItem(KEY_THEME, t);
    document.querySelectorAll('.theme-opt').forEach((b) => b.classList.toggle('active', b.dataset.theme === t));
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.content = getComputedStyle(document.documentElement).getPropertyValue('--bg-app').trim() || '#EEE3CC';
  }

  function saveCurrentGame() {
    if (!game || game.finished) return;
    localStorage.setItem(KEY_CURRENT, JSON.stringify({
      level: game.level, index: game.index, board: game.board, notes: game.notes,
      hintsUsed: game.hintsUsed, elapsedBefore: currentElapsed(), notesMode: game.notesMode,
    }));
  }
  function loadCurrentGame() {
    try { return JSON.parse(localStorage.getItem(KEY_CURRENT)); } catch (e) { return null; }
  }
  function clearCurrentGame() { localStorage.removeItem(KEY_CURRENT); }

  // ---- game state ----
  let game = null; // active game object
  let progress = loadProgress();

  function currentElapsed() {
    if (!game) return 0;
    if (game.timerRunning) return game.elapsedBefore + (Date.now() - game.startedAt) / 1000;
    return game.elapsedBefore;
  }

  function newGameFromBank(level, index, resumeData) {
    const entry = window.PUZZLE_BANK[level][index];
    const puzzle = strToBoard(entry[0]);
    const solution = strToBoard(entry[1]);
    const given = puzzle.map((v) => v !== 0);
    return {
      level, index, solution, given,
      board: resumeData ? resumeData.board.slice() : puzzle.slice(),
      notes: resumeData ? resumeData.notes.slice() : new Array(81).fill(0),
      selected: null,
      notesMode: resumeData ? !!resumeData.notesMode : false,
      hintsUsed: resumeData ? resumeData.hintsUsed : 0,
      history: [],
      elapsedBefore: resumeData ? resumeData.elapsedBefore : 0,
      startedAt: Date.now(),
      timerRunning: true,
      finished: false,
    };
  }

  function startPuzzle(level, index, resumeData) {
    stopTimerInterval();
    game = newGameFromBank(level, index, resumeData);
    showScreen('game');
    renderGame();
    startTimerInterval();
    saveCurrentGame();
  }

  // ---- conflict detection ----
  function computeErrors(board) {
    const errors = new Set();
    for (let i = 0; i < 81; i++) {
      if (!board[i]) continue;
      for (const p of PEERS[i]) {
        if (board[p] === board[i]) { errors.add(i); errors.add(p); break; }
      }
    }
    return errors;
  }

  // ---- DOM refs ----
  const el = {
    home: document.getElementById('screen-home'),
    gameScreen: document.getElementById('screen-game'),
    resumeBanner: document.getElementById('resume-banner'),
    resumeTitle: document.getElementById('resume-title'),
    resumeSub: document.getElementById('resume-sub'),
    btnResume: document.getElementById('btn-resume'),
    levelBtns: document.querySelectorAll('.level-btn'),
    progressText: document.getElementById('level-progress-text'),
    progressFill: document.getElementById('level-progress-fill'),
    puzzleGrid: document.getElementById('puzzle-grid'),
    btnBack: document.getElementById('btn-back'),
    gameLevelLabel: document.getElementById('game-level-label'),
    gamePuzzleLabel: document.getElementById('game-puzzle-label'),
    timerLabel: document.getElementById('timer-label'),
    btnTimer: document.getElementById('btn-timer'),
    board: document.getElementById('board'),
    numpad: document.getElementById('numpad'),
    btnUndo: document.getElementById('btn-undo'),
    btnNotes: document.getElementById('btn-notes'),
    btnErase: document.getElementById('btn-erase'),
    btnHint: document.getElementById('btn-hint'),
    hintCount: document.getElementById('hint-count'),
    pauseOverlay: document.getElementById('pause-overlay'),
    btnResumePause: document.getElementById('btn-resume-pause'),
    winOverlay: document.getElementById('win-overlay'),
    winTime: document.getElementById('win-time'),
    winBest: document.getElementById('win-best'),
    btnWinMenu: document.getElementById('btn-win-menu'),
    btnWinNext: document.getElementById('btn-win-next'),
    btnTheme: document.getElementById('btn-theme'),
    themeSheet: document.getElementById('theme-sheet'),
    btnThemeClose: document.getElementById('btn-theme-close'),
  };

  let activeHomeLevel = localStorage.getItem(KEY_LAST_LEVEL) || 'easy';

  function showScreen(name) {
    el.home.hidden = name !== 'home';
    el.gameScreen.hidden = name !== 'game';
  }

  // ---- HOME rendering ----
  function renderHome() {
    el.levelBtns.forEach((b) => b.classList.toggle('active', b.dataset.level === activeHomeLevel));
    const list = progress[activeHomeLevel];
    const done = list.filter((x) => x.completed).length;
    el.progressText.textContent = `${done} / ${PUZZLES_PER_LEVEL} 完成`;
    el.progressFill.style.width = (done / PUZZLES_PER_LEVEL * 100) + '%';

    el.puzzleGrid.innerHTML = '';
    for (let i = 0; i < PUZZLES_PER_LEVEL; i++) {
      const st = list[i];
      const b = document.createElement('button');
      b.className = 'puzzle-cell' + (st.completed ? ' done' : '');
      b.textContent = i + 1;
      if (game && game.level === activeHomeLevel && game.index === i && !game.finished) b.classList.add('current');
      if (st.completed) {
        const chk = document.createElement('span');
        chk.className = 'check';
        chk.textContent = '✓';
        b.appendChild(chk);
        b.title = `最佳時間 ${fmtTime(st.bestTime)}`;
      }
      b.addEventListener('click', () => startPuzzle(activeHomeLevel, i, null));
      el.puzzleGrid.appendChild(b);
    }

    const saved = loadCurrentGame();
    if (saved && !(game && game.finished)) {
      el.resumeBanner.hidden = false;
      el.resumeTitle.textContent = `繼續上次的題目 · ${LEVEL_LABEL[saved.level]} 第 ${saved.index + 1} 關`;
      el.resumeSub.textContent = `已進行 ${fmtTime(saved.elapsedBefore)}`;
    } else {
      el.resumeBanner.hidden = true;
    }
  }

  el.levelBtns.forEach((b) => b.addEventListener('click', () => {
    activeHomeLevel = b.dataset.level;
    localStorage.setItem(KEY_LAST_LEVEL, activeHomeLevel);
    renderHome();
  }));

  el.btnResume.addEventListener('click', () => {
    const saved = loadCurrentGame();
    if (saved) startPuzzle(saved.level, saved.index, saved);
  });

  // ---- GAME rendering ----
  function renderGame() {
    el.gameLevelLabel.textContent = LEVEL_LABEL[game.level];
    el.gamePuzzleLabel.textContent = `第 ${game.index + 1} 關`;
    el.hintCount.textContent = (MAX_HINTS - game.hintsUsed);
    el.btnHint.disabled = game.hintsUsed >= MAX_HINTS;
    el.btnNotes.classList.toggle('on', game.notesMode);
    el.btnUndo.disabled = game.history.length === 0;
    el.winOverlay.hidden = true;
    el.pauseOverlay.hidden = true;
    renderBoard();
    renderNumpad();
    updateTimerLabel();
  }

  function renderBoard() {
    const errors = computeErrors(game.board);
    const selVal = game.selected !== null ? game.board[game.selected] : 0;
    el.board.innerHTML = '';
    for (let i = 0; i < 81; i++) {
      const r = ROW_OF[i], c = COL_OF[i];
      const cell = document.createElement('div');
      cell.className = 'cell';
      cell.dataset.r = r; cell.dataset.c = c;
      if ((BOX_OF[i] + Math.floor(BOX_OF[i] / 3)) % 2 === 1) cell.classList.add('shade');

      const v = game.board[i];
      if (v) {
        cell.textContent = v;
        if (game.given[i]) cell.classList.add('given');
        if (errors.has(i)) cell.classList.add('error');
      } else if (game.notes[i]) {
        const grid = document.createElement('div');
        grid.className = 'notes-grid';
        for (let d = 1; d <= 9; d++) {
          const s = document.createElement('span');
          if (game.notes[i] & (1 << (d - 1))) s.textContent = d;
          grid.appendChild(s);
        }
        cell.appendChild(grid);
      }

      if (game.selected === i) cell.classList.add('selected');
      else if (game.selected !== null) {
        if (ROW_OF[i] === ROW_OF[game.selected] || COL_OF[i] === COL_OF[game.selected] || BOX_OF[i] === BOX_OF[game.selected]) {
          cell.classList.add('peer');
        }
      }
      if (selVal && v === selVal && i !== game.selected) cell.classList.add('samevalue');

      cell.addEventListener('click', () => { game.selected = i; renderBoard(); });
      el.board.appendChild(cell);
    }
  }

  function renderNumpad() {
    el.numpad.innerHTML = '';
    for (let d = 1; d <= 9; d++) {
      const b = document.createElement('button');
      b.className = 'num-btn';
      b.textContent = d;
      b.addEventListener('click', () => inputDigit(d));
      el.numpad.appendChild(b);
    }
  }

  function updateTimerLabel() { el.timerLabel.textContent = fmtTime(currentElapsed()); }

  let timerInterval = null;
  function startTimerInterval() {
    stopTimerInterval();
    timerInterval = setInterval(() => { if (game) { updateTimerLabel(); if (Date.now() % 5000 < 1000) saveCurrentGame(); } }, 1000);
  }
  function stopTimerInterval() { if (timerInterval) clearInterval(timerInterval); timerInterval = null; }

  function pauseGame() {
    if (!game || !game.timerRunning) return;
    game.elapsedBefore = currentElapsed();
    game.timerRunning = false;
    el.pauseOverlay.hidden = false;
    saveCurrentGame();
  }
  function resumeGame() {
    if (!game || game.timerRunning) return;
    game.startedAt = Date.now();
    game.timerRunning = true;
    el.pauseOverlay.hidden = true;
  }

  // ---- edit actions ----
  function pushHistory(entry) { game.history.push(entry); el.btnUndo.disabled = false; }

  function inputDigit(d) {
    if (!game || game.selected === null || game.finished) return;
    const i = game.selected;
    if (game.given[i]) return;
    if (game.notesMode) {
      if (game.board[i]) return;
      const prevNotes = game.notes[i];
      game.notes[i] ^= (1 << (d - 1));
      pushHistory({ type: 'notes', index: i, prevNotes });
    } else {
      const prevValue = game.board[i], prevNotes = game.notes[i];
      if (prevValue === d) return;
      game.board[i] = d;
      game.notes[i] = 0;
      pushHistory({ type: 'fill', index: i, prevValue, prevNotes });
      checkWin();
    }
    renderBoard();
    el.btnHint.disabled = game.hintsUsed >= MAX_HINTS;
    saveCurrentGame();
  }

  function eraseSelected() {
    if (!game || game.selected === null || game.finished) return;
    const i = game.selected;
    if (game.given[i]) return;
    if (!game.board[i] && !game.notes[i]) return;
    pushHistory({ type: 'fill', index: i, prevValue: game.board[i], prevNotes: game.notes[i] });
    game.board[i] = 0;
    game.notes[i] = 0;
    renderBoard();
    saveCurrentGame();
  }

  function undo() {
    if (!game || game.history.length === 0) return;
    const last = game.history.pop();
    if (last.type === 'fill') { game.board[last.index] = last.prevValue; game.notes[last.index] = last.prevNotes; }
    else if (last.type === 'notes') { game.notes[last.index] = last.prevNotes; }
    el.btnUndo.disabled = game.history.length === 0;
    renderBoard();
    saveCurrentGame();
  }

  function toggleNotesMode() {
    if (!game) return;
    game.notesMode = !game.notesMode;
    el.btnNotes.classList.toggle('on', game.notesMode);
    saveCurrentGame();
  }

  function useHint() {
    if (!game || game.hintsUsed >= MAX_HINTS || game.finished) return;
    let target = (game.selected !== null && !game.given[game.selected] && game.board[game.selected] === 0)
      ? game.selected : -1;
    if (target === -1) target = game.board.findIndex((v, idx) => v === 0 && !game.given[idx]);
    if (target === -1) return;
    game.hintsUsed++;
    game.board[target] = game.solution[target];
    game.notes[target] = 0;
    game.selected = target;
    el.hintCount.textContent = (MAX_HINTS - game.hintsUsed);
    el.btnHint.disabled = game.hintsUsed >= MAX_HINTS;
    renderBoard();
    checkWin();
    saveCurrentGame();
  }

  function checkWin() {
    for (let i = 0; i < 81; i++) if (game.board[i] !== game.solution[i]) return;
    game.finished = true;
    game.elapsedBefore = currentElapsed();
    game.timerRunning = false;
    stopTimerInterval();
    const entry = progress[game.level][game.index];
    const isNewBest = entry.bestTime === null || game.elapsedBefore < entry.bestTime;
    entry.completed = true;
    entry.bestTime = isNewBest ? game.elapsedBefore : entry.bestTime;
    saveProgress(progress);
    clearCurrentGame();

    el.winTime.textContent = fmtTime(game.elapsedBefore);
    el.winBest.textContent = isNewBest ? '🎉 新紀錄!' : `最佳時間 ${fmtTime(entry.bestTime)}`;
    el.btnWinNext.hidden = game.index >= PUZZLES_PER_LEVEL - 1;
    el.winOverlay.hidden = false;
  }

  // ---- wiring ----
  el.btnBack.addEventListener('click', () => {
    if (game && !game.finished) { game.elapsedBefore = currentElapsed(); game.timerRunning = false; saveCurrentGame(); }
    stopTimerInterval();
    showScreen('home');
    renderHome();
  });
  el.btnUndo.addEventListener('click', undo);
  el.btnNotes.addEventListener('click', toggleNotesMode);
  el.btnErase.addEventListener('click', eraseSelected);
  el.btnHint.addEventListener('click', useHint);
  el.btnTimer.addEventListener('click', () => { if (!game || game.finished) return; game.timerRunning ? pauseGame() : resumeGame(); });
  el.btnResumePause.addEventListener('click', resumeGame);
  el.btnWinMenu.addEventListener('click', () => { showScreen('home'); renderHome(); });
  el.btnWinNext.addEventListener('click', () => { startPuzzle(game.level, game.index + 1, null); });

  el.btnTheme.addEventListener('click', () => { el.themeSheet.hidden = false; });
  el.btnThemeClose.addEventListener('click', () => { el.themeSheet.hidden = true; });
  document.querySelector('.sheet-backdrop').addEventListener('click', () => { el.themeSheet.hidden = true; });
  document.getElementById('theme-options').addEventListener('click', (e) => {
    const b = e.target.closest('.theme-opt');
    if (b) applyTheme(b.dataset.theme);
  });

  document.addEventListener('keydown', (e) => {
    if (el.gameScreen.hidden || !game || game.finished) return;
    if (e.key >= '1' && e.key <= '9') { inputDigit(Number(e.key)); return; }
    if (e.key === 'Backspace' || e.key === 'Delete' || e.key === '0') { eraseSelected(); return; }
    if (e.key.toLowerCase() === 'n') { toggleNotesMode(); return; }
    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) {
      e.preventDefault();
      let i = game.selected === null ? 0 : game.selected;
      let r = ROW_OF[i], c = COL_OF[i];
      if (e.key === 'ArrowUp') r = (r + 8) % 9;
      if (e.key === 'ArrowDown') r = (r + 1) % 9;
      if (e.key === 'ArrowLeft') c = (c + 8) % 9;
      if (e.key === 'ArrowRight') c = (c + 1) % 9;
      game.selected = r * 9 + c;
      renderBoard();
    }
  });

  document.addEventListener('visibilitychange', () => {
    if (document.hidden && game && game.timerRunning && !el.gameScreen.hidden) pauseGame();
  });

  // ---- boot ----
  applyTheme(loadTheme());
  renderHome();
  showScreen('home');

  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => { navigator.serviceWorker.register('sw.js').catch(() => {}); });
  }
})();
