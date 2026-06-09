# The Depths of Tartarus — 3D Incantation Roguelite

You are an ancient demon clawing your way out of a layered celestial prison. You cannot strike, punch, or shoot — your only weapon is **language**. You type runic incantations into a console, and a custom **language processor** (a CFG parser) decides whether your spell is valid. Valid syntax releases devastating magic and breaks the sealed doors; broken syntax lets the Holy Light burn you.

The dungeon itself is a **Finite Automaton (FA)**, and each door is gated by a **Context-Free Grammar (CFG)** rule — so navigation is an FA puzzle and combat is a CFG puzzle.

---

## 🎮 Controls
- **Move:** W / A / S / D or Arrow Keys (camera-relative)
- **Look around:** just **move the mouse** (free-look — no clicking needed)
- **Open the map:** **M** (full dungeon FA map) · **Esc** closes it
- **Dance:** **B** (procedural spin)
- **Inscribe spells:** approach a glowing runic circle in front of a door and press **Enter** to open the terminal. Type your incantation and press **Enter** or click **CAST**.
- **Dev hotkeys (temporary):** **T** = teleport straight to the boss room (q7) with the boss active & full HP, **O** = win screen, **P** = death screen

---

## ⚡ Incantation Rules (Grammar Specification)
The grammar engine (`grammar.js`) tokenizes and parses your spell with a hand-written **lexer + recursive-descent parser**.

- **Must end with `!`** — every valid incantation terminates with an exclamation point (e.g. `IGNIS!`).
- **Elements (runes):** `IGNIS, AQUA, TERRA, VENTUS, SOL, LUNA`.
- **Nesting:** wrap spells with `invoke(...)` — e.g. `invoke(IGNIS)!`. Nestable: `invoke(invoke(IGNIS))!`.
- **Fury chains:** link elements with `+` — e.g. `invoke(IGNIS) + AQUA!`.

### Damage formula
```
Damage = 10 × (1 + Nesting Depth) × (1 + Fury Count)
```
- **Nesting Depth** — the maximum depth of nested `invoke(...)`.
- **Fury Count** — the total number of `+` signs.

The parser also reports **which runes a spell uses**, because every door requires its own rune to appear in the spell.

---

## 🗺️ The Dungeon as a Finite Automaton
The dungeon is the FA below (states `q0`–`q7`). Doors are the transitions; **breaking a door and stepping through is a portal** to the next chamber.

```
   q0 ─IGNIS─▶ q2 ─AQUA─▶ q4 ─SOL─▶ q6 ─LUNA─▶ q7 (BOSS / ESCAPE)
   │            │
 TERRA│       LUNA│
   ▼            ▼
   q1 (decoy)   q5 (drain)
   │            │
 SOL│         VENTUS│
   ▼            ▼ (escape back to route)
   q2 …         q4 …
   │
 VENTUS│ (wrong)
   ▼
   q3 (TRAP / oubliette)
```

- **Intended escape route:** `q0 → q2 → q4 → q6 → q7`.
- Each room is a **big chamber** — you spawn at the entrance and must explore to find the right door.
- **Press M** to see the FA map: nodes = rooms, edges = doors with their rune, **your current room pulses gold**, and unexplored rooms are hidden (`?`, fog-of-war).

### Per-door CFG rules (escalating along the route)
Every door needs a **valid spell that (a) uses the door's rune AND (b) satisfies the door's rule**:

| Door | Rune | Rule | Example |
|------|------|------|---------|
| q0→q2 | IGNIS | **Terminal** (depth 0) | `IGNIS!` |
| q2→q4 | AQUA | **Nest** (depth ≥ 1) | `invoke(AQUA)!` |
| q4→q6 | SOL | **Deep** (depth ≥ 2) | `invoke(invoke(SOL))!` |
| q6→q7 | LUNA | **Compound** (depth ≥ 2 & fury ≥ 2) | `invoke(invoke(LUNA) + SOL) + IGNIS!` |

### Off-path rooms (three flavors)
- **q1 — harmless decoy:** `TERRA` from q0 looks like progress; it just loops back to q2. No penalty.
- **q5 — searing drain:** `LUNA` from q2 drops you into a chamber that **bleeds your HP**; one-way. Find and break the escape door fast.
- **q3 — the oubliette (true trap):** `VENTUS` from q0 is a sealed sink — no doors out, fast HP drain → forced respawn at your last safe room.

