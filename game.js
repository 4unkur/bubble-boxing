// MediaPipe is stored in this game's vendor/ folder so the game works offline.
import { PoseLandmarker, FilesetResolver } from "./vendor/mediapipe/vision_bundle.mjs";

// ---------------------------------------------------------------------------
// Settings — tweak freely. URL params override some: ?time=60&lang=ru&level=3
// ---------------------------------------------------------------------------
const params = new URLSearchParams(location.search);
const CONFIG = {
  roundSeconds: Number(params.get("time")) || 60,
  emojiChance: 0.3,
  milestone: 15,           // cheer every N points
  bombPenalty: 3,          // points lost for punching a bomb (score never goes below 0)
  holdToStart: 0.8,        // seconds to hold hands up to start
  holdToLevel: 0.7,        // seconds to touch a level button to pick it
  approach: 0.5,           // seconds a bubble takes to fly in
  comboWindow: 2.2,        // seconds between pops that keep a combo going
  // Distances are fractions of the boxer's torso length (shoulders to hips), so they fit any kid at any distance.
  reach: [0.85, 1.2],      // how far from the shoulder bubbles appear: about one arm's length
  speedWindow: 0.25,       // seconds of hand history used to measure punch speed
  handRaise: 0.3,          // menu buttons: a hand counts when raised this far above the hips...
  handReach: 0.9,          // ...or reaching this far out to the side
  mouseTorso: 0.22,        // pretend torso length (fraction of screen height) when playing with the mouse
};

// Difficulty levels, picked on the start screen by touching an animal (or keys 1/2/3).
// punch: how fast a hand must move to pop a bubble, in torso lengths per second. A slow touch only makes it wobble.
const LEVELS = [
  { icon: "🐢", maxBubbles: 1, gap: [0.6, 0.3], radius: 0.1, stay: [4.5, 3.5], punch: 1.0, bigChance: 0.1, bigHits: 3, bombChance: 0 },
  { icon: "🐇", maxBubbles: 2, gap: [0.5, 0.2], radius: 0.085, stay: [3.2, 2.4], punch: 1.8, bigChance: 0.08, bigHits: 4, bombChance: 0 },
  { icon: "🐆", maxBubbles: 3, gap: [0.4, 0.15], radius: 0.075, stay: [2.4, 1.7], punch: 2.4, bigChance: 0.07, bigHits: 5, bombChance: 0.15 },
];
const LEVEL_KEY = "bubbleBoxing.level";

const EMOJIS = ["🐟", "🐠", "🐙", "🦆", "🍓", "🐸", "🦋", "🐞", "🍎", "⭐", "🐳", "🦀"];
const COLORS = ["#3fc8ff", "#ff5ec8"]; // glove glow per player (sorted by screen position)

const TEXT = {
  en: {
    raise: "Raise your hands to start!",
    again: "Raise your hands to play again!",
    count: ["Three", "Two", "One"],
    go: "Go! Punch the bubbles!",
    goBombs: "Go! Punch the bubbles, not the bombs!",
    cheers: ["Wow!", "What a punch!", "Super!", "Keep going!", "Great job!", "Fantastic!", "Champion!"],
    combo: (n) => `${n} in a row!`,
    big: "Big bubble! Punch it again and again!",
    bigDone: "You did it!",
    punchHint: "Punch it fast! Pow!",
    pows: ["POW!", "BAM!", "WHAM!", "BIFF!", "BOP!"],
    done: (n) => `Hooray! You got ${n} points!`,
    cantSee: "I can't see you! Come in front of the camera",
    stepBack: "Step back a little",
    paused: "Paused",
    noCam: "Camera not available — you can play with the mouse",
    levels: ["Easy!", "Medium!", "Hard! Watch out for bombs!"],
    boom: "Boom! Oops!",
  },
  ru: {
    raise: "Подними руки, чтобы начать!",
    again: "Подними руки, чтобы играть ещё!",
    count: ["Три", "Два", "Один"],
    go: "Вперёд! Бей пузыри!",
    goBombs: "Вперёд! Бей пузыри, но не бомбы!",
    cheers: ["Ух ты!", "Вот это удар!", "Супер!", "Так держать!", "Молодец!", "Отлично!", "Чемпион!"],
    combo: (n) => `${n} подряд!`,
    big: "Большой пузырь! Бей ещё и ещё!",
    bigDone: "Получилось!",
    punchHint: "Бей быстро! Бам!",
    pows: ["БАМ!", "БАЦ!", "ХЛОП!", "БУХ!", "ТЫЩ!"],
    done: (n) => `Ура! У тебя ${n} ${ruPlural(n, "очко", "очка", "очков")}!`,
    cantSee: "Я тебя не вижу! Встань перед камерой",
    stepBack: "Отойди чуть-чуть назад",
    paused: "Пауза",
    noCam: "Камера недоступна — можно играть мышкой",
    levels: ["Легко!", "Средне!", "Трудно! Осторожно, бомбы!"],
    boom: "Бум! Ой!",
  },
};

function ruPlural(n, one, few, many) {
  const m10 = n % 10, m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 10 || m100 >= 20)) return few;
  return many;
}

let lang = TEXT[params.get("lang")] ? params.get("lang") : "en";
const t = () => TEXT[lang];

// Only hands punch: averaged wrist/knuckle landmarks + hit padding (fraction of H).
const HANDS = [
  { ids: [15, 17, 19], pad: 0.05 },
  { ids: [16, 18, 20], pad: 0.05 },
];
const VIS_MIN = 0.4;

// ---------------------------------------------------------------------------
// DOM / canvas
// ---------------------------------------------------------------------------
const video = document.getElementById("video");
const canvas = document.getElementById("canvas");
const ctx = canvas.getContext("2d");
const intro = document.getElementById("intro");
const introMsg = document.getElementById("introMsg");
const startBtn = document.getElementById("startBtn");

let W = 0, H = 0, DPR = 1;
function resize() {
  DPR = Math.min(window.devicePixelRatio || 1, 2);
  W = window.innerWidth;
  H = window.innerHeight;
  canvas.width = Math.round(W * DPR);
  canvas.height = Math.round(H * DPR);
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
}
window.addEventListener("resize", resize);
resize();

// ---------------------------------------------------------------------------
// Audio (all synthesized — no files needed)
// ---------------------------------------------------------------------------
let ac = null, master = null, noiseBuf = null, boomBuf = null, whooshBuf = null, muted = false;

function noise(seconds, shape) {
  const b = ac.createBuffer(1, ac.sampleRate * seconds, ac.sampleRate);
  const d = b.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * shape(i / d.length);
  return b;
}

function initAudio() {
  ac = new AudioContext();
  master = ac.createGain();
  master.gain.value = 0.8;
  master.connect(ac.destination);
  noiseBuf = noise(0.06, (k) => 1 - k);
  boomBuf = noise(0.7, (k) => (1 - k) ** 2);
  whooshBuf = noise(0.35, (k) => Math.sin(k * Math.PI));
}

function tone(freq, start, dur, type = "sine", vol = 0.3) {
  if (!ac || muted) return;
  const o = ac.createOscillator(), g = ac.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, start);
  g.gain.setValueAtTime(0.0001, start);
  g.gain.exponentialRampToValueAtTime(vol, start + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, start + dur);
  o.connect(g).connect(master);
  o.start(start);
  o.stop(start + dur + 0.02);
}

