// The Depths of Tartarus - 3D Game Engine (Finite-Automaton Maze)
//
// The dungeon is a Finite Automaton (states q0..q7):
//   - Rooms        = states (q0 start, q7 accept = boss)
//   - Doors        = directed transitions, each labelled by a rune (the FA alphabet)
//   - Doors are PORTALS: breaking one and stepping through warps you to the target room
//   - Intended escape route: q0 -> q2 -> q4 -> q6 -> q7
//   - Off-path rooms (q1,q3,q5) are longer detours that still funnel back to the route
//
// Each door is ALSO a CFG-gated barrier: to break it you must type a spell that
// (a) is valid under the grammar, (b) uses the door's rune, and (c) satisfies the
// door's CFG rule (terminal / nested / deep / compound).

// ---------------------------------------------------------------------------
// CFG RULE LIBRARY (per-door grammar constraints)
// ---------------------------------------------------------------------------
const DOOR_RULES = {
    terminal: {
        label: "Terminal Rune",
        test: (p) => p.valid && p.depth === 0,
        hint: (r) => `a single rune, no invoke. e.g. ${r}!`
    },
    nest: {
        label: "Nested Invocation",
        test: (p) => p.valid && p.depth >= 1,
        hint: (r) => `wrap it once. e.g. invoke(${r})!`
    },
    deep: {
        label: "Deep Recursion",
        test: (p) => p.valid && p.depth >= 2,
        hint: (r) => `nest twice (depth >= 2). e.g. invoke(invoke(${r}))!`
    },
    compound: {
        label: "Compound Fury",
        test: (p) => p.valid && p.depth >= 2 && p.fury >= 2,
        hint: (r) => `depth >= 2 AND two '+'. e.g. invoke(invoke(${r}) + SOL) + LUNA!`
    }
};

// Player collision radius and door opening half-width
const PLAYER_RADIUS = 1.2;
const DOOR_GAP_HALF = 3.0;
const WALL_HEIGHT = 12;     // tall, enclosing walls — you can't see over them
const DOOR_OPENING_H = 7;   // doorways are arched: open below this, lintel above

// ---------------------------------------------------------------------------
// GAME STATE
// ---------------------------------------------------------------------------
const state = {
    started: false,
    player: {
        hp: 100,
        maxHp: 100,
        x: 0,
        z: 93,
        rotation: 0,
        vx: 0,
        vz: 0,
        speed: 0.18,
        isCasting: false,
        isStaggering: false,
        staggerTime: 0,
        castTime: 0,
        currentRoom: 'q0',
        checkpointRoom: 'q0',
        lastDrainTick: 0
    },
    camera: {
        radius: 11,
        theta: Math.PI / 2,
        phi: Math.PI / 4,
        targetTheta: Math.PI / 2,   // smoothed-toward orbit angles (mouse sets these)
        targetPhi: Math.PI / 4,
        sensitivity: 0.0045,        // mouse-look sensitivity
        targetX: 0,
        targetY: 2,
        targetZ: 93
    },
    keys: {},
    mouse: { isDown: false, lastX: 0, lastY: 0 },

    // FA STATES (rooms q0..q7). Big chambers, spread out; doors are PORTALS between
    // them (the directed FA edges), so physical adjacency is not required.
    // kind: 'start' | 'path' (intended route) | 'maze' (off-path detour) | 'boss' (accept).
    rooms: {
        q0: { cx:   0, cz:  90, hx: 15, hz: 15, kind: 'start', name: 'Q0 · The Threshold' },
        q1: { cx: -55, cz:  55, hx: 15, hz: 15, kind: 'maze',  name: 'Q1 · Hall of Whispers' },
        q2: { cx:   0, cz:  45, hx: 15, hz: 15, kind: 'path',  name: 'Q2 · The Crossways' },
        q3: { cx:  55, cz:  55, hx: 15, hz: 15, kind: 'maze',  peril: 'trap',  name: 'Q3 · The Oubliette' },
        q5: { cx:   0, cz:   0, hx: 15, hz: 15, kind: 'maze',  peril: 'drain', name: 'Q5 · The Searing Dark' },
        q4: { cx:  60, cz:   0, hx: 15, hz: 15, kind: 'path',  name: 'Q4 · The Convergence' },
        q6: { cx: -25, cz: -45, hx: 15, hz: 15, kind: 'path',  name: 'Q6 · The Last Span' },
        q7: { cx: -75, cz: -90, hx: 26, hz: 26, kind: 'boss',  name: 'Q7 · Celestial Vault' }
    },

    // FA TRANSITIONS (directed doors). `from` room owns the physical doorway on `wall`.
    // correct:true marks the intended escape route q0->q2->q4->q6->q7.
    doors: [
        // --- intended escape route (escalating CFG rules) ---
        { id: 'e02', from: 'q0', to: 'q2', wall: 'N', rune: 'IGNIS', ruleKey: 'terminal', correct: true,  hp: 25, maxHp: 25 },
        { id: 'e24', from: 'q2', to: 'q4', wall: 'E', rune: 'AQUA',  ruleKey: 'nest',     correct: true,  hp: 40, maxHp: 40 },
        { id: 'e46', from: 'q4', to: 'q6', wall: 'W', rune: 'SOL',   ruleKey: 'deep',     correct: true,  hp: 60, maxHp: 60 },
        { id: 'e67', from: 'q6', to: 'q7', wall: 'W', rune: 'LUNA',  ruleKey: 'compound', correct: true,  hp: 80, maxHp: 80 },
        // --- off-path doors ---
        { id: 'e01', from: 'q0', to: 'q1', wall: 'W', rune: 'TERRA',  ruleKey: 'terminal', correct: false, hp: 25, maxHp: 25 }, // q1: harmless decoy
        { id: 'e03', from: 'q0', to: 'q3', wall: 'E', rune: 'VENTUS', ruleKey: 'terminal', correct: false, hp: 25, maxHp: 25 }, // q3: TRAP (sink)
        { id: 'e12', from: 'q1', to: 'q2', wall: 'N', rune: 'SOL',    ruleKey: 'terminal', correct: false, hp: 30, maxHp: 30 }, // decoy rejoins the route
        { id: 'e25', from: 'q2', to: 'q5', wall: 'S', rune: 'LUNA',   ruleKey: 'nest',     correct: false, hp: 35, maxHp: 35 }, // q5: COSTLY (drain)
        { id: 'e54', from: 'q5', to: 'q4', wall: 'E', rune: 'VENTUS', ruleKey: 'nest',     correct: false, hp: 35, maxHp: 35 }  // q5 escape -> back on route
    ],

    boss: {
        active: false,
        hp: 150, maxHp: 150,
        x: -75, z: -95,                  // dead centre of q7 (where the middle pillar was)
        shattered: false,
        requirement: "ANGELIC SHIELD: 60+ damage to pierce! It fires CONSTANTLY — cast from behind a pillar for cover!",
        lastAttackTime: 0,
        attackCooldown: 3200             // fires often, even while you type
    },

    bossPillars: [],                     // central cover pillars (set when q7 is built)

    activeDoor: null,   // door id the player is standing at, or 'BOSS'
    inConsoleMode: false,
    visitedRooms: { q0: true },  // fog-of-war for the minimap
    particles: [],
    projectiles: [],
    floatingTexts: []
};

state.doors.forEach(d => { d.broken = false; d.off = 0; });

// Three.js instances
let scene, camera, renderer;
let demonMesh, angelMesh;
let ambientLight, dirLight;
let torchLights = [];   // collected torch/lantern point-lights, for flicker

// ---------------------------------------------------------------------------
// FA HELPERS
// ---------------------------------------------------------------------------
const OPPOSITE = { N: 'S', S: 'N', E: 'W', W: 'E' };

function doorById(id) {
    return state.doors.find(d => d.id === id) || null;
}

// Physical doorways on a room = its OUTGOING doors only (you enter via a portal,
// so incoming edges have no doorway on this side).
function doorwaysOf(roomId) {
    const list = [];
    state.doors.forEach(d => {
        if (d.from === roomId) list.push({ wall: d.wall, off: d.off });
    });
    return list;
}

// Live connections out of a room: { wall, neighbor, passable, door }
function connectionsOf(roomId) {
    const list = [];
    state.doors.forEach(d => {
        if (d.from === roomId) {
            list.push({ wall: d.wall, neighbor: d.to, passable: d.broken, door: d });
        }
    });
    return list;
}

// World position of a door's barrier plane (centre of the doorway in the `from` wall).
function doorWorldPos(d) {
    const room = state.rooms[d.from];
    if (d.wall === 'N') return { x: room.cx + d.off, z: room.cz - room.hz };
    if (d.wall === 'S') return { x: room.cx + d.off, z: room.cz + room.hz };
    if (d.wall === 'E') return { x: room.cx + room.hx, z: room.cz + d.off };
    /* W */              return { x: room.cx - room.hx, z: room.cz + d.off };
}

// Floor point just inside the `from` room in front of a door (where the runic circle sits).
function doorApproachPos(d) {
    const room = state.rooms[d.from];
    if (d.wall === 'N') return { x: room.cx + d.off, z: room.cz - room.hz + 3 };
    if (d.wall === 'S') return { x: room.cx + d.off, z: room.cz + room.hz - 3 };
    if (d.wall === 'E') return { x: room.cx + room.hx - 3, z: room.cz + d.off };
    /* W */              return { x: room.cx - room.hx + 3, z: room.cz + d.off };
}

function ruleOf(d) { return DOOR_RULES[d.ruleKey]; }

function doorRequirementText(d) {
    const rule = ruleOf(d);
    return `${d.rune} DOOR · ${rule.label} — use ${d.rune}; ${rule.hint(d.rune)}`;
}

// Does a parsed spell open this door?  valid + uses the rune + satisfies the rule.
function doorCheck(d, parsed) {
    return parsed.valid && parsed.elements.includes(d.rune) && ruleOf(d).test(parsed);
}

// ---------------------------------------------------------------------------
// UI / FX HELPERS  (unchanged behaviour)
// ---------------------------------------------------------------------------
function logToConsole(message, type = 'info') {
    const consoleBody = document.getElementById('console-logs');
    if (!consoleBody) return;
    const div = document.createElement('div');
    if (type === 'success') div.className = 'log-success';
    if (type === 'error') div.className = 'log-error';
    if (type === 'gold') div.className = 'log-gold';
    div.textContent = `[${new Date().toLocaleTimeString()}] ${message}`;
    consoleBody.appendChild(div);
    consoleBody.scrollTop = consoleBody.scrollHeight;
}

function spawnFloatingText(text, x, y, z, color = 0xff3333) {
    const canvasContainer = document.getElementById('game-canvas-container');
    const floatEl = document.createElement('div');
    floatEl.style.position = 'absolute';
    floatEl.style.color = '#' + color.toString(16).padStart(6, '0');
    floatEl.style.fontFamily = "'Share Tech Mono', monospace";
    floatEl.style.fontSize = '1.8rem';
    floatEl.style.fontWeight = 'bold';
    floatEl.style.textShadow = '0 0 10px rgba(0,0,0,0.8), 0 0 5px currentColor';
    floatEl.style.pointerEvents = 'none';
    floatEl.style.transition = 'transform 1s ease-out, opacity 1s ease-out';
    floatEl.textContent = text;
    canvasContainer.appendChild(floatEl);

    state.floatingTexts.push({
        element: floatEl,
        worldPos: new THREE.Vector3(x, y, z),
        age: 0,
        maxAge: 1000
    });
}

let shakeAmount = 0;
function triggerScreenShake(amount) { shakeAmount = amount; }

