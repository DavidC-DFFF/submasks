"use strict";

/**
 * Subnet Sprint
 * - Masques /8 à /30
 * - Vies affichées en 9 cases
 * - Score basé sur temps restant * niveau
 * - Bonus:
 *   - si vie < 9 => +1 vie
 *   - si déjà 9 vies => score x2
 * - Faux: perte de vie + malus (temps restant * niveau)
 * - Timeout: perte de vie uniquement
 */

// ==============================
// Constantes (base fixée)
// ==============================
const MIN_CIDR = 8;
const MAX_CIDR = 30;

const START_LIVES = 3;
const MAX_LIVES = 9;

const LEVEL_UP_EVERY = 10;

// Temps par niveau
const BASE_TIME_MS = 60000;
const MIN_TIME_MS = 5000;
const TIME_REDUCTION_PER_LEVEL = 4000;

// Fenêtre bonus (durée max de réponse pour bonus) par palier dans le niveau
// 22%,20%,...,4%
const BONUS_WINDOW_START_RATIO = 0.22;
const BONUS_WINDOW_END_RATIO = 0.04;

// Segments bonus dans la barre (78 -> 100)
const BONUS_BANDS = [
  [78, 80],
  [80, 82],
  [82, 84],
  [84, 86],
  [86, 88],
  [88, 90],
  [90, 92],
  [92, 94],
  [94, 96],
  [96, 100]
];

// ==============================
// DOM
// ==============================
const questionValueEl = document.getElementById("questionValue");
const questionModeEl = document.getElementById("questionMode");
const answerInputEl = document.getElementById("answerInput");
const validateBtnEl = document.getElementById("validateBtn");
const restartBtnEl = document.getElementById("restartBtn");
const messageEl = document.getElementById("message");

const levelValueEl = document.getElementById("levelValue");
const scoreValueEl = document.getElementById("scoreValue");
const livesGridEl = document.getElementById("livesGrid");
const levelProgressEl = document.getElementById("levelProgress");

const timeBarFillEl = document.getElementById("timeBarFill");
const bonusBandsEl = document.getElementById("bonusBands");

// ==============================
// State
// ==============================
const state = {
  level: 1,
  score: 0,
  lives: START_LIVES,
  correctInLevel: 0, // 0..9

  currentQuestion: null, // { givenType, givenValue, expected }

  timeLimitMs: BASE_TIME_MS,
  bonusWindowRatioCurrent: BONUS_WINDOW_START_RATIO,
  bonusWindowMs: Math.floor(BASE_TIME_MS * BONUS_WINDOW_START_RATIO),

  startTimestamp: 0,
  timerFrameId: null,
  locked: false,
  gameOver: false
};

// ==============================
// Init / Events
// ==============================
function init() {
  buildLivesGrid();
  buildProgressDots();
  buildBonusBands();
  bindEvents();
  resetGame();
}

function bindEvents() {
  validateBtnEl.addEventListener("click", submitAnswer);

  answerInputEl.addEventListener("keydown", (e) => {
    if (e.key === "Enter") submitAnswer();
  });

  restartBtnEl.addEventListener("click", resetGame);
}

// ==============================
// UI
// ==============================
function setMessage(text, type = "") {
  if (!messageEl) return;
  messageEl.textContent = text;
  messageEl.className = "message";
  if (type) messageEl.classList.add(type);
}

function buildLivesGrid() {
  if (!livesGridEl) return;
  livesGridEl.innerHTML = "";
  for (let i = 0; i < MAX_LIVES; i += 1) {
    const cell = document.createElement("span");
    cell.className = "life-cell";
    livesGridEl.appendChild(cell);
  }
}

function updateLivesGrid() {
  if (!livesGridEl) return;
  const cells = livesGridEl.querySelectorAll(".life-cell");
  cells.forEach((cell, idx) => {
    const isOn = idx < state.lives;
    cell.classList.toggle("on", isOn);
    cell.classList.toggle("off", !isOn);

    // 9e case (index 8) jaune brillante lorsqu'elle est allumée
    if (idx === MAX_LIVES - 1) {
      cell.classList.toggle("cap", isOn);
    } else {
      cell.classList.remove("cap");
    }
  });
}

function buildProgressDots() {
  if (!levelProgressEl) return;
  levelProgressEl.innerHTML = "";
  for (let i = 0; i < LEVEL_UP_EVERY; i += 1) {
    const dot = document.createElement("div");
    dot.className = "step";
    levelProgressEl.appendChild(dot);
  }
}

function updateProgressDots() {
  if (!levelProgressEl) return;
  const dots = levelProgressEl.querySelectorAll(".step");
  dots.forEach((dot, idx) => {
    dot.classList.toggle("on", idx < state.correctInLevel);
  });
}

function buildBonusBands() {
  if (!bonusBandsEl) return;
  bonusBandsEl.innerHTML = "";

  BONUS_BANDS.forEach(([start, end]) => {
    const band = document.createElement("div");
    band.className = "bonus-band on";
    band.style.left = `${start}%`;
    band.style.width = `${end - start}%`;
    bonusBandsEl.appendChild(band);
  });
}

