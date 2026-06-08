// The Depths of Tartarus - 3D Game Engine

// Game State
const state = {
    started: false,
    player: {
        hp: 100,
        maxHp: 100,
        x: 0,
        z: 30,
        rotation: 0,
        vx: 0,
        vz: 0,
        speed: 0.15,
        isCasting: false,
        isStaggering: false,
        staggerTime: 0,
        castTime: 0,
        checkpoint: { x: 0, z: 30, name: "Entrance Gate" }
    },
    camera: {
        radius: 12,
        theta: Math.PI / 2, // horizontal angle
        phi: Math.PI / 4,   // vertical angle
        targetX: 0,
        targetY: 2,
        targetZ: 30
    },
    keys: {},
    mouse: {
        isDown: false,
        lastX: 0,
        lastY: 0
    },
    barriers: [
        {
            id: 0,
            name: "Gate of Echoes",
            x: 0, z: 10,
            hp: 25, maxHp: 25,
            shattered: false,
            requirement: "Requires simple terminal spells. Try: IGNIS! or invoke(AQUA)!",
            check: (spell) => spell.valid,
            minDmg: 10
        },
        {
            id: 1,
            name: "Gate of Depths",
            x: -15, z: -10,
            hp: 50, maxHp: 50,
            shattered: false,
            requirement: "Requires nested magic (Nesting Depth >= 2). Try: invoke(invoke(TERRA))!",
            check: (spell) => spell.valid && spell.depth >= 2,
            minDmg: 20
        },
        {
            id: 2,
            name: "Gate of Fury",
            x: 15, z: -10,
            hp: 80, maxHp: 80,
            shattered: false,
            requirement: "Requires compound fury (Depth >= 2 AND Fury >= 2). Try: invoke(invoke(SOL) + LUNA) + IGNIS!",
            check: (spell) => spell.valid && spell.depth >= 2 && spell.fury >= 2,
            minDmg: 30
        }
    ],
    boss: {
        active: false,
        hp: 150, maxHp: 150,
        x: 0, z: -35,
        shattered: false,
        requirement: "ANGELIC SHIELD: Requires spell damage of 60+ to penetrate! Dodge the light beams!",
        check: (spell) => spell.valid && spell.damage >= 60,
        lastAttackTime: 0,
        attackCooldown: 8000 // 8 seconds — gives player time to open console & cast
    },
    activeGate: null,
    inConsoleMode: false,
    particles: [],
    projectiles: [],
    floatingTexts: []
};

// Three.js instances
let scene, camera, renderer;
let demonMesh, angelMesh, bridgeMesh;
let barrierMeshes = [];
let runicCircleMeshes = [];
let lavaChasmMesh;
let ambientLight, dirLight;
let playerSprite = null;

/**
 * Log message helper
 */
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

/**
 * Spawns 3D Floating text numbers above targets (barriers, boss, player)
 */
function spawnFloatingText(text, x, y, z, color = 0xff3333) {
    // We create floating elements as 3D sprites or using HTML overlay coordinates. 
    // HTML overlays are extremely performant and easy. Let's create CSS overlay floats!
    const canvasContainer = document.getElementById('game-canvas-container');
    const floatEl = document.createElement('div');
    floatEl.style.position = 'absolute';
    floatEl.style.color = '#' + color.toString(16);
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
        maxAge: 1000 // 1s
    });
}

/**
 * Screen shakes camera briefly
 */
let shakeAmount = 0;
function triggerScreenShake(amount) {
    shakeAmount = amount;
}

/**
 * Create Procedural Textures
 */
function createObsidianTexture() {
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 256;
    const ctx = canvas.getContext('2d');
    
    // Obsidian block gradient
    ctx.fillStyle = '#0f0c0c';
    ctx.fillRect(0, 0, 256, 256);
    
    // Draw crack pattern
    ctx.strokeStyle = '#220808';
    ctx.lineWidth = 2;
    for (let i = 0; i < 15; i++) {
        ctx.beginPath();
        ctx.moveTo(Math.random() * 256, Math.random() * 256);
        ctx.lineTo(Math.random() * 256, Math.random() * 256);
        ctx.stroke();
    }
    
    const texture = new THREE.CanvasTexture(canvas);
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    return texture;
}

/**
 * Create Billboard Sprite for player using the demon figure image
 */
function createDemonMesh() {
    const group = new THREE.Group();

    // Invisible collision anchor (actual 3D position tracker)
    const anchorGeo = new THREE.BoxGeometry(0.1, 0.1, 0.1);
    const anchorMat = new THREE.MeshBasicMaterial({ visible: false });
    const anchor = new THREE.Mesh(anchorGeo, anchorMat);
    group.add(anchor);

    // Billboard sprite using the player figure image
    const loader = new THREE.TextureLoader();
    const spriteMat = new THREE.SpriteMaterial({
        map: loader.load('assets/player.png'),
        transparent: true,
        alphaTest: 0.05,
        depthWrite: false
    });
    const sprite = new THREE.Sprite(spriteMat);
    sprite.scale.set(5.5, 7.5, 1); // width, height in world units
    sprite.position.set(0, 3.75, 0); // lift so feet sit on ground
    group.add(sprite);

    // Red glow under feet
    const glowGeo = new THREE.CircleGeometry(1.2, 24);
    const glowMat = new THREE.MeshBasicMaterial({ color: 0xff2200, transparent: true, opacity: 0.45, side: THREE.DoubleSide });
    const glow = new THREE.Mesh(glowGeo, glowMat);
    glow.rotation.x = -Math.PI / 2;
    glow.position.y = 0.02;
    group.add(glow);

    // Minimal userData so animation references don't crash
    group.userData = {
        sprite: sprite,
        glow: glow,
        leftWing: new THREE.Group(),
        rightWing: new THREE.Group(),
        leftLeg: new THREE.Group(),
        rightLeg: new THREE.Group(),
        body: anchor,
        head: anchor
    };

    playerSprite = sprite;
    return group;
}

