/* =============================================================
   NEON BAY  -  an original open-world driving game
   All geometry, textures and audio are generated at runtime.
   No third-party game assets are used or required.
   ============================================================= */
(function () {
  "use strict";

  // ---------------------------------------------------------- config
  var CELL = 76;          // city grid spacing
  var GRID = 13;          // cells per side
  var ROAD = 19;          // road width
  var WORLD = CELL * GRID;

  var ENGINE = 27;
  var BRAKE = 44;
  var MAX_FWD = 63;
  var MAX_REV = 17;
  var DRAG = 0.62;
  var ROLL = 3.4;
  var TURN = 2.35;
  var GRIP = 7.6;
  var GRIP_HAND = 1.05;
  var GRAVITY = 32;

  var TRAFFIC_N = 18;
  var PED_N = 64;
  var POLICE_MAX = 6;

  // ---------------------------------------------------------- state
  var scene, camera, renderer, clock;
  var car, carMesh, blob;
  var buildings = [], bGrid = {};
  var ramps = [];
  var traffic = [], peds = [], police = [];
  var pickupMesh, beamMesh;
  var running = false, paused = false, started = false;

  var G = {
    x: CELL * 0.5, z: CELL * 0.5, y: 0,
    h: 0, vx: 0, vz: 0, vy: 0,
    grounded: true, pitch: 0,
    cash: 0, heat: 0, stars: 0,
    hasCargo: false, mx: 0, mz: 0,
    timer: 0, deliveries: 0, best: 0,
    shake: 0, damage: 0
  };

  var keys = {};
  var touch = { t: 0, s: 0, b: 0 };
  var camMode = 0;

  // ---------------------------------------------------------- helpers
  function rnd(a, b) { return a + Math.random() * (b - a); }
  function irnd(a, b) { return Math.floor(rnd(a, b + 1)); }
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function key(i, j) { return i + "|" + j; }

  // ---------------------------------------------------------- textures
  function windowTexture(tier) {
    var c = document.createElement("canvas");
    c.width = 64; c.height = 128;
    var x = c.getContext("2d");
    x.fillStyle = "#0a0b14";
    x.fillRect(0, 0, 64, 128);
    var cols = 5, rows = 11;
    for (var r = 0; r < rows; r++) {
      for (var q = 0; q < cols; q++) {
        var lit = Math.random();
        if (lit > 0.55) {
          var hue = Math.random() < 0.16 ? rnd(280, 320) : rnd(35, 55);
          var l = rnd(45, 72);
          x.fillStyle = "hsl(" + hue + "," + rnd(55, 90) + "%," + l + "%)";
        } else {
          x.fillStyle = "#12141f";
        }
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
    g.addColorStop(0.00, "#07091c");
    g.addColorStop(0.42, "#171a4a");
    g.addColorStop(0.66, "#5b2a6e");
    g.addColorStop(0.82, "#c04a6a");
    g.addColorStop(0.93, "#f0834a");
    g.addColorStop(1.00, "#ffc07a");
    x.fillStyle = g;
    x.fillRect(0, 0, 16, 256);
    var t = new THREE.CanvasTexture(c);
    t.magFilter = THREE.LinearFilter;
    return t;
  }

  function asphaltTexture() {
    var c = document.createElement("canvas");
    c.width = c.height = 128;
    var x = c.getContext("2d");
    x.fillStyle = "#191b24";
    x.fillRect(0, 0, 128, 128);
    for (var i = 0; i < 900; i++) {
      x.fillStyle = "rgba(255,255,255," + (Math.random() * 0.035) + ")";
      x.fillRect(Math.random() * 128, Math.random() * 128, 2, 2);
    }
    var t = new THREE.CanvasTexture(c);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(GRID * 3, GRID * 3);
    return t;
  }

  // ---------------------------------------------------------- world
  function buildSky() {
    var geo = new THREE.SphereGeometry(1400, 24, 16);
    var mat = new THREE.MeshBasicMaterial({
      map: skyTexture(), side: THREE.BackSide, fog: false, depthWrite: false
    });
    scene.add(new THREE.Mesh(geo, mat));
  }

  function buildGround() {
    var g = new THREE.PlaneGeometry(WORLD * 2.4, WORLD * 2.4);
    var m = new THREE.MeshStandardMaterial({
      map: asphaltTexture(), color: 0x9aa0b4, roughness: 0.95, metalness: 0.05
    });
    var mesh = new THREE.Mesh(g, m);
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.set(WORLD / 2, -0.02, WORLD / 2);
    scene.add(mesh);

    // lane stripes along every road centre
    var stripeMat = new THREE.MeshBasicMaterial({ color: 0xf2d98a, transparent: true, opacity: 0.4 });
    var sg = new THREE.PlaneGeometry(0.45, 5.5);
    var count = GRID * GRID * 2 * 4;
    var inst = new THREE.InstancedMesh(sg, stripeMat, count);
    var d = new THREE.Object3D(), n = 0;
    for (var i = 0; i <= GRID; i++) {
      for (var s = 0; s < GRID * 4 && n < count; s++) {
        var p = s * (CELL / 4) + CELL / 8;
        d.position.set(i * CELL, 0.02, p); d.rotation.set(-Math.PI / 2, 0, 0);
        d.updateMatrix(); inst.setMatrixAt(n++, d.matrix);
        if (n >= count) break;
        d.position.set(p, 0.02, i * CELL); d.rotation.set(-Math.PI / 2, 0, Math.PI / 2);
        d.updateMatrix(); inst.setMatrixAt(n++, d.matrix);
      }
    }
    inst.count = n;
    scene.add(inst);
  }

  function buildWater() {
    var g = new THREE.PlaneGeometry(WORLD * 2.4, 900);
    var m = new THREE.MeshStandardMaterial({
      color: 0x0a2440, roughness: 0.15, metalness: 0.8,
      transparent: true, opacity: 0.94
    });
    var mesh = new THREE.Mesh(g, m);
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.set(WORLD / 2, -0.6, -540);
    scene.add(mesh);
  }

  function buildCity() {
    var tiers = 5;
    var mats = [], geos = [], insts = [], counts = [];
    var t;
    for (t = 0; t < tiers; t++) {
      mats.push(new THREE.MeshStandardMaterial({
        map: windowTexture(t + 1), roughness: 0.72, metalness: 0.18,
        emissive: 0x1a1226, emissiveIntensity: 0.55
      }));
      geos.push(new THREE.BoxGeometry(1, 1, 1));
      counts.push(0);
    }

    var plan = [];
    for (var i = 0; i < GRID; i++) {
      for (var j = 0; j < GRID; j++) {
        var cx = i * CELL + CELL / 2, cz = j * CELL + CELL / 2;
        var inner = CELL - ROAD - 6;
        var n = irnd(1, 3);
        for (var k = 0; k < n; k++) {
          var w = rnd(inner * 0.32, inner * (n === 1 ? 0.92 : 0.5));
          var d = rnd(inner * 0.32, inner * (n === 1 ? 0.92 : 0.5));
          var ox = n === 1 ? 0 : rnd(-inner / 2 + w / 2, inner / 2 - w / 2);
          var oz = n === 1 ? 0 : rnd(-inner / 2 + d / 2, inner / 2 - d / 2);
          var edge = Math.min(i, j, GRID - 1 - i, GRID - 1 - j);
          var maxH = edge < 2 ? 26 : edge < 4 ? 52 : 92;
          var h = rnd(12, maxH);
          var tier = clamp(Math.floor(h / 20), 0, tiers - 1);
          plan.push({ x: cx + ox, z: cz + oz, w: w, d: d, h: h, tier: tier });
          counts[tier]++;
        }
      }
    }

    for (t = 0; t < tiers; t++) {
      insts.push(new THREE.InstancedMesh(geos[t], mats[t], Math.max(1, counts[t])));
      insts[t].count = 0;
      scene.add(insts[t]);
    }

    var dummy = new THREE.Object3D();
    var col = new THREE.Color();
    plan.forEach(function (b) {
      var m = insts[b.tier];
      dummy.position.set(b.x, b.h / 2, b.z);
      dummy.scale.set(b.w, b.h, b.d);
      dummy.rotation.set(0, 0, 0);
      dummy.updateMatrix();
      m.setMatrixAt(m.count, dummy.matrix);
      if (m.setColorAt) {
        col.setHSL(rnd(0.58, 0.78), 0.18, rnd(0.42, 0.62));
        m.setColorAt(m.count, col);
      }
      m.count++;
      buildings.push(b);
      var gi = Math.floor(b.x / CELL), gj = Math.floor(b.z / CELL);
      var kk = key(gi, gj);
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
    var geo = new THREE.BoxGeometry(1, 0.7, 1);
    var mat = new THREE.MeshBasicMaterial({ vertexColors: false });
    var picks = plan.filter(function () { return Math.random() < 0.42; });
    var inst = new THREE.InstancedMesh(geo, mat, Math.max(1, picks.length));
    var d = new THREE.Object3D(), c = new THREE.Color(), n = 0;
    picks.forEach(function (b) {
      d.position.set(b.x, b.h + 0.5, b.z);
      d.scale.set(b.w * 1.04, 1, b.d * 1.04);
      d.updateMatrix();
      inst.setMatrixAt(n, d.matrix);
      if (inst.setColorAt) {
        var hues = [0.86, 0.52, 0.94, 0.05, 0.72];
        c.setHSL(hues[irnd(0, hues.length - 1)], 0.95, 0.62);
        inst.setColorAt(n, c);
      }
      n++;
    });
    inst.count = n;
    inst.instanceMatrix.needsUpdate = true;
    if (inst.instanceColor) {
      inst.instanceColor.needsUpdate = true;
      inst.material.vertexColors = true;
    }
    scene.add(inst);
  }

  function buildPalms() {
    var n = 260;
    var tg = new THREE.CylinderGeometry(0.22, 0.34, 7, 5);
    var tm = new THREE.MeshStandardMaterial({ color: 0x4a3a2a, roughness: 1 });
    var ti = new THREE.InstancedMesh(tg, tm, n);
    var fg = new THREE.ConeGeometry(3.1, 1.5, 6);
    var fm = new THREE.MeshStandardMaterial({ color: 0x1d6b4a, roughness: 0.9, emissive: 0x06301f, emissiveIntensity: 0.5 });
    var fi = new THREE.InstancedMesh(fg, fm, n);
    var d = new THREE.Object3D();
    for (var i = 0; i < n; i++) {
      var gi = irnd(0, GRID), gj = irnd(0, GRID);
      var along = rnd(0, CELL);
      var x, z;
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
      var x = gi * CELL, z = gj * CELL + rnd(-CELL / 3, CELL / 3);
      if (horiz) { var tmp = x; x = gi * CELL + rnd(-CELL / 3, CELL / 3); z = gj * CELL; }
      var r = { x: x, z: z, len: len, wid: wid, h: hgt, horiz: horiz, dir: Math.random() < 0.5 ? 1 : -1 };
      ramps.push(r);

      var geo = new THREE.BufferGeometry();
      var hw = wid / 2, hl = len / 2;
      var a = [
        -hw, 0, -hl, hw, 0, -hl, hw, 0, hl, -hw, 0, hl,
        -hw, hgt, hl * r.dir >= 0 ? hl : hl, hw, hgt, hl
      ];
      // simple wedge: rises along +z (local), flipped by dir
      var v = new Float32Array([
        -hw, 0, -hl, hw, 0, -hl, hw, hgt, hl,
        -hw, 0, -hl, hw, hgt, hl, -hw, hgt, hl,
        -hw, 0, -hl, -hw, hgt, hl, -hw, 0, hl,
        hw, 0, -hl, hw, 0, hl, hw, hgt, hl,
        -hw, 0, -hl, -hw, 0, hl, hw, 0, hl,
        -hw, 0, -hl, hw, 0, hl, hw, 0, -hl,
        -hw, hgt, hl, hw, hgt, hl, hw, 0, hl,
        -hw, hgt, hl, hw, 0, hl, -hw, 0, hl
      ]);
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
      var r = ramps[i];
      var dx = x - r.x, dz = z - r.z;
      var along, across;
      if (r.horiz) { along = dx * r.dir; across = dz; }
      else { along = dz * r.dir; across = dx; }
      if (Math.abs(across) > r.wid / 2) continue;
      if (along < -r.len / 2 || along > r.len / 2) continue;
      var t = (along + r.len / 2) / r.len;
      return { h: t * r.h, slope: r.h / r.len };
    }
    return null;
  }

  // ---------------------------------------------------------- car
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
      var barMat = new THREE.MeshBasicMaterial({ color: 0x0d1030 });
      var bar = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.16, 0.34), barMat);
      bar.position.set(0, 1.56, -0.2); g.add(bar);
      var lr = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.2, 0.36), new THREE.MeshBasicMaterial({ color: 0xff1030 }));
      lr.position.set(-0.42, 1.58, -0.2); g.add(lr);
      var lb = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.2, 0.36), new THREE.MeshBasicMaterial({ color: 0x2050ff }));
      lb.position.set(0.42, 1.58, -0.2); g.add(lb);
      g.userData.lights = [lr, lb];
    }
    return g;
  }

  // ---------------------------------------------------------- agents
  function nearestNode(v) { return Math.round(v / CELL) * CELL; }

  function spawnTraffic() {
    var colors = [0xd8443a, 0x2f7fd8, 0xe0c341, 0x2fae72, 0xd9d9e0, 0x8a4fd0, 0xe07a2f];
    for (var i = 0; i < TRAFFIC_N; i++) {
      var gi = irnd(0, GRID), gj = irnd(0, GRID);
      var horiz = Math.random() < 0.5;
      var t = {
        x: horiz ? gi * CELL + rnd(0, CELL) : gi * CELL,
        z: horiz ? gj * CELL : gj * CELL + rnd(0, CELL),
        h: 0, sp: rnd(13, 22), horiz: horiz, dir: Math.random() < 0.5 ? 1 : -1,
        mesh: buildCarMesh(colors[irnd(0, colors.length - 1)], false),
        cool: 0
      };
      t.h = t.horiz ? (t.dir > 0 ? Math.PI / 2 : -Math.PI / 2) : (t.dir > 0 ? 0 : Math.PI);
      scene.add(t.mesh);
      traffic.push(t);
    }
  }

  function updateTraffic(dt) {
    for (var i = 0; i < traffic.length; i++) {
      var t = traffic[i];
      if (t.horiz) t.x += t.dir * t.sp * dt; else t.z += t.dir * t.sp * dt;

      // turn at intersections
      var onNodeX = Math.abs(t.x - nearestNode(t.x)) < 0.7;
      var onNodeZ = Math.abs(t.z - nearestNode(t.z)) < 0.7;
      t.cool -= dt;
      if (onNodeX && onNodeZ && t.cool <= 0 && Math.random() < 0.5) {
        t.cool = 1.4;
        t.horiz = !t.horiz;
        t.dir = Math.random() < 0.5 ? 1 : -1;
        t.x = nearestNode(t.x); t.z = nearestNode(t.z);
        t.h = t.horiz ? (t.dir > 0 ? Math.PI / 2 : -Math.PI / 2) : (t.dir > 0 ? 0 : Math.PI);
      }

      if (t.x < -CELL) t.x = WORLD; if (t.x > WORLD + CELL) t.x = 0;
      if (t.z < -CELL) t.z = WORLD; if (t.z > WORLD + CELL) t.z = 0;

      var lane = t.horiz ? 4.2 * t.dir : 4.2 * t.dir;
      t.mesh.position.set(t.horiz ? t.x : t.x + lane * 0, 0, t.horiz ? t.z + lane * 0 : t.z);
      t.mesh.position.x = t.x; t.mesh.position.z = t.z;
      t.mesh.rotation.y = t.h;

      // collision with player
      var dx = t.x - G.x, dz = t.z - G.z;
      if (dx * dx + dz * dz < 16) {
        var sp = Math.sqrt(G.vx * G.vx + G.vz * G.vz);
        if (sp > 8) {
          G.vx *= -0.3; G.vz *= -0.3;
          G.shake = Math.min(1, sp / 40);
          addHeat(9);
          Audio.crash();
          t.x += dx * 0.6; t.z += dz * 0.6;
        }
      }
    }
  }

  function spawnPeds() {
    var g = new THREE.CapsuleGeometry ? new THREE.CapsuleGeometry(0.28, 0.9, 3, 6)
      : new THREE.CylinderGeometry(0.28, 0.28, 1.5, 6);
    var m = new THREE.MeshStandardMaterial({ color: 0xcfd2e0, roughness: 0.9 });
    var inst = new THREE.InstancedMesh(g, m, PED_N);
    scene.add(inst);
    for (var i = 0; i < PED_N; i++) {
      var gi = irnd(0, GRID - 1), gj = irnd(0, GRID - 1);
      peds.push({
        x: gi * CELL + rnd(ROAD / 2 + 1, CELL - ROAD / 2 - 1),
        z: gj * CELL + rnd(ROAD / 2 + 1, CELL - ROAD / 2 - 1),
        a: rnd(0, 6.28), sp: rnd(1.2, 2.6), t: rnd(0, 4)
      });
    }
    peds.inst = inst;
  }

  function updatePeds(dt) {
    var d = new THREE.Object3D();
    for (var i = 0; i < peds.length; i++) {
      var p = peds[i];
      p.t -= dt;
      if (p.t <= 0) { p.t = rnd(1.5, 5); p.a += rnd(-1.6, 1.6); }
      p.x += Math.sin(p.a) * p.sp * dt;
      p.z += Math.cos(p.a) * p.sp * dt;
      var dx = p.x - G.x, dz = p.z - G.z;
      var dd = dx * dx + dz * dz;
      if (dd < 120) { p.a = Math.atan2(dx, dz); p.sp = 5.2; }
      else if (p.sp > 3) p.sp = rnd(1.2, 2.6);
      if (p.x < 0 || p.x > WORLD || p.z < 0 || p.z > WORLD) p.a += Math.PI;
      d.position.set(p.x, 0.9, p.z);
      d.rotation.set(0, p.a, 0);
      d.scale.set(1, 1, 1);
      d.updateMatrix();
      peds.inst.setMatrixAt(i, d.matrix);
    }
    peds.inst.instanceMatrix.needsUpdate = true;
  }

  function spawnPolice() {
    if (police.length >= Math.min(POLICE_MAX, G.stars + 1)) return;
    var ang = rnd(0, 6.28), dist = rnd(120, 190);
    var p = {
      x: clamp(G.x + Math.sin(ang) * dist, 5, WORLD - 5),
      z: clamp(G.z + Math.cos(ang) * dist, 5, WORLD - 5),
      h: 0, vx: 0, vz: 0, mesh: buildCarMesh(0x101a3a, true), t: 0
    };
    scene.add(p.mesh);
    police.push(p);
  }

  function updatePolice(dt) {
    for (var i = police.length - 1; i >= 0; i--) {
      var p = police[i];
      p.t += dt;
      var dx = G.x - p.x, dz = G.z - p.z;
      var dist = Math.sqrt(dx * dx + dz * dz) || 1;
      var want = Math.atan2(dx, dz);
      var diff = ((want - p.h + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
      p.h += clamp(diff, -2.6 * dt, 2.6 * dt);
      var sp = 30 + G.stars * 5;
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

      if (dist < 5) {
        G.vx *= -0.4; G.vz *= -0.4;
        G.shake = 0.8; Audio.crash();
        G.damage = Math.min(100, G.damage + 6);
      }
      if (G.stars === 0 || dist > 420) {
        scene.remove(p.mesh); police.splice(i, 1);
      }
    }
    if (G.stars > 0 && Math.random() < dt * 0.55) spawnPolice();
  }

  function addHeat(v) {
    G.heat = clamp(G.heat + v, 0, 100);
    G.stars = clamp(Math.floor(G.heat / 18), 0, 5);
  }

  // ---------------------------------------------------------- missions
  function newMission() {
    var gi = irnd(0, GRID - 1), gj = irnd(0, GRID - 1);
    G.mx = gi * CELL + CELL / 2 + rnd(-14, 14);
    G.mz = gj * CELL + CELL / 2 + rnd(-14, 14);
    var d = Math.hypot(G.mx - G.x, G.mz - G.z);
    if (d < 140) return newMission();
    if (G.hasCargo) G.timer = 22 + d / 26;
    updateMarker();
  }

  function updateMarker() {
    var col = G.hasCargo ? 0x2fe08a : 0xffb020;
    pickupMesh.position.set(G.mx, 1.2, G.mz);
    beamMesh.position.set(G.mx, 30, G.mz);
    pickupMesh.material.color.setHex(col);
    beamMesh.material.color.setHex(col);
  }

  function checkMission(dt) {
    var d = Math.hypot(G.mx - G.x, G.mz - G.z);
    if (d < 6) {
      if (!G.hasCargo) {
        G.hasCargo = true;
        Audio.chime(660);
        newMission();
        toast("Cargo loaded - get it to the drop before the timer runs out");
      } else {
        var pay = 250 + Math.floor(G.timer * 22) + G.deliveries * 40;
        G.cash += pay; G.deliveries++;
        G.best = Math.max(G.best, G.deliveries);
        G.hasCargo = false; G.timer = 0;
        Audio.chime(880); Audio.chime(1180);
        toast("Delivered!  +$" + pay);
        newMission();
      }
    }
    if (G.hasCargo) {
      G.timer -= dt;
      if (G.timer <= 0) {
        G.hasCargo = false; G.timer = 0;
        toast("Cargo spoiled. Find a new pickup.");
        newMission();
      }
    }
  }

  var toastEl, toastT = 0;
  function toast(msg) { toastEl.textContent = msg; toastEl.style.opacity = 1; toastT = 3.4; }

  // ---------------------------------------------------------- audio
  var Audio = (function () {
    var ctx = null, engGain, engOsc, engFilt, sirenOsc, sirenGain, on = false;
    function init() {
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
    }
    return {
      init: init,
      engine: function (rpm, load) {
        if (!on) return;
        engOsc.frequency.setTargetAtTime(48 + rpm * 150, ctx.currentTime, 0.05);
        engFilt.frequency.setTargetAtTime(420 + rpm * 1500, ctx.currentTime, 0.08);
        engGain.gain.setTargetAtTime(0.018 + load * 0.026, ctx.currentTime, 0.1);
      },
      siren: function (active, t) {
        if (!on) return;
        sirenGain.gain.setTargetAtTime(active ? 0.02 : 0, ctx.currentTime, 0.15);
        if (active) sirenOsc.frequency.setTargetAtTime(620 + Math.sin(t * 7) * 220, ctx.currentTime, 0.02);
      },
      chime: function (f) {
        if (!on) return;
        var o = ctx.createOscillator(), g = ctx.createGain();
        o.type = "triangle"; o.frequency.value = f;
        g.gain.setValueAtTime(0.001, ctx.currentTime);
        g.gain.exponentialRampToValueAtTime(0.14, ctx.currentTime + 0.02);
        g.gain.exponentialRampToValueAtTime(0.0008, ctx.currentTime + 0.4);
        o.connect(g); g.connect(ctx.destination);
        o.start(); o.stop(ctx.currentTime + 0.45);
      },
      crash: function () {
        if (!on) return;
        var len = 0.28, buf = ctx.createBuffer(1, ctx.sampleRate * len, ctx.sampleRate);
        var d = buf.getChannelData(0);
        for (var i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length);
        var s = ctx.createBufferSource(); s.buffer = buf;
        var f = ctx.createBiquadFilter(); f.type = "lowpass"; f.frequency.value = 1200;
        var g = ctx.createGain(); g.gain.value = 0.22;
        s.connect(f); f.connect(g); g.connect(ctx.destination);
        s.start();
      }
    };
  })();

  // ---------------------------------------------------------- physics
  function updateCar(dt) {
    var throttle = 0, steer = 0;
    if (keys["w"] || keys["arrowup"]) throttle += 1;
    if (keys["s"] || keys["arrowdown"]) throttle -= 1;
    if (keys["a"] || keys["arrowleft"]) steer -= 1;
    if (keys["d"] || keys["arrowright"]) steer += 1;
    throttle += touch.t; steer += touch.s;
    throttle = clamp(throttle, -1, 1); steer = clamp(steer, -1, 1);
    var hand = !!keys[" "] || touch.b > 0;

    var fx = Math.sin(G.h), fz = Math.cos(G.h);
    var rx = Math.cos(G.h), rz = -Math.sin(G.h);
    var vf = G.vx * fx + G.vz * fz;
    var vl = G.vx * rx + G.vz * rz;

    if (G.grounded) {
      if (throttle > 0) vf += throttle * ENGINE * dt * (1 - clamp(vf / MAX_FWD, 0, 0.92));
      else if (throttle < 0) {
        if (vf > 1) vf -= BRAKE * dt;
        else vf += throttle * ENGINE * 0.5 * dt * (1 - clamp(-vf / MAX_REV, 0, 0.9));
      }
      if (hand) vf -= Math.sign(vf) * 26 * dt;
      vf -= vf * DRAG * dt;
      if (Math.abs(vf) < 0.4 && throttle === 0) vf = 0;
      else vf -= Math.sign(vf) * ROLL * dt;
      vf = clamp(vf, -MAX_REV, MAX_FWD);

      var grip = hand ? GRIP_HAND : GRIP;
      vl -= vl * grip * dt;

      var auth = clamp(Math.abs(vf) / 11, 0, 1) * (1 - clamp(Math.abs(vf) / (MAX_FWD * 2.4), 0, 0.45));
      G.h += steer * TURN * auth * dt * (vf < -0.5 ? -1 : 1);
    } else {
      G.h += steer * 0.9 * dt;
    }

    G.vx = fx * vf + rx * vl;
    G.vz = fz * vf + rz * vl;
    G.x += G.vx * dt;
    G.z += G.vz * dt;

    // vertical / ramps
    var rh = rampHeight(G.x, G.z);
    var ground = rh ? rh.h : 0;
    if (G.grounded) {
      if (rh) {
        var rise = ground - G.y;
        G.y = ground;
        G.pitch = lerp(G.pitch, -Math.atan(rh.slope), 10 * dt);
        if (rise < -0.4) { G.grounded = false; G.vy = Math.abs(vf) * rh.slope * 0.9; }
      } else if (G.y > 0.05) {
        G.grounded = false; G.vy = 0;
      } else {
        G.y = 0;
        G.pitch = lerp(G.pitch, 0, 8 * dt);
      }
    }
    if (!G.grounded) {
      G.vy -= GRAVITY * dt;
      G.y += G.vy * dt;
      G.pitch = lerp(G.pitch, clamp(-G.vy * 0.02, -0.5, 0.5), 3 * dt);
      if (G.y <= ground) {
        G.y = ground; G.vy = 0; G.grounded = true;
        if (Math.abs(vf) > 20) { Audio.crash(); G.shake = 0.4; }
      }
    }

    collide();
    bounds();

    carMesh.position.set(G.x, G.y, G.z);
    carMesh.rotation.set(G.pitch, G.h, clamp(-vl * 0.012, -0.16, 0.16));
    blob.position.set(G.x, ground + 0.03, G.z);
    blob.material.opacity = clamp(0.42 - (G.y - ground) * 0.05, 0, 0.42);

    var rpm = clamp(Math.abs(vf) / MAX_FWD, 0, 1);
    Audio.engine(rpm, clamp(Math.abs(throttle), 0, 1));
    Audio.siren(G.stars > 0 && police.length > 0, performance.now() / 1000);
  }

  function collide() {
    if (G.y > 8) return;
    var r = 1.5;
    var ci = Math.floor(G.x / CELL), cj = Math.floor(G.z / CELL);
    for (var i = ci - 1; i <= ci + 1; i++) {
      for (var j = cj - 1; j <= cj + 1; j++) {
        var list = bGrid[key(i, j)];
        if (!list) continue;
        for (var k = 0; k < list.length; k++) {
          var b = list[k];
          if (G.y > b.h) continue;
          var minx = b.x - b.w / 2 - r, maxx = b.x + b.w / 2 + r;
          var minz = b.z - b.d / 2 - r, maxz = b.z + b.d / 2 + r;
          if (G.x > minx && G.x < maxx && G.z > minz && G.z < maxz) {
            var px = Math.min(maxx - G.x, G.x - minx);
            var pz = Math.min(maxz - G.z, G.z - minz);
            var sp = Math.hypot(G.vx, G.vz);
            if (px < pz) {
              G.x += (G.x > b.x ? px : -px);
              G.vx *= -0.22; G.vz *= 0.55;
            } else {
              G.z += (G.z > b.z ? pz : -pz);
              G.vz *= -0.22; G.vx *= 0.55;
            }
            if (sp > 9) {
              Audio.crash();
              G.shake = Math.min(1, sp / 45);
              G.damage = Math.min(100, G.damage + sp * 0.12);
            }
          }
        }
      }
    }
  }

  function bounds() {
    var pad = 12;
    if (G.x < -pad) { G.x = -pad; G.vx = Math.abs(G.vx) * 0.3; }
    if (G.x > WORLD + pad) { G.x = WORLD + pad; G.vx = -Math.abs(G.vx) * 0.3; }
    if (G.z < -pad) { G.z = -pad; G.vz = Math.abs(G.vz) * 0.3; }
    if (G.z > WORLD + pad) { G.z = WORLD + pad; G.vz = -Math.abs(G.vz) * 0.3; }
  }

  // ---------------------------------------------------------- camera
  function updateCamera(dt) {
    var sp = Math.hypot(G.vx, G.vz);
    var back = camMode === 0 ? 12.5 : 7.2;
    var up = camMode === 0 ? 5.4 : 3.0;
    var tx = G.x - Math.sin(G.h) * back;
    var tz = G.z - Math.cos(G.h) * back;
    var ty = G.y + up + sp * 0.03;
    var k = 1 - Math.pow(0.0016, dt);
    camera.position.x = lerp(camera.position.x, tx, k);
    camera.position.y = lerp(camera.position.y, ty, k);
    camera.position.z = lerp(camera.position.z, tz, k);
    if (G.shake > 0) {
      camera.position.x += rnd(-1, 1) * G.shake;
      camera.position.y += rnd(-1, 1) * G.shake * 0.6;
      camera.position.z += rnd(-1, 1) * G.shake;
      G.shake = Math.max(0, G.shake - dt * 2.2);
    }
    camera.lookAt(G.x + Math.sin(G.h) * 8, G.y + 1.6, G.z + Math.cos(G.h) * 8);
    camera.fov = lerp(camera.fov, 62 + clamp(sp / MAX_FWD, 0, 1) * 16, 3 * dt);
    camera.updateProjectionMatrix();
  }

  // ---------------------------------------------------------- hud
  var el = {};
  function updateHUD(dt) {
    var sp = Math.hypot(G.vx, G.vz) * 3.1;
    el.speed.textContent = Math.round(sp);
    el.cash.textContent = "$" + G.cash.toLocaleString();
    el.deliv.textContent = G.deliveries;
    var s = "";
    for (var i = 0; i < 5; i++) s += i < G.stars ? "★" : "☆";
    el.stars.textContent = s;
    el.stars.className = "stars" + (G.stars > 0 ? " hot" : "");
    if (G.hasCargo) {
      el.timer.style.display = "";
      el.timer.textContent = G.timer.toFixed(1) + "s";
      el.timer.className = "timer" + (G.timer < 6 ? " low" : "");
    } else el.timer.style.display = "none";
    el.dmgbar.style.width = G.damage + "%";

    if (toastT > 0) { toastT -= dt; if (toastT <= 0) toastEl.style.opacity = 0; }
    drawMini();
  }

  var mini, mctx;
  function drawMini() {
    var W = mini.width, H = mini.height, R = 190;
    mctx.clearRect(0, 0, W, H);
    mctx.save();
    mctx.translate(W / 2, H / 2);
    mctx.rotate(-G.h);
    var s = (W / 2) / R;
    mctx.scale(s, s);
    mctx.translate(-G.x, -G.z);

    mctx.strokeStyle = "rgba(120,140,190,0.34)";
    mctx.lineWidth = 5;
    for (var i = 0; i <= GRID; i++) {
      mctx.beginPath(); mctx.moveTo(i * CELL, -CELL); mctx.lineTo(i * CELL, WORLD + CELL); mctx.stroke();
      mctx.beginPath(); mctx.moveTo(-CELL, i * CELL); mctx.lineTo(WORLD + CELL, i * CELL); mctx.stroke();
    }
    mctx.fillStyle = G.hasCargo ? "#2fe08a" : "#ffb020";
    mctx.beginPath(); mctx.arc(G.mx, G.mz, 9, 0, 6.29); mctx.fill();

    mctx.fillStyle = "#ff3355";
    police.forEach(function (p) { mctx.beginPath(); mctx.arc(p.x, p.z, 6, 0, 6.29); mctx.fill(); });
    mctx.fillStyle = "rgba(210,220,240,0.55)";
    traffic.forEach(function (t) { mctx.beginPath(); mctx.arc(t.x, t.z, 4, 0, 6.29); mctx.fill(); });
    mctx.restore();

    mctx.save();
    mctx.translate(W / 2, H / 2);
    mctx.fillStyle = "#7fe8ff";
    mctx.beginPath();
    mctx.moveTo(0, -9); mctx.lineTo(6, 7); mctx.lineTo(0, 3.5); mctx.lineTo(-6, 7);
    mctx.closePath(); mctx.fill();
    mctx.restore();
  }

  // ---------------------------------------------------------- loop
  function frame() {
    requestAnimationFrame(frame);
    if (!running) return;
    var dt = Math.min(0.05, clock.getDelta());
    if (paused) { renderer.render(scene, camera); return; }

    updateCar(dt);
    updateTraffic(dt);
    updatePeds(dt);
    updatePolice(dt);
    checkMission(dt);
    updateCamera(dt);
    updateHUD(dt);

    if (G.stars > 0 && police.length === 0) spawnPolice();
    G.heat = Math.max(0, G.heat - dt * (police.length ? 0.9 : 4.5));
    G.stars = clamp(Math.floor(G.heat / 18), 0, 5);
    G.damage = Math.max(0, G.damage - dt * 0.8);

    pickupMesh.rotation.y += dt * 1.6;
    pickupMesh.position.y = 1.2 + Math.sin(performance.now() / 400) * 0.35;

    renderer.render(scene, camera);
  }

  // ---------------------------------------------------------- setup
  function init() {
    var host = document.getElementById("stage");
    scene = new THREE.Scene();
    scene.fog = new THREE.Fog(0x18173a, 90, 560);

    camera = new THREE.PerspectiveCamera(62, innerWidth / innerHeight, 0.4, 3000);
    renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
    renderer.setPixelRatio(Math.min(devicePixelRatio, 1.75));
    renderer.setSize(innerWidth, innerHeight);
    if (THREE.sRGBEncoding) renderer.outputEncoding = THREE.sRGBEncoding;
    host.appendChild(renderer.domElement);
    clock = new THREE.Clock();

    scene.add(new THREE.HemisphereLight(0x8899ff, 0x241a3a, 0.85));
    var sun = new THREE.DirectionalLight(0xffb488, 0.75);
    sun.position.set(-260, 180, -420);
    scene.add(sun);
    var rim = new THREE.DirectionalLight(0x5566ff, 0.35);
    rim.position.set(300, 140, 300);
    scene.add(rim);

    buildSky();
    buildGround();
    buildWater();
    buildCity();
    buildRamps();

    carMesh = buildCarMesh(0xe8355a, false);
    scene.add(carMesh);
    blob = new THREE.Mesh(
      new THREE.CircleGeometry(2.4, 16),
      new THREE.MeshBasicMaterial({ color: 0x000010, transparent: true, opacity: 0.42 })
    );
    blob.rotation.x = -Math.PI / 2;
    scene.add(blob);

    pickupMesh = new THREE.Mesh(
      new THREE.OctahedronGeometry(1.9),
      new THREE.MeshBasicMaterial({ color: 0xffb020, transparent: true, opacity: 0.9 })
    );
    scene.add(pickupMesh);
    beamMesh = new THREE.Mesh(
      new THREE.CylinderGeometry(1.5, 1.5, 60, 10, 1, true),
      new THREE.MeshBasicMaterial({ color: 0xffb020, transparent: true, opacity: 0.14, side: THREE.DoubleSide, depthWrite: false })
    );
    scene.add(beamMesh);

    spawnTraffic();
    spawnPeds();
    newMission();

    el.speed = document.getElementById("speed");
    el.cash = document.getElementById("cash");
    el.stars = document.getElementById("stars");
    el.timer = document.getElementById("timer");
    el.deliv = document.getElementById("deliv");
    el.dmgbar = document.getElementById("dmgbar");
    toastEl = document.getElementById("toast");
    mini = document.getElementById("mini");
    mini.width = mini.height = 190;
    mctx = mini.getContext("2d");

    camera.position.set(G.x, 8, G.z - 14);
    running = true;
    frame();
  }

  // ---------------------------------------------------------- input
  addEventListener("keydown", function (e) {
    var k = e.key.toLowerCase();
    keys[k] = true;
    if (k === "c") camMode = camMode ? 0 : 1;
    if (k === "p") paused = !paused;
    if (k === "r") respawn();
    if ([" ", "arrowup", "arrowdown", "arrowleft", "arrowright"].indexOf(k) >= 0) e.preventDefault();
  });
  addEventListener("keyup", function (e) { keys[e.key.toLowerCase()] = false; });

  function respawn() {
    var gi = irnd(0, GRID), gj = irnd(0, GRID);
    G.x = gi * CELL; G.z = gj * CELL;
    G.vx = G.vz = G.vy = 0; G.y = 0; G.grounded = true;
    G.damage = 0; G.heat = 0; G.stars = 0;
    toast("Respawned");
  }

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
        e.addEventListener(ev, function (x) { x.preventDefault(); on(); });
      });
      ["touchend", "touchcancel", "mouseup", "mouseleave"].forEach(function (ev) {
        e.addEventListener(ev, function (x) { x.preventDefault(); off(); });
      });
    }
    bind("tGas", function () { touch.t = 1; }, function () { touch.t = 0; });
    bind("tRev", function () { touch.t = -1; }, function () { touch.t = 0; });
    bind("tL", function () { touch.s = -1; }, function () { touch.s = 0; });
    bind("tR", function () { touch.s = 1; }, function () { touch.s = 0; });
    bind("tHand", function () { touch.b = 1; }, function () { touch.b = 0; });
  }

  // ---------------------------------------------------------- boot
  function boot() {
    document.getElementById("start").addEventListener("click", function () {
      if (started) return;
      started = true;
      Audio.init();
      document.getElementById("intro").style.display = "none";
      document.getElementById("hud").style.display = "";
      init();
      bindTouch();
    });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