// Rough, uneven dungeon rock floor — NOT tiled: blotchy dark stone, gravel,
// cracks and old dried-blood stains baked in.
function createStoneFloorTexture(bloody) {
    const c = document.createElement('canvas');
    c.width = c.height = 512;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#34353a';
    ctx.fillRect(0, 0, 512, 512);
    // large soft blotches for an uneven, worn surface
    for (let i = 0; i < 90; i++) {
        const g = 30 + Math.random() * 45;
        const r = 30 + Math.random() * 90;
        ctx.fillStyle = `rgba(${g},${g + 3},${g + 8},${0.06 + Math.random() * 0.1})`;
        ctx.beginPath();
        ctx.arc(Math.random() * 512, Math.random() * 512, r, 0, Math.PI * 2);
        ctx.fill();
    }
    // gravel speckle
    for (let i = 0; i < 5000; i++) {
        const g = 25 + Math.random() * 70;
        ctx.fillStyle = `rgba(${g},${g},${g + 5},0.5)`;
        ctx.fillRect(Math.random() * 512, Math.random() * 512, 2, 2);
    }
    // jagged cracks
    ctx.strokeStyle = 'rgba(12,12,14,0.7)';
    for (let i = 0; i < 14; i++) {
        ctx.lineWidth = 0.8 + Math.random() * 2;
        ctx.beginPath();
        let x = Math.random() * 512, y = Math.random() * 512;
        ctx.moveTo(x, y);
        for (let s = 0; s < 6; s++) { x += (Math.random() - 0.5) * 70; y += (Math.random() - 0.5) * 70; ctx.lineTo(x, y); }
        ctx.stroke();
    }
    // old dried blood stains baked into the rock
    const stains = bloody ? 5 : 2;
    for (let i = 0; i < stains; i++) {
        const cx = Math.random() * 512, cy = Math.random() * 512, R = 30 + Math.random() * 60;
        const grad = ctx.createRadialGradient(cx, cy, 2, cx, cy, R);
        grad.addColorStop(0, 'rgba(60,8,8,0.55)');
        grad.addColorStop(0.6, 'rgba(45,6,6,0.32)');
        grad.addColorStop(1, 'rgba(30,4,4,0)');
        ctx.fillStyle = grad;
        ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.fill();
        // a few droplets/streaks around it
        for (let d = 0; d < 8; d++) {
            const a = Math.random() * Math.PI * 2, dist = R * (0.6 + Math.random() * 0.7);
            ctx.fillStyle = 'rgba(48,6,6,0.4)';
            ctx.beginPath();
            ctx.arc(cx + Math.cos(a) * dist, cy + Math.sin(a) * dist, 2 + Math.random() * 5, 0, Math.PI * 2);
            ctx.fill();
        }
    }
    const t = new THREE.CanvasTexture(c);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    return t;
}

// Procedural blood-splatter decal (transparent) for scattering "here and there".
function createBloodTexture() {
    const c = document.createElement('canvas');
    c.width = c.height = 128;
    const ctx = c.getContext('2d');
    const cx = 64, cy = 64;
    const grad = ctx.createRadialGradient(cx, cy, 2, cx, cy, 50);
    grad.addColorStop(0, 'rgba(70,8,8,0.85)');
    grad.addColorStop(0.5, 'rgba(48,6,6,0.55)');
    grad.addColorStop(1, 'rgba(30,4,4,0)');
    ctx.fillStyle = grad;
    ctx.beginPath(); ctx.arc(cx, cy, 50, 0, Math.PI * 2); ctx.fill();
    for (let d = 0; d < 22; d++) {
        const a = Math.random() * Math.PI * 2, dist = 18 + Math.random() * 44;
        ctx.fillStyle = `rgba(${50 + Math.random() * 30 | 0},6,6,${0.4 + Math.random() * 0.4})`;
        ctx.beginPath();
        ctx.arc(cx + Math.cos(a) * dist, cy + Math.sin(a) * dist, 1.5 + Math.random() * 6, 0, Math.PI * 2);
        ctx.fill();
    }
    return new THREE.CanvasTexture(c);
}

// Stacked stone-brick masonry for walls.
function createBrickTexture() {
    const c = document.createElement('canvas');
    c.width = c.height = 256;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#2b2d31'; // mortar
    ctx.fillRect(0, 0, 256, 256);
    const bh = 32, bw = 64, mortar = 4;
    for (let row = 0, y = 0; y < 256; row++, y += bh) {
        const offset = (row % 2) * (bw / 2);
        for (let x = -bw; x < 256; x += bw) {
            const shade = 70 + Math.random() * 30;
            ctx.fillStyle = `rgb(${shade},${shade + 2},${shade + 6})`;
            ctx.fillRect(x + offset + mortar, y + mortar, bw - mortar * 2, bh - mortar * 2);
            // top-edge highlight + bottom shadow for depth
            ctx.fillStyle = 'rgba(255,255,255,0.06)';
            ctx.fillRect(x + offset + mortar, y + mortar, bw - mortar * 2, 3);
            ctx.fillStyle = 'rgba(0,0,0,0.25)';
            ctx.fillRect(x + offset + mortar, y + bh - mortar - 3, bw - mortar * 2, 3);
        }
    }
    const t = new THREE.CanvasTexture(c);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    return t;
}

// Aged vertical wooden planks (for door panels).
function createWoodTexture() {
    const c = document.createElement('canvas');
    c.width = c.height = 256;
    const ctx = c.getContext('2d');
    const planks = 5, pw = 256 / planks;
    for (let p = 0; p < planks; p++) {
        const base = 48 + Math.random() * 18;
        ctx.fillStyle = `rgb(${base + 18},${base},${base - 14})`;
        ctx.fillRect(p * pw, 0, pw, 256);
        // grain
        ctx.strokeStyle = 'rgba(20,12,6,0.35)';
        ctx.lineWidth = 1;
        for (let g = 0; g < 7; g++) {
            const gx = p * pw + 6 + Math.random() * (pw - 12);
            ctx.beginPath();
            ctx.moveTo(gx, 0);
            for (let y = 0; y <= 256; y += 32) ctx.lineTo(gx + Math.sin(y * 0.05) * 3, y);
            ctx.stroke();
        }
        // dark seam between planks
        ctx.fillStyle = 'rgba(0,0,0,0.55)';
        ctx.fillRect(p * pw, 0, 3, 256);
    }
    const t = new THREE.CanvasTexture(c);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    return t;
}

// A hanging iron chain: a vertical run of interlocking links (drops along -Y).
function createChain(linkCount) {
    const group = new THREE.Group();
    const linkGeo = new THREE.TorusGeometry(0.16, 0.05, 6, 10);
    const linkMat = new THREE.MeshStandardMaterial({ color: 0x32343a, roughness: 0.6, metalness: 0.9 });
    for (let i = 0; i < linkCount; i++) {
        const link = new THREE.Mesh(linkGeo, linkMat);
        link.position.y = -i * 0.26;
        link.rotation.y = (i % 2) * Math.PI / 2; // alternate links 90°
        group.add(link);
    }
    return group;
}

// Ancient stone pillar with a capital + base.
function createPillar() {
    const g = new THREE.Group();
    const stoneMat = new THREE.MeshStandardMaterial({ map: createBrickTexture(), color: 0x9a9aa2, roughness: 0.95, metalness: 0.05 });
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.85, 0.95, WALL_HEIGHT, 12), stoneMat);
    shaft.position.y = WALL_HEIGHT / 2;
    shaft.castShadow = true;
    g.add(shaft);
    const capMat = new THREE.MeshStandardMaterial({ color: 0x6f6f77, roughness: 0.9 });
    const base = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.7, 2.2), capMat);
    base.position.y = 0.35;
    g.add(base);
    const cap = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.7, 2.2), capMat);
    cap.position.y = WALL_HEIGHT - 0.35;
    g.add(cap);
    return g;
}

// A caged iron lantern hung from a wall bracket by a short chain.
// The group's origin is the wall-mount point; the lantern dangles below.
function createLantern(warm) {
    const group = new THREE.Group();
    const ironMat = new THREE.MeshStandardMaterial({ color: 0x1a1a1e, roughness: 0.55, metalness: 0.9 });
    const flameColor = warm ? 0xffb24d : 0xbfe0ff;

    // Bracket arm jutting from the wall
    const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 1.1, 6), ironMat);
    arm.rotation.z = Math.PI / 2 - 0.4;
    arm.position.set(0.45, 0.05, 0);
    group.add(arm);

    // Short chain down to the lantern
    const chain = createChain(3);
    chain.scale.set(0.6, 0.6, 0.6);
    chain.position.set(0.85, 0, 0);
    group.add(chain);

    // Lantern body hangs ~1.3 below the bracket
    const lant = new THREE.Group();
    lant.position.set(0.85, -1.3, 0);
    const topCap = new THREE.Mesh(new THREE.ConeGeometry(0.34, 0.3, 6), ironMat);
    topCap.position.y = 0.55; lant.add(topCap);
    const botCap = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.34, 0.12, 6), ironMat);
    botCap.position.y = -0.45; lant.add(botCap);
    // cage posts
    for (let i = 0; i < 4; i++) {
        const post = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.95, 4), ironMat);
        const a = i * Math.PI / 2;
        post.position.set(Math.cos(a) * 0.26, 0.05, Math.sin(a) * 0.26);
        lant.add(post);
    }
    // glowing core (the flame)
    const flame = new THREE.Mesh(
        new THREE.SphereGeometry(0.2, 8, 8),
        new THREE.MeshBasicMaterial({ color: flameColor })
    );
    flame.position.y = 0.05;
    flame.scale.y = 1.4;
    lant.add(flame);
    group.add(lant);

    const light = new THREE.PointLight(flameColor, warm ? 3.0 : 2.6, 28);
    light.position.set(0.85, -0.6, 0);
    group.add(light);

    group.userData = { flame, light, baseIntensity: light.intensity };
    return group;
}

// A pile of ancient skeletal remains lying on the floor.
function createSkeleton() {
    const g = new THREE.Group();
    const boneMat = new THREE.MeshStandardMaterial({ color: 0xd8d2c0, roughness: 0.9, metalness: 0.0 });
    // Skull
    const skull = new THREE.Mesh(new THREE.SphereGeometry(0.38, 10, 10), boneMat);
    skull.scale.set(1, 0.95, 1.15);
    skull.position.set(0, 0.32, -1.4);
    g.add(skull);
    const jaw = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.12, 0.3), boneMat);
    jaw.position.set(0, 0.16, -1.15); g.add(jaw);
    // Eye sockets
    const socketMat = new THREE.MeshBasicMaterial({ color: 0x050505 });
    [-0.13, 0.13].forEach(x => {
        const s = new THREE.Mesh(new THREE.SphereGeometry(0.08, 6, 6), socketMat);
        s.position.set(x, 0.36, -1.62); g.add(s);
    });
    // Spine + ribs
    const spine = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 1.6, 6), boneMat);
    spine.rotation.x = Math.PI / 2;
    spine.position.set(0, 0.12, -0.2); g.add(spine);
    for (let i = 0; i < 5; i++) {
        const rib = new THREE.Mesh(new THREE.TorusGeometry(0.28, 0.04, 5, 10, Math.PI), boneMat);
        rib.rotation.y = Math.PI / 2;
        rib.position.set(0, 0.1, -0.7 + i * 0.28);
        g.add(rib);
    }
    // A couple of scattered long bones
    [[-0.6, 0.5, 0.4], [0.7, -0.3, 0.7]].forEach(([x, z, rot]) => {
        const bone = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.9, 6), boneMat);
        bone.rotation.z = Math.PI / 2; bone.rotation.y = rot;
        bone.position.set(x, 0.08, z); g.add(bone);
    });
    return g;
}