/**
 * Procedurally build Angelic Boss
 */
function createAngelMesh() {
    const angelGroup = new THREE.Group();
    
    // Body (Elegantly segmented glowing white structure)
    const bodyGeo = new THREE.CylinderGeometry(0.1, 0.6, 2.5, 8);
    const bodyMat = new THREE.MeshStandardMaterial({
        color: 0xffffff,
        emissive: 0x88bbff,
        emissiveIntensity: 0.3,
        roughness: 0.1
    });
    const body = new THREE.Mesh(bodyGeo, bodyMat);
    body.position.y = 1.25;
    angelGroup.add(body);

    // Celestial Halo
    const haloGeo = new THREE.TorusGeometry(0.5, 0.06, 8, 24);
    const haloMat = new THREE.MeshBasicMaterial({ color: 0xffeebb });
    const halo = new THREE.Mesh(haloGeo, haloMat);
    halo.position.set(0, 3.2, 0);
    halo.rotation.x = Math.PI / 2;
    angelGroup.add(halo);

    // Glowing Wings (4 wings)
    const wingMat = new THREE.MeshStandardMaterial({
        color: 0xffffff,
        emissive: 0xffffff,
        emissiveIntensity: 1.0,
        transparent: true,
        opacity: 0.8
    });
    
    const wings = [];
    const wingGeo = new THREE.BoxGeometry(2.5, 0.3, 0.05);
    wingGeo.translate(1.25, 0, 0); // pivot at base

    for (let i = 0; i < 4; i++) {
        const wingMesh = new THREE.Mesh(wingGeo, wingMat);
        const wingPivot = new THREE.Group();
        wingPivot.add(wingMesh);
        
        // Arrange wings on left and right
        if (i < 2) {
            wingPivot.position.set(-0.2, 1.8 - (i * 0.5), -0.2);
            wingPivot.rotation.y = Math.PI - 0.2;
            if (i === 1) wingPivot.rotation.z = -0.3;
        } else {
            wingPivot.position.set(0.2, 1.8 - ((i - 2) * 0.5), -0.2);
            wingPivot.rotation.y = 0.2;
            wingPivot.rotation.z = Math.PI;
            if (i === 3) wingPivot.rotation.z = Math.PI + 0.3;
        }
        angelGroup.add(wingPivot);
        wings.push(wingPivot);
    }

    angelGroup.userData = { wings: wings };
    return angelGroup;
}

/**
 * Initialize 3D Scene
 */