function popSound(pitch = 1) {
  if (!ac || muted) return;
  const now = ac.currentTime;
  const o = ac.createOscillator(), g = ac.createGain();
  o.type = "sine";
  o.frequency.setValueAtTime(260 * pitch, now);
  o.frequency.exponentialRampToValueAtTime(1100 * pitch, now + 0.07);
  g.gain.setValueAtTime(0.45, now);
  g.gain.exponentialRampToValueAtTime(0.0001, now + 0.12);
  o.connect(g).connect(master);
  o.start(now);
  o.stop(now + 0.13);

  const n = ac.createBufferSource(), f = ac.createBiquadFilter(), ng = ac.createGain();
  n.buffer = noiseBuf;
  f.type = "bandpass";
  f.frequency.value = 2500 * pitch;
  ng.gain.value = 0.35;
  n.connect(f).connect(ng).connect(master);
  n.start(now);
}

// A soft glove "thump" under every punch.
function thumpSound(vol = 0.6) {
  if (!ac || muted) return;
  const now = ac.currentTime;
  const o = ac.createOscillator(), g = ac.createGain();
  o.type = "sine";
  o.frequency.setValueAtTime(170, now);
  o.frequency.exponentialRampToValueAtTime(55, now + 0.12);
  g.gain.setValueAtTime(vol, now);
  g.gain.exponentialRampToValueAtTime(0.0001, now + 0.16);
  o.connect(g).connect(master);
  o.start(now);
  o.stop(now + 0.18);

  const n = ac.createBufferSource(), f = ac.createBiquadFilter(), ng = ac.createGain();
  n.buffer = noiseBuf;
  f.type = "lowpass";
  f.frequency.value = 1400;
  ng.gain.value = vol * 0.8;
  n.connect(f).connect(ng).connect(master);
  n.start(now);
}

function boomSound() {
  if (!ac || muted) return;
  const now = ac.currentTime;
  const n = ac.createBufferSource(), f = ac.createBiquadFilter(), g = ac.createGain();
  n.buffer = boomBuf;
  f.type = "lowpass";
  f.frequency.setValueAtTime(1800, now);
  f.frequency.exponentialRampToValueAtTime(120, now + 0.6);
  g.gain.setValueAtTime(0.9, now);
  g.gain.exponentialRampToValueAtTime(0.0001, now + 0.7);
  n.connect(f).connect(g).connect(master);
  n.start(now);

  const o = ac.createOscillator(), og = ac.createGain();
  o.type = "sine";
  o.frequency.setValueAtTime(140, now);
  o.frequency.exponentialRampToValueAtTime(40, now + 0.5);
  og.gain.setValueAtTime(0.6, now);
  og.gain.exponentialRampToValueAtTime(0.0001, now + 0.55);
  o.connect(og).connect(master);
  o.start(now);
  o.stop(now + 0.6);
}

// Quiet swoosh when a bubble flies in, so the kid looks for it.
function whooshSound() {
  if (!ac || muted) return;
  const now = ac.currentTime;
  const n = ac.createBufferSource(), f = ac.createBiquadFilter(), g = ac.createGain();
  n.buffer = whooshBuf;
  f.type = "bandpass";
  f.Q.value = 1.5;
  f.frequency.setValueAtTime(500, now);
  f.frequency.exponentialRampToValueAtTime(2200, now + 0.3);
  g.gain.value = 0.18;
  n.connect(f).connect(g).connect(master);
  n.start(now);
}

// Too-gentle touch: the bubble just bounces.
function boingSound() {
  if (!ac || muted) return;
  const now = ac.currentTime;
  const o = ac.createOscillator(), g = ac.createGain();
  o.type = "triangle";
  o.frequency.setValueAtTime(180, now);
  o.frequency.exponentialRampToValueAtTime(420, now + 0.08);
  o.frequency.exponentialRampToValueAtTime(260, now + 0.2);
  g.gain.setValueAtTime(0.0001, now);
  g.gain.exponentialRampToValueAtTime(0.22, now + 0.02);
  g.gain.exponentialRampToValueAtTime(0.0001, now + 0.25);
  o.connect(g).connect(master);
  o.start(now);
  o.stop(now + 0.27);
}

function chime() {
  if (!ac) return;
  const now = ac.currentTime;
  [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => tone(f, now + i * 0.08, 0.35, "triangle", 0.25));
}

function fanfare() {
  if (!ac) return;
  const now = ac.currentTime;
  const notes = [523.25, 523.25, 659.25, 783.99, 659.25, 783.99, 1046.5];
  const times = [0, 0.15, 0.3, 0.45, 0.65, 0.8, 1.0];
  notes.forEach((f, i) => tone(f, now + times[i], i === notes.length - 1 ? 0.9 : 0.25, "triangle", 0.28));
}

function beep(high) {
  if (!ac) return;
  tone(high ? 990 : 660, ac.currentTime, high ? 0.5 : 0.25, "sine", 0.3);
}

function say(text) {
  if (muted || !("speechSynthesis" in window)) return;
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  const code = lang === "ru" ? "ru" : "en";
  // Prefer the Mac's built-in voices: Chrome's "Google …" voices need the internet.
  const voices = speechSynthesis.getVoices().filter((v) => v.lang.toLowerCase().startsWith(code));
  const voice = voices.find((v) => v.localService) || voices[0];
  if (voice) u.voice = voice;
  u.lang = lang === "ru" ? "ru-RU" : "en-US";
  u.pitch = 1.25;
  u.rate = 0.95;
  speechSynthesis.speak(u);
}

// ---------------------------------------------------------------------------
// Camera + pose model
// ---------------------------------------------------------------------------
let landmarker = null;
let poses = [];
let boxer = -1; // index in poses of the kid we spawn bubbles around: the one closest to the camera
let lastVideoTime = -1;
let cameraOk = false;

async function startCamera() {
  const stream = await navigator.mediaDevices.getUserMedia({
    video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: "user" },
    audio: false,
  });
  video.srcObject = stream;
  await video.play();
  cameraOk = true;
}

async function loadModel() {
  const fileset = await FilesetResolver.forVisionTasks("./vendor/mediapipe/wasm");
  const opts = (delegate) => ({
    baseOptions: {
      modelAssetPath: "./vendor/mediapipe/pose_landmarker_lite.task",
      delegate,
    },
    runningMode: "VIDEO",
    numPoses: 2,
    minPoseDetectionConfidence: 0.5,
    minPosePresenceConfidence: 0.5,
    minTrackingConfidence: 0.5,
  });
  try {
    landmarker = await PoseLandmarker.createFromOptions(fileset, opts("GPU"));
  } catch (e) {
    console.warn("GPU delegate failed, falling back to CPU", e);
    landmarker = await PoseLandmarker.createFromOptions(fileset, opts("CPU"));
  }
}

// Video is drawn "cover"-style and mirrored; this maps landmarks to screen.
function videoRect() {
  const vw = video.videoWidth || 1280, vh = video.videoHeight || 720;
  const s = Math.max(W / vw, H / vh);
  const dw = vw * s, dh = vh * s;
  return { ox: (W - dw) / 2, oy: (H - dh) / 2, dw, dh };
}
function toScreen(lm) {
  const r = videoRect();
  return { x: W - (r.ox + lm.x * r.dw), y: r.oy + lm.y * r.dh };
}

