#!/usr/bin/env node
/* =============================================================
   Headless smoke test.

   Loads the real three.js build the game loads in production,
   stubs out the browser APIs the game touches, boots the game
   and steps a few hundred frames. Catches the class of bug that
   silently blanks the canvas: missing constructors, typos in
   member names, bad geometry args, NaN propagation.

   Run:  node tools/smoke-test.js
   ============================================================= */
"use strict";

const fs = require("fs");
const path = require("path");
const vm = require("vm");
const https = require("https");

const THREE_URL = "https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js";
const CACHE = path.join(__dirname, ".cache", "three.min.js");
const GAME = path.join(__dirname, "..", "games", "neon-bay", "game.js");

// ------------------------------------------------------------ fetch three.js
function getThree() {
  if (fs.existsSync(CACHE)) return fs.readFileSync(CACHE, "utf8");
  return new Promise((resolve, reject) => {
    https.get(THREE_URL, (res) => {
      if (res.statusCode !== 200) return reject(new Error("three.js download: HTTP " + res.statusCode));
      let d = "";
      res.on("data", (c) => (d += c));
      res.on("end", () => {
        fs.mkdirSync(path.dirname(CACHE), { recursive: true });
        fs.writeFileSync(CACHE, d);
        resolve(d);
      });
    }).on("error", reject);
  });
}

// ------------------------------------------------------------ dom stubs
function ctx2d() {
  const noop = () => {};
  return {
    canvas: { width: 128, height: 128 },
    fillStyle: "", strokeStyle: "", lineWidth: 1, font: "", globalAlpha: 1,
    textAlign: "", textBaseline: "",
    fillRect: noop, clearRect: noop, strokeRect: noop, fillText: noop,
    beginPath: noop, closePath: noop, moveTo: noop, lineTo: noop,
    arc: noop, fill: noop, stroke: noop, save: noop, restore: noop,
    translate: noop, rotate: noop, scale: noop, setTransform: noop,
    drawImage: noop, putImageData: noop,
    createLinearGradient: () => ({ addColorStop: noop }),
    createRadialGradient: () => ({ addColorStop: noop }),
    getImageData: () => ({ data: new Uint8ClampedArray(4) })
  };
}

function makeEl(tag) {
  const el = {
    tagName: (tag || "div").toUpperCase(),
    style: {}, dataset: {}, children: [], className: "", id: "",
    width: 300, height: 150, textContent: "", innerHTML: "",
    appendChild(c) { this.children.push(c); return c; },
    removeChild(c) { const i = this.children.indexOf(c); if (i >= 0) this.children.splice(i, 1); return c; },
    addEventListener(t, f) { (this._h = this._h || {}), (this._h[t] = this._h[t] || []).push(f); },
    removeEventListener() {},
    dispatch(t, ev) { ((this._h || {})[t] || []).forEach((f) => f(ev || { preventDefault() {} })); },
    setAttribute() {}, getAttribute: () => null,
    getContext(kind) { return kind === "2d" ? ctx2d() : null; },
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 1280, height: 720 }),
    focus() {}, click() { this.dispatch("click"); },
    querySelector: () => null, querySelectorAll: () => []
  };
  return el;
}

// ids the game looks up
const IDS = ["stage", "start", "intro", "hud", "speed", "cash", "stars", "timer",
  "hpbar", "arbar", "weapon", "ammo", "objective", "banner", "flash", "mini", "crash",
  "tGas", "tRev", "tL", "tR", "tHand", "tFire", "tEnter"];

const store = {};
IDS.forEach((id) => { store[id] = makeEl("div"); store[id].id = id; });
store.mini.getContext = (k) => (k === "2d" ? ctx2d() : null);

// Handler registries kept in closures. The game calls bare `addEventListener(...)`
// from inside a strict-mode IIFE, where `this` is undefined - so these must not
// depend on the call-site receiver.
const winH = {};
const docH = {};

const documentStub = {
  readyState: "complete",
  body: makeEl("body"),
  documentElement: makeEl("html"),
  createElement: (t) => makeEl(t),
  createElementNS: (ns, t) => makeEl(t),
  getElementById: (id) => store[id] || null,
  querySelector: () => null,
  querySelectorAll: () => [],
  addEventListener(t, f) { (docH[t] = docH[t] || []).push(f); },
  removeEventListener() {},
  exitPointerLock() {}
};

// ------------------------------------------------------------ sandbox
let rafQueue = [];
let frameCount = 0;