function init3D() {
    const container = document.getElementById('game-canvas-container');
    const width = container.clientWidth;
    const height = container.clientHeight;

    // Scene
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x1a0808);
    scene.fog = new THREE.FogExp2(0x1a0808, 0.012); // lighter fog, less dense

    // Camera
    camera = new THREE.PerspectiveCamera(60, width / height, 0.1, 1000);
    
    // Renderer
    renderer = new THREE.WebGLRenderer({ canvas: document.getElementById('game-canvas'), antialias: true });
    renderer.setSize(width, height);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.6; // brighter overall

    // Lights — significantly brighter
    ambientLight = new THREE.AmbientLight(0x663322, 3.5); // strong warm ambient
    scene.add(ambientLight);

    dirLight = new THREE.DirectionalLight(0xff6633, 3.0); // brighter directional
    dirLight.position.set(10, 20, 10);
    dirLight.castShadow = true;
    dirLight.shadow.mapSize.width = 1024;
    dirLight.shadow.mapSize.height = 1024;
    scene.add(dirLight);

    // Second fill light from left
    const fillLight = new THREE.DirectionalLight(0xff3311, 2.0);
    fillLight.position.set(-10, 15, -5);
    scene.add(fillLight);

    // Lava Light (Emits glow from below)
    const lavaLight = new THREE.PointLight(0xff2200, 8, 60);
    lavaLight.position.set(0, -1, 0);
    scene.add(lavaLight);

    // Additional point lights spread around the arena for even illumination
    const arenaLights = [
        [0, 4, 20], [-15, 4, 0], [15, 4, 0], [0, 4, -20]
    ];
    arenaLights.forEach(([x, y, z]) => {
        const pl = new THREE.PointLight(0xff4422, 2.5, 35);
        pl.position.set(x, y, z);
        scene.add(pl);
    });

    // Floor Geometry (Basalt Grid) — brighter colour
    const obsidianTex = createObsidianTexture();
    const floorGeo = new THREE.PlaneGeometry(100, 100);
    const floorMat = new THREE.MeshStandardMaterial({
        color: 0x2a1010, // brighter floor
        roughness: 0.85,
        metalness: 0.15,
        bumpMap: obsidianTex,
        bumpScale: 0.05
    });
    const floor = new THREE.Mesh(floorGeo, floorMat);
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    scene.add(floor);

    // Basalt Grid lines overlay
    const grid = new THREE.GridHelper(100, 50, 0xff0000, 0x1a0505);
    grid.position.y = 0.01;
    scene.add(grid);

    // Lava Chasm (Glowing Red trenches at the edges)
    // Left lava trench
    const lavaGeoL = new THREE.BoxGeometry(6, 1, 100);
    const lavaMat = new THREE.MeshBasicMaterial({ color: 0xff2200 });
    const lavaL = new THREE.Mesh(lavaGeoL, lavaMat);
    lavaL.position.set(-25, -0.6, 0);
    scene.add(lavaL);
    
    // Right lava trench
    const lavaR = lavaL.clone();
    lavaR.position.x = 25;
    scene.add(lavaR);

    // Front lava separation (where the boss arena sits)
    const lavaF = new THREE.Mesh(new THREE.BoxGeometry(100, 1, 10), lavaMat);
    lavaF.position.set(0, -0.6, -25);
    scene.add(lavaF);

    // Basalt Pillars (Scattered)
    const pillarGeo = new THREE.BoxGeometry(3, 12, 3);
    const pillarMat = new THREE.MeshStandardMaterial({ color: 0x110808, roughness: 0.9 });
    const pillarPositions = [
        [-12, 6, 20], [12, 6, 20],
        [-18, 6, 5], [18, 6, 5],
        [-8, 6, -15], [8, 6, -15],
        [-20, 6, -20], [20, 6, -20]
    ];
    pillarPositions.forEach(pos => {
        const pillar = new THREE.Mesh(pillarGeo, pillarMat);
        pillar.position.set(pos[0], pos[1], pos[2]);
        pillar.castShadow = true;
        pillar.receiveShadow = true;
        scene.add(pillar);
    });

    // Player Mesh
    demonMesh = createDemonMesh();
    scene.add(demonMesh);

    // Create Barriers & Runic floor circles
    state.barriers.forEach(b => {
        // Gates (Two basalt pillars framing a glowing portal)
        const frameL = new THREE.Mesh(new THREE.BoxGeometry(1, 6, 1), pillarMat);
        frameL.position.set(b.x - 3, 3, b.z);
        scene.add(frameL);

        const frameR = frameL.clone();
        frameR.position.x = b.x + 3;
        scene.add(frameR);

        const lintel = new THREE.Mesh(new THREE.BoxGeometry(7, 0.8, 1), pillarMat);
        lintel.position.set(b.x, 6, b.z);
        scene.add(lintel);

        // Holy Light Barrier mesh
        const barrierGeo = new THREE.PlaneGeometry(5.2, 5.2);
        const barrierMat = new THREE.MeshStandardMaterial({
            color: 0xffffff,
            emissive: 0x00ffff,
            emissiveIntensity: 1.0,
            side: THREE.DoubleSide,
            transparent: true,
            opacity: 0.65,
            roughness: 0.1
        });
        const barrier = new THREE.Mesh(barrierGeo, barrierMat);
        barrier.position.set(b.x, 3, b.z);
        scene.add(barrier);
        barrierMeshes.push(barrier);

        // SpotLight projecting from barrier
        const spot = new THREE.SpotLight(0x00ffff, 4, 12, Math.PI/4, 0.5);
        spot.position.set(b.x, 3, b.z);
        spot.target.position.set(b.x, 0, b.z + 5);
        scene.add(spot);
        scene.add(spot.target);

        // Glowing runic circles on the floor (Pulsating active area)
        const circleGeo = new THREE.RingGeometry(2.4, 2.5, 32);
        const circleMat = new THREE.MeshBasicMaterial({ color: 0xff2200, side: THREE.DoubleSide });
        const circle = new THREE.Mesh(circleGeo, circleMat);
        circle.rotation.x = -Math.PI / 2;
        circle.position.set(b.x, 0.05, b.z + 3);
        scene.add(circle);
        runicCircleMeshes.push(circle);
    });

    // Final Angelic Boss Mesh (hidden at start, positioned at far back)
    angelMesh = createAngelMesh();
    angelMesh.position.set(state.boss.x, 8, state.boss.z); // floats high
    angelMesh.visible = false;
    scene.add(angelMesh);

    // Bridge mesh (basalt rocks bridging to Boss arena, appears when Gate 3 falls)
    const bridgeGeo = new THREE.BoxGeometry(8, 0.5, 12);
    bridgeMesh = new THREE.Mesh(bridgeGeo, floorMat);
    bridgeMesh.position.set(0, -0.2, -22);
    bridgeMesh.visible = false;
    scene.add(bridgeMesh);

    // Event Listeners
    window.addEventListener('resize', onWindowResize);
    
    // Mouse dragging for camera look around
    container.addEventListener('mousedown', (e) => {
        if (!state.started || state.inConsoleMode) return;
        state.mouse.isDown = true;
        state.mouse.lastX = e.clientX;
        state.mouse.lastY = e.clientY;
    });

    container.addEventListener('mousemove', (e) => {
        if (!state.mouse.isDown || state.inConsoleMode) return;
        const deltaX = e.clientX - state.mouse.lastX;
        const deltaY = e.clientY - state.mouse.lastY;

        state.camera.theta -= deltaX * 0.007;
        state.camera.phi += deltaY * 0.007;

        // Clamp vertical viewing angle
        state.camera.phi = Math.max(0.1, Math.min(Math.PI / 2 - 0.05, state.camera.phi));

        state.mouse.lastX = e.clientX;
        state.mouse.lastY = e.clientY;
    });

    window.addEventListener('mouseup', () => {
        state.mouse.isDown = false;
    });

    // Keyboard controls
    window.addEventListener('keydown', (e) => {
        state.keys[e.key.toLowerCase()] = true;
        
        // Open terminal if near gate and pressing 'enter'
        if (e.key === 'Enter' && !state.inConsoleMode && state.activeGate !== null) {
            enterConsoleMode();
        }
    });

    window.addEventListener('keyup', (e) => {
        state.keys[e.key.toLowerCase()] = false;
    });

    // Remove loading screen
    document.getElementById('loader').classList.add('hidden');
}

