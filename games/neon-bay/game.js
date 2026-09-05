/* =============================================================
   NEON BAY  -  original open-world action game
   ---------------------------------------------------------------
   Everything here is generated at runtime: the city, the vehicles,
   the characters, the weapons and the sound. No third-party game
   assets of any kind are used, loaded or required.

   Systems:
     world      procedural grid city, ramps, water, traffic
     player     on-foot + driving state machine, enter/exit
     combat     hitscan weapons, enemy AI, health/armour
     wanted     police response scaling with heat
     campaign   six-mission original story chain
   ============================================================= */
(function () {
  "use strict";

  // ============================================================ config
  var CELL = 76, GRID = 13, ROAD = 19, WORLD = CELL * GRID;

  var CAR = {
    engine: 27, brake: 44, maxFwd: 63, maxRev: 17,
    drag: 0.62, roll: 3.4, turn: 2.35, grip: 7.6, gripHand: 1.05
  };
  var GRAVITY = 32;
  var FOOT = { walk: 6.4, run: 12.2, accel: 12 };

  var WEAPONS = [
    { name: "Pistol",  dmg: 24, rps: 5.5,  mag: 12, res: 120, spread: 0.014, auto: false, pel: 1, range: 190, snd: 300 },
    { name: "SMG",     dmg: 15, rps: 13,   mag: 30, res: 260, spread: 0.034, auto: true,  pel: 1, range: 150, snd: 240 },
    { name: "Shotgun", dmg: 12, rps: 1.25, mag: 6,  res: 60,  spread: 0.085, auto: false, pel: 8, range: 62,  snd: 160 }
  ];

  var TRAFFIC_N = 16, CIV_N = 44, POLICE_MAX = 6;

  // ============================================================ state
  var scene, camera, renderer, clock, raycasterUp;
  var buildings = [], bGrid = {}, ramps = [];
  var traffic = [], civs = [], police = [], enemies = [], pickups = [];
  var cars = [];                       // enterable vehicles
  var playerMesh, carMeshes = [], blob;
  var markerMesh, beamMesh;
  var fx = [];                         // pooled transient effects
  var running = false, paused = false, started = false, dead = false;

  var P = {
    mode: "foot",                      // "foot" | "drive"
    veh: null,
    x: CELL * 0.5, y: 0, z: CELL * 0.5,
    vx: 0, vy: 0, vz: 0,
    yaw: 0, pitch: 0, grounded: true,
    hp: 100, armor: 0, cash: 0,
    wep: 0, ammo: [], mag: [], cool: 0, reloading: 0,
    heat: 0, stars: 0, shake: 0, dmgFlash: 0,
    kills: 0, deaths: 0
  };

  var keys = {}, mouse = { down: false, locked: false };
  var touch = { t: 0, s: 0, b: 0, fire: 0 };

  // ============================================================ helpers
  function rnd(a, b) { return a + Math.random() * (b - a); }
  function irnd(a, b) { return Math.floor(rnd(a, b + 1)); }
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function key(i, j) { return i + "|" + j; }
  function dist2(ax, az, bx, bz) { var dx = ax - bx, dz = az - bz; return dx * dx + dz * dz; }
  function nearestNode(v) { return Math.round(v / CELL) * CELL; }

  // ============================================================ textures
  function windowTexture(tier) {
    var c = document.createElement("canvas");
    c.width = 64; c.height = 128;
    var x = c.getContext("2d");
    x.fillStyle = "#0a0b14"; x.fillRect(0, 0, 64, 128);
    for (var r = 0; r < 11; r++) {
      for (var q = 0; q < 5; q++) {
        if (Math.random() > 0.55) {
          var hue = Math.random() < 0.16 ? rnd(280, 320) : rnd(35, 55);
          x.fillStyle = "hsl(" + hue + "," + rnd(55, 90) + "%," + rnd(45, 72) + "%)";
        } else x.fillStyle = "#12141f";
        x.fillRect(6 + q * 11, 5 + r * 11, 7, 7);
      }
    }
    var t = new THREE.CanvasTexture(c);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(2, Math.max(1, Math.round(tier * 1.6)));
    return t;
  }

  function skyTexture() {
    var c = document.createElement("canvas");
    c.width = 16; c.height = 256;
    var x = c.getContext("2d");
    var g = x.createLinearGradient(0, 0, 0, 256);
    g.addColorStop(0.00, "#07091c"); g.addColorStop(0.42, "#171a4a");
    g.addColorStop(0.66, "#5b2a6e"); g.addColorStop(0.82, "#c04a6a");
    g.addColorStop(0.93, "#f0834a"); g.addColorStop(1.00, "#ffc07a");
    x.fillStyle = g; x.fillRect(0, 0, 16, 256);
    return new THREE.CanvasTexture(c);
  }

  function asphaltTexture() {
    var c = document.createElement("canvas");
    c.width = c.height = 128;
    var x = c.getContext("2d");
    x.fillStyle = "#191b24"; x.fillRect(0, 0, 128, 128);
    for (var i = 0; i < 900; i++) {
      x.fillStyle = "rgba(255,255,255," + (Math.random() * 0.035) + ")";
      x.fillRect(Math.random() * 128, Math.random() * 128, 2, 2);
    }
    var t = new THREE.CanvasTexture(c);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(GRID * 3, GRID * 3);
    return t;
  }

  // ============================================================ world
  function buildSky() {
    scene.add(new THREE.Mesh(
      new THREE.SphereGeometry(1400, 24, 16),
      new THREE.MeshBasicMaterial({ map: skyTexture(), side: THREE.BackSide, fog: false, depthWrite: false })
    ));
  }

  function buildGround() {
    var m = new THREE.Mesh(
      new THREE.PlaneGeometry(WORLD * 2.4, WORLD * 2.4),
      new THREE.MeshStandardMaterial({ map: asphaltTexture(), color: 0x9aa0b4, roughness: 0.95, metalness: 0.05 })
    );
    m.rotation.x = -Math.PI / 2;
    m.position.set(WORLD / 2, -0.02, WORLD / 2);
    scene.add(m);

    var cap = GRID * GRID * 8;
    var inst = new THREE.InstancedMesh(
      new THREE.PlaneGeometry(0.45, 5.5),
      new THREE.MeshBasicMaterial({ color: 0xf2d98a, transparent: true, opacity: 0.4 }),
      cap
    );
    var d = new THREE.Object3D(), n = 0;
    for (var i = 0; i <= GRID && n < cap; i++) {
      for (var s = 0; s < GRID * 4 && n < cap; s++) {
        var p = s * (CELL / 4) + CELL / 8;
        d.position.set(i * CELL, 0.02, p); d.rotation.set(-Math.PI / 2, 0, 0);
        d.updateMatrix(); inst.setMatrixAt(n++, d.matrix);
        if (n >= cap) break;
        d.position.set(p, 0.02, i * CELL); d.rotation.set(-Math.PI / 2, 0, Math.PI / 2);
        d.updateMatrix(); inst.setMatrixAt(n++, d.matrix);
      }
    }
    inst.count = n;
    inst.instanceMatrix.needsUpdate = true;
    scene.add(inst);
  }

  function buildWater() {
    var m = new THREE.Mesh(
      new THREE.PlaneGeometry(WORLD * 2.4, 900),
      new THREE.MeshStandardMaterial({ color: 0x0a2440, roughness: 0.15, metalness: 0.8, transparent: true, opacity: 0.94 })
    );
    m.rotation.x = -Math.PI / 2;
    m.position.set(WORLD / 2, -0.6, -540);
    scene.add(m);
  }

  function buildCity() {
    var tiers = 5, mats = [], insts = [], counts = [], t;
    for (t = 0; t < tiers; t++) {
      mats.push(new THREE.MeshStandardMaterial({
        map: windowTexture(t + 1), roughness: 0.72, metalness: 0.18,
        emissive: 0x1a1226, emissiveIntensity: 0.55
      }));
      counts.push(0);
    }

    var plan = [];
    for (var i = 0; i < GRID; i++) {
      for (var j = 0; j < GRID; j++) {
        var cx = i * CELL + CELL / 2, cz = j * CELL + CELL / 2;
        var inner = CELL - ROAD - 6, n = irnd(1, 3);
        for (var k = 0; k < n; k++) {
          var w = rnd(inner * 0.32, inner * (n === 1 ? 0.92 : 0.5));
          var dp = rnd(inner * 0.32, inner * (n === 1 ? 0.92 : 0.5));
          var ox = n === 1 ? 0 : rnd(-inner / 2 + w / 2, inner / 2 - w / 2);
          var oz = n === 1 ? 0 : rnd(-inner / 2 + dp / 2, inner / 2 - dp / 2);
          var edge = Math.min(i, j, GRID - 1 - i, GRID - 1 - j);
          var h = rnd(12, edge < 2 ? 26 : edge < 4 ? 52 : 92);
          var tier = clamp(Math.floor(h / 20), 0, tiers - 1);
          plan.push({ x: cx + ox, z: cz + oz, w: w, d: dp, h: h, tier: tier });
          counts[tier]++;
        }
      }
    }

    for (t = 0; t < tiers; t++) {
      var im = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), mats[t], Math.max(1, counts[t]));
      im.count = 0; insts.push(im); scene.add(im);
    }

    var dm = new THREE.Object3D(), col = new THREE.Color();
    plan.forEach(function (b) {
      var m = insts[b.tier];
      dm.position.set(b.x, b.h / 2, b.z);
      dm.scale.set(b.w, b.h, b.d);
      dm.rotation.set(0, 0, 0);
      dm.updateMatrix();
      m.setMatrixAt(m.count, dm.matrix);
      if (m.setColorAt) { col.setHSL(rnd(0.58, 0.78), 0.18, rnd(0.42, 0.62)); m.setColorAt(m.count, col); }
      m.count++;
      buildings.push(b);
      var kk = key(Math.floor(b.x / CELL), Math.floor(b.z / CELL));
      (bGrid[kk] = bGrid[kk] || []).push(b);
    });
    insts.forEach(function (m) {
      m.instanceMatrix.needsUpdate = true;
      if (m.instanceColor) m.instanceColor.needsUpdate = true;
    });

    buildNeon(plan);
    buildPalms();
  }

  function buildNeon(plan) {
    var picks = plan.filter(function () { return Math.random() < 0.42; });
    var mat = new THREE.MeshBasicMaterial({ vertexColors: true });
    var inst = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 0.7, 1), mat, Math.max(1, picks.length));
    var d = new THREE.Object3D(), c = new THREE.Color(), n = 0;
    var hues = [0.86, 0.52, 0.94, 0.05, 0.72];
    picks.forEach(function (b) {
      d.position.set(b.x, b.h + 0.5, b.z);
      d.scale.set(b.w * 1.04, 1, b.d * 1.04);
      d.rotation.set(0, 0, 0);
      d.updateMatrix();
      inst.setMatrixAt(n, d.matrix);
      if (inst.setColorAt) { c.setHSL(hues[irnd(0, hues.length - 1)], 0.95, 0.62); inst.setColorAt(n, c); }
      n++;
    });
    inst.count = n;
    inst.instanceMatrix.needsUpdate = true;
    if (inst.instanceColor) inst.instanceColor.needsUpdate = true;
    else inst.material.vertexColors = false;
    scene.add(inst);
  }

  function buildPalms() {
    var n = 240, d = new THREE.Object3D();
    var ti = new THREE.InstancedMesh(
      new THREE.CylinderGeometry(0.22, 0.34, 7, 5),
      new THREE.MeshStandardMaterial({ color: 0x4a3a2a, roughness: 1 }), n);
    var fi = new THREE.InstancedMesh(
      new THREE.ConeGeometry(3.1, 1.5, 6),
      new THREE.MeshStandardMaterial({ color: 0x1d6b4a, roughness: 0.9, emissive: 0x06301f, emissiveIntensity: 0.5 }), n);
    for (var i = 0; i < n; i++) {
      var gi = irnd(0, GRID), gj = irnd(0, GRID), along = rnd(0, CELL), x, z;
      if (Math.random() < 0.5) { x = gi * CELL + (Math.random() < 0.5 ? -1 : 1) * (ROAD / 2 + 2.2); z = gj * CELL + along; }
      else { z = gj * CELL + (Math.random() < 0.5 ? -1 : 1) * (ROAD / 2 + 2.2); x = gi * CELL + along; }
      var s = rnd(0.8, 1.35);
      d.position.set(x, 3.5 * s, z); d.scale.set(1, s, 1); d.rotation.set(0, rnd(0, 6.28), 0);
      d.updateMatrix(); ti.setMatrixAt(i, d.matrix);
      d.position.set(x, 7 * s, z); d.scale.set(s, s, s);
      d.updateMatrix(); fi.setMatrixAt(i, d.matrix);
    }
    ti.instanceMatrix.needsUpdate = true;
    fi.instanceMatrix.needsUpdate = true;
    scene.add(ti); scene.add(fi);
  }

  function buildRamps() {
    var mat = new THREE.MeshStandardMaterial({ color: 0x2a2f45, roughness: 0.7, emissive: 0x241238, emissiveIntensity: 0.6 });
    for (var i = 0; i < 9; i++) {
      var gi = irnd(1, GRID - 2), gj = irnd(1, GRID - 2);
      var horiz = Math.random() < 0.5;
      var len = 16, wid = 9, hgt = rnd(3.4, 5.2);
      var x = horiz ? gi * CELL + rnd(-CELL / 3, CELL / 3) : gi * CELL;
      var z = horiz ? gj * CELL : gj * CELL + rnd(-CELL / 3, CELL / 3);
      var r = { x: x, z: z, len: len, wid: wid, h: hgt, horiz: horiz, dir: Math.random() < 0.5 ? 1 : -1 };
      ramps.push(r);

      var hw = wid / 2, hl = len / 2;
      var v = new Float32Array([
        -hw, 0, -hl, hw, 0, -hl, hw, hgt, hl,
        -hw, 0, -hl, hw, hgt, hl, -hw, hgt, hl,
        -hw, 0, -hl, -hw, hgt, hl, -hw, 0, hl,
         hw, 0, -hl,  hw, 0, hl,  hw, hgt, hl,
        -hw, 0, -hl, -hw, 0, hl,  hw, 0, hl,
        -hw, 0, -hl,  hw, 0, hl,  hw, 0, -hl,
        -hw, hgt, hl, hw, hgt, hl, hw, 0, hl,
        -hw, hgt, hl, hw, 0, hl, -hw, 0, hl
      ]);
      var geo = new THREE.BufferGeometry();
      geo.setAttribute("position", new THREE.BufferAttribute(v, 3));
      geo.computeVertexNormals();
      var mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(x, 0, z);
      mesh.rotation.y = (horiz ? Math.PI / 2 : 0) + (r.dir < 0 ? Math.PI : 0);
      scene.add(mesh);
    }
  }

  function rampHeight(x, z) {
    for (var i = 0; i < ramps.length; i++) {
      var r = ramps[i], dx = x - r.x, dz = z - r.z, along, across;
      if (r.horiz) { along = dx * r.dir; across = dz; }
      else { along = dz * r.dir; across = dx; }
      if (Math.abs(across) > r.wid / 2) continue;
      if (along < -r.len / 2 || along > r.len / 2) continue;
      return { h: ((along + r.len / 2) / r.len) * r.h, slope: r.h / r.len };
    }
    return null;
  }

  // ============================================================ models
  function buildCarMesh(bodyColor, isPolice) {
    var g = new THREE.Group();
    var bm = new THREE.MeshStandardMaterial({ color: bodyColor, roughness: 0.35, metalness: 0.55 });
    var body = new THREE.Mesh(new THREE.BoxGeometry(2.05, 0.62, 4.5), bm);
    body.position.y = 0.66; g.add(body);
    var nose = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.34, 0.9), bm);
    nose.position.set(0, 0.5, 2.32); g.add(nose);
    var cabin = new THREE.Mesh(new THREE.BoxGeometry(1.72, 0.56, 2.05),
      new THREE.MeshStandardMaterial({ color: 0x11131f, roughness: 0.18, metalness: 0.7 }));
    cabin.position.set(0, 1.2, -0.2); g.add(cabin);

    var hl = new THREE.MeshBasicMaterial({ color: 0xfff3cf });
    var tl = new THREE.MeshBasicMaterial({ color: 0xff2a3c });
    [-0.62, 0.62].forEach(function (o) {
      var a = new THREE.Mesh(new THREE.BoxGeometry(0.44, 0.2, 0.1), hl);
      a.position.set(o, 0.62, 2.76); g.add(a);
      var b = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.18, 0.1), tl);
      b.position.set(o, 0.75, -2.26); g.add(b);
    });

    var wg = new THREE.CylinderGeometry(0.42, 0.42, 0.32, 12);
    var wm = new THREE.MeshStandardMaterial({ color: 0x0c0d12, roughness: 0.9 });
    [[-1.02, 1.5], [1.02, 1.5], [-1.02, -1.5], [1.02, -1.5]].forEach(function (p) {
      var w = new THREE.Mesh(wg, wm);
      w.rotation.z = Math.PI / 2;
      w.position.set(p[0], 0.42, p[1]);
      g.add(w);
    });

    if (isPolice) {
      var bar = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.16, 0.34), new THREE.MeshBasicMaterial({ color: 0x0d1030 }));
      bar.position.set(0, 1.56, -0.2); g.add(bar);
      var lr = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.2, 0.36), new THREE.MeshBasicMaterial({ color: 0xff1030 }));
      lr.position.set(-0.42, 1.58, -0.2); g.add(lr);
      var lb = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.2, 0.36), new THREE.MeshBasicMaterial({ color: 0x2050ff }));
      lb.position.set(0.42, 1.58, -0.2); g.add(lb);
      g.userData.lights = [lr, lb];
    }
    return g;
  }

  var SKINS = [0xf2cfa8, 0xdcab80, 0xc08552, 0x9c6644, 0x7a4c30, 0x5c3720];
  var HAIRS = [0x241a14, 0x3d2b1f, 0x0d0b0a, 0x6b4a2a, 0x8a7a5a, 0x4a2418];

  // A blocky humanoid: torso, head with a real face, arms, legs, held weapon.
  // The face sits on local +z, which is the direction the model walks and aims.
  function buildPerson(shirt, pants, withGun, skinCol, hairCol) {
    var g = new THREE.Group();
    var sm = new THREE.MeshStandardMaterial({ color: shirt, roughness: 0.85 });
    var pm = new THREE.MeshStandardMaterial({ color: pants, roughness: 0.9 });
    var skin = new THREE.MeshStandardMaterial({
      color: skinCol === undefined ? SKINS[irnd(0, SKINS.length - 1)] : skinCol, roughness: 0.9
    });
    var hairM = new THREE.MeshStandardMaterial({
      color: hairCol === undefined ? HAIRS[irnd(0, HAIRS.length - 1)] : hairCol, roughness: 1
    });
    var dark = new THREE.MeshStandardMaterial({ color: 0x1a1410, roughness: 0.7 });
    var white = new THREE.MeshStandardMaterial({ color: 0xf6f2ea, roughness: 0.5 });

    var torso = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.78, 0.34), sm);
    torso.position.y = 1.22; g.add(torso);

    // collar, so the head reads as attached rather than floating
    var neck = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.12, 0.2), skin);
    neck.position.y = 1.63; g.add(neck);

    var head = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.36, 0.32), skin);
    head.position.y = 1.79; g.add(head);

    function part(w, h, d, x, y, z, mat) {
      var m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
      m.position.set(x, y, z);
      g.add(m);
      return m;
    }

    // eyes: sclera set into the face, pupil proud of it so it catches light
    [-0.079, 0.079].forEach(function (ox) {
      part(0.088, 0.062, 0.02, ox, 1.845, 0.162, white);
      part(0.042, 0.042, 0.026, ox, 1.842, 0.170, dark);
      part(0.100, 0.024, 0.02, ox, 1.898, 0.162, hairM);   // brow
    });

    part(0.056, 0.10, 0.06, 0, 1.788, 0.176, skin);         // nose
    part(0.124, 0.026, 0.02, 0, 1.706, 0.164, dark);        // mouth
    part(0.03, 0.14, 0.16, -0.176, 1.79, 0, skin);          // ears
    part(0.03, 0.14, 0.16, 0.176, 1.79, 0, skin);

    // hair: cap plus a back panel and short sides
    part(0.37, 0.11, 0.35, 0, 1.965, 0, hairM);
    part(0.36, 0.26, 0.06, 0, 1.86, -0.155, hairM);
    part(0.04, 0.22, 0.30, -0.172, 1.87, -0.02, hairM);
    part(0.04, 0.22, 0.30, 0.172, 1.87, -0.02, hairM);

    var armG = new THREE.BoxGeometry(0.17, 0.68, 0.19);
    var la = new THREE.Mesh(armG, sm); la.position.set(-0.4, 1.2, 0); g.add(la);
    var ra = new THREE.Mesh(armG, sm); ra.position.set(0.4, 1.2, 0); g.add(ra);
    g.userData.arm = ra;

    var legG = new THREE.BoxGeometry(0.22, 0.8, 0.24);
    var ll = new THREE.Mesh(legG, pm); ll.position.set(-0.16, 0.42, 0); g.add(ll);
    var rl = new THREE.Mesh(legG, pm); rl.position.set(0.16, 0.42, 0); g.add(rl);
    g.userData.legs = [ll, rl];

    if (withGun) {
      var gun = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.15, 0.52),
        new THREE.MeshStandardMaterial({ color: 0x23262f, roughness: 0.5, metalness: 0.7 }));
      gun.position.set(0.4, 1.16, 0.36);
      g.add(gun);
      g.userData.gun = gun;
      var flash = new THREE.Mesh(new THREE.SphereGeometry(0.19, 6, 5),
        new THREE.MeshBasicMaterial({ color: 0xffd47a, transparent: true, opacity: 0 }));
      flash.position.set(0.4, 1.16, 0.68);
      g.add(flash);
      g.userData.flash = flash;
    }
    return g;
  }

  // ============================================================ effects
  function spawnTracer(ax, ay, az, bx, by, bz) {
    var g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(new Float32Array([ax, ay, az, bx, by, bz]), 3));
    var m = new THREE.Line(g, new THREE.LineBasicMaterial({ color: 0xffe08a, transparent: true, opacity: 0.9 }));
    scene.add(m);
    fx.push({ mesh: m, t: 0.06, fade: true });
  }

  function spawnSpark(x, y, z, color) {
    var m = new THREE.Mesh(new THREE.SphereGeometry(0.22, 6, 5),
      new THREE.MeshBasicMaterial({ color: color || 0xffb347, transparent: true, opacity: 1 }));
    m.position.set(x, y, z);
    scene.add(m);
    fx.push({ mesh: m, t: 0.22, fade: true, grow: 5 });
  }

  function updateFx(dt) {
    for (var i = fx.length - 1; i >= 0; i--) {
      var f = fx[i];
      f.t -= dt;
      if (f.grow) f.mesh.scale.multiplyScalar(1 + f.grow * dt);
      if (f.fade && f.mesh.material) f.mesh.material.opacity = clamp(f.t * 6, 0, 1);
      if (f.t <= 0) {
        scene.remove(f.mesh);
        if (f.mesh.geometry) f.mesh.geometry.dispose();
        if (f.mesh.material) f.mesh.material.dispose();
        fx.splice(i, 1);
      }
    }
  }

  // ============================================================ combat
  function blockedAt(x, y, z) {
    if (y > 92) return false;
    var list = bGrid[key(Math.floor(x / CELL), Math.floor(z / CELL))];
    if (!list) return false;
    for (var i = 0; i < list.length; i++) {
      var b = list[i];
      if (y > b.h) continue;
      if (x > b.x - b.w / 2 && x < b.x + b.w / 2 && z > b.z - b.d / 2 && z < b.z + b.d / 2) return true;
    }
    return false;
  }

  // Marches a ray, returns the first thing hit: a target or a wall.
  function castRay(ox, oy, oz, dx, dy, dz, range, targets) {
    var step = 1.6, best = null, bestT = range;
    for (var i = 0; i < targets.length; i++) {
      var e = targets[i];
      if (e.dead) continue;
      var px = e.x - ox, py = (e.y || 0) + 1.15 - oy, pz = e.z - oz;
      var t = px * dx + py * dy + pz * dz;
      if (t < 0 || t > bestT) continue;
      var cx = px - dx * t, cy = py - dy * t, cz = pz - dz * t;
      if (cx * cx + cy * cy + cz * cz < 0.62) { bestT = t; best = e; }
    }
    for (var d = step; d < bestT; d += step) {
      if (blockedAt(ox + dx * d, oy + dy * d, oz + dz * d)) {
        return { type: "wall", d: d, x: ox + dx * d, y: oy + dy * d, z: oz + dz * d };
      }
    }
    if (best) return { type: "hit", target: best, d: bestT, x: ox + dx * bestT, y: oy + dy * bestT, z: oz + dz * bestT };
    return { type: "miss", d: range, x: ox + dx * range, y: oy + dy * range, z: oz + dz * range };
  }

  function playerFire() {
    var w = WEAPONS[P.wep];
    if (P.cool > 0 || P.reloading > 0) return;
    if (P.mag[P.wep] <= 0) { startReload(); return; }
    P.mag[P.wep]--;
    P.cool = 1 / w.rps;

    var ox = P.x, oy = P.y + (P.mode === "drive" ? 1.1 : 1.5), oz = P.z;
    for (var p = 0; p < w.pel; p++) {
      var yaw = P.yaw + rnd(-w.spread, w.spread);
      var pit = P.pitch + rnd(-w.spread, w.spread);
      var cp = Math.cos(pit);
      var dx = Math.sin(yaw) * cp, dy = Math.sin(pit), dz = Math.cos(yaw) * cp;
      var r = castRay(ox, oy, oz, dx, dy, dz, w.range, enemies.concat(police));
      spawnTracer(ox + dx * 1.2, oy - 0.15, oz + dz * 1.2, r.x, r.y, r.z);
      if (r.type === "hit") {
        damageTarget(r.target, w.dmg);
        spawnSpark(r.x, r.y, r.z, 0xff5a6a);
      } else if (r.type === "wall") spawnSpark(r.x, r.y, r.z, 0xaab4d0);
    }
    Audio.shot(w.snd);
    P.shake = Math.max(P.shake, w.pel > 4 ? 0.36 : 0.16);
    alertNearby(P.x, P.z, 90);
    if (P.mode === "foot") addHeat(3);
  }

  function startReload() {
    var w = WEAPONS[P.wep];
    if (P.reloading > 0 || P.mag[P.wep] >= w.mag || P.ammo[P.wep] <= 0) return;
    P.reloading = 1.5;
  }

  function finishReload() {
    var w = WEAPONS[P.wep];
    var need = w.mag - P.mag[P.wep];
    var take = Math.min(need, P.ammo[P.wep]);
    P.mag[P.wep] += take;
    P.ammo[P.wep] -= take;
    Audio.chime(340);
  }

  function damageTarget(e, dmg) {
    e.hp -= dmg;
    e.alert = true;
    if (e.hp <= 0 && !e.dead) {
      e.dead = true; e.deadT = 4.5;
      P.kills++;
      if (e.kind === "cop") addHeat(16); else addHeat(5);
      P.cash += e.kind === "cop" ? 0 : 60;
      Mission.onKill(e);
      Audio.chime(200);
    }
  }

  function damagePlayer(dmg) {
    if (dead) return;
    if (P.armor > 0) {
      var soak = Math.min(P.armor, dmg * 0.7);
      P.armor -= soak; dmg -= soak;
    }
    P.hp -= dmg;
    P.dmgFlash = 1;
    P.shake = Math.max(P.shake, 0.3);
    if (P.hp <= 0) killPlayer();
  }

  function killPlayer() {
    dead = true;
    P.deaths++;
    var lost = Math.floor(P.cash * 0.15);
    P.cash -= lost;
    show("WASTED", "You lost $" + lost + " in medical fees. Respawning...", 2.6);
    setTimeout(function () {
      P.hp = 100; P.armor = 0; P.heat = 0; P.stars = 0;
      P.mode = "foot"; P.veh = null;
      var gi = irnd(0, GRID), gj = irnd(0, GRID);
      P.x = gi * CELL; P.z = gj * CELL; P.y = 0;
      P.vx = P.vy = P.vz = 0;
      dead = false;
    }, 2600);
  }

  function alertNearby(x, z, r) {
    var r2 = r * r;
    enemies.forEach(function (e) { if (!e.dead && dist2(e.x, e.z, x, z) < r2) e.alert = true; });
  }

  // ============================================================ enemies
  function spawnEnemy(x, z, kind) {
    var shirt = kind === "cop" ? 0x1b2a5c : [0x7a2230, 0x2d4a2a, 0x4a2a5c, 0x6a4a1a][irnd(0, 3)];
    var e = {
      kind: kind || "gang", x: x, z: z, y: 0,
      hp: kind === "cop" ? 90 : 70, dead: false, deadT: 0,
      mesh: buildPerson(shirt, 0x232838, true),
      cool: rnd(0.4, 1.6), alert: false, strafe: Math.random() < 0.5 ? 1 : -1, t: rnd(0, 6)
    };
    scene.add(e.mesh);
    enemies.push(e);
    return e;
  }

  function updateEnemies(dt) {
    for (var i = enemies.length - 1; i >= 0; i--) {
      var e = enemies[i];
      if (e.dead) {
        e.deadT -= dt;
        e.mesh.rotation.x = lerp(e.mesh.rotation.x, -Math.PI / 2, 6 * dt);
        e.mesh.position.y = lerp(e.mesh.position.y, 0.25, 6 * dt);
        if (e.deadT <= 0) { scene.remove(e.mesh); enemies.splice(i, 1); }
        continue;
      }

      e.t += dt;
      var dx = P.x - e.x, dz = P.z - e.z;
      var d = Math.sqrt(dx * dx + dz * dz) || 1;
      if (d < 70) e.alert = true;

      if (e.alert && !dead) {
        var want = Math.atan2(dx, dz);
        e.mesh.rotation.y = want;

        // hold a firing distance, strafe while there
        var sp = 0;
        if (d > 26) sp = 5.6;
        else if (d < 12) sp = -3.4;
        var mx = Math.sin(want) * sp, mz = Math.cos(want) * sp;
        mx += Math.cos(want) * e.strafe * 3.0;
        mz += -Math.sin(want) * e.strafe * 3.0;
        if (Math.random() < dt * 0.4) e.strafe *= -1;

        var nx = e.x + mx * dt, nz = e.z + mz * dt;
        if (!blockedAt(nx, 1, nz)) { e.x = nx; e.z = nz; }
        else e.strafe *= -1;

        // fire
        e.cool -= dt;
        if (e.cool <= 0 && d < 62) {
          e.cool = rnd(0.7, 1.9);
          var los = castRay(e.x, 1.35, e.z, dx / d, 0, dz / d, 70, []);
          if (los.type !== "wall" || los.d > d) {
            var acc = clamp(1 - d / 90, 0.15, 0.8);
            spawnTracer(e.x, 1.35, e.z, P.x + rnd(-2, 2), P.y + 1.2, P.z + rnd(-2, 2));
            if (e.mesh.userData.flash) {
              e.mesh.userData.flash.material.opacity = 1;
              fx.push({ mesh: e.mesh.userData.flash, t: 0.05, fade: true });
            }
            Audio.shot(220);
            if (Math.random() < acc) damagePlayer(e.kind === "cop" ? 9 : 7);
          }
        }
        // walk bob
        var b = Math.sin(e.t * 9) * 0.28;
        if (e.mesh.userData.legs) {
          e.mesh.userData.legs[0].rotation.x = b;
          e.mesh.userData.legs[1].rotation.x = -b;
        }
      }
      e.mesh.position.set(e.x, e.y, e.z);
    }
  }

  // ============================================================ police
  function addHeat(v) {
    P.heat = clamp(P.heat + v, 0, 100);
    P.stars = clamp(Math.floor(P.heat / 18), 0, 5);
  }

  function spawnPolice() {
    if (police.length >= Math.min(POLICE_MAX, P.stars + 1)) return;
    var ang = rnd(0, 6.28), dd = rnd(110, 180);
    var p = {
      kind: "cop", x: clamp(P.x + Math.sin(ang) * dd, 5, WORLD - 5),
      z: clamp(P.z + Math.cos(ang) * dd, 5, WORLD - 5),
      y: 0, h: 0, vx: 0, vz: 0, hp: 140, dead: false, deadT: 0,
      mesh: buildCarMesh(0x101a3a, true), t: 0
    };
    scene.add(p.mesh);
    police.push(p);
  }

  function updatePolice(dt) {
    for (var i = police.length - 1; i >= 0; i--) {
      var p = police[i];
      if (p.dead) { scene.remove(p.mesh); police.splice(i, 1); continue; }
      p.t += dt;
      var dx = P.x - p.x, dz = P.z - p.z;
      var d = Math.sqrt(dx * dx + dz * dz) || 1;
      var want = Math.atan2(dx, dz);
      var diff = ((want - p.h + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
      p.h += clamp(diff, -2.6 * dt, 2.6 * dt);
      var sp = 30 + P.stars * 5;
      p.vx = lerp(p.vx, Math.sin(p.h) * sp, 1.6 * dt);
      p.vz = lerp(p.vz, Math.cos(p.h) * sp, 1.6 * dt);
      p.x += p.vx * dt; p.z += p.vz * dt;
      p.mesh.position.set(p.x, 0, p.z);
      p.mesh.rotation.y = p.h;

      var f = Math.floor(p.t * 6) % 2;
      if (p.mesh.userData.lights) {
        p.mesh.userData.lights[0].visible = f === 0;
        p.mesh.userData.lights[1].visible = f === 1;
      }

      if (d < 5 && P.mode === "drive") {
        P.vx *= -0.4; P.vz *= -0.4;
        P.shake = 0.8; Audio.crash();
        damagePlayer(4);
      }
      // drive-by
      if (P.stars >= 2 && d < 40 && Math.random() < dt * 0.5 && !dead) {
        spawnTracer(p.x, 1.3, p.z, P.x + rnd(-2.5, 2.5), P.y + 1.2, P.z + rnd(-2.5, 2.5));
        Audio.shot(230);
        if (Math.random() < 0.35) damagePlayer(6);
      }
      if (P.stars === 0 || d > 430) { scene.remove(p.mesh); police.splice(i, 1); }
    }
    if (P.stars > 0 && Math.random() < dt * 0.6) spawnPolice();
  }

  // ============================================================ traffic + civilians
  function spawnTraffic() {
    var colors = [0xd8443a, 0x2f7fd8, 0xe0c341, 0x2fae72, 0xd9d9e0, 0x8a4fd0, 0xe07a2f];
    for (var i = 0; i < TRAFFIC_N; i++) {
      var gi = irnd(0, GRID), gj = irnd(0, GRID), horiz = Math.random() < 0.5;
      var t = {
        x: horiz ? gi * CELL + rnd(0, CELL) : gi * CELL,
        z: horiz ? gj * CELL : gj * CELL + rnd(0, CELL),
        h: 0, sp: rnd(13, 22), horiz: horiz, dir: Math.random() < 0.5 ? 1 : -1,
        mesh: buildCarMesh(colors[irnd(0, colors.length - 1)], false), cool: 0, occupied: false
      };
      t.h = t.horiz ? (t.dir > 0 ? Math.PI / 2 : -Math.PI / 2) : (t.dir > 0 ? 0 : Math.PI);
      scene.add(t.mesh);
      traffic.push(t);
      cars.push(t);
    }
  }

  function updateTraffic(dt) {
    for (var i = 0; i < traffic.length; i++) {
      var t = traffic[i];
      if (t.occupied) continue;
      if (t.horiz) t.x += t.dir * t.sp * dt; else t.z += t.dir * t.sp * dt;
      t.cool -= dt;
      if (Math.abs(t.x - nearestNode(t.x)) < 0.7 && Math.abs(t.z - nearestNode(t.z)) < 0.7 && t.cool <= 0 && Math.random() < 0.5) {
        t.cool = 1.4;
        t.horiz = !t.horiz;
        t.dir = Math.random() < 0.5 ? 1 : -1;
        t.x = nearestNode(t.x); t.z = nearestNode(t.z);
        t.h = t.horiz ? (t.dir > 0 ? Math.PI / 2 : -Math.PI / 2) : (t.dir > 0 ? 0 : Math.PI);
      }
      if (t.x < -CELL) t.x = WORLD;
      if (t.x > WORLD + CELL) t.x = 0;
      if (t.z < -CELL) t.z = WORLD;
      if (t.z > WORLD + CELL) t.z = 0;
      t.mesh.position.set(t.x, 0, t.z);
      t.mesh.rotation.y = t.h;

      if (P.mode === "drive" && dist2(t.x, t.z, P.x, P.z) < 16) {
        var sp = Math.hypot(P.vx, P.vz);
        if (sp > 8) {
          P.vx *= -0.3; P.vz *= -0.3;
          P.shake = Math.min(1, sp / 40);
          addHeat(7); Audio.crash();
          t.x += (t.x - P.x) * 0.6; t.z += (t.z - P.z) * 0.6;
        }
      }
    }
  }

  function spawnCivs() {
    var shirts = [0xcfd2e0, 0xe0a0b0, 0x90c0e0, 0xd8c890, 0xa0d8b0, 0xc0a0d8];
    for (var i = 0; i < CIV_N; i++) {
      var gi = irnd(0, GRID - 1), gj = irnd(0, GRID - 1);
      var c = {
        x: gi * CELL + rnd(ROAD / 2 + 1, CELL - ROAD / 2 - 1),
        z: gj * CELL + rnd(ROAD / 2 + 1, CELL - ROAD / 2 - 1),
        a: rnd(0, 6.28), sp: rnd(1.4, 2.8), t: rnd(0, 4),
        mesh: buildPerson(shirts[irnd(0, shirts.length - 1)], [0x2a3040, 0x3a3040, 0x50483a][irnd(0, 2)], false)
      };
      c.mesh.scale.setScalar(rnd(0.92, 1.06));
      scene.add(c.mesh);
      civs.push(c);
    }
  }

  function updateCivs(dt) {
    for (var i = 0; i < civs.length; i++) {
      var c = civs[i];
      c.t -= dt;
      if (c.t <= 0) { c.t = rnd(1.5, 5); c.a += rnd(-1.6, 1.6); }
      var scared = dist2(c.x, c.z, P.x, P.z) < 260 && (P.stars > 0 || P.mode === "drive");
      if (scared) { c.a = Math.atan2(c.x - P.x, c.z - P.z); c.sp = 6.4; }
      else if (c.sp > 3.2) c.sp = rnd(1.4, 2.8);
      var nx = c.x + Math.sin(c.a) * c.sp * dt;
      var nz = c.z + Math.cos(c.a) * c.sp * dt;
      if (blockedAt(nx, 1, nz)) c.a += Math.PI;
      else { c.x = nx; c.z = nz; }
      if (c.x < 0 || c.x > WORLD || c.z < 0 || c.z > WORLD) c.a += Math.PI;
      c.mesh.position.set(c.x, 0, c.z);
      c.mesh.rotation.y = c.a;
      var b = Math.sin((c.t + i) * 8) * 0.24 * (c.sp / 3);
      if (c.mesh.userData.legs) {
        c.mesh.userData.legs[0].rotation.x = b;
        c.mesh.userData.legs[1].rotation.x = -b;
      }
    }
  }

  // ============================================================ pickups
  function spawnPickup(x, z, kind) {
    var color = kind === "health" ? 0x2fe08a : kind === "armor" ? 0x42a8ff : 0xffb020;
    var m = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1),
      new THREE.MeshBasicMaterial({ color: color, transparent: true, opacity: 0.88 }));
    m.position.set(x, 1.1, z);
    scene.add(m);
    pickups.push({ x: x, z: z, kind: kind, mesh: m, t: rnd(0, 6) });
  }

  function seedPickups() {
    for (var i = 0; i < 26; i++) {
      var gi = irnd(0, GRID - 1), gj = irnd(0, GRID - 1);
      var kinds = ["health", "armor", "ammo", "ammo"];
      spawnPickup(gi * CELL + CELL / 2 + rnd(-18, 18), gj * CELL + CELL / 2 + rnd(-18, 18), kinds[irnd(0, 3)]);
    }
  }

  function updatePickups(dt) {
    for (var i = pickups.length - 1; i >= 0; i--) {
      var p = pickups[i];
      p.t += dt;
      p.mesh.rotation.y += dt * 2;
      p.mesh.position.y = 1.1 + Math.sin(p.t * 2.4) * 0.22;
      if (dist2(p.x, p.z, P.x, P.z) < 9) {
        if (p.kind === "health") P.hp = Math.min(100, P.hp + 35);
        else if (p.kind === "armor") P.armor = Math.min(100, P.armor + 45);
        else { P.ammo[0] += 40; P.ammo[1] += 70; P.ammo[2] += 18; }
        Audio.chime(760);
        show("", p.kind === "health" ? "+35 health" : p.kind === "armor" ? "+45 armour" : "Ammo restocked", 1.4);
        scene.remove(p.mesh);
        pickups.splice(i, 1);
        setTimeout(function () {
          var gi = irnd(0, GRID - 1), gj = irnd(0, GRID - 1);
          if (running) spawnPickup(gi * CELL + CELL / 2 + rnd(-18, 18), gj * CELL + CELL / 2 + rnd(-18, 18),
            ["health", "armor", "ammo"][irnd(0, 2)]);
        }, 22000);
      }
    }
  }

  // ============================================================ campaign
  var Mission = (function () {
    var idx = -1, active = null, timer = 0, need = 0, got = 0, done = false;

    // Original story. Neon Bay, the Harbor Kings, and a dispatcher named Reyes.
    var CHAIN = [
      {
        title: "First Run",
        brief: "Reyes runs a courier garage on the east side. She has a package and nobody clean to move it. Get it to the marker.",
        type: "deliver", pay: 400
      },
      {
        title: "Shakedown",
        brief: "The drop was watched. Harbor Kings crew are waiting on you. Reyes says clear them out or the route is dead.",
        type: "kill", count: 4, pay: 900
      },
      {
        title: "Hot Cargo",
        brief: "Police flagged the plate. Run this one anyway - and lose the tail before you reach the drop.",
        type: "deliver_hot", pay: 1400
      },
      {
        title: "The Lockup",
        brief: "The Kings keep a stash lot under the overpass. Take the lot. Reyes wants it quiet, but quiet stopped being an option.",
        type: "clear", count: 6, pay: 2000
      },
      {
        title: "Convoy",
        brief: "They are moving product across the grid tonight. Intercept the runners before they scatter.",
        type: "kill", count: 8, pay: 2800
      },
      {
        title: "Harbor Kings",
        brief: "Last one. Their crew boss is holding the north dock with everything he has left. Finish it.",
        type: "boss", count: 10, pay: 6000
      }
    ];

    function place() {
      var gi = irnd(0, GRID - 1), gj = irnd(0, GRID - 1);
      var mx = gi * CELL + CELL / 2 + rnd(-16, 16);
      var mz = gj * CELL + CELL / 2 + rnd(-16, 16);
      if (dist2(mx, mz, P.x, P.z) < 150 * 150) return place();
      return { x: mx, z: mz };
    }

    function start(i) {
      idx = i;
      if (i >= CHAIN.length) {
        active = null; done = true;
        show("CAMPAIGN COMPLETE", "Neon Bay is yours. Free roam unlocked - the city keeps running.", 6);
        return;
      }
      active = CHAIN[i];
      got = 0; need = active.count || 0;
      var spot = place();
      active.tx = spot.x; active.tz = spot.z;
      timer = active.type === "deliver_hot" ? 75 : 0;

      if (active.type === "deliver_hot") addHeat(46);

      if (active.type === "kill" || active.type === "clear" || active.type === "boss") {
        for (var k = 0; k < need; k++) {
          var a = rnd(0, 6.28), r = rnd(10, 34);
          spawnEnemy(active.tx + Math.sin(a) * r, active.tz + Math.cos(a) * r, "gang");
        }
        if (active.type === "boss") {
          var boss = spawnEnemy(active.tx, active.tz, "gang");
          boss.hp = 420;
          boss.mesh.scale.setScalar(1.28);
          boss.boss = true;
        }
      }
      show("MISSION  " + (i + 1) + "/" + CHAIN.length + "  -  " + active.title, active.brief, 7);
      updateMarker();
    }

    function updateMarker() {
      if (!active) { markerMesh.visible = false; beamMesh.visible = false; return; }
      markerMesh.visible = true; beamMesh.visible = true;
      var col = active.type.indexOf("deliver") === 0 ? 0xffb020 : 0xff3a5e;
      markerMesh.position.set(active.tx, 1.4, active.tz);
      beamMesh.position.set(active.tx, 30, active.tz);
      markerMesh.material.color.setHex(col);
      beamMesh.material.color.setHex(col);
    }

    return {
      start: start,
      get active() { return active; },
      get index() { return idx; },
      get total() { return CHAIN.length; },
      get progress() { return need ? got + "/" + need : ""; },
      get timer() { return timer; },
      onKill: function (e) {
        if (!active) return;
        if (active.type === "kill" || active.type === "clear" || active.type === "boss") {
          if (active.type === "boss" && !e.boss) { got++; return; }
          got++;
          if (active.type === "boss" && e.boss) got = need;
          if (got >= need) complete();
        }
      },
      update: function (dt) {
        if (!active) return;
        if (active.type === "deliver_hot") {
          timer -= dt;
          if (timer <= 0) { show("MISSION FAILED", "The cargo was seized. Reyes will call again.", 3.4); restart(); return; }
        }
        if (active.type.indexOf("deliver") === 0) {
          if (dist2(P.x, P.z, active.tx, active.tz) < 60) {
            if (active.type === "deliver_hot" && P.stars > 0) return; // must lose the tail first
            complete();
          }
        }
        if (active.type === "clear" || active.type === "boss") {
          // marker follows the remaining cluster
          var alive = enemies.filter(function (e) { return !e.dead; });
          if (alive.length) { active.tx = alive[0].x; active.tz = alive[0].z; }
          updateMarker();
        }
      },
      objective: function () {
        if (done) return "Free roam - city cleared";
        if (!active) return "";
        switch (active.type) {
          case "deliver": return "Deliver the package";
          case "deliver_hot": return P.stars > 0 ? "Lose the police, then deliver" : "Deliver the package";
          case "kill": return "Eliminate the crew  " + got + "/" + need;
          case "clear": return "Clear the lot  " + got + "/" + need;
          case "boss": return "Take the dock  " + got + "/" + need;
        }
        return "";
      }
    };

    function complete() {
      P.cash += active.pay;
      Audio.chime(880); Audio.chime(1180);
      show("MISSION COMPLETE", active.title + "  -  +$" + active.pay, 4);
      var nxt = idx + 1;
      active = null;
      markerMesh.visible = false; beamMesh.visible = false;
      setTimeout(function () { if (running) start(nxt); }, 4200);
    }

    function restart() {
      var cur = idx;
      active = null;
      setTimeout(function () { if (running) start(cur); }, 3600);
    }
  })();

  // ============================================================ player
  // Buildings are always inset inside a cell, so the road lines at exact
  // multiples of CELL are guaranteed clear. Spawning at a cell CENTRE
  // (CELL*0.5) puts you inside a building with no way to walk out.
  function freeSpot() {
    for (var t = 0; t < 80; t++) {
      var gi = t === 0 ? 1 : irnd(0, GRID);
      var gj = t === 0 ? 1 : irnd(0, GRID);
      var x = gi * CELL, z = gj * CELL;
      if (!blockedAt(x, 1, z)) return { x: x, z: z };
    }
    return { x: CELL, z: CELL };
  }

  // Safety net: if anything ever leaves the player embedded in geometry,
  // slide them out to the nearer of the two road lines bounding this cell.
  function unstick() {
    if (!blockedAt(P.x, P.y + 1, P.z)) return;
    var rx = Math.round(P.x / CELL) * CELL;
    var rz = Math.round(P.z / CELL) * CELL;
    if (Math.abs(P.x - rx) <= Math.abs(P.z - rz)) P.x = rx; else P.z = rz;
    if (blockedAt(P.x, P.y + 1, P.z)) { var s = freeSpot(); P.x = s.x; P.z = s.z; }
    P.vx = P.vz = 0;
  }

  function nearestCar(maxD) {
    var best = null, bd = maxD * maxD;
    for (var i = 0; i < cars.length; i++) {
      var d = dist2(cars[i].x, cars[i].z, P.x, P.z);
      if (d < bd) { bd = d; best = cars[i]; }
    }
    return best;
  }

  function toggleVehicle() {
    if (P.mode === "drive") {
      P.mode = "foot";
      if (P.veh) { P.veh.occupied = false; P.veh = null; }
      P.x += Math.cos(P.yaw) * 2.4;
      P.z += -Math.sin(P.yaw) * 2.4;
      P.vx = P.vz = 0;
      playerMesh.visible = true;
      show("", "On foot", 1.1);
    } else {
      var c = nearestCar(7);
      if (!c) { show("", "No vehicle nearby", 1.1); return; }
      P.mode = "drive";
      P.veh = c;
      c.occupied = true;
      P.x = c.x; P.z = c.z; P.y = 0;
      P.yaw = c.h || 0;
      P.vx = P.vz = 0;
      playerMesh.visible = false;
      show("", "Driving", 1.1);
    }
  }

  function updateFoot(dt) {
    var f = 0, s = 0;
    if (keys["w"] || keys["arrowup"]) f += 1;
    if (keys["s"] || keys["arrowdown"]) f -= 1;
    if (keys["a"] || keys["arrowleft"]) s -= 1;
    if (keys["d"] || keys["arrowright"]) s += 1;
    f += touch.t; s += touch.s;

    var run = keys["shift"] || touch.b > 0;
    var sp = run ? FOOT.run : FOOT.walk;
    var len = Math.hypot(f, s) || 1;
    var wx = (Math.sin(P.yaw) * f + Math.cos(P.yaw) * s) / len * sp;
    var wz = (Math.cos(P.yaw) * f - Math.sin(P.yaw) * s) / len * sp;
    if (f === 0 && s === 0) { wx = 0; wz = 0; }

    P.vx = lerp(P.vx, wx, clamp(FOOT.accel * dt, 0, 1));
    P.vz = lerp(P.vz, wz, clamp(FOOT.accel * dt, 0, 1));

    unstick();

    // Axis-separated so sliding along a wall still works instead of stopping dead.
    var nx = P.x + P.vx * dt, nz = P.z + P.vz * dt;
    if (!blockedAt(nx, P.y + 1, P.z)) P.x = nx; else P.vx = 0;
    if (!blockedAt(P.x, P.y + 1, nz)) P.z = nz; else P.vz = 0;

    var rh = rampHeight(P.x, P.z);
    var ground = rh ? rh.h : 0;
    P.y = lerp(P.y, ground, clamp(12 * dt, 0, 1));

    boundsClamp();

    playerMesh.position.set(P.x, P.y, P.z);
    playerMesh.rotation.y = P.yaw;
    var moving = Math.hypot(P.vx, P.vz);
    if (playerMesh.userData.legs) {
      var b = Math.sin(performance.now() / 1000 * (run ? 13 : 8)) * 0.4 * clamp(moving / 6, 0, 1);
      playerMesh.userData.legs[0].rotation.x = b;
      playerMesh.userData.legs[1].rotation.x = -b;
    }
    Audio.engine(0, 0);
  }

  function updateDrive(dt) {
    var throttle = 0, steer = 0;
    if (keys["w"] || keys["arrowup"]) throttle += 1;
    if (keys["s"] || keys["arrowdown"]) throttle -= 1;
    if (keys["a"] || keys["arrowleft"]) steer -= 1;
    if (keys["d"] || keys["arrowright"]) steer += 1;
    throttle = clamp(throttle + touch.t, -1, 1);
    steer = clamp(steer + touch.s, -1, 1);
    var hand = !!keys[" "] || touch.b > 0;

    var fx2 = Math.sin(P.yaw), fz = Math.cos(P.yaw);
    var rx = Math.cos(P.yaw), rz = -Math.sin(P.yaw);
    var vf = P.vx * fx2 + P.vz * fz;
    var vl = P.vx * rx + P.vz * rz;

    if (P.grounded) {
      if (throttle > 0) vf += throttle * CAR.engine * dt * (1 - clamp(vf / CAR.maxFwd, 0, 0.92));
      else if (throttle < 0) {
        if (vf > 1) vf -= CAR.brake * dt;
        else vf += throttle * CAR.engine * 0.5 * dt * (1 - clamp(-vf / CAR.maxRev, 0, 0.9));
      }
      if (hand) vf -= Math.sign(vf) * 26 * dt;
      vf -= vf * CAR.drag * dt;
      if (Math.abs(vf) < 0.4 && throttle === 0) vf = 0;
      else vf -= Math.sign(vf) * CAR.roll * dt;
      vf = clamp(vf, -CAR.maxRev, CAR.maxFwd);
      vl -= vl * (hand ? CAR.gripHand : CAR.grip) * dt;
      var auth = clamp(Math.abs(vf) / 11, 0, 1) * (1 - clamp(Math.abs(vf) / (CAR.maxFwd * 2.4), 0, 0.45));
      P.yaw += steer * CAR.turn * auth * dt * (vf < -0.5 ? -1 : 1);
    } else P.yaw += steer * 0.9 * dt;

    P.vx = fx2 * vf + rx * vl;
    P.vz = fz * vf + rz * vl;
    P.x += P.vx * dt;
    P.z += P.vz * dt;

    var rh = rampHeight(P.x, P.z);
    var ground = rh ? rh.h : 0;
    if (P.grounded) {
      if (rh) {
        var rise = ground - P.y;
        P.y = ground;
        P.pitchV = -Math.atan(rh.slope);
        if (rise < -0.4) { P.grounded = false; P.vy = Math.abs(vf) * rh.slope * 0.9; }
      } else if (P.y > 0.05) { P.grounded = false; P.vy = 0; }
      else { P.y = 0; P.pitchV = lerp(P.pitchV || 0, 0, 8 * dt); }
    }
    if (!P.grounded) {
      P.vy -= GRAVITY * dt;
      P.y += P.vy * dt;
      if (P.y <= ground) {
        P.y = ground; P.vy = 0; P.grounded = true;
        if (Math.abs(vf) > 20) { Audio.crash(); P.shake = 0.4; }
      }
    }

    collideCar(vf);
    boundsClamp();

    if (P.veh) {
      P.veh.x = P.x; P.veh.z = P.z; P.veh.h = P.yaw;
      P.veh.mesh.position.set(P.x, P.y, P.z);
      P.veh.mesh.rotation.set(P.pitchV || 0, P.yaw, clamp(-vl * 0.012, -0.16, 0.16));
    }
    blob.position.set(P.x, ground + 0.03, P.z);
    Audio.engine(clamp(Math.abs(vf) / CAR.maxFwd, 0, 1), clamp(Math.abs(throttle), 0, 1));
  }

  function collideCar() {
    if (P.y > 8) return;
    var r = 1.5;
    var ci = Math.floor(P.x / CELL), cj = Math.floor(P.z / CELL);
    for (var i = ci - 1; i <= ci + 1; i++) {
      for (var j = cj - 1; j <= cj + 1; j++) {
        var list = bGrid[key(i, j)];
        if (!list) continue;
        for (var k = 0; k < list.length; k++) {
          var b = list[k];
          if (P.y > b.h) continue;
          var minx = b.x - b.w / 2 - r, maxx = b.x + b.w / 2 + r;
          var minz = b.z - b.d / 2 - r, maxz = b.z + b.d / 2 + r;
          if (P.x > minx && P.x < maxx && P.z > minz && P.z < maxz) {
            var px = Math.min(maxx - P.x, P.x - minx);
            var pz = Math.min(maxz - P.z, P.z - minz);
            var sp = Math.hypot(P.vx, P.vz);
            if (px < pz) { P.x += (P.x > b.x ? px : -px); P.vx *= -0.22; P.vz *= 0.55; }
            else { P.z += (P.z > b.z ? pz : -pz); P.vz *= -0.22; P.vx *= 0.55; }
            if (sp > 9) { Audio.crash(); P.shake = Math.min(1, sp / 45); damagePlayer(sp * 0.14); }
          }
        }
      }
    }
  }

  function boundsClamp() {
    var pad = 12;
    if (P.x < -pad) { P.x = -pad; P.vx = Math.abs(P.vx) * 0.3; }
    if (P.x > WORLD + pad) { P.x = WORLD + pad; P.vx = -Math.abs(P.vx) * 0.3; }
    if (P.z < -pad) { P.z = -pad; P.vz = Math.abs(P.vz) * 0.3; }
    if (P.z > WORLD + pad) { P.z = WORLD + pad; P.vz = -Math.abs(P.vz) * 0.3; }
  }

  // ============================================================ camera
  function updateCamera(dt) {
    var k = 1 - Math.pow(0.0016, dt);
    var tx, ty, tz, lx, ly, lz;
    if (P.mode === "drive") {
      var sp = Math.hypot(P.vx, P.vz);
      tx = P.x - Math.sin(P.yaw) * 12.5;
      tz = P.z - Math.cos(P.yaw) * 12.5;
      ty = P.y + 5.4 + sp * 0.03;
      lx = P.x + Math.sin(P.yaw) * 8; ly = P.y + 1.6; lz = P.z + Math.cos(P.yaw) * 8;
      camera.fov = lerp(camera.fov, 62 + clamp(sp / CAR.maxFwd, 0, 1) * 16, 3 * dt);
    } else {
      // Hold V to swing the camera round in front of him and look at his face.
      P.front = lerp(P.front || 0, keys["v"] ? 1 : 0, clamp(7 * dt, 0, 1));
      var fv = P.front;
      var cp = Math.cos(P.pitch);
      var cy = P.yaw + fv * Math.PI;
      var back = lerp(5.2, 3.0, fv);
      tx = P.x - Math.sin(cy) * back * cp - Math.cos(cy) * 1.5 * (1 - fv);
      tz = P.z - Math.cos(cy) * back * cp + Math.sin(cy) * 1.5 * (1 - fv);
      ty = P.y + lerp(2.5 - Math.sin(P.pitch) * 4.4, 1.86, fv);
      lx = lerp(P.x + Math.sin(P.yaw) * 14 * cp, P.x, fv);
      ly = lerp(P.y + 1.6 + Math.sin(P.pitch) * 14, P.y + 1.80, fv);
      lz = lerp(P.z + Math.cos(P.yaw) * 14 * cp, P.z, fv);
      camera.fov = lerp(camera.fov, fv > 0.5 ? 40 : (mouse.down ? 54 : 64), 6 * dt);
    }
    camera.position.x = lerp(camera.position.x, tx, k);
    camera.position.y = lerp(camera.position.y, ty, k);
    camera.position.z = lerp(camera.position.z, tz, k);
    if (P.shake > 0) {
      camera.position.x += rnd(-1, 1) * P.shake;
      camera.position.y += rnd(-1, 1) * P.shake * 0.6;
      camera.position.z += rnd(-1, 1) * P.shake;
      P.shake = Math.max(0, P.shake - dt * 2.4);
    }
    camera.lookAt(lx, ly, lz);
    camera.updateProjectionMatrix();
  }

  // ============================================================ audio
  var Audio = (function () {
    var ctx = null, engGain, engOsc, engFilt, sirenOsc, sirenGain, on = false;
    return {
      init: function () {
        if (ctx) return;
        var AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return;
        ctx = new AC();
        engOsc = ctx.createOscillator(); engOsc.type = "sawtooth"; engOsc.frequency.value = 60;
        engFilt = ctx.createBiquadFilter(); engFilt.type = "lowpass"; engFilt.frequency.value = 700;
        engGain = ctx.createGain(); engGain.gain.value = 0;
        engOsc.connect(engFilt); engFilt.connect(engGain); engGain.connect(ctx.destination);
        engOsc.start();
        sirenOsc = ctx.createOscillator(); sirenOsc.type = "square"; sirenOsc.frequency.value = 700;
        sirenGain = ctx.createGain(); sirenGain.gain.value = 0;
        sirenOsc.connect(sirenGain); sirenGain.connect(ctx.destination);
        sirenOsc.start();
        on = true;
      },
      engine: function (rpm, load) {
        if (!on) return;
        engOsc.frequency.setTargetAtTime(48 + rpm * 150, ctx.currentTime, 0.05);
        engFilt.frequency.setTargetAtTime(420 + rpm * 1500, ctx.currentTime, 0.08);
        engGain.gain.setTargetAtTime(rpm < 0.01 && load < 0.01 ? 0 : 0.018 + load * 0.026, ctx.currentTime, 0.1);
      },
      siren: function (active, t) {
        if (!on) return;
        sirenGain.gain.setTargetAtTime(active ? 0.018 : 0, ctx.currentTime, 0.15);
        if (active) sirenOsc.frequency.setTargetAtTime(620 + Math.sin(t * 7) * 220, ctx.currentTime, 0.02);
      },
      chime: function (f) {
        if (!on) return;
        var o = ctx.createOscillator(), g = ctx.createGain();
        o.type = "triangle"; o.frequency.value = f;
        g.gain.setValueAtTime(0.001, ctx.currentTime);
        g.gain.exponentialRampToValueAtTime(0.12, ctx.currentTime + 0.02);
        g.gain.exponentialRampToValueAtTime(0.0008, ctx.currentTime + 0.4);
        o.connect(g); g.connect(ctx.destination);
        o.start(); o.stop(ctx.currentTime + 0.45);
      },
      shot: function (freq) {
        if (!on) return;
        var len = 0.16, buf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * len), ctx.sampleRate);
        var d = buf.getChannelData(0);
        for (var i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / d.length, 2.6);
        var s = ctx.createBufferSource(); s.buffer = buf;
        var f = ctx.createBiquadFilter(); f.type = "bandpass"; f.frequency.value = freq || 260; f.Q.value = 0.9;
        var g = ctx.createGain(); g.gain.value = 0.16;
        s.connect(f); f.connect(g); g.connect(ctx.destination);
        s.start();
      },
      crash: function () {
        if (!on) return;
        var len = 0.28, buf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * len), ctx.sampleRate);
        var d = buf.getChannelData(0);
        for (var i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length);
        var s = ctx.createBufferSource(); s.buffer = buf;
        var f = ctx.createBiquadFilter(); f.type = "lowpass"; f.frequency.value = 1200;
        var g = ctx.createGain(); g.gain.value = 0.2;
        s.connect(f); f.connect(g); g.connect(ctx.destination);
        s.start();
      }
    };
  })();

  // ============================================================ hud
  var el = {}, mini, mctx, banT = 0;

  function show(title, body, secs) {
    if (!el.banner) return;
    el.banner.innerHTML = (title ? '<b>' + title + "</b>" : "") + (body ? "<span>" + body + "</span>" : "");
    el.banner.style.opacity = 1;
    banT = secs || 3;
  }

  function updateHUD(dt) {
    var sp = P.mode === "drive" ? Math.hypot(P.vx, P.vz) * 3.1 : Math.hypot(P.vx, P.vz) * 1.1;
    el.speed.textContent = Math.round(sp);
    el.cash.textContent = "$" + Math.max(0, P.cash).toLocaleString();
    el.hp.style.width = clamp(P.hp, 0, 100) + "%";
    el.ar.style.width = clamp(P.armor, 0, 100) + "%";
    var w = WEAPONS[P.wep];
    el.weapon.textContent = w.name;
    el.ammo.textContent = P.reloading > 0 ? "reloading" : (P.mag[P.wep] + " / " + P.ammo[P.wep]);
    var s = "";
    for (var i = 0; i < 5; i++) s += i < P.stars ? "★" : "☆";
    el.stars.textContent = s;
    el.stars.className = "stars" + (P.stars > 0 ? " hot" : "");
    el.obj.textContent = Mission.objective();
    var mt = Mission.timer;
    if (mt > 0) { el.timer.style.display = ""; el.timer.textContent = mt.toFixed(1) + "s"; el.timer.className = "timer" + (mt < 12 ? " low" : ""); }
    else el.timer.style.display = "none";

    el.flash.style.opacity = P.dmgFlash;
    P.dmgFlash = Math.max(0, P.dmgFlash - dt * 2.4);

    if (banT > 0) { banT -= dt; if (banT <= 0) el.banner.style.opacity = 0; }
    drawMini();
  }

  function drawMini() {
    var W = mini.width, H = mini.height, R = 200;
    mctx.clearRect(0, 0, W, H);
    mctx.save();
    mctx.translate(W / 2, H / 2);
    mctx.rotate(-P.yaw);
    var s = (W / 2) / R;
    mctx.scale(s, s);
    mctx.translate(-P.x, -P.z);

    mctx.strokeStyle = "rgba(120,140,190,0.34)";
    mctx.lineWidth = 5;
    for (var i = 0; i <= GRID; i++) {
      mctx.beginPath(); mctx.moveTo(i * CELL, -CELL); mctx.lineTo(i * CELL, WORLD + CELL); mctx.stroke();
      mctx.beginPath(); mctx.moveTo(-CELL, i * CELL); mctx.lineTo(WORLD + CELL, i * CELL); mctx.stroke();
    }
    var a = Mission.active;
    if (a) {
      mctx.fillStyle = a.type.indexOf("deliver") === 0 ? "#ffb020" : "#ff3a5e";
      mctx.beginPath(); mctx.arc(a.tx, a.tz, 10, 0, 6.29); mctx.fill();
    }
    mctx.fillStyle = "#ff3355";
    police.forEach(function (p) { mctx.beginPath(); mctx.arc(p.x, p.z, 6, 0, 6.29); mctx.fill(); });
    mctx.fillStyle = "#ff8a3a";
    enemies.forEach(function (e) { if (!e.dead) { mctx.beginPath(); mctx.arc(e.x, e.z, 5, 0, 6.29); mctx.fill(); } });
    mctx.fillStyle = "#2fe08a";
    pickups.forEach(function (p) { mctx.beginPath(); mctx.arc(p.x, p.z, 4, 0, 6.29); mctx.fill(); });
    mctx.restore();

    mctx.save();
    mctx.translate(W / 2, H / 2);
    mctx.fillStyle = P.mode === "drive" ? "#7fe8ff" : "#ffe08a";
    mctx.beginPath();
    mctx.moveTo(0, -9); mctx.lineTo(6, 7); mctx.lineTo(0, 3.5); mctx.lineTo(-6, 7);
    mctx.closePath(); mctx.fill();
    mctx.restore();
  }

  // ============================================================ loop
  function frame() {
    requestAnimationFrame(frame);
    if (!running) return;
    var dt = Math.min(0.05, clock.getDelta());
    if (paused) { renderer.render(scene, camera); return; }

    if (!dead) {
      if (P.mode === "drive") updateDrive(dt); else updateFoot(dt);
      if (P.cool > 0) P.cool -= dt;
      if (P.reloading > 0) { P.reloading -= dt; if (P.reloading <= 0) finishReload(); }
      if (mouse.down || touch.fire) { if (WEAPONS[P.wep].auto || !P._held) { playerFire(); P._held = true; } }
      else P._held = false;
    }

    updateTraffic(dt);
    updateCivs(dt);
    updateEnemies(dt);
    updatePolice(dt);
    updatePickups(dt);
    updateFx(dt);
    Mission.update(dt);
    updateCamera(dt);
    updateHUD(dt);

    P.heat = Math.max(0, P.heat - dt * (police.length ? 0.9 : 4.2));
    P.stars = clamp(Math.floor(P.heat / 18), 0, 5);
    if (P.stars > 0 && police.length === 0) spawnPolice();
    Audio.siren(P.stars > 0 && police.length > 0, performance.now() / 1000);

    if (markerMesh.visible) {
      markerMesh.rotation.y += dt * 1.6;
      markerMesh.position.y = 1.4 + Math.sin(performance.now() / 400) * 0.35;
    }

    renderer.render(scene, camera);
  }

  // ============================================================ setup
  function init() {
    scene = new THREE.Scene();
    scene.fog = new THREE.Fog(0x18173a, 90, 560);
    camera = new THREE.PerspectiveCamera(64, innerWidth / innerHeight, 0.4, 3000);
    renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
    renderer.setPixelRatio(Math.min(devicePixelRatio, 1.75));
    renderer.setSize(innerWidth, innerHeight);
    if (THREE.sRGBEncoding) renderer.outputEncoding = THREE.sRGBEncoding;
    document.getElementById("stage").appendChild(renderer.domElement);
    clock = new THREE.Clock();

    scene.add(new THREE.HemisphereLight(0x8899ff, 0x241a3a, 0.9));
    var sun = new THREE.DirectionalLight(0xffb488, 0.75);
    sun.position.set(-260, 180, -420); scene.add(sun);
    var rim = new THREE.DirectionalLight(0x5566ff, 0.35);
    rim.position.set(300, 140, 300); scene.add(rim);

    buildSky(); buildGround(); buildWater(); buildCity(); buildRamps();

    playerMesh = buildPerson(0xe8355a, 0x1e2438, true);
    scene.add(playerMesh);
    blob = new THREE.Mesh(new THREE.CircleGeometry(2.4, 16),
      new THREE.MeshBasicMaterial({ color: 0x000010, transparent: true, opacity: 0.4 }));
    blob.rotation.x = -Math.PI / 2;
    scene.add(blob);

    markerMesh = new THREE.Mesh(new THREE.OctahedronGeometry(2.1),
      new THREE.MeshBasicMaterial({ color: 0xffb020, transparent: true, opacity: 0.9 }));
    scene.add(markerMesh);
    beamMesh = new THREE.Mesh(
      new THREE.CylinderGeometry(1.6, 1.6, 60, 10, 1, true),
      new THREE.MeshBasicMaterial({ color: 0xffb020, transparent: true, opacity: 0.14, side: THREE.DoubleSide, depthWrite: false }));
    scene.add(beamMesh);

    spawnTraffic(); spawnCivs(); seedPickups();

    WEAPONS.forEach(function (w, i) { P.mag[i] = w.mag; P.ammo[i] = w.res; });

    el.speed = document.getElementById("speed");
    el.cash = document.getElementById("cash");
    el.stars = document.getElementById("stars");
    el.timer = document.getElementById("timer");
    el.hp = document.getElementById("hpbar");
    el.ar = document.getElementById("arbar");
    el.weapon = document.getElementById("weapon");
    el.ammo = document.getElementById("ammo");
    el.obj = document.getElementById("objective");
    el.banner = document.getElementById("banner");
    el.flash = document.getElementById("flash");
    mini = document.getElementById("mini");
    mini.width = mini.height = 190;
    mctx = mini.getContext("2d");

    var spawn = freeSpot();
    P.x = spawn.x; P.z = spawn.z; P.y = 0;
    playerMesh.position.set(P.x, 0, P.z);

    // A parked car within reach of the spawn, so pressing F always does
    // something. Not part of the traffic pool, so it stays put until taken.
    var park = { x: spawn.x + 4.5, z: spawn.z + 3, h: 0, occupied: false, parked: true,
                 mesh: buildCarMesh(0xe8355a, false) };
    park.mesh.position.set(park.x, 0, park.z);
    scene.add(park.mesh);
    cars.push(park);

    camera.position.set(P.x, 8, P.z - 14);
    running = true;
    Mission.start(0);
    frame();
  }

  // ============================================================ input
  addEventListener("keydown", function (e) {
    var k = String(e.key || "").toLowerCase();
    keys[k] = true;
    if (k === "f") toggleVehicle();
    if (k === "r") startReload();
    if (k === "p") paused = !paused;
    if (k === "1") P.wep = 0;
    if (k === "2") P.wep = 1;
    if (k === "3") P.wep = 2;
    if (k === "q") P.wep = (P.wep + 1) % WEAPONS.length;
    if ([" ", "arrowup", "arrowdown", "arrowleft", "arrowright"].indexOf(k) >= 0 && e.preventDefault) e.preventDefault();
  });
  addEventListener("keyup", function (e) { keys[String(e.key || "").toLowerCase()] = false; });

  addEventListener("mousedown", function (e) {
    if (e.button === 0) mouse.down = true;
    var c = renderer && renderer.domElement;
    if (c && c.requestPointerLock && !mouse.locked) c.requestPointerLock();
  });
  addEventListener("mouseup", function (e) { if (e.button === 0) mouse.down = false; });
  addEventListener("mousemove", function (e) {
    if (!mouse.locked) return;
    P.yaw -= (e.movementX || 0) * 0.0026;
    P.pitch = clamp(P.pitch - (e.movementY || 0) * 0.0022, -0.62, 0.52);
  });
  document.addEventListener("pointerlockchange", function () {
    mouse.locked = document.pointerLockElement === (renderer && renderer.domElement);
  });

  addEventListener("resize", function () {
    if (!renderer) return;
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(innerWidth, innerHeight);
  });

  function bindTouch() {
    function bind(id, on, off) {
      var e = document.getElementById(id);
      if (!e) return;
      ["touchstart", "mousedown"].forEach(function (ev) {
        e.addEventListener(ev, function (x) { if (x.preventDefault) x.preventDefault(); if (x.stopPropagation) x.stopPropagation(); on(); });
      });
      ["touchend", "touchcancel", "mouseup", "mouseleave"].forEach(function (ev) {
        e.addEventListener(ev, function (x) { if (x.preventDefault) x.preventDefault(); off(); });
      });
    }
    bind("tGas", function () { touch.t = 1; }, function () { touch.t = 0; });
    bind("tRev", function () { touch.t = -1; }, function () { touch.t = 0; });
    bind("tL", function () { touch.s = -1; }, function () { touch.s = 0; });
    bind("tR", function () { touch.s = 1; }, function () { touch.s = 0; });
    bind("tHand", function () { touch.b = 1; }, function () { touch.b = 0; });
    bind("tFire", function () { touch.fire = 1; }, function () { touch.fire = 0; });
    var ent = document.getElementById("tEnter");
    if (ent) ent.addEventListener("touchstart", function (x) { if (x.preventDefault) x.preventDefault(); toggleVehicle(); });
  }

  // ============================================================ boot
  function boot() {
    var btn = document.getElementById("start");
    if (!btn) return;
    btn.addEventListener("click", function () {
      if (started) return;
      started = true;
      Audio.init();
      var intro = document.getElementById("intro");
      if (intro) intro.style.display = "none";
      var hud = document.getElementById("hud");
      if (hud) hud.style.display = "";
      init();
      bindTouch();
    });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