// Static character GLB (no rig) loaded from an embedded model, auto-fitted to size
// and given PROCEDURAL motion (bob / hop / spin) since it has no animation clips.
const CHAR_TARGET_HEIGHT = 4.2;     // world units tall
function createDemonMesh() {
    const group = new THREE.Group();

    // Soft arcane glow pooled under the feet
    const glow = new THREE.Mesh(
        new THREE.CircleGeometry(1.3, 24),
        new THREE.MeshBasicMaterial({ color: 0xc060ff, transparent: true, opacity: 0.3, side: THREE.DoubleSide, depthWrite: false })
    );
    glow.rotation.x = -Math.PI / 2;
    glow.position.y = 0.02;
    group.add(glow);

    const bob = new THREE.Group();   // procedural bob/hop/spin wrapper
    group.add(bob);

    group.userData = { glow, bob, ready: false, dancing: false };

    const src = (typeof CHAR_URI !== 'undefined') ? CHAR_URI : 'models/char.glb';
    const loader = new THREE.GLTFLoader();
    loader.load(src, (gltf) => {
        const model = gltf.scene;
        model.traverse(o => { if (o.isMesh) { o.castShadow = true; o.frustumCulled = false; } });

        // Auto-fit: scale to target height, center horizontally, drop feet to y=0
        let box = new THREE.Box3().setFromObject(model);
        const size = new THREE.Vector3(); box.getSize(size);
        const s = CHAR_TARGET_HEIGHT / (size.y || 1);
        model.scale.setScalar(s);
        box = new THREE.Box3().setFromObject(model);
        model.position.x -= (box.min.x + box.max.x) / 2;
        model.position.z -= (box.min.z + box.max.z) / 2;
        model.position.y -= box.min.y;
        model.rotation.y = Math.PI;   // face -Z (flip if it ends up backwards)

        bob.add(model);
        group.userData.model = model;
        group.userData.ready = true;
    }, undefined, (err) => { console.warn('Character GLB failed to load:', err); });

    // A soft personal light that follows the character so the face is visible
    // in dim rooms — kept modest so it doesn't wash the colours out.
    const faceLight = new THREE.PointLight(0xfff2e6, 0.9, 12);
    faceLight.position.set(0, 3.4, -2.5);   // in front (-Z) at head height
    group.add(faceLight);

    return group;
}

// Toggle a dance spin (press B). Static model, so it's a procedural spin.
function toggleDance() {
    if (!demonMesh) return;
    const ud = demonMesh.userData;
    if (!ud.ready || state.player.hp <= 0) return;
    ud.dancing = !ud.dancing;
    if (!ud.dancing && ud.bob) ud.bob.rotation.y = 0;
}

// Boss: the Celestial Fallen Angel Warrior (static GLB, embedded). Auto-fitted,
// hovers and faces the player; userData.ready guards the loaded state.
const BOSS_TARGET_HEIGHT = 8.0;
function createAngelMesh() {
    const group = new THREE.Group();
    group.userData = { ready: false };
    const src = (typeof BOSS_URI !== 'undefined') ? BOSS_URI : 'models/boss.glb';
    const loader = new THREE.GLTFLoader();
    loader.load(src, (gltf) => {
        const m = gltf.scene;
        m.traverse(o => { if (o.isMesh) { o.castShadow = true; o.frustumCulled = false; } });
        let box = new THREE.Box3().setFromObject(m);
        const sz = new THREE.Vector3(); box.getSize(sz);
        m.scale.setScalar(BOSS_TARGET_HEIGHT / (sz.y || 1));
        box = new THREE.Box3().setFromObject(m);
        m.position.x -= (box.min.x + box.max.x) / 2;
        m.position.z -= (box.min.z + box.max.z) / 2;
        m.position.y -= box.min.y;                 // feet at group origin
        group.add(m);
        group.userData.ready = true;
    }, undefined, (err) => console.warn('Boss GLB failed to load:', err));
    return group;
}

// ---------------------------------------------------------------------------
// MAZE GEOMETRY
// ---------------------------------------------------------------------------
let wallMat, floorMat;
const roomGroups = {};   // room id -> THREE.Group (only the current room is rendered)

// Show only the given room (huge perf win + you only ever see your own chamber).
function setVisibleRoom(id) {
    for (const r in roomGroups) roomGroups[r].visible = (r === id);
}

// Build the full maze: floors + walls (arched doorways) + ceilings for every room.
function buildMaze() {
    // Rough rock floor (not tiled)
    const stoneTex = createStoneFloorTexture(false);
    stoneTex.repeat.set(1.5, 1.5);
    floorMat = new THREE.MeshStandardMaterial({
        map: stoneTex, color: 0x6e6e74, roughness: 1.0, metalness: 0.02, bumpMap: stoneTex, bumpScale: 0.12
    });
    // Off-path (maze) floors: colder, bloodier, faint violet sheen
    const mazeTex = createStoneFloorTexture(true);
    mazeTex.repeat.set(1.5, 1.5);
    const mazeFloorMat = new THREE.MeshStandardMaterial({
        map: mazeTex, color: 0x4f4b5c, roughness: 1.0, metalness: 0.03, emissive: 0x0a0414, emissiveIntensity: 0.4
    });
    // Stone-brick masonry walls
    const brickTex = createBrickTexture();
    brickTex.repeat.set(3, 3);
    wallMat = new THREE.MeshStandardMaterial({ map: brickTex, color: 0x7c7c84, roughness: 0.98, metalness: 0.03 });
    // Dark ceiling (rough rock)
    const ceilTex = createStoneFloorTexture(false);
    ceilTex.repeat.set(1.5, 1.5);
    const ceilMat = new THREE.MeshStandardMaterial({ map: ceilTex, color: 0x44444a, roughness: 1.0, metalness: 0.0, side: THREE.DoubleSide });

    const thickness = 1;
    const gapHalf = DOOR_GAP_HALF + 0.75; // visual opening half-width

    Object.entries(state.rooms).forEach(([id, room]) => {
        const fw = room.hx * 2;
        const fd = room.hz * 2;

        // Each room is its own group so we can render just the current one
        const rg = new THREE.Group();
        roomGroups[id] = rg;
        scene.add(rg);

        // Floor
        const floor = new THREE.Mesh(new THREE.PlaneGeometry(fw, fd), room.kind === 'maze' ? mazeFloorMat : floorMat);
        floor.rotation.x = -Math.PI / 2;
        floor.position.set(room.cx, 0, room.cz);
        floor.receiveShadow = true;
        rg.add(floor);

        // Ceiling — closes the room from above
        const ceil = new THREE.Mesh(new THREE.PlaneGeometry(fw, fd), ceilMat);
        ceil.rotation.x = Math.PI / 2;
        ceil.position.set(room.cx, WALL_HEIGHT, room.cz);
        rg.add(ceil);

        // Which walls have a doorway, and the lateral offset of each
        const ways = doorwaysOf(id);
        const wallGap = {};
        ways.forEach(w => { (wallGap[w.wall] = wallGap[w.wall] || []).push(w.off); });

        // Build each of the 4 walls, split around any doorway gap (with a lintel above each gap)
        ['N', 'S', 'E', 'W'].forEach(wallDir => {
            const horizontal = (wallDir === 'N' || wallDir === 'S'); // spans X
            const spanHalf = horizontal ? room.hx : room.hz;
            const fixed = wallDir === 'N' ? room.cz - room.hz
                        : wallDir === 'S' ? room.cz + room.hz
                        : wallDir === 'E' ? room.cx + room.hx
                        : room.cx - room.hx;
            const center = horizontal ? room.cx : room.cz;
            const offsets = (wallGap[wallDir] || []).slice().sort((a, b) => a - b);

            const addPanel = (s, e, yCenter, height) => {
                const len = e - s;
                if (len <= 0.05) return;
                const mid = (s + e) / 2;
                const geo = horizontal
                    ? new THREE.BoxGeometry(len, height, thickness)
                    : new THREE.BoxGeometry(thickness, height, len);
                const mesh = new THREE.Mesh(geo, wallMat);
                mesh.castShadow = true; mesh.receiveShadow = true;
                if (horizontal) mesh.position.set(mid, yCenter, fixed);
                else            mesh.position.set(fixed, yCenter, mid);
                rg.add(mesh);
            };

            // Full-height side panels between gaps...
            let cursor = center - spanHalf;
            offsets.forEach(off => {
                const gapStart = center + off - gapHalf;
                const gapEnd = center + off + gapHalf;
                if (gapStart > cursor) addPanel(cursor, gapStart, WALL_HEIGHT / 2, WALL_HEIGHT);
                // ...and a lintel above the doorway opening
                addPanel(gapStart, gapEnd, (DOOR_OPENING_H + WALL_HEIGHT) / 2, WALL_HEIGHT - DOOR_OPENING_H);
                cursor = Math.max(cursor, gapEnd);
            });
            if (cursor < center + spanHalf) addPanel(cursor, center + spanHalf, WALL_HEIGHT / 2, WALL_HEIGHT);
        });

        addRoomDressing(id, room, rg);
    });
}

// Populate a room with ancient dungeon dressing: corner pillars + chains,
// wall-hung lanterns (the room's light), skeletal remains and blood splatter.
function addRoomDressing(id, room, rg) {
    const warm = (room.kind !== 'maze');
    const inset = 1.6;
    const corners = [
        [room.cx - room.hx + inset, room.cz - room.hz + inset],
        [room.cx + room.hx - inset, room.cz - room.hz + inset],
        [room.cx - room.hx + inset, room.cz + room.hz - inset],
        [room.cx + room.hx - inset, room.cz + room.hz - inset]
    ];

    corners.forEach((c, i) => {
        const pillar = createPillar();
        pillar.position.set(c[0], 0, c[1]);
        rg.add(pillar);
        if (i % 2 === 0) {
            const chain = createChain(20);
            chain.position.set(c[0] + 0.6, WALL_HEIGHT - 0.5, c[1] + 0.6);
            rg.add(chain);
        }
    });

    // Lanterns hung on the side walls (mounted high, facing into the room)
    const lanternH = WALL_HEIGHT - 3.5;
    const mounts = [
        { x: room.cx - room.hx + 0.5, z: room.cz - room.hz * 0.45, rot: 0 },        // west wall -> juts +x into room
        { x: room.cx + room.hx - 0.5, z: room.cz + room.hz * 0.45, rot: Math.PI },  // east wall -> juts -x into room
    ];
    mounts.forEach(m => {
        const lantern = createLantern(warm);
        lantern.position.set(m.x, lanternH, m.z);
        lantern.rotation.y = m.rot;
        rg.add(lantern);
        torchLights.push(lantern.userData);
    });

    // Skeletal remains — in the maze rooms (where the lost perished) and a couple of others
    if (room.kind === 'maze' || id === 'q4' || id === 'q6') {
        const skel = createSkeleton();
        skel.position.set(room.cx + (Math.random() - 0.5) * room.hx, 0, room.cz + (Math.random() - 0.5) * room.hz);
        skel.rotation.y = Math.random() * Math.PI * 2;
        rg.add(skel);
    }

    // Scattered old blood splatter decals on the floor ("here and there")
    const bloodTex = createBloodTexture();
    const splats = room.kind === 'maze' ? 3 : (room.kind === 'boss' ? 4 : 1 + (Math.random() * 2 | 0));
    for (let i = 0; i < splats; i++) {
        const sz = 2.5 + Math.random() * 4;
        const splat = new THREE.Mesh(
            new THREE.PlaneGeometry(sz, sz),
            new THREE.MeshBasicMaterial({ map: bloodTex, transparent: true, depthWrite: false, opacity: 0.85 })
        );
        splat.rotation.x = -Math.PI / 2;
        splat.rotation.z = Math.random() * Math.PI * 2;
        splat.position.set(
            room.cx + (Math.random() - 0.5) * (room.hx * 1.5),
            0.04,
            room.cz + (Math.random() - 0.5) * (room.hz * 1.5)
        );
        rg.add(splat);
    }

    // The boss vault gets an extra cold celestial glow from on high
    if (room.kind === 'boss') {
        const celestial = new THREE.PointLight(0xbcd4ff, 3.2, 48);
        celestial.position.set(room.cx, WALL_HEIGHT - 1, room.cz);
        rg.add(celestial);

        // Central cover pillars — hide behind these to block the boss's beam.
        // Laid out in the band between the player's entrance (south) and the boss (north).
        const cx = room.cx, cz = room.cz;
        // Ring of cover pillars AROUND the boss (centre kept clear — the boss stands there)
        const layout = [
            [cx - 13, cz + 4], [cx + 13, cz + 4],
            [cx - 20, cz - 5], [cx + 20, cz - 5],
            [cx - 13, cz - 14], [cx + 13, cz - 14]
        ];
        state.bossPillars = [];
        layout.forEach(([x, z]) => {
            const p = createPillar();
            p.position.set(x, 0, z);
            rg.add(p);
            state.bossPillars.push({ x, z, r: 2.0 });   // cover radius for line-of-sight
        });
    }
}