/**
 * Handle screen resize
 */
function onWindowResize() {
    const container = document.getElementById('game-canvas-container');
    const width = container.clientWidth;
    const height = container.clientHeight;
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    renderer.setSize(width, height);
}

/**
 * Open Runic Console
 */
function enterConsoleMode() {
    state.inConsoleMode = true;
    state.keys = {}; // Reset moving keys
    
    const terminal = document.getElementById('runic-terminal-container');
    const input = document.getElementById('incantation-input');
    
    terminal.classList.remove('hidden');
    input.disabled = false;
    input.value = '';
    setTimeout(() => input.focus(), 100);

    // Show appropriate barrier HP in HUD
    const targetStats = document.getElementById('target-stats');
    const targetName = document.getElementById('target-name');
    const targetHpText = document.getElementById('target-hp-text');
    const targetHpBar = document.getElementById('target-hp-bar');
    const targetRequirement = document.getElementById('target-requirement');

    targetStats.classList.remove('hidden');

    if (state.boss.active) {
        targetName.textContent = "CELESTIAL ARCHANGEL";
        targetHpText.textContent = `${state.boss.hp} / ${state.boss.maxHp}`;
        targetHpBar.style.width = `${(state.boss.hp / state.boss.maxHp) * 100}%`;
        targetRequirement.textContent = state.boss.requirement;
    } else if (state.activeGate !== null) {
        const gate = state.barriers[state.activeGate];
        targetName.textContent = gate.name.toUpperCase();
        targetHpText.textContent = `${gate.hp} / ${gate.maxHp}`;
        targetHpBar.style.width = `${(gate.hp / gate.maxHp) * 100}%`;
        targetRequirement.textContent = gate.requirement;
    }
}

/**
 * Close Runic Console
 */
function exitConsoleMode() {
    state.inConsoleMode = false;
    document.getElementById('runic-terminal-container').classList.add('hidden');
    const input = document.getElementById('incantation-input');
    input.disabled = true;
    input.blur();

    // Hide target stats in HUD if not locked near anything
    if (state.activeGate === null) {
        document.getElementById('target-stats').classList.add('hidden');
    }
}

/**
 * Hook Runic Helper Button Clicks
 */
document.querySelectorAll('.rune-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
        const input = document.getElementById('incantation-input');
        const rune = btn.getAttribute('data-rune');
        
        if (!input.disabled) {
            const startPos = input.selectionStart;
            const endPos = input.selectionEnd;
            const text = input.value;
            
            // Insert at cursor position
            input.value = text.substring(0, startPos) + rune + text.substring(endPos);
            input.focus();
            
            // Re-position cursor inside parentheses if it is an invoke()
            if (rune === 'invoke()') {
                input.setSelectionRange(startPos + 7, startPos + 7);
            } else {
                input.setSelectionRange(startPos + rune.length, startPos + rune.length);
            }

            updateLiveFormula();
        }
    });
});

/**
 * Calculate damage and update Live Potency UI as player types
 */
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

/**
 * Handle Incantation Submission (Casting Spell)
 */
