# Neon Bay Arcade

Original browser games that run with no install, no plugins and no downloads. Everything is a static file — open the HTML and play.

**[▶ Play Neon Bay](https://techi101.github.io/neon-bay-arcade/games/neon-bay/)** · [Arcade home](https://techi101.github.io/neon-bay-arcade/)

---

## Neon Bay

An open-world action game in a procedurally generated grid city at dusk. Drive it, walk it, shoot your way through a six-mission campaign — or ignore the campaign and tear up the city.

### On foot and behind the wheel

- **Seamless state machine** — press `F` to enter or leave any vehicle on the street. Traffic cars are all enterable; the one you take is removed from the AI pool and handed to you.
- **Third-person shooter controls on foot** — pointer-lock mouse aim, over-shoulder camera, sprint, walk-cycle animation.
- **Arcade drift driving** — forward and lateral velocity are tracked separately, so the car understeers under power and breaks loose on the handbrake. Steering authority falls off at top speed.
- **Ramps and air** — wedge ramps with real airborne physics and a pitch that follows your arc.

### Combat

- **Three weapons** — pistol, SMG, shotgun, each with its own damage, fire rate, magazine, spread and pellet count. `1` `2` `3` or `Q` to switch, `R` to reload.
- **Hitscan with real occlusion** — shots march a ray through the world, so buildings block them. Enemies are hit on a capsule test, walls throw sparks.
- **Enemy AI** — crews hold a firing distance, strafe, break line of sight around corners, and only shoot when they actually have a shot on you.
- **Health and armour** — armour soaks 70% of incoming damage until it is gone. Pickups respawn around the map.

### The city responds

- **Wanted level** — heat rises when you shoot, wreck traffic or kill. Police spawn off-screen, pursue, and start firing on you at two stars and above. Heat decays when you break away.
- **Civilians** — pedestrians wander the sidewalks and scatter when you drive at them or the sirens start.
- **Live minimap** — rotating and player-centred, showing the street grid, your objective, enemies, police and pickups.

### The campaign

Six missions with an original story — a courier working for a dispatcher named Reyes, and the crew running the north dock. Delivery runs, a timed run while wanted, camp clears, and a final assault with a boss that takes considerably more than one magazine.

### Controls

| Action | Keyboard / mouse | Touch |
|---|---|---|
| Move / drive | `W` `A` `S` `D` or arrows | ◀ ▶ GAS REV |
| Aim | Mouse (click to lock) | — |
| Fire | Left click | FIRE |
| Enter / exit vehicle | `F` | CAR |
| Sprint / handbrake | `Shift` / `Space` | RUN |
| Switch weapon | `1` `2` `3` or `Q` | — |
| Reload | `R` | — |
| Pause | `P` | — |

Touch controls appear automatically on touch devices.

---

## Running it locally

No build step and no dependencies to install:

```bash
git clone https://github.com/techi101/neon-bay-arcade.git
cd neon-bay-arcade
npx serve .
```

Then open the address it prints.

## Testing

The game renders with WebGL, which a CI box does not have — so the test harness stubs the renderer and runs everything else for real:

```bash
node tools/smoke-test.js
```

It loads the **actual** three.js build the game loads in production, mocks the browser APIs the game touches, boots the game, and steps 240 frames. It checks that:

- every `THREE.*` constructor the source names actually exists in that revision (feature-tested references behind `typeof` are exempt)
- the file evaluates, boots, and keeps requesting frames
- no exception escapes during 240 frames of simulation
- the HUD is producing finite numbers rather than `NaN`

This exists because a `THREE.CapsuleGeometry` reference — a constructor added years after the pinned revision — shipped and blanked the canvas on start. The harness catches that entire class of bug before it reaches a browser.

## How it is built

| | |
|---|---|
| Renderer | [three.js](https://threejs.org/) r128, loaded from a CDN |
| Geometry | Generated at runtime; buildings, palms and stripes use `InstancedMesh` to keep draw calls low |
| Textures | Drawn into `<canvas>` at load — window grids, sky gradient, asphalt noise |
| Audio | Web Audio oscillators, filters and noise buffers — engine, siren, gunfire, impacts |
| Build step | None. Static HTML, CSS and JS |

```
neon-bay-arcade/
├── index.html              arcade portal
├── games/
│   └── neon-bay/
│       ├── index.html      HUD, intro, touch controls
│       └── game.js         world, player, combat, AI, campaign, audio
├── tools/
│   └── smoke-test.js       headless boot-and-run test
├── LICENSE
└── README.md
```

## Deploying

The repo is a static site, so GitHub Pages serves it as-is:

**Settings → Pages → Source: Deploy from a branch → `main` / `(root)`**

## Roadmap

- [ ] Cover system and aim-down-sights
- [ ] Selectable vehicles with distinct handling
- [ ] Persistent progress via `localStorage`
- [ ] **Street Sprint** — top-down checkpoint time trial with a ghost lap
- [ ] Day/night cycle

## Licence

MIT — see [LICENSE](LICENSE).

## A note on originality

This is original work. It is **not affiliated with, endorsed by, or derived from any commercial game or franchise**, and contains no third-party game assets — no imported models, textures, audio, maps, characters or trade names. The city, the vehicles, the characters, the weapons and the sound are all generated by the code in this repository.