// Is the player shielded from the boss by a cover pillar? (pillar intersects the
// boss->player line). Uses point-to-segment distance against each pillar.
function isBehindCover(px, pz, bx, bz) {
    for (const p of state.bossPillars) {
        const dx = px - bx, dz = pz - bz;
        const len2 = dx * dx + dz * dz;
        if (len2 < 0.01) continue;
        let t = ((p.x - bx) * dx + (p.z - bz) * dz) / len2;
        t = Math.max(0, Math.min(1, t));
        const cxp = bx + t * dx, czp = bz + t * dz;
        const d = Math.hypot(p.x - cxp, p.z - czp);
        if (d < p.r) return true;
    }
    return false;
}

// Door barriers (holy light) + runic approach circles
let doorVisuals = {}; // door id -> { group, circle, seals }

// An ancient banded-wood door sealed shut with seams of celestial light.
function buildWoodDoor(celestialColor) {
    const group = new THREE.Group();
    const doorW = (DOOR_GAP_HALF + 0.75) * 2 + 0.3; // fully covers the doorway gap (no side peek)
    const doorH = DOOR_OPENING_H + 0.4;             // overlaps the lintel so there's no top gap

    // Wood plank panel (split into two leaves with a central seam)
    const woodTex = createWoodTexture();
    const woodMat = new THREE.MeshStandardMaterial({ map: woodTex, color: 0x8a6b4a, roughness: 0.9, metalness: 0.05 });
    const leafW = doorW / 2 - 0.04;
    [-1, 1].forEach(sgn => {
        const leaf = new THREE.Mesh(new THREE.BoxGeometry(leafW, doorH, 0.5), woodMat);
        leaf.position.set(sgn * (leafW / 2 + 0.04), doorH / 2, 0);
        leaf.castShadow = true;
        group.add(leaf);
    });

    // Iron bands + bolts
    const ironMat = new THREE.MeshStandardMaterial({ color: 0x1c1c20, roughness: 0.55, metalness: 0.9 });
    [doorH * 0.22, doorH * 0.78].forEach(by => {
        const band = new THREE.Mesh(new THREE.BoxGeometry(doorW + 0.1, 0.45, 0.62), ironMat);
        band.position.set(0, by, 0);
        group.add(band);
    });
    // Central iron ring handles
    const ringGeo = new THREE.TorusGeometry(0.35, 0.07, 6, 16);
    [-1, 1].forEach(sgn => {
        const ring = new THREE.Mesh(ringGeo, ironMat);
        ring.position.set(sgn * 0.7, doorH / 2, 0.32);
        group.add(ring);
    });

    // Celestial seal: glowing seams that lock the door (cross of light)
    const sealMat = new THREE.MeshBasicMaterial({ color: celestialColor, transparent: true, opacity: 0.9 });
    const vSeam = new THREE.Mesh(new THREE.BoxGeometry(0.12, doorH, 0.66), sealMat);
    vSeam.position.set(0, doorH / 2, 0);
    group.add(vSeam);
    const hSeam = new THREE.Mesh(new THREE.BoxGeometry(doorW, 0.12, 0.66), sealMat);
    hSeam.position.set(0, doorH / 2, 0);
    group.add(hSeam);
    // Glowing frame around the doorway
    const frameMat = new THREE.MeshBasicMaterial({ color: celestialColor, transparent: true, opacity: 0.55 });
    const fT = new THREE.Mesh(new THREE.BoxGeometry(doorW + 0.3, 0.18, 0.7), frameMat); fT.position.set(0, doorH, 0); group.add(fT);
    const fL = new THREE.Mesh(new THREE.BoxGeometry(0.18, doorH, 0.7), frameMat); fL.position.set(-doorW / 2, doorH / 2, 0); group.add(fL);
    const fR = fL.clone(); fR.position.x = doorW / 2; group.add(fR);

    group.userData.seals = [vSeam, hSeam, fT, fL, fR];
    return group;
}

function buildDoors() {
    state.doors.forEach(d => {
        const pos = doorWorldPos(d);
        const horizontal = (d.wall === 'N' || d.wall === 'S');
        const celestial = d.correct ? 0x8fe8ff : 0xc77dff; // correct = pale celestial blue, wrong = violet

        const rg = roomGroups[d.from] || scene;   // door lives in its from-room group
        const group = buildWoodDoor(celestial);
        group.position.set(pos.x, 0, pos.z);
        if (!horizontal) group.rotation.y = Math.PI / 2;
        rg.add(group);

        // Faint runic approach circle on the floor inside the from-room
        const ap = doorApproachPos(d);
        const circle = new THREE.Mesh(
            new THREE.RingGeometry(2.0, 2.2, 40),
            new THREE.MeshBasicMaterial({ color: celestial, side: THREE.DoubleSide, transparent: true, opacity: 0.7 })
        );
        circle.rotation.x = -Math.PI / 2;
        circle.position.set(ap.x, 0.05, ap.z);
        rg.add(circle);

        doorVisuals[d.id] = { group, circle, seals: group.userData.seals };
    });
}

// ---------------------------------------------------------------------------
// SCENE INIT
// ---------------------------------------------------------------------------
function init3D() {
    const container = document.getElementById('game-canvas-container');
    const width = container.clientWidth;
    const height = container.clientHeight;

    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x070809);   // cold near-black stone
    scene.fog = new THREE.FogExp2(0x070809, 0.02);

    camera = new THREE.PerspectiveCamera(60, width / height, 0.1, 1000);

    renderer = new THREE.WebGLRenderer({ canvas: document.getElementById('game-canvas'), antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5)); // cap for performance
    renderer.setSize(width, height);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.12;

    // Dim, cold dungeon fill — the lanterns do the real lighting now.
    ambientLight = new THREE.AmbientLight(0x2a313e, 1.05);
    scene.add(ambientLight);

    // Faint moonlight (mostly blocked by ceilings; lights exterior bedrock through doorways)
    dirLight = new THREE.DirectionalLight(0x8090aa, 0.55);
    dirLight.position.set(12, 36, 14);
    dirLight.castShadow = true;
    dirLight.shadow.mapSize.width = 1024;
    dirLight.shadow.mapSize.height = 1024;
    dirLight.shadow.camera.left = -95;
    dirLight.shadow.camera.right = 95;
    dirLight.shadow.camera.top = 95;
    dirLight.shadow.camera.bottom = -95;
    scene.add(dirLight);

    // Vast dark bedrock under the whole dungeon, so any glimpse past a wall
    // shows stone fading into fog instead of empty black void.
    const bedrock = new THREE.Mesh(
        new THREE.PlaneGeometry(600, 600),
        new THREE.MeshStandardMaterial({ color: 0x0d0e12, roughness: 1.0, metalness: 0.0 })
    );
    bedrock.rotation.x = -Math.PI / 2;
    bedrock.position.y = -0.08;
    bedrock.receiveShadow = true;
    scene.add(bedrock);

    buildMaze();
    buildDoors();
    setVisibleRoom(state.player.currentRoom);   // start with only q0 rendered

    demonMesh = createDemonMesh();
    demonMesh.position.set(state.player.x, 0, state.player.z);
    scene.add(demonMesh);

    angelMesh = createAngelMesh();
    angelMesh.position.set(state.boss.x, 0, state.boss.z);
    angelMesh.visible = false;
    scene.add(angelMesh);

    // Event listeners
    window.addEventListener('resize', onWindowResize);

    // Free-look: the camera turns as the mouse MOVES — no clicking/holding needed.
    container.addEventListener('mousemove', (e) => {
        if (!state.started || state.inConsoleMode || mapOpen) return;
        let dx = e.movementX, dy = e.movementY;
        if (dx === undefined || dy === undefined) {  // fallback if movementX unsupported
            dx = e.clientX - state.mouse.lastX;
            dy = e.clientY - state.mouse.lastY;
        }
        state.mouse.lastX = e.clientX;
        state.mouse.lastY = e.clientY;
        const s = state.camera.sensitivity;
        state.camera.targetTheta -= dx * s;
        state.camera.targetPhi += dy * s;
        // Keep the camera below the ceiling (no top-down peeking over walls)
        state.camera.targetPhi = Math.max(0.5, Math.min(Math.PI / 2 - 0.05, state.camera.targetPhi));
    });

    window.addEventListener('keydown', (e) => {
        state.keys[e.key.toLowerCase()] = true;
        if (e.key === 'Enter' && !state.inConsoleMode && state.activeDoor !== null) {
            enterConsoleMode();
        }
        if ((e.key === 'm' || e.key === 'M') && !state.inConsoleMode) toggleMap();
        if (e.key === 'Escape' && mapOpen) toggleMap();
        if ((e.key === 'b' || e.key === 'B') && !state.inConsoleMode && !mapOpen) toggleDance();
        // DEV preview hotkeys (remove later): O = win screen, P = death screen, T = jump to boss
        if ((e.key === 'o' || e.key === 'O') && !state.inConsoleMode) shatterBoss();
        if ((e.key === 'p' || e.key === 'P') && !state.inConsoleMode) triggerDeath();
        if ((e.key === 't' || e.key === 'T') && !state.inConsoleMode && demonMesh) {
            const q = state.rooms.q7;
            state.player.currentRoom = 'q7';
            state.player.checkpointRoom = 'q7';
            setVisibleRoom('q7');
            state.player.x = q.cx; state.player.z = q.cz + q.hz * 0.4;
            state.player.vx = 0; state.player.vz = 0;
            demonMesh.position.set(state.player.x, 0, state.player.z);
            state.player.hp = state.player.maxHp;
            document.getElementById('hp-bar').style.width = '100%';
            document.getElementById('hp-text').textContent = `${state.player.hp} / ${state.player.maxHp}`;
            if (!state.boss.active && !state.boss.shattered) spawnBoss();
            logToConsole("DEV: teleported to Q7 — the boss awaits.", 'gold');
        }
    });
    window.addEventListener('keyup', (e) => { state.keys[e.key.toLowerCase()] = false; });

    const loader = document.getElementById('loader');
    if (loader) loader.classList.add('hidden');
}

function onWindowResize() {
    const container = document.getElementById('game-canvas-container');
    const width = container.clientWidth;
    const height = container.clientHeight;
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    renderer.setSize(width, height);
}

