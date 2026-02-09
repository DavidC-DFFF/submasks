"use strict";

/**
 * Subnet Sprint
 * - Conversion masque décimal <-> CIDR
 * - Vies, timer, bonus de vitesse, niveaux
 */

const MIN_CIDR = 1;
const MAX_CIDR = 30;
const START_LIVES = 5;
const MAX_LIVES = 9;

const LEVEL_UP_EVERY = 10; // 10 bonnes réponses par niveau
const BASE_TIME_MS = 10000; // durée initiale
const MIN_TIME_MS = 3200;   // durée minimale
const TIME_REDUCTION_PER_LEVEL = 700; // réduit à chaque niveau

const BONUS_MARKER_RATIO_START = 0.32; // 32% du temps (réponse avant = bonus)
const BONUS_MARKER_RATIO_MIN = 0.18;   // zone bonus plus exigeante avec les niveaux
const BONUS_MARKER_REDUCTION_PER_LEVEL = 0.015;

const questionValueEl = document.getElementById("questionValue");
const questionModeEl = document.getElementById("questionMode");
const answerInputEl = document.getElementById("answerInput");
const validateBtnEl = document.getElementById("validateBtn");
const restartBtnEl = document.getElementById("restartBtn");
const messageEl = document.getElementById("message");

const levelValueEl = document.getElementById("levelValue");
const livesValueEl = document.getElementById("livesValue");
const scoreValueEl = document.getElementById("scoreValue");
const levelProgressEl = document.getElementById("levelProgress");

const timeBarFillEl = document.getElementById("timeBarFill");
const bonusMarkerEl = document.getElementById("bonusMarker");

const state = {
  level: 1,
  lives: START_LIVES,
  score: 0,
  correctInLevel: 0,

  currentQuestion: null, // { givenType, givenValue, expected }
  timeLimitMs: BASE_TIME_MS,
  bonusThresholdMs: Math.floor(BASE_TIME_MS * BONUS_MARKER_RATIO_START),

  startTimestamp: 0,
  timerFrameId: null,
  locked: false,
  gameOver: false
};

function init() {
  buildProgressDots();
  bindEvents();
  resetGame();
}

function bindEvents() {
  validateBtnEl.addEventListener("click", submitAnswer);

  answerInputEl.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      submitAnswer();
    }
  });

  restartBtnEl.addEventListener("click", resetGame);
}

function buildProgressDots() {
  levelProgressEl.innerHTML = "";
  for (let i = 0; i < LEVEL_UP_EVERY; i += 1) {
    const dot = document.createElement("div");
    dot.className = "step";
    levelProgressEl.appendChild(dot);
  }
}

function updateProgressDots() {
  const dots = levelProgressEl.querySelectorAll(".step");
  dots.forEach((dot, idx) => {
    dot.classList.toggle("on", idx < state.correctInLevel);
  });
}

function setMessage(text, type = "") {
  messageEl.textContent = text;
  messageEl.className = "message";
  if (type) {
    messageEl.classList.add(type);
  }
}

function updateHUD() {
  levelValueEl.textContent = String(state.level);
  livesValueEl.textContent = String(state.lives);
  scoreValueEl.textContent = String(state.score);
  updateProgressDots();
}

function cidrToDecimal(cidr) {
  // cidr dans [0..32]
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
  if (!Number.isInteger(n) || n < 0 || n > 32) return null;
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
    return {
      givenType: "cidr",
      givenValue: `/${cidr}`,
      expected: dec
    };
  }

  return {
    givenType: "decimal",
    givenValue: dec,
    expected: `/${cidr}`
  };
}

function renderQuestion() {
  const q = state.currentQuestion;
  questionValueEl.textContent = q.givenValue;

  if (q.givenType === "cidr") {
    questionModeEl.textContent = "Donne la notation décimale";
    answerInputEl.placeholder = "Ex: 255.255.255.0";
  } else {
    questionModeEl.textContent = "Donne la notation CIDR";
    answerInputEl.placeholder = "Ex: /24 ou 24";
  }
}

function computeTimingForLevel(level) {
  const timeLimit = Math.max(
    MIN_TIME_MS,
    BASE_TIME_MS - (level - 1) * TIME_REDUCTION_PER_LEVEL
  );

  const bonusRatio = Math.max(
    BONUS_MARKER_RATIO_MIN,
    BONUS_MARKER_RATIO_START - (level - 1) * BONUS_MARKER_REDUCTION_PER_LEVEL
  );

  const bonusThreshold = Math.floor(timeLimit * bonusRatio);
  return { timeLimit, bonusThreshold };
}