function castIncantation() {
    if (!state.inConsoleMode) return;

    const inputField = document.getElementById('incantation-input');
    const spellText = inputField.value.trim();
    if (!spellText) return;

    exitConsoleMode();

    // Trigger casting state on player
    state.player.isCasting = true;
    state.player.castTime = Date.now();
    audio.playCast();

    // Trigger visual cast flash
    const castFlash = document.getElementById('cast-flash');
    castFlash.classList.add('flash-active');
    setTimeout(() => castFlash.classList.remove('flash-active'), 80);

    const parsed = processSpell(spellText);
    logToConsole(`Demon chants: "${spellText}"`);

    setTimeout(() => {
        if (state.boss.active) {
            // CASTING AT BOSS
            if (parsed.valid && parsed.damage >= 60) {
                // Hits Boss
                state.boss.hp = Math.max(0, state.boss.hp - parsed.damage);
                logToConsole(`HELLFIRE BURST! Hits Celestial Archangel for ${parsed.damage} DMG!`, 'success');
                audio.playSuccess(parsed.damage);
                spawnFloatingText(`-${parsed.damage}`, state.boss.x, 3, state.boss.z, 0x55ff55);
                triggerScreenShake(parsed.damage / 60);

                // Update HUD
                document.getElementById('target-hp-bar').style.width = `${(state.boss.hp / state.boss.maxHp) * 100}%`;
                document.getElementById('target-hp-text').textContent = `${state.boss.hp} / ${state.boss.maxHp}`;

                // Spawn Projectile
                spawnProjectile(demonMesh.position, new THREE.Vector3(state.boss.x, 3, state.boss.z), 0xff2200);

                if (state.boss.hp <= 0) {
                    shatterBoss();
                }
            } else {
                // Spell fizzles or is not powerful enough
                let errorMsg = parsed.error || "Spell damage below 60! Shield deflected the strike.";
                logToConsole(`FIZZLE: ${errorMsg}`, 'error');
                audio.playFailure();
                
                // Player takes damage (Holy Retribution)
                applyPlayerDamage(25, "Holy Deflection");
            }
        } else if (state.activeGate !== null) {
            // CASTING AT ACTIVE GATE
            const gate = state.barriers[state.activeGate];
            const checkPassed = gate.check(parsed);

            if (checkPassed) {
                // Apply Damage to Barrier
                gate.hp = Math.max(0, gate.hp - parsed.damage);
                logToConsole(`SUCCESS! ${gate.name} barrier takes ${parsed.damage} DMG!`, 'success');
                audio.playSuccess(parsed.damage);
                spawnFloatingText(`-${parsed.damage}`, gate.x, 3, gate.z, 0x55ff55);
                triggerScreenShake(parsed.damage / 30);

                // Update HUD
                document.getElementById('target-hp-bar').style.width = `${(gate.hp / gate.maxHp) * 100}%`;
                document.getElementById('target-hp-text').textContent = `${gate.hp} / ${gate.maxHp}`;

                // Spawn Projectile
                spawnProjectile(demonMesh.position, new THREE.Vector3(gate.x, 3, gate.z), 0xff2200);

                if (gate.hp <= 0) {
                    shatterGate(state.activeGate);
                }
            } else {
                // Invalid or failed syntax
                let errorMsg = parsed.error || `Failed to match gate's syntax rule.`;
                logToConsole(`FIZZLE: ${errorMsg}`, 'error');
                audio.playFailure();

                // Player takes damage
                applyPlayerDamage(20, "Grammar Backlash");
            }
        }
    }, 400); // 400ms delay to align with casting animation
}

document.getElementById('incantation-form').addEventListener('submit', castIncantation);

/**
 * Spawns a glowing projectile fireball/bolt
 */
function spawnProjectile(start, end, colorHex) {
    const geo = new THREE.SphereGeometry(0.4, 8, 8);
    const mat = new THREE.MeshBasicMaterial({ color: colorHex });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.copy(start);
    mesh.position.y += 1.5; // fire from chest
    scene.add(mesh);

    state.projectiles.push({
        mesh: mesh,
        start: mesh.position.clone(),
        end: end.clone(),
        t: 0,
        speed: 0.04
    });
}

/**
 * Apply damage to player
 */
function applyPlayerDamage(amount, source) {
    if (state.player.hp <= 0) return;

    state.player.hp = Math.max(0, state.player.hp - amount);
    state.player.isStaggering = true;
    state.player.staggerTime = Date.now();
    
    logToConsole(`Demon takes ${amount} Holy Damage from ${source}!`, 'error');
    spawnFloatingText(`-${amount}`, demonMesh.position.x, 3, demonMesh.position.z, 0xff2222);
    triggerScreenShake(amount / 20);

    // Damage screen flash
    const flash = document.getElementById('damage-flash');
    flash.classList.add('flash-active');
    setTimeout(() => flash.classList.remove('flash-active'), 120);

    // Update HUD
    document.getElementById('hp-bar').style.width = `${(state.player.hp / state.player.maxHp) * 100}%`;
    document.getElementById('hp-text').textContent = `${state.player.hp} / ${state.player.maxHp}`;

    if (state.player.hp <= 0) {
        triggerDeath();
    }
}

/**
 * Shatter Gate Barrier
 */
function shatterGate(gateIdx) {
    const gate = state.barriers[gateIdx];
    gate.shattered = true;
    logToConsole(`BARRIER SHATTERED! ${gate.name} barrier collapses!`, 'gold');
    audio.playShatter();
    triggerScreenShake(1.5);

    // Fade out barrier mesh
    const mesh = barrierMeshes[gateIdx];
    mesh.visible = false;

    // Spawn shatter particles
    spawnShatterParticles(gate.x, 3, gate.z, 0x00ffff);

    // Update checkpoint
    state.player.checkpoint = { x: gate.x, z: gate.z + 4, name: gate.name };
    document.getElementById('checkpoint-name').textContent = gate.name;

    // Hide target stats in HUD
    document.getElementById('target-stats').classList.add('hidden');
    state.activeGate = null;

    // Check if all gates shattered
    const allShattered = state.barriers.every(b => b.shattered);
    if (allShattered) {
        spawnBoss();
    }
}

/**
 * Spawn Boss Archangel
 */
function spawnBoss() {
    logToConsole("WARNING: Celestial energy surges in the abyss!", 'error');
    
    setTimeout(() => {
        // Build basalt bridge over lava chasm
        bridgeMesh.visible = true;
        // Spawn bridge fragments animation
        spawnShatterParticles(0, 0, -22, 0x110808);
        
        logToConsole("A Celestial bridge emerges!", 'gold');
    }, 1500);

    setTimeout(() => {
        // Archangel descends
        state.boss.active = true;
        angelMesh.visible = true;
        audio.startBossTheme();
        logToConsole("BOSS DESCENDED: The Celestial Archangel blocks your escape!", 'error');
        spawnFloatingText("ANGELIC DESCENSION", state.boss.x, 6, state.boss.z, 0xffffff);
        triggerScreenShake(2.0);
    }, 3500);
}