// ---------------------------------------------------------------------------
// RUNIC CONSOLE
// ---------------------------------------------------------------------------
function enterConsoleMode() {
    state.inConsoleMode = true;
    state.keys = {};

    const terminal = document.getElementById('runic-terminal-container');
    const input = document.getElementById('incantation-input');
    terminal.classList.remove('hidden');
    input.disabled = false;
    input.value = '';
    // Focus WITHOUT letting the browser scroll the page to reveal the input
    // (that scroll is what pushed the view up and cut off the top).
    setTimeout(() => {
        input.focus({ preventScroll: true });
        window.scrollTo(0, 0);
    }, 100);

    const targetStats = document.getElementById('target-stats');
    const targetName = document.getElementById('target-name');
    const targetHpText = document.getElementById('target-hp-text');
    const targetHpBar = document.getElementById('target-hp-bar');
    const targetRequirement = document.getElementById('target-requirement');
    targetStats.classList.remove('hidden');

    if (state.activeDoor === 'BOSS') {
        targetName.textContent = "CELESTIAL ARCHANGEL";
        targetHpText.textContent = `${state.boss.hp} / ${state.boss.maxHp}`;
        targetHpBar.style.width = `${(state.boss.hp / state.boss.maxHp) * 100}%`;
        targetRequirement.textContent = state.boss.requirement;
    } else if (state.activeDoor !== null) {
        const d = doorById(state.activeDoor);
        targetName.textContent = `${d.rune} DOOR`;
        targetHpText.textContent = `${d.hp} / ${d.maxHp}`;
        targetHpBar.style.width = `${(d.hp / d.maxHp) * 100}%`;
        targetRequirement.textContent = doorRequirementText(d);
    }
}

function exitConsoleMode() {
    state.inConsoleMode = false;
    document.getElementById('runic-terminal-container').classList.add('hidden');
    const input = document.getElementById('incantation-input');
    input.disabled = true;
    input.blur();
    if (state.activeDoor === null) {
        document.getElementById('target-stats').classList.add('hidden');
    }
}

document.querySelectorAll('.rune-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        const input = document.getElementById('incantation-input');
        const rune = btn.getAttribute('data-rune');
        if (!input.disabled) {
            const startPos = input.selectionStart;
            const endPos = input.selectionEnd;
            const text = input.value;
            input.value = text.substring(0, startPos) + rune + text.substring(endPos);
            input.focus({ preventScroll: true });
            if (rune === 'invoke()') input.setSelectionRange(startPos + 7, startPos + 7);
            else input.setSelectionRange(startPos + rune.length, startPos + rune.length);
            updateLiveFormula();
        }
    });
});

function updateLiveFormula() {
    const input = document.getElementById('incantation-input').value;
    const formulaBase = document.getElementById('formula-base');
    const formulaDepth = document.getElementById('formula-depth');
    const formulaFury = document.getElementById('formula-fury');
    const formulaTotal = document.getElementById('formula-total');
    const parsed = processSpell(input);

    if (parsed.valid) {
        formulaBase.textContent = BASE_DAMAGE;
        formulaDepth.textContent = `(1 + ${parsed.depth}) = ${1 + parsed.depth}`;
        formulaFury.textContent = `(1 + ${parsed.fury}) = ${1 + parsed.fury}`;
        formulaTotal.textContent = parsed.damage;
        formulaTotal.style.color = '#55ff55';
        formulaTotal.style.textShadow = '0 0 10px rgba(85, 255, 85, 0.8)';
    } else {
        formulaBase.textContent = BASE_DAMAGE;
        formulaDepth.textContent = '1.0 (invalid)';
        formulaFury.textContent = '1.0 (invalid)';
        formulaTotal.textContent = '0 (FIZZLE)';
        formulaTotal.style.color = 'var(--color-red-glow)';
        formulaTotal.style.textShadow = '0 0 10px rgba(255, 42, 42, 0.8)';
    }
}
document.getElementById('incantation-input').addEventListener('input', updateLiveFormula);

// ---------------------------------------------------------------------------
// CASTING
// ---------------------------------------------------------------------------
function castIncantation() {
    if (!state.inConsoleMode) return;
    const inputField = document.getElementById('incantation-input');
    const spellText = inputField.value.trim();
    if (!spellText) return;

    exitConsoleMode();
    state.player.isCasting = true;
    state.player.castTime = Date.now();
    audio.playCast();

    const castFlash = document.getElementById('cast-flash');
    castFlash.classList.add('flash-active');
    setTimeout(() => castFlash.classList.remove('flash-active'), 80);

    const parsed = processSpell(spellText);
    logToConsole(`Demon chants: "${spellText}"`);

    setTimeout(() => {
        if (state.activeDoor === 'BOSS') {
            if (parsed.valid && parsed.damage >= 60) {
                state.boss.hp = Math.max(0, state.boss.hp - parsed.damage);
                logToConsole(`HELLFIRE BURST! Hits Celestial Archangel for ${parsed.damage} DMG!`, 'success');
                audio.playSuccess(parsed.damage);
                spawnFloatingText(`-${parsed.damage}`, state.boss.x, 3, state.boss.z, 0x55ff55);
                triggerScreenShake(parsed.damage / 60);
                document.getElementById('target-hp-bar').style.width = `${(state.boss.hp / state.boss.maxHp) * 100}%`;
                document.getElementById('target-hp-text').textContent = `${state.boss.hp} / ${state.boss.maxHp}`;
                spawnProjectile(demonMesh.position, new THREE.Vector3(state.boss.x, 3, state.boss.z), 0xff2200);
                if (state.boss.hp <= 0) shatterBoss();
            } else {
                const errorMsg = parsed.error || "Spell damage below 60! Shield deflected the strike.";
                logToConsole(`FIZZLE: ${errorMsg}`, 'error');
                audio.playFailure();
                applyPlayerDamage(25, "Holy Deflection");
            }
        } else if (state.activeDoor !== null) {
            const d = doorById(state.activeDoor);
            if (doorCheck(d, parsed)) {
                d.hp = Math.max(0, d.hp - parsed.damage);
                logToConsole(`SUCCESS! ${d.rune} door takes ${parsed.damage} DMG!`, 'success');
                audio.playSuccess(parsed.damage);
                const wp = doorWorldPos(d);
                spawnFloatingText(`-${parsed.damage}`, wp.x, 3, wp.z, 0x55ff55);
                triggerScreenShake(parsed.damage / 30);
                document.getElementById('target-hp-bar').style.width = `${(d.hp / d.maxHp) * 100}%`;
                document.getElementById('target-hp-text').textContent = `${d.hp} / ${d.maxHp}`;
                spawnProjectile(demonMesh.position, new THREE.Vector3(wp.x, 3, wp.z), 0xff2200);
                if (d.hp <= 0) breakDoor(d);
            } else {
                // Explain WHY it failed: wrong rune, wrong structure, or invalid syntax.
                let errorMsg;
                if (!parsed.valid) errorMsg = parsed.error;
                else if (!parsed.elements.includes(d.rune)) errorMsg = `This door only answers to ${d.rune}.`;
                else errorMsg = `Right rune, wrong form — needs ${ruleOf(d).label}.`;
                logToConsole(`FIZZLE: ${errorMsg}`, 'error');
                audio.playFailure();
                applyPlayerDamage(20, "Grammar Backlash");
            }
        }
    }, 400);
}
document.getElementById('incantation-form').addEventListener('submit', castIncantation);

function spawnProjectile(start, end, colorHex) {
    const geo = new THREE.SphereGeometry(0.4, 8, 8);
    const mat = new THREE.MeshBasicMaterial({ color: colorHex });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.copy(start);
    mesh.position.y += 1.5;
    scene.add(mesh);
    state.projectiles.push({ mesh, start: mesh.position.clone(), end: end.clone(), t: 0, speed: 0.04 });
}

function applyPlayerDamage(amount, source) {
    if (state.player.hp <= 0) return;
    state.player.hp = Math.max(0, state.player.hp - amount);
    state.player.isStaggering = true;
    state.player.staggerTime = Date.now();
    logToConsole(`Demon takes ${amount} Holy Damage from ${source}!`, 'error');
    spawnFloatingText(`-${amount}`, demonMesh.position.x, 3, demonMesh.position.z, 0xff2222);
    triggerScreenShake(amount / 20);
    const flash = document.getElementById('damage-flash');
    flash.classList.add('flash-active');
    setTimeout(() => flash.classList.remove('flash-active'), 120);
    document.getElementById('hp-bar').style.width = `${(state.player.hp / state.player.maxHp) * 100}%`;
    document.getElementById('hp-text').textContent = `${state.player.hp} / ${state.player.maxHp}`;
    if (state.player.hp <= 0) triggerDeath();
}

// ---------------------------------------------------------------------------
// DOOR / FA TRANSITION
// ---------------------------------------------------------------------------
function breakDoor(d) {
    d.broken = true;
    logToConsole(`BARRIER SHATTERED! The ${d.rune} door collapses!`, 'gold');
    audio.playShatter();
    triggerScreenShake(1.5);

    const v = doorVisuals[d.id];
    if (v) v.group.visible = false;

    const wp = doorWorldPos(d);
    spawnShatterParticles(wp.x, 3, wp.z, d.correct ? 0x8a5a32 : 0xc77dff); // wood splinters / violet light

    document.getElementById('target-stats').classList.add('hidden');
    state.activeDoor = null;

    if (d.correct) {
        logToConsole(`The ${d.rune} path opens onward. Step through.`, 'success');
    } else {
        logToConsole(`A wrong rune... the ${d.rune} door yawns open. Beware what lies beyond.`, 'error');
    }
}

// Called when the player steps through a (broken) portal door into a new room.
function onEnterRoom(roomId, viaDoor) {
    const room = state.rooms[roomId];
    state.player.currentRoom = roomId;
    state.visitedRooms[roomId] = true;
    setVisibleRoom(roomId);               // render only this chamber
    state.activeDoor = null;
    document.getElementById('target-stats').classList.add('hidden');

    // Brief celestial flash on transition
    const flash = document.getElementById('cast-flash');
    if (flash) { flash.classList.add('flash-active'); setTimeout(() => flash.classList.remove('flash-active'), 120); }

    // Only SAFE rooms become respawn checkpoints (never a drain/trap room).
    const safe = !room.peril;
    if (safe) {
        state.player.checkpointRoom = roomId;
        document.getElementById('checkpoint-name').textContent = room.name;
    }

    if (room.kind === 'boss') {
        logToConsole(`You breach the ${room.name}.`, 'gold');
        if (!state.boss.active && !state.boss.shattered) spawnBoss();
    } else if (room.peril === 'trap') {
        // Sealed oubliette: no doors out. Fast bleed -> forced respawn.
        state.player.lastDrainTick = Date.now();
        logToConsole(`TRAPPED in ${room.name}! The walls seal — there is NO way out. The holy light consumes you...`, 'error');
        spawnFloatingText("SEALED", room.cx, 5, room.cz, 0xc77dff);
        triggerScreenShake(1.5);
    } else if (room.peril === 'drain') {
        // Costly chamber: HP drains, one-way. There IS an escape door — find it fast.
        state.player.lastDrainTick = Date.now();
        logToConsole(`${room.name} sears your flesh! Find the escape door FAST — there is no going back.`, 'error');
    } else if (room.kind === 'maze') {
        logToConsole(`Entered ${room.name}. This path feels... wrong.`, 'error');
    } else {
        logToConsole(`Entered ${room.name}.`, 'gold');
    }
}

function spawnBoss() {
    state.boss.active = true;
    angelMesh.visible = true;
    audio.startBossTheme();
    logToConsole("THE CELESTIAL ARCHANGEL DESCENDS! Only a spell of 60+ damage can pierce its shield.", 'error');
    spawnFloatingText("ANGELIC DESCENSION", state.boss.x, 6, state.boss.z, 0xffffff);
    triggerScreenShake(2.0);
}