// ---------------------------------------------------------------------------
// Game state
// ---------------------------------------------------------------------------
let state = "intro"; // intro | ready | countdown | playing | paused | done
let bubbles = [];
let particles = [];
let score = 0;
let nextMilestone = CONFIG.milestone;
let elapsed = 0;
let spawnTimer = 0;
let countdown = 0;
let doneAt = 0;
let raiseHold = 0;
let lastSeen = 0;
let hipsMissingSince = 0;
let hint = null, hintSpokenAt = -1e9;
let debug = false;
let points = [];               // current hands on screen
const prevPoints = new Map();  // key -> {x,y} from previous frame, for swipe hits
const handHist = new Map();    // key -> recent {at,x,y}, for punch speed
let mouse = { x: 0, y: 0, at: -1e9 };
let level = loadLevel();
const levelHold = LEVELS.map(() => 0);
let shake = 0, flash = 0;      // bomb effects
let combo = 0, lastPopAt = -1e9;
let lastSides = [];            // recent spawn sides, so both hands get work
let gentleTouches = 0, punchHintAt = -1e9;

const rand = (a, b) => a + Math.random() * (b - a);
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const lv = () => LEVELS[level];
const lerp = (a, b, k) => a + (b - a) * k;

// Shoulders and torso length of a pose on screen: the yardstick for reach and punch speed.
function bodyFrame(lms) {
  const P = (i) => (lms[i] && (lms[i].visibility ?? 1) >= VIS_MIN ? toScreen(lms[i]) : null);
  const [ls, rs, lh, rh, lk, rk] = [11, 12, 23, 24, 25, 26].map(P);
  if (!ls || !rs) return null;
  const mid = { x: (ls.x + rs.x) / 2, y: (ls.y + rs.y) / 2 };
  const sw = Math.hypot(ls.x - rs.x, ls.y - rs.y);
  // hips can be hidden when the kid is close; shoulder width is a fine stand-in then
  const hip = lh && rh ? { x: (lh.x + rh.x) / 2, y: (lh.y + rh.y) / 2 } : null;
  const torso = hip ? Math.hypot(mid.x - hip.x, mid.y - hip.y) : sw * 1.4;
  if (torso < 1) return null;
  const [left, right] = ls.x < rs.x ? [ls, rs] : [rs, ls]; // screen-left / screen-right shoulder
  return { left, right, mid, torso, hip: hip || { x: mid.x, y: mid.y + torso }, kneeY: lk && rk ? (lk.y + rk.y) / 2 : null };
}

function mouseFrame() {
  const torso = CONFIG.mouseTorso * H;
  const mid = { x: W / 2, y: H * 0.5 };
  const sw = torso * 0.7;
  return { left: { x: mid.x - sw / 2, y: mid.y }, right: { x: mid.x + sw / 2, y: mid.y }, mid, torso, hip: { x: mid.x, y: mid.y + torso }, kneeY: null };
}

function boxerFrame() {
  if (boxer >= 0 && poses[boxer]) return bodyFrame(poses[boxer]);
  return cameraOk ? null : mouseFrame();
}

// Bubbles appear about an arm's length from a shoulder, out to the side or up high (uppercut).
function spawnSpot(body, r) {
  const sides = ["L", "R", "L", "R", "U"];
  let side = pick(sides);
  // never three in a row on the same side
  if (lastSides.length >= 2 && lastSides.every((s) => s === side)) side = side === "L" ? "R" : "L";
  const T = body.torso;
  let x, y;
  if (side === "U") {
    x = body.mid.x + rand(-0.35, 0.35) * T;
    y = body.mid.y - rand(1.05, 1.3) * T;
  } else {
    const sh = side === "L" ? body.left : body.right;
    const dir = side === "L" ? -1 : 1;
    const a = rand(-15, 65) * Math.PI / 180; // angle above horizontal
    const d = rand(...CONFIG.reach) * T;
    x = sh.x + dir * Math.cos(a) * d;
    y = sh.y - Math.sin(a) * d;
  }
  x = Math.max(r * 1.1, Math.min(W - r * 1.1, x));
  y = Math.max(r * 1.1 + 0.13 * H, Math.min(H - r * 1.1, y));
  return { x, y, side };
}

function spawnBubble(ambient = false) {
  const body = boxerFrame();
  if (!body) return false;
  const bomb = !ambient && Math.random() < lv().bombChance;
  const big = !ambient && !bomb && Math.random() < lv().bigChance;
  let r = lv().radius * H * (big ? 1.35 : 1);
  r = Math.min(r, body.torso * (big ? 0.75 : 0.55)); // keep bubbles kid-sized when the kid is far away
  // a few tries to find a spot clear of other bubbles and of the hands (a fist already there doesn't count as a punch)
  let spot = null;
  for (let i = 0; i < 8 && !spot; i++) {
    const s = spawnSpot(body, r);
    const clear = bubbles.every((b) => b.leaving !== null || Math.hypot(b.x - s.x, b.y - s.y) > (b.r + r) * 1.15) &&
      points.every((p) => Math.hypot(p.x - s.x, p.y - s.y) > r + p.pad * 2);
    if (clear) spot = s;
  }
  if (!spot) return false;
  lastSides = [...lastSides, spot.side].slice(-2);
  const progress = Math.min(1, elapsed / CONFIG.roundSeconds);
  bubbles.push({
    x: spot.x, y: spot.y, r,
    phase: rand(0, Math.PI * 2),
    hue: big ? 48 : rand(0, 360),
    big,
    bomb,
    hits: big ? lv().bigHits : 1,
    emoji: !big && !bomb && Math.random() < CONFIG.emojiChance ? pick(EMOJIS) : null,
    age: 0,
    stay: ambient ? 8 : lerp(lv().stay[0], lv().stay[1], progress) * (big ? 1.8 : 1) * (bomb ? 0.8 : 1),
    leaving: null,  // seconds since it started floating away (nobody punched it)
    autoPopAt: null,
    squish: 0,
    hitCool: 0,
    inside: new Set(), // hands touching it last frame
  });
  whooshSound();
  if (big) say(t().big);
  return true;
}

function burst(x, y, r, hue, n, golden) {
  particles.push({ type: "ring", x, y, r, life: 0, max: 0.35, color: `hsl(${hue},100%,80%)` });
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + rand(-0.2, 0.2);
    const sp = rand(0.4, 1.0) * H * (golden ? 0.9 : 0.6);
    particles.push({
      type: "drop", x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp,
      size: rand(0.006, 0.014) * H, life: 0, max: rand(0.4, 0.7),
      color: golden ? `hsl(${rand(40, 60)},100%,${rand(55, 80)}%)` : `hsl(${hue + rand(-30, 30)},100%,80%)`,
    });
  }
}

// Comic-book word for a hit, tilted and in the glove's glow color.
function powText(x, y, size, color) {
  particles.push({ type: "pow", text: pick(t().pows), x, y, vy: -0.08 * H, size, rot: rand(-0.3, 0.3), life: 0, max: 0.8, color });
}