/**
 * Shatter Boss (Victory!)
 */
function shatterBoss() {
    state.boss.shattered = true;
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
        endMsg.textContent = "You have broken the three barriers of Holy Light and vanquished the Archangel. The gates of the underworld are shattered, and your demonic presence returns to the cosmos.";
        endBtn.textContent = "PLAY AGAIN";
        endBtn.className = "btn btn-primary";
        endBtn.style.background = "linear-gradient(135deg, #aa7700 0%, #ffcc00 100%)";
        endBtn.style.borderColor = "#ffcc00";

        endScreen.classList.remove('hidden');
    }, 2000);
}

/**
 * Trigger player death & respawn at checkpoint
 */
function triggerDeath() {
    audio.playFailure();
    logToConsole("YOU DIED. Respawning at last gate...", 'error');

    const endScreen = document.getElementById('end-screen');
    const endTitle = document.getElementById('end-title');
    const endMsg = document.getElementById('end-message');
    const endBtn = document.getElementById('end-button');

    endScreen.style.background = 'radial-gradient(circle at center, rgba(15, 5, 5, 0.95) 0%, rgba(5, 2, 2, 0.99) 100%)';
    endScreen.style.color = '#e0d0d0';
    endTitle.textContent = "YOU PERISHED";
    endTitle.style.color = 'var(--color-red-glow)';
    endTitle.style.textShadow = '0 0 15px rgba(255, 42, 42, 0.7)';
    endMsg.textContent = "The blinding celestial light disintegrated your corporeal form. Your essence returns to your last checkpoint.";
    endBtn.textContent = "RESPAWN";
    endBtn.className = "btn btn-primary";
    endBtn.style.background = ""; // Reset inline style

    endScreen.classList.remove('hidden');
}

/**
 * Handle Respawn Click
 */
function respawnPlayer() {
    document.getElementById('end-screen').classList.add('hidden');
    
    // Reset Player Stats
    state.player.hp = state.player.maxHp;
    state.player.x = state.player.checkpoint.x;
    state.player.z = state.player.checkpoint.z;
    demonMesh.position.set(state.player.x, 0, state.player.z);

    // Reset current active gate HP if not shattered
    if (state.activeGate !== null) {
        const gate = state.barriers[state.activeGate];
        gate.hp = gate.maxHp;
    }

    // Reset boss HP if active but not dead
    if (state.boss.active && !state.boss.shattered) {
        state.boss.hp = state.boss.maxHp;
    }

    // Update HUD
    document.getElementById('hp-bar').style.width = '100%';
    document.getElementById('hp-text').textContent = `${state.player.hp} / ${state.player.maxHp}`;
    
    exitConsoleMode();
}

document.getElementById('end-button').addEventListener('click', () => {
    if (state.boss.shattered) {
        // Refresh page to replay entire game
        window.location.reload();
    } else {
        respawnPlayer();
    }
});

/**
 * Spawns small debris boxes
 */
function spawnShatterParticles(x, y, z, colorHex) {
    const geo = new THREE.BoxGeometry(0.25, 0.25, 0.25);
    const mat = new THREE.MeshBasicMaterial({ color: colorHex });
    
    for (let i = 0; i < 40; i++) {
        const mesh = new THREE.Mesh(geo, mat);
        mesh.position.set(
            x + (Math.random() - 0.5) * 4,
            y + (Math.random() - 0.5) * 4,
            z + (Math.random() - 0.5) * 4
        );
        scene.add(mesh);

        state.particles.push({
            mesh: mesh,
            vx: (Math.random() - 0.5) * 0.3,
            vy: (Math.random() - 0.2) * 0.3,
            vz: (Math.random() - 0.5) * 0.3,
            age: 0,
            maxAge: 60 + Math.random() * 40
        });
    }
}

/**
 * Starts the game loop
 */
function startGame() {
    state.started = true;
    document.getElementById('start-screen').classList.add('hidden');
    document.getElementById('hud-container').classList.remove('hidden');
    
    // Initialize procedural audio synthesizer
    audio.init();

    logToConsole("Demon awakens. The Gates of Celestial Light await your dark runes.");
    
    // Start central animation loop
    animate();
}

document.getElementById('play-button').addEventListener('click', startGame);

/**
 * 3D Main Animation Loop
 */