function shatterBoss() {
    state.boss.shattered = true;
    state.boss.active = false;
    audio.playShatter();
    audio.stopBossTheme();
    triggerScreenShake(3.0);
    spawnShatterParticles(state.boss.x, 4, state.boss.z, 0xffeebb);
    angelMesh.visible = false;
    logToConsole("VICTORY! You have broken the Celestial Archangel and escaped Tartarus!", 'gold');

    setTimeout(() => {
        const endScreen = document.getElementById('end-screen');
        const endTitle = document.getElementById('end-title');
        const endMsg = document.getElementById('end-message');
        const endBtn = document.getElementById('end-button');
        endScreen.style.background = 'radial-gradient(circle at center, rgba(255,255,255,0.95) 0%, rgba(200,220,255,0.99) 100%)';
        endScreen.style.color = '#111';
        endTitle.textContent = "ESCAPED TARTARUS";
        endTitle.style.color = '#aa7700';
        endTitle.style.textShadow = '0 0 15px rgba(255, 204, 0, 0.6)';
        endMsg.textContent = "You spoke the true sequence of runes — IGNIS, AQUA, SOL, LUNA — broke the Archangel's shield, and clawed free of the celestial prison.";
        endBtn.textContent = "PLAY AGAIN";
        endBtn.className = "btn btn-primary";
        endBtn.style.background = "linear-gradient(135deg, #aa7700 0%, #ffcc00 100%)";
        endBtn.style.borderColor = "#ffcc00";
        // Red/black smoke background (dark red overlay for readability) + rotating character
        endScreen.style.background = "linear-gradient(rgba(20,3,5,0.5), rgba(8,1,2,0.82)), url('assets/win-bg.jpg') center / cover no-repeat";
        endScreen.style.color = '#f0d8c0';
        endTitle.style.color = '#ffcc44';
        deathVisualActive = false;
        const rc = document.getElementById('reaper-canvas');
        if (rc) rc.style.display = 'none';
        initVictoryVisual();
        victoryVisualActive = true;
        const dc = document.getElementById('dancer-canvas');
        if (dc) dc.style.display = 'block';
        endScreen.classList.remove('hidden');
    }, 2000);
}

function triggerDeath() {
    audio.playFailure();
    logToConsole("YOU DIED. Your essence recoils to the last cleared chamber...", 'error');
    const endScreen = document.getElementById('end-screen');
    const endTitle = document.getElementById('end-title');
    const endMsg = document.getElementById('end-message');
    const endBtn = document.getElementById('end-button');
    endScreen.style.background = "linear-gradient(rgba(18,3,4,0.62), rgba(6,1,1,0.9)), url('assets/win-bg.jpg') center / cover no-repeat";
    endScreen.style.color = '#e0d0d0';
    endTitle.textContent = "YOU PERISHED";
    endTitle.style.color = 'var(--color-red-glow)';
    endTitle.style.textShadow = '0 0 15px rgba(255, 42, 42, 0.7)';
    endMsg.textContent = "The blinding celestial light disintegrated your corporeal form. Your essence returns to your last checkpoint.";
    endBtn.textContent = "RESPAWN";
    endBtn.className = "btn btn-primary";
    endBtn.style.background = "";
    // Grim Reaper visual on the death pop-up; hide the victory model
    victoryVisualActive = false;
    const dc = document.getElementById('dancer-canvas'); if (dc) dc.style.display = 'none';
    initReaperVisual();
    deathVisualActive = true;
    const rc = document.getElementById('reaper-canvas');
    if (rc) rc.style.display = 'block';
    endScreen.classList.remove('hidden');
}

function respawnPlayer() {
    document.getElementById('end-screen').classList.add('hidden');
    deathVisualActive = false;
    victoryVisualActive = false;

    state.player.hp = state.player.maxHp;
    state.player.lastDrainTick = 0;

    // Return to the last SAFE room reached (its entrance)
    const room = state.rooms[state.player.checkpointRoom];
    state.player.currentRoom = state.player.checkpointRoom;
    setVisibleRoom(state.player.currentRoom);
    state.player.x = room.cx;
    state.player.z = room.cz + room.hz * 0.2;
    state.player.vx = 0;
    state.player.vz = 0;
    demonMesh.position.set(state.player.x, 0, state.player.z);

    state.doors.forEach(d => {
        // Re-seal doors leading into peril rooms, so you don't fall straight back in.
        if (state.rooms[d.to].peril) {
            d.broken = false;
            d.hp = d.maxHp;
            const v = doorVisuals[d.id];
            if (v) v.group.visible = true;
        } else if (d.hp < d.maxHp && !d.broken) {
            d.hp = d.maxHp; // heal a door that was being attacked
        }
    });

    if (state.boss.active && !state.boss.shattered) state.boss.hp = state.boss.maxHp;

    document.getElementById('hp-bar').style.width = '100%';
    document.getElementById('hp-text').textContent = `${state.player.hp} / ${state.player.maxHp}`;
    state.activeDoor = null;
    exitConsoleMode();
}

document.getElementById('end-button').addEventListener('click', () => {
    if (state.boss.shattered) window.location.reload();
    else respawnPlayer();
});

function spawnShatterParticles(x, y, z, colorHex) {
    const geo = new THREE.BoxGeometry(0.25, 0.25, 0.25);
    const mat = new THREE.MeshBasicMaterial({ color: colorHex });
    for (let i = 0; i < 40; i++) {
        const mesh = new THREE.Mesh(geo, mat);
        mesh.position.set(x + (Math.random() - 0.5) * 4, y + (Math.random() - 0.5) * 4, z + (Math.random() - 0.5) * 4);
        scene.add(mesh);
        state.particles.push({
            mesh,
            vx: (Math.random() - 0.5) * 0.3,
            vy: (Math.random() - 0.2) * 0.3,
            vz: (Math.random() - 0.5) * 0.3,
            age: 0,
            maxAge: 60 + Math.random() * 40
        });
    }
}

// ---------------------------------------------------------------------------
// MOVEMENT + ROOM-BASED COLLISION
// ---------------------------------------------------------------------------
// Resolve the player's desired position against the current room's walls,
// allowing passage through any open doorway and switching rooms on crossing.
function resolveMovement(nx, nz) {
    const cur = state.player.currentRoom;
    const room = state.rooms[cur];
    const conns = connectionsOf(cur);
    const r = PLAYER_RADIUS;

    const minX = room.cx - room.hx + r;
    const maxX = room.cx + room.hx - r;
    const minZ = room.cz - room.hz + r;
    const maxZ = room.cz + room.hz - r;

    const openOn = (wall, lateral, center) => {
        const c = conns.find(cn => cn.wall === wall && cn.passable);
        if (!c) return null;
        // lateral must be within the doorway opening
        if (Math.abs(lateral - center) > DOOR_GAP_HALF) return null;
        return c;
    };

    // X axis (E = +x wall, W = -x wall); lateral coordinate is z, gap centred at cz
    if (nx > maxX) {
        const c = openOn('E', nz, room.cz);
        if (!c) nx = maxX;
    } else if (nx < minX) {
        const c = openOn('W', nz, room.cz);
        if (!c) nx = minX;
    }
    // Z axis (N = -z wall, S = +z wall); lateral coordinate is x, gap centred at cx
    if (nz < minZ) {
        const c = openOn('N', nx, room.cx);
        if (!c) nz = minZ;
    } else if (nz > maxZ) {
        const c = openOn('S', nx, room.cx);
        if (!c) nz = maxZ;
    }

    // Did the player's centre cross a wall plane through an opening? -> change room.
    let switched = null;
    if (nx > room.cx + room.hx) switched = openOn('E', nz, room.cz);
    else if (nx < room.cx - room.hx) switched = openOn('W', nz, room.cz);
    else if (nz < room.cz - room.hz) switched = openOn('N', nx, room.cx);
    else if (nz > room.cz + room.hz) switched = openOn('S', nx, room.cx);

    if (switched) {
        // Portal: drop the player at the entrance (south side) of the target chamber,
        // so a big room must be explored to find the next door.
        const dest = state.rooms[switched.neighbor];
        onEnterRoom(switched.neighbor, switched.door);
        state.player.vx = 0;
        state.player.vz = 0;
        return { x: dest.cx, z: dest.cz + dest.hz * 0.2 };
    }

    return { x: nx, z: nz };
}

// ---------------------------------------------------------------------------
// MINIMAP  (the dungeon drawn as its finite automaton: rooms = nodes, doors = edges)
// ---------------------------------------------------------------------------
let minimapCtx = null, mapOverlayCtx = null, mapOpen = false;
let mapBounds = null;

function getMapBounds() {
    if (mapBounds) return mapBounds;
    const xs = Object.values(state.rooms).map(r => r.cx);
    const zs = Object.values(state.rooms).map(r => r.cz);
    mapBounds = { minX: Math.min(...xs), maxX: Math.max(...xs), minZ: Math.min(...zs), maxZ: Math.max(...zs) };
    return mapBounds;
}

// World (x,z) -> canvas (px,py), uniform scale, north (-z) at top.
function worldToMap(cx, cz, W, H, pad) {
    const b = getMapBounds();
    const xspan = (b.maxX - b.minX) || 1;
    const zspan = (b.maxZ - b.minZ) || 1;
    const s = Math.min((W - 2 * pad) / xspan, (H - 2 * pad) / zspan);
    const ox = (W - xspan * s) / 2;
    const oy = (H - zspan * s) / 2;
    return { x: ox + (cx - b.minX) * s, y: oy + (cz - b.minZ) * s };
}

function nodeColor(room, id) {
    if (id === state.player.currentRoom) return '#ffd24d';
    if (room.kind === 'boss') return '#bcd4ff';
    if (room.kind === 'start') return '#7cfc9a';
    if (room.kind === 'path') return '#5fb0ff';
    if (room.peril === 'trap') return '#ff5a5a';
    if (room.peril === 'drain') return '#ff9a3d';
    return '#b07cff';
}

function drawFAMap(ctx, W, H, big, time) {
    ctx.clearRect(0, 0, W, H);
    const pad = big ? 50 : 40;
    const nr = big ? 19 : 7;
    const seen = (id) => state.visitedRooms[id];

    // Edges (doors) — only from rooms you've visited, so you see your options.
    state.doors.forEach(d => {
        if (!seen(d.from)) return;
        const a = worldToMap(state.rooms[d.from].cx, state.rooms[d.from].cz, W, H, pad);
        const b = worldToMap(state.rooms[d.to].cx, state.rooms[d.to].cz, W, H, pad);
        ctx.strokeStyle = d.broken ? 'rgba(124,252,154,0.85)' : 'rgba(150,170,210,0.4)';
        ctx.lineWidth = big ? 3 : 1.5;
        ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
        if (big) {
            ctx.fillStyle = d.correct ? '#9fe0ff' : '#c9a6ff';
            ctx.font = '11px "Share Tech Mono", monospace';
            ctx.textAlign = 'center';
            ctx.fillText(d.rune, (a.x + b.x) / 2, (a.y + b.y) / 2 - 4);
        }
    });

    // Nodes (rooms)
    Object.entries(state.rooms).forEach(([id, room]) => {
        const p = worldToMap(room.cx, room.cz, W, H, pad);
        const isCur = id === state.player.currentRoom;
        if (isCur) {
            const pulse = nr + 4 + Math.sin(time * 0.006) * 3;
            ctx.strokeStyle = 'rgba(255,210,77,0.9)';
            ctx.lineWidth = 2;
            ctx.beginPath(); ctx.arc(p.x, p.y, pulse, 0, Math.PI * 2); ctx.stroke();
        }
        ctx.beginPath();
        ctx.arc(p.x, p.y, nr, 0, Math.PI * 2);
        if (seen(id)) {
            ctx.fillStyle = nodeColor(room, id);
            ctx.fill();
            if (room.kind === 'boss') { ctx.lineWidth = big ? 3 : 2; ctx.strokeStyle = '#fff'; ctx.stroke(); }
            ctx.fillStyle = '#0a0a0f';
            ctx.font = `bold ${big ? 14 : 9}px "Share Tech Mono", monospace`;
            ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
            ctx.fillText(id, p.x, p.y);
        } else {
            ctx.fillStyle = 'rgba(40,46,60,0.9)';
            ctx.fill();
            ctx.strokeStyle = 'rgba(120,130,150,0.6)';
            ctx.lineWidth = 1; ctx.setLineDash([3, 3]); ctx.stroke(); ctx.setLineDash([]);
            ctx.fillStyle = 'rgba(160,170,190,0.8)';
            ctx.font = `bold ${big ? 16 : 9}px "Share Tech Mono", monospace`;
            ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
            ctx.fillText('?', p.x, p.y);
        }
        if (big && seen(id)) {
            ctx.fillStyle = '#8fa3c8';
            ctx.font = '10px "Share Tech Mono", monospace';
            ctx.fillText(room.name.replace(/^Q\d+ · /, ''), p.x, p.y + nr + 12);
        }
    });
    ctx.textBaseline = 'alphabetic';
}