function updateBonusMarker() {
  const ratio = state.bonusThresholdMs / state.timeLimitMs;
  bonusMarkerEl.style.left = `${Math.max(0, Math.min(1, ratio)) * 100}%`;
}

function startRound() {
  state.locked = false;
  answerInputEl.disabled = false;
  validateBtnEl.disabled = false;
  answerInputEl.value = "";
  answerInputEl.focus();

  const t = computeTimingForLevel(state.level);
  state.timeLimitMs = t.timeLimit;
  state.bonusThresholdMs = t.bonusThreshold;
  updateBonusMarker();

  state.currentQuestion = generateQuestion();
  renderQuestion();

  state.startTimestamp = performance.now();
  if (state.timerFrameId) cancelAnimationFrame(state.timerFrameId);
  state.timerFrameId = requestAnimationFrame(tickTimer);
}

function tickTimer(now) {
  if (state.gameOver || state.locked) return;

  const elapsed = now - state.startTimestamp;
  const remaining = Math.max(0, state.timeLimitMs - elapsed);
  const ratio = remaining / state.timeLimitMs;
  timeBarFillEl.style.transform = `scaleX(${ratio})`;

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

function isAnswerCorrect(userRaw) {
  const q = state.currentQuestion;

  if (q.givenType === "cidr") {
    // attendu décimal
    const normalized = normalizeDecimalInput(userRaw);
    return normalized !== null && normalized === q.expected;
  }

  // attendu CIDR
  const normalized = normalizeCidrInput(userRaw);
  return normalized !== null && normalized === q.expected;
}

function onCorrect(elapsedMs) {
  state.score += 1;
  state.correctInLevel += 1;

  // Bonus de vitesse : réponse avant bonusThreshold
  if (elapsedMs <= state.bonusThresholdMs && state.lives < MAX_LIVES) {
    state.lives += 1;
    setMessage("✅ Correct + Bonus vitesse : +1 vie", "ok");
  } else {
    setMessage("✅ Correct", "ok");
  }

  if (state.correctInLevel >= LEVEL_UP_EVERY) {
    state.level += 1;
    state.correctInLevel = 0;
    setMessage(`🎉 Niveau ${state.level} !`, "ok");
  }

  updateHUD();
  nextRoundWithDelay(350);
}

function onWrong() {
  state.lives -= 1;
  if (state.lives <= 0) {
    state.lives = 0;
    updateHUD();
    endGame(`❌ Mauvaise réponse. Plus de vies. Partie terminée.`);
    return;
  }

  setMessage(`❌ Faux. Réponse attendue : ${state.currentQuestion.expected}`, "bad");
  updateHUD();
  nextRoundWithDelay(700);
}

function onTimeout() {
  state.lives -= 1;
  if (state.lives <= 0) {
    state.lives = 0;
    updateHUD();
    endGame("⏱️ Temps écoulé. Plus de vies. Partie terminée.");
    return;
  }

  setMessage(`⏱️ Temps écoulé ! Réponse : ${state.currentQuestion.expected}`, "warn");
  updateHUD();
  nextRoundWithDelay(700);
}

function submitAnswer() {
  if (state.gameOver || state.locked) return;

  const answer = answerInputEl.value.trim();
  if (!answer) {
    setMessage("Entre une réponse avant de valider.", "warn");
    return;
  }

  state.locked = true;
  stopTimer();

  const elapsed = performance.now() - state.startTimestamp;
  const ok = isAnswerCorrect(answer);

  if (ok) onCorrect(elapsed);
  else onWrong();
}

function nextRoundWithDelay(ms) {
  answerInputEl.disabled = true;
  validateBtnEl.disabled = true;
  setTimeout(() => {
    if (!state.gameOver) startRound();
  }, ms);
}

function endGame(text) {
  state.gameOver = true;
  state.locked = true;
  stopTimer();
  timeBarFillEl.style.transform = "scaleX(0)";
  answerInputEl.disabled = true;
  validateBtnEl.disabled = true;
  setMessage(text, "bad");
}

function resetGame() {
  stopTimer();

  state.level = 1;
  state.lives = START_LIVES;
  state.score = 0;
  state.correctInLevel = 0;
  state.currentQuestion = null;
  state.gameOver = false;
  state.locked = false;

  updateHUD();
  setMessage("Prêt ? Convertis le masque affiché.", "");
  startRound();
}

init();