---

## 🚪 Doors & Boss
- Doors are **ancient banded-wood doors sealed with celestial light**; break them by casting a spell that meets their rune + rule.
- **The Celestial Fallen Angel Warrior** stands in the **center of the large q7 arena**, ringed by **6 stone cover pillars**. Beat it to escape.
  - **Shield:** any spell under **60 damage** is deflected — you need a compound spell (e.g. `invoke(invoke(LUNA) + SOL) + IGNIS!` = 90).
  - **It fires CONTINUOUSLY** — even while you're typing a spell. There is no "safe while the console is open" anymore.
  - **Cover is the defense:** stand so a **pillar is between you and the boss** and the beam is **BLOCKED** (no damage). Out in the open you can still **dodge by moving** (only when not typing), otherwise you take ~20 holy damage.
  - The cast range reaches from behind the ring pillars, so the loop is: **duck behind a pillar → open terminal → cast → the beam hits the pillar, not you.**

---

## 🎨 Environment & Atmosphere
- **Stone dungeon:** rough (non-tiled) rock floors with cracks & **old blood stains**, **stone-brick walls**, and **ceilings** (each room is enclosed — you only ever see the chamber you're in).
- **Lighting:** dim, cold ambient + **hanging wall lanterns** (warm on the route, cold-blue in the maze) that flicker.
- **Dressing:** ancient pillars with hanging chains, **skeletal remains**, drifting red fog.
- **Performance:** only the **current room is rendered** (huge speed win + you can't see outside the room). Camera is clamped inside the room and below the ceiling.

---

## 🧍 Characters (3D models)
- **Player — Obsidian Warden Shadow Hunter** (`lib/char.glb`): a **levitating mage** — hovers, glides with a forward lean, rises while casting, hop/flare FX, and a soft follow-light so the face stays visible. (It's a static mesh, so motion is procedural; press **B** to dance-spin.)
- **Boss — Celestial Fallen Angel Warrior** (`lib/boss.glb`): large, hovers, and turns to face you.
- Models are loaded with **GLTFLoader**, heavily **optimized** (decimated + 512px webp textures + quantized) and **embedded as data URIs** so they load over `file://`.

---

## 🏆 End Screens
- **YOU PERISHED (death):** red/black smoke background + a slowly rotating **Grim Reaper**.
- **ESCAPED TARTARUS (victory):** red/black smoke background + a slowly rotating **dark-fantasy character** + gold title.
- **Start screen:** dark red/black molten-marble background.
- (Backgrounds are free Unsplash images in `assets/`.)

---

## 🛠️ Architecture
```
index.html        – layout (start screen, HUD, terminal, end screen) + script includes
grammar.js        – CFG lexer + recursive-descent parser, damage + rune reporting, self-test suite
game.js           – Three.js engine: FA rooms/doors, movement+collision, camera, minimap,
                    casting/combat, boss, characters, procedural animation, end screens
audio.js          – procedural Web Audio synthesis (ambience, SFX, boss arpeggiator)
style.css         – dark gothic UI styling
three.min.js      – Three.js r128 (local)
lib/              – GLTFLoader/FBXLoader + the embedded model data URIs (*-data.js)
models/           – all .glb files (source uploads + optimized char/boss/reaper/win)
assets/           – background images (start / win / death)
skin/             – (legacy) earlier Minecraft-skin experiments, unused by the current build
```
- **Graphics:** Three.js (WebGL) with procedural textures, fog, flickering lanterns, shadows.
- **Audio:** HTML5 Web Audio API — no external audio files.
- **Compiler engine:** custom lexer + recursive-descent parser in vanilla JS, with helpful syntax error logs and a 10-case self-check suite (shown in the HUD diagnostics panel).

---

## ▶️ Running
Open `index.html` directly (everything works over `file://` — models, skins, and backgrounds are embedded or local). For the smoothest experience you can also serve it:
```
python3 -m http.server 8000   # then open http://localhost:8000
```

## 🧪 Quick test run
At q0 cast: `IGNIS!` → q2 `invoke(AQUA)!` → q4 `invoke(invoke(SOL))!` → q6 `invoke(invoke(LUNA) + SOL) + IGNIS!` → fight the boss with a 60+ damage spell (e.g. the same compound spell does 90).