function setupMinimap() {
    if (minimapCtx) return; // once
    // Circular corner minimap
    const wrap = document.createElement('div');
    wrap.id = 'minimap-wrap';
    wrap.style.cssText = 'position:absolute;top:16px;left:16px;width:190px;height:190px;border-radius:50%;overflow:hidden;border:2px solid rgba(150,200,255,0.5);box-shadow:0 0 18px rgba(120,180,255,0.35),inset 0 0 28px rgba(0,0,0,0.85);background:rgba(8,10,16,0.85);z-index:30;';
    const cv = document.createElement('canvas');
    cv.width = 190; cv.height = 190;
    wrap.appendChild(cv);
    const lbl = document.createElement('div');
    lbl.textContent = '[M] MAP';
    lbl.style.cssText = 'position:absolute;bottom:5px;left:50%;transform:translateX(-50%);font:10px "Share Tech Mono",monospace;color:#9fc4ff;letter-spacing:1px;text-shadow:0 0 4px #000;';
    wrap.appendChild(lbl);
    document.body.appendChild(wrap);
    minimapCtx = cv.getContext('2d');

    // Big map overlay
    const overlay = document.createElement('div');
    overlay.id = 'map-overlay';
    overlay.style.cssText = 'position:absolute;inset:0;display:none;flex-direction:column;align-items:center;justify-content:center;gap:14px;background:rgba(4,6,10,0.88);z-index:60;';
    const title = document.createElement('div');
    title.textContent = 'DUNGEON AUTOMATON';
    title.style.cssText = 'font:700 22px "Cinzel",serif;color:#cfe2ff;letter-spacing:3px;text-shadow:0 0 12px rgba(120,180,255,0.6);';
    const cv2 = document.createElement('canvas');
    cv2.width = 560; cv2.height = 560;
    cv2.style.cssText = 'border:2px solid rgba(150,200,255,0.5);border-radius:12px;box-shadow:0 0 40px rgba(120,180,255,0.35);background:rgba(8,10,16,0.96);';
    const hint = document.createElement('div');
    hint.innerHTML = '<span style="color:#7cfc9a">●</span> start &nbsp; <span style="color:#5fb0ff">●</span> route &nbsp; <span style="color:#ffd24d">●</span> you &nbsp; <span style="color:#bcd4ff">●</span> boss &nbsp; <span style="color:#b07cff">●</span> off-path &nbsp; <span style="color:#ff9a3d">●</span> drain &nbsp; <span style="color:#ff5a5a">●</span> trap &nbsp;|&nbsp; green edge = opened &nbsp;|&nbsp; [M] / [Esc] close';
    hint.style.cssText = 'font:11px "Share Tech Mono",monospace;color:#9fb3d6;';
    overlay.appendChild(title);
    overlay.appendChild(cv2);
    overlay.appendChild(hint);
    document.body.appendChild(overlay);
    mapOverlayCtx = cv2.getContext('2d');
    overlay._wrap = overlay;
}

function toggleMap() {
    mapOpen = !mapOpen;
    const overlay = document.getElementById('map-overlay');
    if (overlay) overlay.style.display = mapOpen ? 'flex' : 'none';
}

// ---------------------------------------------------------------------------
// GAME LOOP
// ---------------------------------------------------------------------------
function startGame() {
    state.started = true;
    document.getElementById('start-screen').classList.add('hidden');
    document.getElementById('hud-container').classList.remove('hidden');
    setupMinimap();
    onWindowResize(); // ensure the canvas fills the window once layout has settled
    audio.init();
    logToConsole("Demon awakens at the Threshold (Q0). Three sealed doors loom — find the true path out.");
    logToConsole("Press [M] to open the dungeon map.", 'gold');
    document.getElementById('checkpoint-name').textContent = state.rooms.q0.name;
    animate();
}
document.getElementById('play-button').addEventListener('click', startGame);

// ---------------------------------------------------------------------------
// DEATH-SCREEN GRIM REAPER (small standalone 3D visual on the "YOU PERISHED" pop-up)
// ---------------------------------------------------------------------------
let reaperRenderer = null, reaperScene = null, reaperCam = null, reaperModel = null;
let reaperReady = false, deathVisualActive = false;

function initReaperVisual() {
    if (reaperRenderer) return;
    const content = document.querySelector('#end-screen .end-content');
    if (!content) return;
    const cv = document.createElement('canvas');
    cv.id = 'reaper-canvas';
    cv.width = 260; cv.height = 300;
    cv.style.cssText = 'display:block;margin:0 auto 6px;width:260px;height:300px;';
    content.insertBefore(cv, content.firstChild);

    reaperRenderer = new THREE.WebGLRenderer({ canvas: cv, antialias: true, alpha: true });
    reaperRenderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    reaperRenderer.setSize(260, 300, false);
    reaperScene = new THREE.Scene();
    reaperCam = new THREE.PerspectiveCamera(40, 260 / 300, 0.1, 100);
    reaperCam.position.set(0, 0, 5);

    reaperScene.add(new THREE.AmbientLight(0x8090b0, 1.3));
    const key = new THREE.PointLight(0xcde0ff, 2.2, 60); key.position.set(3, 4, 4); reaperScene.add(key);
    const rim = new THREE.PointLight(0xff2a3a, 1.8, 60); rim.position.set(-3, 1, -3); reaperScene.add(rim);

    const loader = new THREE.GLTFLoader();
    loader.load(REAPER_URI, (gltf) => {
        const m = gltf.scene;
        let box = new THREE.Box3().setFromObject(m);
        const sz = new THREE.Vector3(); box.getSize(sz);
        m.scale.setScalar(3.0 / (sz.y || 1));
        box = new THREE.Box3().setFromObject(m);
        m.position.x -= (box.min.x + box.max.x) / 2;
        m.position.y -= (box.min.y + box.max.y) / 2;   // center vertically for framing
        m.position.z -= (box.min.z + box.max.z) / 2;
        reaperModel = m;
        reaperScene.add(m);
        reaperReady = true;
    }, undefined, (err) => console.warn('Reaper visual failed to load:', err));
}

function renderReaper(time) {
    if (!reaperRenderer || !reaperReady) return;
    reaperModel.rotation.y = time * 0.0009;                         // slow turn
    reaperModel.position.y = (reaperModel.position.y || 0);          // (centered)
    reaperCam.lookAt(0, 0, 0);
    reaperRenderer.render(reaperScene, reaperCam);
}

// ---------------------------------------------------------------------------
// VICTORY SCREEN — a slowly rotating dark-fantasy character (like the death reaper)
// ---------------------------------------------------------------------------
let dancerRenderer = null, dancerScene = null, dancerCam = null, dancerModel = null;
let dancerReady = false, victoryVisualActive = false;

function initVictoryVisual() {
    if (dancerRenderer) return;
    const content = document.querySelector('#end-screen .end-content');
    if (!content) return;
    const cv = document.createElement('canvas');
    cv.id = 'dancer-canvas';
    cv.width = 280; cv.height = 320;
    cv.style.cssText = 'display:block;margin:0 auto 6px;width:280px;height:320px;';
    content.insertBefore(cv, content.firstChild);

    dancerRenderer = new THREE.WebGLRenderer({ canvas: cv, antialias: true, alpha: true });
    dancerRenderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    dancerRenderer.setSize(280, 320, false);
    dancerScene = new THREE.Scene();
    dancerCam = new THREE.PerspectiveCamera(40, 280 / 320, 0.1, 100);
    dancerCam.position.set(0, 0, 7);

    dancerScene.add(new THREE.AmbientLight(0x9098b0, 1.3));
    const key = new THREE.PointLight(0xffe6a0, 2.2, 60); key.position.set(3, 4, 4); dancerScene.add(key);
    const rim = new THREE.PointLight(0x88bbff, 1.6, 60); rim.position.set(-3, 2, -3); dancerScene.add(rim);

    const src = (typeof WIN_URI !== 'undefined') ? WIN_URI : 'models/winchar.glb';
    new THREE.GLTFLoader().load(src, (gltf) => {
        const m = gltf.scene;
        m.traverse(o => { if (o.isMesh) { o.castShadow = true; o.frustumCulled = false; } });
        let box = new THREE.Box3().setFromObject(m);
        const sz = new THREE.Vector3(); box.getSize(sz);
        m.scale.setScalar(4.4 / (sz.y || 1));          // bigger on the win screen
        box = new THREE.Box3().setFromObject(m);
        m.position.x -= (box.min.x + box.max.x) / 2;
        m.position.y -= (box.min.y + box.max.y) / 2;   // center for framing
        m.position.z -= (box.min.z + box.max.z) / 2;
        dancerModel = m;
        dancerScene.add(m);
        dancerReady = true;
    }, undefined, (err) => console.warn('Victory visual failed to load:', err));
}

function renderVictory(time) {
    if (!dancerRenderer || !dancerReady) return;
    dancerModel.rotation.y = time * 0.0009;        // slow turn (same feel as the reaper)
    dancerCam.lookAt(0, 0, 0);
    dancerRenderer.render(dancerScene, dancerCam);
}

