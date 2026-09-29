// Headless physics check for public/game/index.html
// Stubs the DOM, runs the real game script, and asserts physics invariants.
import fs from "node:fs";
import vm from "node:vm";

const html = fs.readFileSync(new URL("./public/game/index.html", import.meta.url), "utf8");
const match = html.match(/<script type="application\/javascript">([\s\S]*?)<\/script>/);
if (!match) { console.error("FAIL: game script not found"); process.exit(1); }
const source = match[1] + "\n;globalThis.__t = { paddles, theBall, moveBall, getSpeed: () => speed, resetBall };";

const ctxStub = {
  clearRect() {}, fillRect() {}, drawImage() {}, fill() {}, arc() {},
  set fillStyle(_v) {}, get fillStyle() { return ""; },
};
const canvasStub = { width: 800, height: 600, getContext: () => ctxStub };
const sandbox = {
  console, Math,
  Path2D: class { arc() {} },
  document: { getElementById: (id) => (id === "canvas" ? canvasStub : {}) },
  window: { innerWidth: 800, innerHeight: 600, addEventListener() {}, requestAnimationFrame() {} },
};
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(source, sandbox);
const t = sandbox.__t;

let failures = 0;
const check = (cond, msg) => { if (cond) console.log("PASS:", msg); else { failures++; console.log("FAIL:", msg); } };
const atCenter = () => Math.abs(t.theBall.x - 0.5) < 0.001 && Math.abs(t.theBall.y - 0.5) < 0.001;
const trackBall = () => {
  const y = Math.min(1 - 0.24, Math.max(0, t.theBall.y - 0.12));
  t.paddles[0].y = y; t.paddles[1].y = y;
};

// --- Test 1: serve direction matches the angle convention (degrees, y-down) ---
for (const angle of [45, 135, 315, 225]) {
  t.theBall.angle = angle;
  t.theBall.x = t.theBall.y = 0.5;
  t.moveBall();
  const rad = angle * Math.PI / 180;
  const expX = Math.cos(rad) > 0 ? ">" : "<";
  const expY = Math.sin(rad) > 0 ? ">" : "<";
  const gotX = t.theBall.x > 0.5 ? ">" : "<";
  const gotY = t.theBall.y > 0.5 ? ">" : "<";
  check(gotX === expX && gotY === expY, `angle ${angle}: ball moves x${gotX}0 y${gotY}0 as expected`);
}

// --- Test 2: ball bounces off both walls and stays on the table ---
t.theBall.x = 0.5; t.theBall.y = 0.01; t.theBall.angle = 80; // heading down-right, steep
t.paddles[0].y = 0; t.paddles[1].y = 0; // park paddles in the top band
let yMin = 1, yMax = 0, bouncedTop = false, bouncedBottom = false;
for (let i = 0; i < 5000; i++) {
  const yBefore = t.theBall.y;
  t.moveBall();
  if (yBefore < 0.02 && t.theBall.y > yBefore) bouncedTop = true;
  if (yBefore > 0.98 && t.theBall.y < yBefore) bouncedBottom = true;
  yMin = Math.min(yMin, t.theBall.y); yMax = Math.max(yMax, t.theBall.y);
  if (atCenter()) { t.theBall.x = 0.5; t.theBall.y = 0.01; t.theBall.angle = 80; } // keep the probe in play
}
check(bouncedTop, "ball reflects off the top wall");
check(bouncedBottom, "ball reflects off the bottom wall");
check(yMin >= -0.001 && yMax <= 1.001, `ball stays within y=[0,1] (min ${yMin.toFixed(3)}, max ${yMax.toFixed(3)})`);

// --- Test 3: rally vs tracking paddles - hits happen, nothing breaks ---
t.resetBall();
let hits = 0, outOfBounds = false, escapes = 0, prevDx = null;
for (let i = 0; i < 200000; i++) {
  trackBall();
  const xBefore = t.theBall.x;
  t.moveBall();
  const dx = t.theBall.x - xBefore;
  if (t.theBall.x < -0.06 || t.theBall.x > 1.06 || t.theBall.y < -0.01 || t.theBall.y > 1.01) outOfBounds = true;
  // a paddle hit reverses travel direction near an edge
  if (prevDx !== null && Math.sign(dx) !== Math.sign(prevDx) && (xBefore < 0.2 || xBefore > 0.8) && !atCenter()) hits++;
  if (i > 10 && atCenter()) escapes++; // got through despite full paddle coverage
  prevDx = dx;
}
check(hits >= 10, `rally works: ${hits} paddle hits in 200k frames`);
check(!outOfBounds, "ball never leaves the table during a rally");
check(escapes === 0, `ball never phases through a paddle (escapes: ${escapes})`);
check(t.getSpeed() > 0.005, `ball speeds up as the rally goes on (speed ${t.getSpeed().toFixed(4)})`);

// --- Test 4: missing the ball serves a fresh one from the center ---
t.resetBall();
t.paddles[0].y = 0; t.paddles[1].y = 0; // parked away from the serve path
let respawned = false, escaped = false;
for (let i = 0; i < 100000 && !respawned; i++) {
  const xBefore = t.theBall.x;
  t.moveBall();
  if (xBefore < 0.0 || xBefore > 1.0) escaped = true; // got past a paddle
  if (i > 10 && atCenter()) respawned = true;
}
check(escaped, "ball can get past a paddle (a point is scored)");
check(respawned, "after a miss, a new ball is served from the center");
check(t.getSpeed() === 0.005, "serve speed resets to base after a point");

// --- Test 5: ball clamped onto a wall (y exactly 0) still hits a paddle ---
t.theBall.x = 0.092; t.theBall.y = 0; t.theBall.angle = 180; // skimming the top wall toward myPaddle
t.paddles[0].y = 0; t.paddles[1].y = 0.8; // myPaddle covers y [0, 0.24]
const speedBefore = t.getSpeed();
t.moveBall();
check(t.theBall.x >= 0.09, `ball grazing along the wall still bounces (x=${t.theBall.x.toFixed(3)})`);
check(t.getSpeed() > speedBefore, "wall-graze contact counts as a paddle hit");

// --- Test 6: no ghost hit from behind the paddle ---
t.theBall.x = 0.05; t.theBall.y = 0.1; t.theBall.angle = 180; // already past myPaddle's face
t.paddles[0].y = 0; t.paddles[1].y = 0.8;
t.moveBall();
check(t.theBall.x < 0.05, `ball already behind the paddle passes through (x=${t.theBall.x.toFixed(3)})`);

console.log(failures === 0 ? "\nALL PHYSICS CHECKS PASSED" : `\n${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