const sandbox = {
  console,
  document: documentStub,
  navigator: { userAgent: "node-smoke-test", maxTouchPoints: 0 },
  location: { href: "http://localhost/", protocol: "http:" },
  innerWidth: 1280, innerHeight: 720, devicePixelRatio: 1,
  performance: { now: () => Date.now() },
  requestAnimationFrame(fn) { rafQueue.push(fn); return rafQueue.length; },
  cancelAnimationFrame() {},
  setTimeout, clearTimeout, setInterval, clearInterval,
  addEventListener(t, f) { (winH[t] = winH[t] || []).push(f); },
  removeEventListener() {},
  Image: function () { return makeEl("img"); },
  URL: { createObjectURL: () => "blob:x", revokeObjectURL() {} },
  // deliberately no AudioContext: exercises the game's silent-audio path
  TextDecoder, TextEncoder, Math, Date, JSON, isNaN, parseFloat, parseInt,
  Float32Array, Uint8Array, Uint16Array, Uint32Array, Int32Array,
  Uint8ClampedArray, ArrayBuffer, DataView, Promise, Error, TypeError
};
sandbox.window = sandbox;
sandbox.self = sandbox;
sandbox.globalThis = sandbox;

// ------------------------------------------------------------ run
(async function main() {
  const threeSrc = await getThree();
  const ctx = vm.createContext(sandbox);

  const fails = [];
  function fail(where, e) {
    fails.push(where + ": " + (e && e.message ? e.message : e));
    if (e && e.stack) fails.push("    " + e.stack.split("\n").slice(1, 3).join("\n    "));
  }

  // 1. three.js
  try {
    vm.runInContext(threeSrc, ctx, { filename: "three.min.js" });
  } catch (e) { fail("three.js load", e); }
  if (!sandbox.THREE) {
    console.error("FAIL  three.js did not expose a THREE global");
    process.exit(1);
  }
  console.log("ok    three.js loaded (" + (sandbox.THREE.REVISION || "?") + ")");

  // 2. stub the renderer - no GPU in node
  const T = sandbox.THREE;
  T.WebGLRenderer = function () {
    return {
      domElement: makeEl("canvas"),
      setPixelRatio() {}, setSize() {}, render() {}, dispose() {},
      setClearColor() {}, shadowMap: {}, outputEncoding: 0,
      getContext: () => ({})
    };
  };

  // 3. verify every constructor the game names actually exists
  const gameSrc = fs.readFileSync(GAME, "utf8");
  const used = new Set();
  let m;
  const re = /THREE\.([A-Za-z0-9_]+)/g;
  while ((m = re.exec(gameSrc))) used.add(m[1]);
  // A name reached only through `typeof THREE.X === "function"` is a deliberate
  // feature test for a newer three.js, not a hard dependency.
  const guarded = new Set();
  const gre = /typeof\s+THREE\.([A-Za-z0-9_]+)/g;
  while ((m = gre.exec(gameSrc))) guarded.add(m[1]);
  const missing = [...used].filter((n) => T[n] === undefined && !guarded.has(n));
  if (missing.length) {
    missing.forEach((n) => fails.push("THREE." + n + " is referenced unguarded but does not exist in r" + T.REVISION));
  } else {
    console.log("ok    all " + used.size + " THREE.* references resolve (" + guarded.size + " feature-tested)");
  }

  // 4. load and boot the game
  let evaluated = false;
  try {
    vm.runInContext(gameSrc, ctx, { filename: "game.js" });
    evaluated = true;
  } catch (e) { fail("game.js evaluate", e); }

  if (evaluated) {
    try {
      (docH.DOMContentLoaded || []).forEach((f) => f({}));
      store.start.dispatch("click");
      console.log("ok    booted without throwing");
    } catch (e) { fail("boot", e); }
  } else {
    fails.push("skipped boot and frame stepping - the file did not evaluate");
  }

  // 5. step frames
  const STEPS = 240;
  try {
    for (let i = 0; i < STEPS; i++) {
      const q = rafQueue; rafQueue = [];
      if (!q.length) { fails.push("render loop stopped at frame " + i); break; }
      q.forEach((fn) => fn(16.7 * i));
      frameCount++;
    }
    console.log("ok    stepped " + frameCount + " frames");
  } catch (e) { fail("frame " + frameCount, e); }

  // 6. sanity-check the HUD is producing real numbers
  const bad = [];
  ["speed", "cash", "ammo", "weapon", "objective"].forEach((id) => {
    const e = store[id];
    if (!e) { bad.push(id + " element was never created"); return; }
    const t = String(e.textContent);
    if (/nan|undefined|infinity/i.test(t)) bad.push(id + ' = "' + t + '"');
  });
  if (bad.length) fails.push("HUD produced junk values: " + bad.join(", "));
  else console.log("ok    HUD values are finite");

  // ------------------------------------------------------------ report
  console.log("");
  if (fails.length) {
    console.error("FAILED (" + fails.length + ")");
    fails.forEach((f) => console.error("  - " + f));
    process.exit(1);
  }
  console.log("PASS  game boots and runs " + STEPS + " frames clean");
})().catch((e) => {
  console.error("harness error:", e);
  process.exit(1);
});