let _lastFrame = 0;
function animate() {
    if (!state.started) return;
    requestAnimationFrame(animate);
    const time = Date.now();
    const dt = Math.min(0.05, (_lastFrame ? (time - _lastFrame) : 16) / 1000);
    _lastFrame = time;

    // 1. Particles
    for (let i = state.particles.length - 1; i >= 0; i--) {
        const p = state.particles[i];
        p.mesh.position.x += p.vx;
        p.mesh.position.y += p.vy;
        p.mesh.position.z += p.vz;
        p.vy -= 0.008;
        p.age++;
        if (p.age >= p.maxAge) { scene.remove(p.mesh); state.particles.splice(i, 1); }
    }

    // 2. Projectiles
    for (let i = state.projectiles.length - 1; i >= 0; i--) {
        const proj = state.projectiles[i];
        proj.t += proj.speed;
        proj.mesh.position.lerpVectors(proj.start, proj.end, Math.min(1.0, proj.t));
        proj.mesh.position.y += Math.sin(proj.t * Math.PI) * 0.8;
        if (proj.t >= 1.0) { scene.remove(proj.mesh); state.projectiles.splice(i, 1); }
    }

    // 3. Floating text overlays
    const canvasContainer = document.getElementById('game-canvas-container');
    const containerRect = canvasContainer.getBoundingClientRect();
    const tempV = new THREE.Vector3();
    for (let i = state.floatingTexts.length - 1; i >= 0; i--) {
        const ft = state.floatingTexts[i];
        ft.age += 16;
        ft.worldPos.y += 0.04;
        tempV.copy(ft.worldPos).project(camera);
        const x = (tempV.x * 0.5 + 0.5) * containerRect.width;
        const y = (tempV.y * -0.5 + 0.5) * containerRect.height;
        ft.element.style.transform = `translate(-50%, -50%) translate(${x}px, ${y}px)`;
        ft.element.style.opacity = 1.0 - (ft.age / ft.maxAge);
        if (ft.age >= ft.maxAge) { ft.element.remove(); state.floatingTexts.splice(i, 1); }
    }

    // 4. Screen shake
    if (shakeAmount > 0) {
        camera.position.x += (Math.random() - 0.5) * shakeAmount;
        camera.position.y += (Math.random() - 0.5) * shakeAmount;
        camera.position.z += (Math.random() - 0.5) * shakeAmount;
        shakeAmount *= 0.88;
        if (shakeAmount < 0.01) shakeAmount = 0;
    }

    // 5. Peril rooms bleed HP. 'drain' chambers have an escape door; 'trap' rooms don't.
    const curRoom = state.rooms[state.player.currentRoom];
    if (curRoom.peril && state.player.hp > 0 && !state.boss.shattered) {
        const rate = curRoom.peril === 'trap' ? 16 : 4; // HP per second
        if (time - state.player.lastDrainTick > 1000) {
            state.player.lastDrainTick = time;
            applyPlayerDamage(rate, curRoom.peril === 'trap' ? "The Oubliette" : "Searing Light");
        }
    }

    // 6. Player movement (room-based collision)
    if (!state.inConsoleMode && !mapOpen && state.player.hp > 0) {
        let moveX = 0, moveZ = 0;
        if (state.keys['w'] || state.keys['arrowup']) moveZ -= 1;
        if (state.keys['s'] || state.keys['arrowdown']) moveZ += 1;
        if (state.keys['a'] || state.keys['arrowleft']) moveX -= 1;
        if (state.keys['d'] || state.keys['arrowright']) moveX += 1;

        if (moveX !== 0 || moveZ !== 0) {
            const forward = new THREE.Vector3(Math.cos(state.camera.theta), 0, Math.sin(state.camera.theta)).normalize();
            const right = new THREE.Vector3(-Math.sin(state.camera.theta), 0, Math.cos(state.camera.theta)).normalize();
            const velocity = new THREE.Vector3()
                .addScaledVector(forward, moveZ)
                .addScaledVector(right, moveX)
                .normalize()
                .multiplyScalar(state.player.speed);
            state.player.vx = velocity.x;
            state.player.vz = velocity.z;
            state.player.rotation = Math.atan2(-velocity.x, -velocity.z);
        } else {
            state.player.vx *= 0.75;
            state.player.vz *= 0.75;
        }

        const resolved = resolveMovement(state.player.x + state.player.vx, state.player.z + state.player.vz);
        state.player.x = resolved.x;
        state.player.z = resolved.z;

        demonMesh.position.set(state.player.x, 0, state.player.z);
        demonMesh.rotation.y = state.player.rotation;
    }

    // 7. Player character animation — PROCEDURAL (the model is static, no rig)
    {
        const ud = demonMesh.userData;
        const speed = Math.abs(state.player.vx) + Math.abs(state.player.vz);

        if (state.player.isCasting && time - state.player.castTime > 800) state.player.isCasting = false;
        if (state.player.isStaggering && time - state.player.staggerTime > 600) state.player.isStaggering = false;

        // levitation aura on the floor: gentle constant pulse, flares while casting
        const gp = (state.player.isCasting ? 1.5 + Math.sin(time * 0.02) * 0.5 : 1) * (1 + Math.sin(time * 0.003) * 0.08);
        if (ud.glow) ud.glow.scale.set(gp, gp, gp);

        if (ud.ready && ud.bob) {
            // A levitating mage: always hovers off the ground and glides.
            const FLOAT = 0.8;

            if (ud.dancing && speed > 0.04) { ud.dancing = false; }

            if (ud.dancing) {
                ud.bob.rotation.y += dt * 5.0;                          // spin
                ud.bob.rotation.x = 0; ud.bob.rotation.z = 0;
                ud.bob.position.y = FLOAT + 0.25 + Math.abs(Math.sin(time * 0.01)) * 0.2;
            } else {
                ud.bob.rotation.y = 0;
                // lean forward into the glide (negative x tilts the top toward -Z / forward)
                const targetLean = speed > 0.02 ? -0.14 : 0.0;
                ud.bob.rotation.x += (targetLean - ud.bob.rotation.x) * 0.08;
                ud.bob.rotation.z = Math.sin(time * 0.0014) * 0.04;      // gentle drift sway

                let y;
                if (state.player.isCasting) {
                    y = FLOAT + 0.4 + Math.sin((time - state.player.castTime) * 0.015) * 0.15; // rise + channel
                } else if (state.player.isStaggering) {
                    y = FLOAT + Math.sin((time - state.player.staggerTime) * 0.05) * 0.1;       // recoil
                } else if (speed > 0.02) {
                    y = FLOAT + 0.12 + Math.sin(time * 0.004) * 0.16;    // glide sway
                } else {
                    y = FLOAT + Math.sin(time * 0.0022) * 0.13;          // idle hover
                }
                ud.bob.position.y = y;
            }
        }
    }

    // 8. Boss animation + attacks
    if (state.boss.active && !state.boss.shattered) {
        // Imposing hover + face the player (static GLB, so whole-body motion only)
        // BOSS_FACE_OFFSET corrects the model's front axis (its right was facing the player).
        const BOSS_FACE_OFFSET = -Math.PI / 2;
        angelMesh.position.y = 1.0 + Math.sin(time * 0.0016) * 0.5;
        angelMesh.rotation.y = Math.atan2(state.player.x - state.boss.x, state.player.z - state.boss.z) + BOSS_FACE_OFFSET;
        // Fires CONTINUOUSLY — even while you're typing a spell. Hide behind a pillar.
        if (time - state.boss.lastAttackTime > state.boss.attackCooldown && state.player.hp > 0) {
            state.boss.lastAttackTime = time;
            logToConsole("Celestial Archangel looses a beam of Holy Light!", 'gold');
            audio.playCast();
            spawnProjectile(angelMesh.position, demonMesh.position, 0x00ffff);
            setTimeout(() => {
                if (state.player.hp <= 0) return;
                // Pillar cover blocks the beam entirely
                if (isBehindCover(state.player.x, state.player.z, state.boss.x, state.boss.z)) {
                    logToConsole("The pillar shields you from the Holy Light!", 'success');
                    spawnFloatingText("BLOCKED", demonMesh.position.x, 3, demonMesh.position.z, 0xbcd4ff);
                    return;
                }
                // Out in the open: dodge by moving (only possible when not typing), else take the hit
                if (!state.inConsoleMode && Math.abs(state.player.vx) + Math.abs(state.player.vz) > 0.05) {
                    logToConsole("DODGED! You rolled clear of the holy blast.", 'success');
                    spawnFloatingText("DODGED", demonMesh.position.x, 3, demonMesh.position.z, 0x00ffff);
                } else {
                    applyPlayerDamage(20, "Holy Beam");
                }
            }, 1000);
        }
    }

    // 9. Nearest interactable door / boss in the current room
    let nearestDoorId = null;
    let minDistance = Infinity;
    const playerPos = new THREE.Vector3(state.player.x, 0, state.player.z);

    state.doors.forEach(d => {
        if (d.broken || d.from !== state.player.currentRoom) return;
        const ap = doorApproachPos(d);
        const dist = playerPos.distanceTo(new THREE.Vector3(ap.x, 0, ap.z));
        if (dist < minDistance) { minDistance = dist; nearestDoorId = d.id; }
    });

    let bossInRange = false;
    if (state.boss.active && !state.boss.shattered && state.rooms[state.player.currentRoom].kind === 'boss') {
        const distToBoss = playerPos.distanceTo(new THREE.Vector3(state.boss.x, 0, state.boss.z));
        if (distToBoss < 26) { bossInRange = true; minDistance = Math.min(minDistance, distToBoss); }
    }

    const prompt = document.getElementById('action-prompt');

    // Close console if the player drifts away from what they were addressing
    if (state.inConsoleMode) {
        const closeThreshold = (state.activeDoor === 'BOSS') ? 32 : 6.5;
        if (minDistance > closeThreshold) exitConsoleMode();
    }

    if (bossInRange) {
        state.activeDoor = 'BOSS';
        prompt.textContent = "PRESS [ENTER] TO INSCRIBE RUNE AT THE ARCHANGEL";
        prompt.classList.remove('hidden');
    } else if (nearestDoorId !== null && minDistance < 5.0) {
        state.activeDoor = nearestDoorId;
        const d = doorById(nearestDoorId);
        prompt.textContent = `PRESS [ENTER] TO INSCRIBE AT THE ${d.rune} DOOR`;
        prompt.classList.remove('hidden');
    } else if (!state.inConsoleMode) {
        state.activeDoor = null;
        prompt.classList.add('hidden');
        document.getElementById('target-stats').classList.add('hidden');
    }

    // Pulse runic circles + celestial seals of un-broken doors in the current room
    const sealPulse = 0.6 + Math.abs(Math.sin(time * 0.0025)) * 0.4;
    state.doors.forEach(d => {
        const v = doorVisuals[d.id];
        if (!v) return;
        const inRoom = (d.from === state.player.currentRoom && !d.broken);
        v.circle.visible = inRoom;
        if (inRoom) {
            const s = 1 + Math.sin(time * 0.004) * 0.08;
            v.circle.scale.set(s, s, s);
        }
        if (v.seals) v.seals.forEach(seal => { seal.material.opacity = (seal.geometry.parameters.height > 1 ? 0.9 : 0.55) * sealPulse; });
    });

    // Torch flame flicker
    const flick = 0.82 + Math.abs(Math.sin(time * 0.013) + Math.sin(time * 0.027)) * 0.18;
    torchLights.forEach(t => {
        t.light.intensity = t.baseIntensity * flick;
        const fs = 1 + Math.sin(time * 0.02 + t.flame.position.x) * 0.12;
        t.flame.scale.set(fs, 1.6 * fs, fs);
    });

    // 10. Camera orbit rig — smooth the look angles, then follow the player
    state.camera.theta += (state.camera.targetTheta - state.camera.theta) * 0.22;
    state.camera.phi   += (state.camera.targetPhi   - state.camera.phi)   * 0.22;
    state.camera.targetX = state.player.x;
    state.camera.targetY = 1.6;
    state.camera.targetZ = state.player.z;
    let targetCamX = state.camera.targetX + state.camera.radius * Math.sin(state.camera.phi) * Math.cos(state.camera.theta);
    let targetCamY = state.camera.targetY + state.camera.radius * Math.cos(state.camera.phi);
    let targetCamZ = state.camera.targetZ + state.camera.radius * Math.sin(state.camera.phi) * Math.sin(state.camera.theta);

    // Keep the camera INSIDE the current room (between its walls and below the ceiling),
    // so rotating never reveals anything outside the chamber.
    const cr = state.rooms[state.player.currentRoom];
    const m = 0.9;
    targetCamX = Math.max(cr.cx - cr.hx + m, Math.min(cr.cx + cr.hx - m, targetCamX));
    targetCamZ = Math.max(cr.cz - cr.hz + m, Math.min(cr.cz + cr.hz - m, targetCamZ));
    targetCamY = Math.max(1.2, Math.min(WALL_HEIGHT - 0.6, targetCamY));

    camera.position.x += (targetCamX - camera.position.x) * 0.18;
    camera.position.y += (targetCamY - camera.position.y) * 0.18;
    camera.position.z += (targetCamZ - camera.position.z) * 0.18;
    camera.lookAt(state.camera.targetX, state.camera.targetY + 1.0, state.camera.targetZ);

    // 11. Minimap (FA graph)
    if (minimapCtx) drawFAMap(minimapCtx, 190, 190, false, time);
    if (mapOpen && mapOverlayCtx) drawFAMap(mapOverlayCtx, 560, 560, true, time);

    // 12. Render
    renderer.render(scene, camera);

    // 13. End-screen visuals: grim reaper on death, dancing robot on victory
    if (deathVisualActive) renderReaper(time);
    if (victoryVisualActive) renderVictory(time);
}

// Boot the scene
if (document.readyState === 'loading') {
    window.addEventListener('DOMContentLoaded', init3D);
} else {
    init3D();
}