// A punch landed on a bubble (scored = during a round).
function punchBubble(b, scored, p) {
  if (b.bomb) return popBomb(b, scored);
  b.hitCool = 0.3;
  if (b.big && b.hits > 1) {
    // big golden bubble: every punch shrinks it a little until the last one pops it
    b.hits--;
    b.squish = 1;
    b.r *= 0.9;
    thumpSound(0.7);
    popSound(0.7);
    burst(b.x, b.y, b.r, 48, 10, true);
    powText(b.x + rand(-0.5, 0.5) * b.r, b.y - b.r * 0.6, 0.07 * H, colorOf(p.player));
    shake = 0.12;
    return;
  }
  popBubble(b, scored, p);
}

function popBubble(b, scored, p) {
  b.dead = true;
  const now = performance.now();
  if (scored) {
    combo = now - lastPopAt < CONFIG.comboWindow * 1000 ? combo + 1 : 1;
    lastPopAt = now;
  }
  if (p) thumpSound();
  popSound(b.big ? 1.4 : rand(0.9, 1.1) * (1 + Math.min(combo, 10) * 0.05));
  burst(b.x, b.y, b.r, b.hue, b.big ? 30 : 16, b.big);
  if (b.emoji) {
    particles.push({
      type: "emoji", text: b.emoji, x: b.x, y: b.y, vx: rand(-0.15, 0.15) * H, vy: -0.5 * H,
      rot: 0, vr: rand(-4, 4), size: b.r * 1.0, life: 0, max: 1.4,
    });
  }
  if (p) powText(b.x, b.y - b.r * 0.2, (b.big ? 0.13 : 0.08) * H, colorOf(p.player));

  if (!scored) return;
  const pts = b.big ? 5 : 1;
  score += pts;
  if (b.big) {
    chime();
    say(t().bigDone);
    confetti(50, b.x, b.y);
    particles.push({ type: "text", text: "+5", x: b.x, y: b.y + b.r * 0.6, vy: -0.15 * H, size: 0.09 * H, life: 0, max: 1.2, color: "#ffd23f" });
  } else {
    particles.push({ type: "text", text: "+1", x: b.x, y: b.y + b.r * 0.6, vy: -0.12 * H, size: 0.05 * H, life: 0, max: 0.7, color: colorOf(p.player) });
  }
  if (score >= nextMilestone) {
    nextMilestone += CONFIG.milestone;
    if (!b.big) { chime(); say(pick(t().cheers)); }
    confetti(60);
  } else if (combo >= 5 && combo % 5 === 0 && !b.big) {
    chime();
    say(t().combo(combo));
    confetti(30, b.x, b.y);
  }
}

// Punching a bomb: a big (harmless) boom and a few points lost. Never a game over.
// When a bomb times out or the round ends it just fades away in a puff of smoke.
function popBomb(b, touched) {
  b.dead = true;
  const n = touched ? 34 : 10;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + rand(-0.2, 0.2);
    const sp = rand(0.3, 1.0) * H * (touched ? 1.1 : 0.3);
    particles.push({
      type: "drop", x: b.x, y: b.y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp,
      size: rand(0.008, 0.02) * H, life: 0, max: rand(0.4, 0.8),
      color: touched ? pick(["#ff5a1f", "#ffb03f", "#ffe03f", "#555"]) : "#999",
    });
  }
  if (!touched) return;
  boomSound();
  say(t().boom);
  shake = 0.4;
  flash = 0.35;
  combo = 0;
  particles.push({ type: "ring", x: b.x, y: b.y, r: b.r * 1.5, life: 0, max: 0.5, color: "#ff8a3f" });
  const lost = Math.min(score, CONFIG.bombPenalty);
  score -= lost;
  particles.push({ type: "text", text: lost ? `💥 −${lost}` : "💥", x: b.x, y: b.y, vy: -0.12 * H, size: 0.08 * H, life: 0, max: 1.2, color: "#ff6a4a" });
}

function confetti(n, cx, cy) {
  for (let i = 0; i < n; i++) {
    const fromTop = cx === undefined;
    particles.push({
      type: "confetti",
      x: fromTop ? rand(0, W) : cx, y: fromTop ? rand(-0.2 * H, 0) : cy,
      vx: fromTop ? rand(-0.05, 0.05) * H : rand(-0.6, 0.6) * H,
      vy: fromTop ? rand(0.2, 0.45) * H : rand(-0.9, -0.2) * H,
      rot: rand(0, 6), vr: rand(-8, 8), size: rand(0.012, 0.022) * H,
      life: 0, max: fromTop ? rand(2.5, 4) : rand(1.2, 2),
      color: `hsl(${rand(0, 360)},95%,60%)`, gravity: fromTop ? 0.05 : 1.2,
    });
  }
}

function startCountdown() {
  bubbles.forEach((b, i) => (b.autoPopAt = i * 0.06));
  score = 0;
  nextMilestone = CONFIG.milestone;
  elapsed = 0;
  spawnTimer = 0;
  combo = 0;
  gentleTouches = 0;
  countdown = 3.999;
  state = "countdown";
  beep(false);
  say(t().count[0]);
}

function endRound() {
  state = "done";
  doneAt = performance.now();
  bubbles.forEach((b, i) => (b.autoPopAt = i * 0.09));
  fanfare();
  confetti(150);
  setTimeout(() => say(t().done(score)), 600);
}

// Level picker: the start screen shows one animal button per level.
function loadLevel() {
  const p = Number(params.get("level"));
  if (p >= 1 && p <= LEVELS.length) return p - 1;
  try {
    const v = localStorage.getItem(LEVEL_KEY);
    if (v !== null && LEVELS[Number(v)]) return Number(v);
  } catch {}
  return 0;
}

function levelButtons() {
  const s = H / 1080;
  return LEVELS.map((_, i) => ({ x: W / 2 + (i - 1) * 330 * s, y: 680 * s, r: 95 * s }));
}

function setLevel(i) {
  levelHold.fill(0);
  if (i === level) return;
  level = i;
  try { localStorage.setItem(LEVEL_KEY, String(i)); } catch {}
  chime();
  say(t().levels[i]);
  const btn = levelButtons()[i];
  particles.push({ type: "ring", x: btn.x, y: btn.y, r: btn.r * 1.2, life: 0, max: 0.6, color: "#ffd23f" });
  confetti(24, btn.x, btn.y);
}

const inMenu = (now) => state === "ready" || (state === "done" && now - doneAt > 3500);

function togglePause() {
  if (state === "playing") { state = "paused"; say(t().paused); }
  else if (state === "paused") state = "playing";
}

const colorOf = (player) => COLORS[player % COLORS.length];

// ---------------------------------------------------------------------------
// Pose → hands, punch speed, hit testing
// ---------------------------------------------------------------------------
function detect(now) {
  if (!landmarker || !cameraOk || video.readyState < 2 || video.currentTime === lastVideoTime) return;
  lastVideoTime = video.currentTime;
  const res = landmarker.detectForVideo(video, now);
  // sort by shoulder position so each kid keeps the same color (camera x is mirrored)
  const shoulderX = (l) => (l[11].x + l[12].x) / 2;
  poses = (res.landmarks || []).slice().sort((a, b) => shoulderX(b) - shoulderX(a));
  // the boxer is whoever stands closest to the camera (widest shoulders)
  const width = (l) => Math.hypot(l[11].x - l[12].x, l[11].y - l[12].y);
  boxer = poses.length ? poses.reduce((best, l, i) => (width(l) > width(poses[best]) ? i : best), 0) : -1;
  if (poses.length) lastSeen = now;
}

