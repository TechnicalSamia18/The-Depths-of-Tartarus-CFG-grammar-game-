# The-Depths-of-Tartarus — CFG/FA grammar game

A 3D atmospheric roguelite where an ancient **demon** escapes a layered celestial prison by typing **runic incantations**. The dungeon is a **Finite Automaton** (rooms = states, doors = transitions) and every door is gated by a **Context-Free Grammar** rule — so you navigate an FA and fight with a CFG.

- **Twist:** a custom lexer + recursive-descent parser validates your spells. Invalid syntax → the Holy Light burns you; valid syntax → the spell breaks the sealed door.
- **Route:** `q0 → q2 → q4 → q6 → q7 (boss/escape)`. Wrong doors lead to a harmless decoy (q1), an HP-draining chamber (q5), or a sealed trap (q3).
- **Each door** needs a valid spell that uses the door's rune **and** matches its CFG rule (Terminal → Nest → Deep → Compound).

**Controls:** WASD/arrows to move · move mouse to look · **Enter** at a door to cast · **M** map · **B** dance.

**Tech:** Three.js (WebGL) 3D dungeon with only-current-room rendering, GLTF character/boss models, procedural Web Audio, and a vanilla-JS CFG engine. See `ReadMe.md` for full details.