// Début niveau: 10 ON ; après 1 bonne: 9 ON ; ... ; après 9: 1 ON
function updateBonusBandsByStage(correctInLevel) {
  if (!bonusBandsEl) return;
  const bands = bonusBandsEl.querySelectorAll(".bonus-band");
  if (!bands.length) return;

  const onCount = Math.max(1, 10 - correctInLevel);

  bands.forEach((band, idx) => {
    const isOn = idx >= (10 - onCount); // garde les derniers ON
    band.classList.toggle("on", isOn);
    band.classList.toggle("off", !isOn);
  });
}

function updateHUD() {
  if (levelValueEl) levelValueEl.textContent = String(state.level);
  if (scoreValueEl) scoreValueEl.textContent = String(state.score);
  updateLivesGrid();
  updateProgressDots();
  updateBonusBandsByStage(state.correctInLevel);
}

// ==============================
// Réseau
// ==============================
function cidrToDecimal(cidr) {
  const octets = [0, 0, 0, 0];
  let remaining = cidr;

  for (let i = 0; i < 4; i += 1) {
    if (remaining >= 8) {
      octets[i] = 255;
      remaining -= 8;
    } else if (remaining > 0) {
      octets[i] = 256 - Math.pow(2, 8 - remaining);
      remaining = 0;
    } else {
      octets[i] = 0;
    }
  }
  return octets.join(".");
}

function normalizeCidrInput(raw) {
  const txt = raw.trim();
  const m = txt.match(/^\/?\s*(\d{1,2})\s*$/);
  if (!m) return null;

  const n = Number(m[1]);
  if (!Number.isInteger(n) || n < MIN_CIDR || n > MAX_CIDR) return null;

  return `/${n}`;
}

function normalizeDecimalInput(raw) {
  const txt = raw.trim();
  const parts = txt.split(".");
  if (parts.length !== 4) return null;

  const nums = parts.map((p) => {
    if (!/^\d{1,3}$/.test(p.trim())) return NaN;
    return Number(p.trim());
  });

  if (nums.some((n) => Number.isNaN(n) || n < 0 || n > 255)) return null;
  return nums.join(".");
}

function pickRandomCidr() {
  return Math.floor(Math.random() * (MAX_CIDR - MIN_CIDR + 1)) + MIN_CIDR;
}

function generateQuestion() {
  const cidr = pickRandomCidr();
  const dec = cidrToDecimal(cidr);
  const givenAsCidr = Math.random() < 0.5;

  if (givenAsCidr) {
    return { givenType: "cidr", givenValue: `/${cidr}`, expected: dec };
  }
  return { givenType: "decimal", givenValue: dec, expected: `/${cidr}` };
}

function renderQuestion() {
  const q = state.currentQuestion;
  if (!q) return;

  if (questionValueEl) questionValueEl.textContent = q.givenValue;

  if (q.givenType === "cidr") {
    if (questionModeEl) questionModeEl.textContent = "Donne la notation décimale";
    if (answerInputEl) answerInputEl.placeholder = "Ex: 255.255.255.0";
  } else {
    if (questionModeEl) questionModeEl.textContent = "Donne la notation CIDR";
    if (answerInputEl) answerInputEl.placeholder = "Ex: /24 ou 24";
  }
}

// ==============================
// Temps / bonus
// ==============================
function computeTimeForLevel(level) {
  return Math.max(MIN_TIME_MS, BASE_TIME_MS - (level - 1) * TIME_REDUCTION_PER_LEVEL);
}

// 22,20,18,...,4 (%)
function computeBonusWindowRatioInLevel(correctInLevel) {
  if (LEVEL_UP_EVERY <= 1) return BONUS_WINDOW_END_RATIO;
  const t = correctInLevel / (LEVEL_UP_EVERY - 1); // 0..1
  return BONUS_WINDOW_START_RATIO + (BONUS_WINDOW_END_RATIO - BONUS_WINDOW_START_RATIO) * t;
}

function updateRoundSettingsForCurrentStage() {
  state.timeLimitMs = computeTimeForLevel(state.level);
  state.bonusWindowRatioCurrent = computeBonusWindowRatioInLevel(state.correctInLevel);
  state.bonusWindowMs = Math.floor(state.timeLimitMs * state.bonusWindowRatioCurrent);
}

function getRemainingMs(now = performance.now()) {
  const elapsed = now - state.startTimestamp;
  return Math.max(0, state.timeLimitMs - elapsed);
}

// ==============================
// Boucle round
// ==============================
function startRound() {
  state.locked = false;
  if (answerInputEl) {
    answerInputEl.disabled = false;
    answerInputEl.value = "";
    answerInputEl.focus();
  }
  if (validateBtnEl) validateBtnEl.disabled = false;

  updateRoundSettingsForCurrentStage();

  state.currentQuestion = generateQuestion();
  renderQuestion();

  state.startTimestamp = performance.now();

  if (state.timerFrameId) cancelAnimationFrame(state.timerFrameId);
  state.timerFrameId = requestAnimationFrame(tickTimer);
}