// Menu buttons: hands hanging at the sides don't press them.
function handActive(p, body) {
  return p.y < body.hip.y - CONFIG.handRaise * body.torso ||
    Math.abs(p.x - body.hip.x) > CONFIG.handReach * body.torso;
}

// Peak hand speed over the last moment, in torso lengths per second.
// Uses the history window so a fist that just stopped inside a bubble still counts as a punch.
function handSpeed(key, x, y, now, unit) {
  let hist = handHist.get(key);
  if (!hist) handHist.set(key, (hist = []));
  hist.push({ at: now, x, y });
  while (hist.length && hist[0].at < now - CONFIG.speedWindow * 1000) hist.shift();
  let best = 0;
  for (const s of hist) {
    const dt = (now - s.at) / 1000;
    if (dt < 0.04) continue;
    const d = Math.hypot(x - s.x, y - s.y);
    if (d > 0.6 * H) continue; // tracking jumped to another hand
    best = Math.max(best, d / dt);
  }
  return best / unit;
}

function computePoints(now) {
  const out = [];
  poses.forEach((lms, player) => {
    const body = bodyFrame(lms);
    const unit = body ? body.torso : CONFIG.mouseTorso * H;
    HANDS.forEach((hand, hi) => {
      const group = hand.ids.map((i) => lms[i]);
      if (group.some((l) => !l || (l.visibility ?? 1) < VIS_MIN)) return;
      const avg = { x: 0, y: 0 };
      group.forEach((l) => { avg.x += l.x / group.length; avg.y += l.y / group.length; });
      const p = toScreen(avg);
      const key = `${player}-${hi}`;
      out.push({
        key, x: p.x, y: p.y, pad: hand.pad * H, player,
        active: body ? handActive(p, body) : true,
        speed: handSpeed(key, p.x, p.y, now, unit),
        flip: body ? p.x > body.mid.x : hi === 0, // the 🥊 emoji faces left
      });
    });
  });
  if (now - mouse.at < 2000) {
    out.push({
      key: "mouse", x: mouse.x, y: mouse.y, pad: 0.035 * H, player: 0, active: true,
      speed: handSpeed("mouse", mouse.x, mouse.y, now, CONFIG.mouseTorso * H), flip: false,
    });
  }
  for (const key of handHist.keys()) if (!out.some((p) => p.key === key)) handHist.delete(key);
  // previous positions let fast punches pop bubbles they passed through (ignore huge jumps)
  const prev = new Map(prevPoints);
  prevPoints.clear();
  out.forEach((p) => {
    const pp = prev.get(p.key);
    const near = pp && Math.hypot(pp.x - p.x, pp.y - p.y) < 0.35 * H;
    p.px = near ? pp.x : p.x;
    p.py = near ? pp.y : p.y;
    prevPoints.set(p.key, { x: p.x, y: p.y });
  });
  return out;
}

function distToSegment(cx, cy, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay;
  const len2 = dx * dx + dy * dy;
  const k = len2 ? Math.max(0, Math.min(1, ((cx - ax) * dx + (cy - ay) * dy) / len2)) : 0;
  return Math.hypot(cx - (ax + k * dx), cy - (ay + k * dy));
}