function animate() {
    if (!state.started) return;
    requestAnimationFrame(animate);

    const time = Date.now();

    // 1. Particle System Physics
    for (let i = state.particles.length - 1; i >= 0; i--) {
        const p = state.particles[i];
        p.mesh.position.x += p.vx;
        p.mesh.position.y += p.vy;
        p.mesh.position.z += p.vz;
        
        // Add gravity to particles
        p.vy -= 0.008;

        p.age++;
        if (p.age >= p.maxAge) {
            scene.remove(p.mesh);
            state.particles.splice(i, 1);
        }
    }

    // 2. Projectile Tracking
    for (let i = state.projectiles.length - 1; i >= 0; i--) {
        const proj = state.projectiles[i];
        proj.t += proj.speed;
        
        // Linear interpolation along path
        proj.mesh.position.lerpVectors(proj.start, proj.end, Math.min(1.0, proj.t));
        
        // Add small drift/sine motion
        proj.mesh.position.y += Math.sin(proj.t * Math.PI) * 0.8;

        if (proj.t >= 1.0) {
            scene.remove(proj.mesh);
            state.projectiles.splice(i, 1);
        }
    }

    // 3. HTML Overlay Floating Text positioning
    const canvasContainer = document.getElementById('game-canvas-container');
    const containerRect = canvasContainer.getBoundingClientRect();
    const tempV = new THREE.Vector3();

    for (let i = state.floatingTexts.length - 1; i >= 0; i--) {
        const ft = state.floatingTexts[i];
        ft.age += 16; // Approx ms per frame
        
        // Slowly float upwards in 3D space
        ft.worldPos.y += 0.04;

        // Project 3D vector to 2D screen coordinate
        tempV.copy(ft.worldPos).project(camera);
        
        // Convert projected coordinates to CSS pixels
        const x = (tempV.x *  .5 + .5) * containerRect.width;
        const y = (tempV.y * -.5 + .5) * containerRect.height;

        ft.element.style.transform = `translate(-50%, -50%) translate(${x}px, ${y}px)`;
        
        // Fade out
        const pct = 1.0 - (ft.age / ft.maxAge);
        ft.element.style.opacity = pct;

        if (ft.age >= ft.maxAge) {
            ft.element.remove();
            state.floatingTexts.splice(i, 1);
        }
    }

    // 4. Handle Screen Shake Decay
    if (shakeAmount > 0) {
        camera.position.x += (Math.random() - 0.5) * shakeAmount;
        camera.position.y += (Math.random() - 0.5) * shakeAmount;
        camera.position.z += (Math.random() - 0.5) * shakeAmount;
        shakeAmount *= 0.88; // fade out fast
        if (shakeAmount < 0.01) shakeAmount = 0;
    }

    // 5. Player Controls & Movement Physics
    if (!state.inConsoleMode && state.player.hp > 0) {
        let moveX = 0;
        let moveZ = 0;

        if (state.keys['w'] || state.keys['arrowup']) moveZ -= 1;
        if (state.keys['s'] || state.keys['arrowdown']) moveZ += 1;
        if (state.keys['a'] || state.keys['arrowleft']) moveX -= 1;
        if (state.keys['d'] || state.keys['arrowright']) moveX += 1;

        if (moveX !== 0 || moveZ !== 0) {
            // Calculate movement vectors based on camera angle (theta)
            const forward = new THREE.Vector3(Math.cos(state.camera.theta), 0, Math.sin(state.camera.theta)).normalize();
            const right = new THREE.Vector3(-Math.sin(state.camera.theta), 0, Math.cos(state.camera.theta)).normalize();
            
            // Note: Camera forward moves towards player, so W moves along forward vector inverted
            const velocity = new THREE.Vector3()
                .addScaledVector(forward, moveZ)
                .addScaledVector(right, moveX)
                .normalize()
                .multiplyScalar(state.player.speed);

            state.player.vx = velocity.x;
            state.player.vz = velocity.z;

            // Update rotation to face direction of movement
            state.player.rotation = Math.atan2(-velocity.x, -velocity.z);
        } else {
            state.player.vx *= 0.75;
            state.player.vz *= 0.75;
        }

        // Apply movement
        state.player.x += state.player.vx;
        state.player.z += state.player.vz;

        // Collision bounds (lava chasms and pillars)
        // Keep inside lava boundaries
        state.player.x = Math.max(-21, Math.min(21, state.player.x));
        
        // Prevent walking past Gate 3 chasm unless boss is active (which spawns the bridge)
        if (!state.boss.active) {
            state.player.z = Math.max(-15, Math.min(45, state.player.z));
        } else {
            // Boss active, can cross bridge
            state.player.z = Math.max(-42, Math.min(45, state.player.z));
        }

        // Update demon mesh transformation
        demonMesh.position.set(state.player.x, 0, state.player.z);
        demonMesh.rotation.y = state.player.rotation;
    }

    // 6. Sprite Player Animations (scale pulse on cast/stagger, bob on walk)
    if (playerSprite) {
        const isMoving = Math.abs(state.player.vx) + Math.abs(state.player.vz) > 0.02;

        if (state.player.isStaggering) {
            const elapsed = time - state.player.staggerTime;
            if (elapsed > 600) {
                state.player.isStaggering = false;
                playerSprite.material.color.setHex(0xffffff);
                playerSprite.position.y = 3.75;
            } else {
                // Red flash on stagger
                const flash = (Math.floor(elapsed / 80) % 2 === 0);
                playerSprite.material.color.setHex(flash ? 0xff3333 : 0xffffff);
                playerSprite.position.y = 3.75 + Math.sin(elapsed * 0.05) * 0.15;
            }
        } else if (state.player.isCasting) {
            const elapsed = time - state.player.castTime;
            if (elapsed > 800) {
                state.player.isCasting = false;
                playerSprite.scale.set(5.5, 7.5, 1);
                playerSprite.position.y = 3.75;
            } else {
                // Hover + scale pulse on cast
                const pulse = 1 + Math.sin(elapsed * 0.015) * 0.08;
                playerSprite.scale.set(5.5 * pulse, 7.5 * pulse, 1);
                playerSprite.position.y = 3.75 + 0.5 + Math.sin(elapsed * 0.012) * 0.2;
            }
        } else if (isMoving) {
            // Gentle bob while walking
            const bob = Math.abs(Math.sin(time * 0.015)) * 0.2;
            playerSprite.position.y = 3.75 + bob;
        } else {
            // Idle — very subtle breathe
            playerSprite.position.y = 3.75 + Math.sin(time * 0.002) * 0.06;
            playerSprite.material.color.setHex(0xffffff);
        }
    }

    // 7. Angelic Boss Animations & Boss Attacks
    if (state.boss.active && !state.boss.shattered) {
        // Hover bobbing motion
        angelMesh.position.y = 3.5 + Math.sin(time * 0.002) * 0.6;
        
        // Fast wing flaps
        const aud = angelMesh.userData;
        if (aud && aud.wings) {
            aud.wings.forEach((wing, index) => {
                const side = index < 2 ? -1 : 1;
                const speed = 0.006 + (index % 2) * 0.002;
                wing.rotation.y = side * (0.2 + Math.sin(time * speed) * 0.35);
            });
        }

        // Trigger Boss Ranged Light Attack
        // IMPORTANT: Boss NEVER attacks while terminal is open — gives player time to cast
        const distToBoss = demonMesh.position.distanceTo(angelMesh.position);
        if (distToBoss < 35
            && time - state.boss.lastAttackTime > state.boss.attackCooldown
            && state.player.hp > 0
            && !state.inConsoleMode) {

            state.boss.lastAttackTime = time;
            
            logToConsole("Celestial Archangel charges a beam of Holy Light!", 'gold');
            audio.playCast();
            spawnProjectile(angelMesh.position, demonMesh.position, 0x00ffff);
            
            setTimeout(() => {
                // Skip damage entirely if player opened console after the shot fired
                if (state.inConsoleMode) {
                    logToConsole("Attack dissolved — your runes deflected the light!", 'success');
                    return;
                }
                // Dodge check — moving fast enough?
                if (Math.abs(state.player.vx) + Math.abs(state.player.vz) > 0.05) {
                    logToConsole("DODGED! You escaped the holy blast.", 'success');
                    spawnFloatingText("DODGED", demonMesh.position.x, 3, demonMesh.position.z, 0x00ffff);
                } else {
                    applyPlayerDamage(25, "Holy Arch-Blast");
                }
            }, 1000);
        }
    }

    // 8. Distance check to Gates & Boss
    let nearestGateIdx = null;
    let minDistance = Infinity;

    state.barriers.forEach((b, idx) => {
        if (b.shattered) return;
        const dist = demonMesh.position.distanceTo(new THREE.Vector3(b.x, 0, b.z + 3));
        if (dist < minDistance) {
            minDistance = dist;
            nearestGateIdx = idx;
        }
    });

    // Boss distance check — wide range (15 units) so interaction is easy
    if (state.boss.active && !state.boss.shattered) {
        const distToBoss = demonMesh.position.distanceTo(new THREE.Vector3(state.boss.x, 0, state.boss.z));
        if (distToBoss < 15) {
            nearestGateIdx = 99; // Special index for Boss
            minDistance = distToBoss;
        }
    }

    const prompt = document.getElementById('action-prompt');

    // Close console ONLY if player walks far away — use 20 units for boss, 6.5 for gates
    // Do NOT close during boss fight just because minDistance fluctuates
    if (state.inConsoleMode) {
        const closeThreshold = (state.activeGate === 99) ? 20 : 6.5;
        if (minDistance > closeThreshold) {
            exitConsoleMode();
        }
    }

    // Handle Active HUD / UI triggers based on range
    if (minDistance < 14) {
        if (nearestGateIdx === 99) {
            state.activeGate = 99;
            prompt.textContent = "PRESS [ENTER] TO INSCRIBE RUNE AT ARCHANGEL";
            prompt.classList.remove('hidden');
        } else if (minDistance < 5.0) {
            state.activeGate = nearestGateIdx;
            const gate = state.barriers[state.activeGate];
            prompt.textContent = `PRESS [ENTER] TO UNLOCK ${gate.name.toUpperCase()}`;
            prompt.classList.remove('hidden');
        } else {
            if (!state.inConsoleMode) {
                state.activeGate = null;
                prompt.classList.add('hidden');
            }
        }
    } else {
        if (!state.inConsoleMode) {
            state.activeGate = null;
            prompt.classList.add('hidden');
            document.getElementById('target-stats').classList.add('hidden');
        }
    }

    // 9. Camera Orbit Follow Rig
    state.camera.targetX = state.player.x;
    state.camera.targetY = 1.6; // head height
    state.camera.targetZ = state.player.z;

    const targetCamX = state.camera.targetX + state.camera.radius * Math.sin(state.camera.phi) * Math.cos(state.camera.theta);
    const targetCamY = state.camera.targetY + state.camera.radius * Math.cos(state.camera.phi);
    const targetCamZ = state.camera.targetZ + state.camera.radius * Math.sin(state.camera.phi) * Math.sin(state.camera.theta);

    // Smooth camera interpolation
    camera.position.x += (targetCamX - camera.position.x) * 0.1;
    camera.position.y += (targetCamY - camera.position.y) * 0.1;
    camera.position.z += (targetCamZ - camera.position.z) * 0.1;

    camera.lookAt(new THREE.Vector3(state.camera.targetX, state.camera.targetY, state.camera.targetZ));

    // 10. Render
    renderer.render(scene, camera);
}

// Hook WebGL scene startup safely
if (document.readyState === 'loading') {
    window.addEventListener('DOMContentLoaded', init3D);
} else {
    init3D();
}