function tickTimer(now) {
  if (state.gameOver || state.locked) return;

  const remaining = getRemainingMs(now);
  const ratioRemaining = remaining / state.timeLimitMs;

  if (timeBarFillEl) {
    timeBarFillEl.style.transform = `scaleX(${ratioRemaining})`;
  }

  if (remaining <= 0) {
    onTimeout();
    return;
  }

  state.timerFrameId = requestAnimationFrame(tickTimer);
}

function stopTimer() {
  if (state.timerFrameId) {
    cancelAnimationFrame(state.timerFrameId);
    state.timerFrameId = null;
  }
}

// ==============================
// Gameplay
// ==============================
function isAnswerCorrect(userRaw) {
  const q = state.currentQuestion;
  if (!q) return false;

  if (q.givenType === "cidr") {
    const normalized = normalizeDecimalInput(userRaw);
    return normalized !== null && normalized === q.expected;
  }

  const normalized = normalizeCidrInput(userRaw);
  return normalized !== null && normalized === q.expected;
}

function applyLifeLoss() {
  state.lives -= 1;
  if (state.lives < 0) state.lives = 0;
}

function awardScore(basePoints, doubled = false) {
  const points = doubled ? basePoints * 2 : basePoints;
  state.score += points;
  return points;
}

function onCorrect(remainingMs, elapsedMs) {
  // Base score = secondes restantes * niveau
  const remainingSeconds = Math.floor(remainingMs / 1000);
  const basePoints = remainingSeconds * state.level;

  const inBonusWindow = elapsedMs <= state.bonusWindowMs;
  let doubled = false;

  if (inBonusWindow) {
    if (state.lives < MAX_LIVES) {
      state.lives += 1; // bonus vie normal
    } else {
      doubled = true; // déjà capé -> score x2
    }
  }

  const gained = awardScore(basePoints, doubled);

  state.correctInLevel += 1;

  if (state.correctInLevel >= LEVEL_UP_EVERY) {
    state.level += 1;
    state.correctInLevel = 0;
    setMessage(`🎉 Niveau suivant ! +${gained} points`, "ok");
  } else {
    if (inBonusWindow && doubled) {
      setMessage(`✅ Correct + bonus capé: +${gained} points (x2)`, "ok");
    } else if (inBonusWindow) {
      setMessage(`✅ Correct + bonus vie : +${gained} points`, "ok");
    } else {
      setMessage(`✅ Correct : +${gained} points`, "ok");
    }
  }

  updateHUD();
  nextRoundWithDelay(260);
}

function onWrong(remainingMs) {
  // Malus = temps restant * niveau
  const remainingSeconds = Math.floor(remainingMs / 1000);
  const malus = remainingSeconds * state.level;

  applyLifeLoss();
  state.score -= malus;
  if (state.score < 0) state.score = 0;

  if (state.lives <= 0) {
    updateHUD();
    endGame(`❌ Faux. -${malus} points. Plus de vies.`);
    return;
  }

  setMessage(`❌ Faux. -${malus} points. Réponse : ${state.currentQuestion.expected}`, "bad");
  updateHUD();
  nextRoundWithDelay(520);
}

function onTimeout() {
  applyLifeLoss();

  if (state.lives <= 0) {
    updateHUD();
    endGame("⏱️ Temps écoulé. Plus de vies.");
    return;
  }

  setMessage("⏱️ Temps écoulé : -1 vie.", "warn");
  updateHUD();
  nextRoundWithDelay(520);
}

function submitAnswer() {
  if (state.gameOver || state.locked) return;

  const answer = (answerInputEl?.value || "").trim();
  if (!answer) {
    setMessage("Entre une réponse avant de valider.", "warn");
    return;
  }

  state.locked = true;
  stopTimer();

  const now = performance.now();
  const elapsedMs = now - state.startTimestamp;
  const remainingMs = Math.max(0, state.timeLimitMs - elapsedMs);

  const ok = isAnswerCorrect(answer);

  if (ok) onCorrect(remainingMs, elapsedMs);
  else onWrong(remainingMs);
}

function nextRoundWithDelay(ms) {
  if (answerInputEl) answerInputEl.disabled = true;
  if (validateBtnEl) validateBtnEl.disabled = true;

  setTimeout(() => {
    if (!state.gameOver) startRound();
  }, ms);
}

function endGame(text) {
  state.gameOver = true;
  state.locked = true;
  stopTimer();

  if (timeBarFillEl) timeBarFillEl.style.transform = "scaleX(0)";
  if (answerInputEl) answerInputEl.disabled = true;
  if (validateBtnEl) validateBtnEl.disabled = true;

  setMessage(text, "bad");
}

function resetGame() {
  stopTimer();

  state.level = 1;
  state.score = 0;
  state.lives = START_LIVES;
  state.correctInLevel = 0;
  state.currentQuestion = null;
  state.gameOver = false;
  state.locked = false;

  updateHUD();
  setMessage("Prêt ? Convertis le masque affiché.", "");
  startRound();
}

init();