function raisedHands() {
  for (const lms of poses) {
    const nose = lms[0], lw = lms[15], rw = lms[16];
    if (!nose || !lw || !rw) continue;
    if ((lw.visibility ?? 1) < 0.5 || (rw.visibility ?? 1) < 0.5) continue;
    if (lw.y < nose.y - 0.03 && rw.y < nose.y - 0.03) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Update
// ---------------------------------------------------------------------------
function update(dt, now) {
  // particles
  particles = particles.filter((p) => {
    p.life += dt;
    if (p.type === "drop") { p.x += p.vx * dt; p.y += p.vy * dt; p.vx *= 0.92; p.vy = p.vy * 0.92 + 0.6 * H * dt; }
    if (p.type === "emoji") { p.x += p.vx * dt; p.y += p.vy * dt; p.vy += 1.4 * H * dt; p.rot += p.vr * dt; }
    if (p.type === "text" || p.type === "pow") { p.y += p.vy * dt; }
    if (p.type === "confetti") { p.x += p.vx * dt; p.y += p.vy * dt; p.vy += p.gravity * H * dt; p.rot += p.vr * dt; p.x += Math.sin(p.life * 4 + p.rot) * 0.05 * H * dt; }
    if (p.type === "sparkle") { p.x += p.vx * dt; p.y += p.vy * dt; }
    return p.life < p.max;
  });
  shake = Math.max(0, shake - dt);
  flash = Math.max(0, flash - dt * 1.5);

  if (state === "paused" || state === "intro") return;

  // sparkle trail behind fast gloves
  points.forEach((p) => {
    if (p.speed > lv().punch && Math.random() < 0.8) {
      particles.push({
        type: "sparkle", x: p.x + rand(-1, 1) * p.pad * 0.5, y: p.y + rand(-1, 1) * p.pad * 0.5,
        vx: rand(-0.05, 0.05) * H, vy: rand(-0.05, 0.05) * H, size: rand(0.005, 0.012) * H,
        life: 0, max: rand(0.3, 0.6), color: colorOf(p.player),
      });
    }
  });

  // start gesture + level picker (touch an animal button and hold for a moment)
  if (inMenu(now)) {
    raiseHold = raisedHands() ? raiseHold + dt : Math.max(0, raiseHold - dt * 2);
    if (raiseHold >= CONFIG.holdToStart) { raiseHold = 0; startCountdown(); }
    levelButtons().forEach((btn, i) => {
      const touching = i !== level &&
        points.some((p) => p.active && Math.hypot(p.x - btn.x, p.y - btn.y) < btn.r + p.pad);
      levelHold[i] = touching ? levelHold[i] + dt : Math.max(0, levelHold[i] - dt * 2);
      if (levelHold[i] >= CONFIG.holdToLevel) setLevel(i);
    });
  } else {
    raiseHold = 0;
    levelHold.fill(0);
  }

  if (state === "countdown") {
    const before = Math.ceil(countdown - 1);
    countdown -= dt;
    const after = Math.ceil(countdown - 1);
    if (after !== before) {
      if (after > 0) { beep(false); say(t().count[3 - after]); }
      else { beep(true); say(lv().bombChance > 0 ? t().goBombs : t().go); state = "playing"; spawnTimer = 0.4; }
    }
  }

  const live = () => bubbles.filter((b) => b.leaving === null && b.autoPopAt === null).length;
  if (state === "playing") {
    elapsed += dt;
    const progress = Math.min(1, elapsed / CONFIG.roundSeconds);
    spawnTimer -= dt;
    if (spawnTimer <= 0 && live() < lv().maxBubbles) {
      // the first bubble waits for the start speech; later ones come quickly after a pop
      if (spawnBubble()) spawnTimer = lerp(lv().gap[0], lv().gap[1], progress);
      else spawnTimer = 0.2;
    }
    if (live() >= lv().maxBubbles) spawnTimer = Math.max(spawnTimer, lerp(lv().gap[0], lv().gap[1], progress));
    if (elapsed >= CONFIG.roundSeconds) endRound();
  }

  // one practice bubble on the menu screens so the little one can try a punch
  if ((state === "ready" || state === "done") && live() < 1 && Math.random() < dt * 0.6) spawnBubble(true);

  // age + hit bubbles
  const scoring = state === "playing";
  const need = lv().punch;
  bubbles.forEach((b) => {
    b.age += dt;
    b.squish = Math.max(0, b.squish - dt * 3);
    b.hitCool = Math.max(0, b.hitCool - dt);
    if (b.autoPopAt !== null) {
      b.autoPopAt -= dt;
      if (b.autoPopAt <= 0) b.bomb ? popBomb(b, false) : popBubble(b, false, null);
      return;
    }
    if (b.leaving !== null) {
      b.leaving += dt;
      b.y -= 0.12 * H * dt;
      if (b.leaving > 0.7) b.dead = true;
      return;
    }
    if (b.age > CONFIG.approach + b.stay) {
      if (b.bomb) popBomb(b, false); else b.leaving = 0;
      return;
    }
    if (b.age < CONFIG.approach * 0.5) return; // still flying in
    const inside = new Set();
    for (const p of points) {
      if (distToSegment(b.x, b.y, p.px, p.py, p.x, p.y) >= b.r * (b.bomb ? 0.8 : 1) + p.pad) continue;
      inside.add(p.key);
      if (b.hitCool > 0) continue;
      if (p.speed >= need) {
        punchBubble(b, scoring, p);
        break;
      }
      // a slow touch: the bubble bounces, so the kid learns it needs a real punch
      if (!b.inside.has(p.key) && !b.bomb) {
        b.squish = 1;
        boingSound();
        if (scoring && ++gentleTouches >= 3 && now - punchHintAt > 15000) {
          say(t().punchHint);
          punchHintAt = now;
          gentleTouches = 0;
        }
      }
    }
    b.inside = inside;
  });
  bubbles = bubbles.filter((b) => !b.dead);
  if (combo && now - lastPopAt > CONFIG.comboWindow * 1000) combo = 0;

  // hints for positioning: the boxer needs to be in view, not too close
  let h = null;
  if (cameraOk && (state === "ready" || state === "playing" || state === "countdown")) {
    if (now - lastSeen > 2000) h = "cantSee";
    else if (boxer >= 0 && poses[boxer]) {
      const l = poses[boxer];
      const hipsVisible = (l[23]?.visibility ?? 0) > 0.3 && (l[24]?.visibility ?? 0) > 0.3;
      if (hipsVisible) hipsMissingSince = 0;
      else if (!hipsMissingSince) hipsMissingSince = now;
      if (hipsMissingSince && now - hipsMissingSince > 3000) h = "stepBack";
    }
  }
  if (!cameraOk && state !== "intro") h = "noCam";
  if (h !== hint) {
    hint = h;
    if (h && h !== "noCam" && state !== "countdown" && now - hintSpokenAt > 10000) {
      say(t()[h]);
      hintSpokenAt = now;
    }
  }
}

// ---------------------------------------------------------------------------
// Render
// ---------------------------------------------------------------------------
function roundRect(x, y, w, h, r) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
}

function label(text, x, y, size, opts = {}) {
  ctx.save();
  ctx.font = `${size}px "Arial Rounded MT Bold", "Baloo 2", system-ui, sans-serif`;
  ctx.textAlign = opts.align || "center";
  ctx.textBaseline = "middle";
  if (opts.pill) {
    const w = ctx.measureText(text).width + size * 1.2;
    const lx = opts.align === "left" ? x - size * 0.6 : x - w / 2;
    roundRect(lx, y - size * 0.85, w, size * 1.7, size * 0.85);
    ctx.fillStyle = opts.pill;
    ctx.fill();
  }
  ctx.shadowColor = "rgba(0,30,70,0.6)";
  ctx.shadowOffsetY = size * 0.06;
  ctx.shadowBlur = size * 0.12;
  ctx.fillStyle = opts.color || "#fff";
  ctx.fillText(text, x, y);
  ctx.restore();
}

// Color emoji pick up fillStyle's alpha in Chrome, so always draw them with an opaque fill.
function emoji(text, x, y, size) {
  ctx.font = `${size}px system-ui, "Apple Color Emoji", sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = "#fff";
  ctx.fillText(text, x, y);
}

function drawBackground() {
  if (cameraOk && video.readyState >= 2) {
    const r = videoRect();
    ctx.save();
    ctx.translate(W, 0);
    ctx.scale(-1, 1);
    ctx.drawImage(video, r.ox, r.oy, r.dw, r.dh);
    ctx.restore();
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, "rgba(255,120,60,0.14)");
    g.addColorStop(1, "rgba(120,0,60,0.26)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
  } else {
    const g = ctx.createRadialGradient(W * 0.3, H * 0.3, 0, W * 0.5, H * 0.5, Math.max(W, H));
    g.addColorStop(0, "#ff8a5c");
    g.addColorStop(0.5, "#b83a6a");
    g.addColorStop(1, "#3a1240");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
  }
}

const easeOutBack = (k) => 1 + 2.2 * (k - 1) ** 3 + 1.2 * (k - 1) ** 2;

function drawBubble(b) {
  const { x, y } = b;
  // flies in from far away: starts tiny and see-through, lands with a little overshoot
  const k = Math.min(1, b.age / CONFIG.approach);
  let r = b.r * (0.15 + 0.85 * easeOutBack(k)) * (1 + Math.sin(b.age * 5 + b.phase) * 0.03);
  r *= 1 + b.squish * 0.18 * Math.sin(b.age * 40);
  const timeLeft = CONFIG.approach + b.stay - b.age;
  ctx.save();
  ctx.globalAlpha = (0.35 + 0.65 * k) * (b.leaving !== null ? Math.max(0, 1 - b.leaving / 0.7) : 1);
  // the last second before it floats away it wiggles, so the kid hurries
  const wx = timeLeft < 1 && b.leaving === null ? Math.sin(b.age * 30) * r * 0.05 : 0;
  if (b.bomb) drawBomb(x + wx, y, r, b.age);
  else drawBubbleBody(b, x + wx, y, r);
  ctx.restore();
}

function drawBubbleBody(b, x, y, r) {
  const h = b.hue;
  if (b.big) { ctx.shadowColor = "#ffd23f"; ctx.shadowBlur = r * 0.6; }
  const g = ctx.createRadialGradient(x - r * 0.3, y - r * 0.35, r * 0.1, x, y, r);
  if (b.big) {
    g.addColorStop(0, "rgba(255,250,200,0.55)");
    g.addColorStop(0.7, "rgba(255,210,60,0.45)");
    g.addColorStop(1, "rgba(255,170,0,0.9)");
  } else {
    g.addColorStop(0, `hsla(${h},100%,96%,0.22)`);
    g.addColorStop(0.65, `hsla(${h},95%,72%,0.28)`);
    g.addColorStop(1, `hsla(${h},95%,62%,0.8)`);
  }
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fillStyle = g;
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.lineWidth = Math.max(3, r * 0.06);
  ctx.strokeStyle = b.big ? "rgba(255,240,150,0.95)" : `hsla(${h + 50},100%,85%,0.95)`;
  ctx.stroke();

  if (b.emoji || b.big) emoji(b.big ? "⭐" : b.emoji, x, y + r * 0.06, r * 0.95);
  // big bubble: one dot per punch still needed (counting without reading)
  if (b.big) {
    const n = b.hits, gap = r * 0.32;
    for (let i = 0; i < n; i++) {
      ctx.beginPath();
      ctx.arc(x + (i - (n - 1) / 2) * gap, y + r * 0.72, r * 0.1, 0, Math.PI * 2);
      ctx.fillStyle = "#fff";
      ctx.fill();
      ctx.lineWidth = r * 0.03;
      ctx.strokeStyle = "#c98a00";
      ctx.stroke();
    }
  }

  // shine
  ctx.beginPath();
  ctx.ellipse(x - r * 0.38, y - r * 0.42, r * 0.24, r * 0.12, -0.7, 0, Math.PI * 2);
  ctx.fillStyle = "rgba(255,255,255,0.85)";
  ctx.fill();
  ctx.beginPath();
  ctx.arc(x - r * 0.12, y - r * 0.62, r * 0.06, 0, Math.PI * 2);
  ctx.fill();
}

// A dark, pulsing red bubble with a bomb inside: easy to tell apart even for the little one.
function drawBomb(x, y, r, age) {
  const pulse = 0.5 + 0.5 * Math.sin(age * 8);
  ctx.shadowColor = "#ff3b1f";
  ctx.shadowBlur = r * (0.3 + 0.5 * pulse);
  const g = ctx.createRadialGradient(x - r * 0.3, y - r * 0.35, r * 0.1, x, y, r);
  g.addColorStop(0, "rgba(120,40,40,0.55)");
  g.addColorStop(0.7, "rgba(60,10,10,0.6)");
  g.addColorStop(1, "rgba(30,0,0,0.9)");
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fillStyle = g;
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.lineWidth = Math.max(3, r * 0.08);
  ctx.strokeStyle = `rgba(255,${60 + pulse * 80},40,${0.6 + 0.4 * pulse})`;
  ctx.stroke();
  emoji("💣", x, y + r * 0.06, r * 1.05);
}

function drawParticles() {
  for (const p of particles) {
    const k = p.life / p.max;
    if (p.type === "text") {
      ctx.save();
      ctx.globalAlpha = Math.max(0, 1 - k);
      label(p.text, p.x, p.y, p.size, { color: p.color });
      ctx.restore();
      continue;
    }
    if (p.type === "pow") {
      ctx.save();
      ctx.globalAlpha = k < 0.6 ? 1 : (1 - k) / 0.4;
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot);
      const s = p.size * (k < 0.15 ? 0.6 + (k / 0.15) * 0.6 : 1.2 - Math.min(0.2, (k - 0.15)));
      ctx.font = `900 ${s}px "Arial Rounded MT Bold", "Arial Black", system-ui, sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.lineJoin = "round";
      ctx.lineWidth = s * 0.18;
      ctx.strokeStyle = "#2a0a3a";
      ctx.strokeText(p.text, 0, 0);
      ctx.fillStyle = "#ffe03f";
      ctx.fillText(p.text, 0, 0);
      ctx.lineWidth = s * 0.05;
      ctx.strokeStyle = p.color;
      ctx.strokeText(p.text, 0, 0);
      ctx.restore();
      continue;
    }
    ctx.save();
    ctx.globalAlpha = Math.max(0, 1 - k);
    if (p.type === "ring") {
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r * (1 + k * 0.8), 0, Math.PI * 2);
      ctx.strokeStyle = p.color;
      ctx.lineWidth = p.r * 0.12 * (1 - k);
      ctx.stroke();
    } else if (p.type === "drop" || p.type === "sparkle") {
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size * (1 - k * 0.5), 0, Math.PI * 2);
      ctx.fillStyle = p.color;
      ctx.fill();
    } else if (p.type === "emoji") {
      ctx.globalAlpha = k < 0.7 ? 1 : (1 - k) / 0.3;
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot);
      emoji(p.text, 0, 0, p.size);
    } else if (p.type === "confetti") {
      ctx.globalAlpha = k < 0.8 ? 1 : (1 - k) / 0.2;
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot);
      ctx.fillStyle = p.color;
      ctx.fillRect(-p.size / 2, -p.size / 4, p.size, p.size / 2);
    }
    ctx.restore();
  }
}

function drawPlayers(now) {
  if (debug) {
    ctx.save();
    ctx.lineWidth = 4;
    poses.forEach((lms, i) => {
      ctx.strokeStyle = colorOf(i);
      for (const { start, end } of PoseLandmarker.POSE_CONNECTIONS) {
        const a = lms[start], b = lms[end];
        if ((a.visibility ?? 1) < VIS_MIN || (b.visibility ?? 1) < VIS_MIN) continue;
        const pa = toScreen(a), pb = toScreen(b);
        ctx.beginPath();
        ctx.moveTo(pa.x, pa.y);
        ctx.lineTo(pb.x, pb.y);
        ctx.stroke();
      }
    });
    ctx.restore();
    for (const p of points) label(p.speed.toFixed(1), p.x, p.y - p.pad * 2, 26, { pill: "rgba(0,0,0,0.5)" });
  }
  // a boxing glove on each hand; it glows brighter while moving fast enough to pop
  for (const p of points) {
    const fast = p.speed >= lv().punch;
    const r = p.pad * (fast ? 1.25 : 1);
    ctx.save();
    const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, r * 1.7);
    g.addColorStop(0, "rgba(255,255,255,0.9)");
    g.addColorStop(0.4, colorOf(p.player));
    g.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = g;
    ctx.globalAlpha = fast ? 0.95 : 0.55;
    ctx.beginPath();
    ctx.arc(p.x, p.y, r * 1.7, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.translate(p.x, p.y);
    if (p.flip) ctx.scale(-1, 1);
    emoji("🥊", 0, 0, r * 2 * (1 + Math.sin(now / 200 + p.x) * 0.03));
    ctx.restore();
  }
}

function drawHUD(now) {
  const s = H / 1080;
  if (state === "playing" || state === "paused" || state === "countdown" || state === "done") {
    // score + combo
    label(`🥊 ${score}`, 40 * s, 80 * s, 90 * s, { align: "left", pill: "rgba(90,0,60,0.45)" });
    if (combo >= 2 && state === "playing") {
      const k = Math.min(1, (now - lastPopAt) / 150);
      label(`🔥 ×${combo}`, 50 * s, 190 * s, (64 + (1 - k) * 20) * s, { align: "left", color: "#ffd23f", pill: "rgba(90,0,60,0.45)" });
    }
    // time bar
    const remaining = Math.max(0, 1 - elapsed / CONFIG.roundSeconds);
    const bw = W * 0.4, bh = 34 * s, bx = W - bw - 50 * s, by = 62 * s;
    roundRect(bx, by, bw, bh, bh / 2);
    ctx.fillStyle = "rgba(60,0,40,0.45)";
    ctx.fill();
    if (remaining > 0) {
      const g = ctx.createLinearGradient(bx, 0, bx + bw, 0);
      ["#ff5e5e", "#ffb03f", "#ffe53f", "#6bff6b", "#3fd2ff", "#a46bff"].forEach((c, i, a) => g.addColorStop(i / (a.length - 1), c));
      roundRect(bx, by, Math.max(bh, bw * remaining), bh, bh / 2);
      ctx.fillStyle = g;
      ctx.fill();
    }
    label("⏱", bx - 40 * s, by + bh / 2, 50 * s);
    label(lv().icon, bx - 120 * s, by + bh / 2, 60 * s);
  }

  const cx = W / 2, cy = H / 2;
  if (inMenu(now)) drawMenu(now, s);

  if (state === "countdown") {
    const n = Math.ceil(countdown - 1);
    if (n > 0) {
      const k = 1 - (countdown - 1 - Math.floor(countdown - 1));
      label(String(n), cx, cy, (320 + k * 120) * s, { color: "#ffd23f" });
    }
  }

  // big score celebration, then it fades into the "play again" menu
  if (state === "done" && now - doneAt < 3500) {
    const pop = Math.min(1, (now - doneAt) / 400);
    ctx.save();
    ctx.globalAlpha = Math.min(1, (3500 - (now - doneAt)) / 300);
    label("🏆", cx, cy - 150 * s, 160 * s * pop);
    label(`${score}`, cx, cy + 60 * s, 260 * s * pop, { color: "#ffd23f" });
    ctx.restore();
  }

  if (state === "paused") {
    ctx.fillStyle = "rgba(40,0,30,0.4)";
    ctx.fillRect(0, 0, W, H);
    label(`⏸ ${t().paused}`, cx, cy, 130 * s);
  }

  if (hint) {
    const icon = hint === "stepBack" ? "👣 " : hint === "cantSee" ? "👀 " : "🖱 ";
    label(icon + t()[hint], cx, H - 90 * s, 54 * s, { pill: "rgba(255,90,90,0.75)" });
  }
}

// Start / play-again screen: raise hands to start, touch an animal to pick the level.
function drawMenu(now, s) {
  const cx = W / 2;
  const msg = state === "ready" ? t().raise : t().again;
  const bob = Math.sin(now / 300) * 15 * s;
  const iconY = 250 * s;
  ctx.save();
  if (state === "done") ctx.globalAlpha = Math.min(1, (now - doneAt - 3500) / 400);
  // progress ring for hold-to-start
  if (raiseHold > 0) {
    ctx.beginPath();
    ctx.arc(cx, iconY, 120 * s, -Math.PI / 2, -Math.PI / 2 + (raiseHold / CONFIG.holdToStart) * Math.PI * 2);
    ctx.strokeStyle = "#ffd23f";
    ctx.lineWidth = 22 * s;
    ctx.lineCap = "round";
    ctx.stroke();
  }
  emoji("🙌", cx, iconY + bob, 150 * s);
  label(msg, cx, iconY + 200 * s, 66 * s, { pill: "rgba(90,0,60,0.5)" });
  levelButtons().forEach((btn, i) => drawLevelButton(btn, i, now, s));
  ctx.restore();
}

// Animal = speed (🐢 easy, 🐇 medium, 🐆 hard), stars underneath, 💣 badge where bombs appear.
function drawLevelButton(btn, i, now, s) {
  const sel = i === level;
  const r = btn.r * (sel ? 1.12 + Math.sin(now / 250) * 0.03 : 0.92);
  ctx.save();
  if (!sel) ctx.globalAlpha *= 0.75;
  if (sel) { ctx.shadowColor = "#ffd23f"; ctx.shadowBlur = r * 0.5; }
  ctx.beginPath();
  ctx.arc(btn.x, btn.y, r, 0, Math.PI * 2);
  ctx.fillStyle = sel ? "rgba(255,210,63,0.35)" : "rgba(90,0,60,0.45)";
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.lineWidth = (sel ? 10 : 5) * s;
  ctx.strokeStyle = sel ? "#ffd23f" : "rgba(255,255,255,0.8)";
  ctx.stroke();
  if (levelHold[i] > 0) {
    ctx.beginPath();
    ctx.arc(btn.x, btn.y, r + 16 * s, -Math.PI / 2, -Math.PI / 2 + Math.min(1, levelHold[i] / CONFIG.holdToLevel) * Math.PI * 2);
    ctx.strokeStyle = "#fff";
    ctx.lineWidth = 14 * s;
    ctx.lineCap = "round";
    ctx.stroke();
  }
  emoji(LEVELS[i].icon, btn.x, btn.y + r * 0.05, r * 1.0);
  if (LEVELS[i].bombChance > 0) emoji("💣", btn.x + r * 0.72, btn.y - r * 0.72, r * 0.5);
  label("⭐".repeat(i + 1), btn.x, btn.y + r + 40 * s, 34 * s);
  ctx.restore();
}

function render(now) {
  ctx.clearRect(0, 0, W, H);
  drawBackground();
  ctx.save();
  if (shake > 0) { const k = shake * 0.04 * H; ctx.translate(rand(-k, k), rand(-k, k)); }
  bubbles.forEach(drawBubble);
  drawPlayers(now);
  drawParticles();
  ctx.restore();
  if (flash > 0) { ctx.fillStyle = `rgba(255,120,40,${flash})`; ctx.fillRect(0, 0, W, H); }
  drawHUD(now);
}

// ---------------------------------------------------------------------------
// Main loop + input
// ---------------------------------------------------------------------------
let last = performance.now();
function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  detect(now);
  points = computePoints(now);
  update(dt, now);
  render(now);
  requestAnimationFrame(frame);
}

function toggleFullscreen() {
  if (document.fullscreenElement) document.exitFullscreen();
  else document.documentElement.requestFullscreen().catch(() => {});
}

startBtn.addEventListener("click", async () => {
  initAudio();
  say(" "); // unlock speech in Chrome
  toggleFullscreen();
  startBtn.disabled = true;
  startBtn.textContent = "⏳ Loading…";
  const [cam, model] = await Promise.allSettled([startCamera(), loadModel()]);
  if (cam.status === "rejected") console.error("Camera:", cam.reason);
  if (model.status === "rejected") {
    console.error("Model:", model.reason);
    introMsg.innerHTML = '<span class="err">Could not load the body-tracking model. Check that the vendor folder is in place.</span>';
    startBtn.disabled = false;
    startBtn.textContent = "▶ Play";
    return;
  }
  intro.style.display = "none";
  state = "ready";
  lastSeen = performance.now();
  say(t().raise);
});

window.addEventListener("keydown", (e) => {
  if (state === "intro") return;
  const k = e.key.toLowerCase();
  if (k === " " || k === "enter") {
    e.preventDefault();
    if (state === "ready" || state === "done") startCountdown();
    else togglePause();
  } else if (k === "f") toggleFullscreen();
  else if (k === "d") debug = !debug;
  else if (k === "m") { muted = !muted; if (muted) speechSynthesis.cancel(); }
  else if (k === "l") { lang = lang === "en" ? "ru" : "en"; say(state === "done" ? t().again : t().raise); }
  else if (LEVELS[Number(k) - 1]) setLevel(Number(k) - 1);
});

canvas.addEventListener("mousemove", (e) => { mouse = { x: e.clientX, y: e.clientY, at: performance.now() }; });
canvas.addEventListener("click", (e) => {
  if (!inMenu(performance.now())) return;
  const i = levelButtons().findIndex((b) => Math.hypot(b.x - e.clientX, b.y - e.clientY) < b.r);
  if (i >= 0) setLevel(i);
});

requestAnimationFrame(frame);
