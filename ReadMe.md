The Depths of Tartarus — 3D Incantation Roguelite
You are an ancient Demon clawing your way out of a layered celestial prison. You cannot strike, punch, or shoot. Your only weapon is language — you type runic incantations into a console, and a language rule processor decides whether your spell is valid. Valid syntax releases devastating magic. Broken syntax allows the Holy Light to burn you.

🎮 Controls
Move: W / A / S / D or Arrow Keys
Look Around: Click and drag your mouse on the game screen.
Inscribe Spells: Approach a glowing runic floor circle and press Enter to open the terminal. Type your incantation and press Enter or click CAST.
⚡ Incantation Rules (Grammar Specification)
Spells must adhere to the grammar engine's rules to execute:

Must End with !: Every valid incantation must terminate with an exclamation point (e.g. IGNIS!).
Basic Elements: Spells consist of primary runes: IGNIS, AQUA, TERRA, VENTUS, SOL, LUNA.
Command Invocations: You can nest spells using the invoke() command. (e.g. invoke(IGNIS)!).
Fury Chains: Link elements together with the + operator. (e.g. invoke(IGNIS) + AQUA!).
Damage Formula
Damage=Base (10)×(1+Nesting Depth)×(1+Fury Count)
Nesting Depth: The maximum depth of nested invoke(...) functions.
Fury Count: The total number of + signs in the formula.
🚪 Barrier Mechanics
Gate of Echoes (25 HP): Focuses on basic terminals and closures. (e.g. invoke(IGNIS)!).
Gate of Depths (50 HP): Enforces recursive depth (Requires Nesting Depth ≥2). (e.g. invoke(invoke(TERRA))!).
Gate of Fury (80 HP): Combines recursion and fury (Requires Nesting Depth ≥2 and Fury Count ≥2). (e.g. invoke(invoke(SOL) + LUNA) + IGNIS!).
The Archangel Boss (150 HP): Surrounded by an angelic shield that deflects any spell dealing less than 60 DMG. Compose a complex formula under pressure while dodging the boss's incoming holy energy blasts!
🛠️ Architecture Details
Graphics: Built using standard WebGL via the Three.js library. Leverages custom procedural lighting, volumetric red fog, and dynamic emissive materials to establish a dark gothic atmosphere.
Audio Synthesis: Uses the HTML5 Web Audio API to procedurally synthesize sound effects (spell castings, holy fizzles, barrier shatters, explosions) and a driving industrial synthesizer arpeggiator theme during the final boss encounter, requiring no external audio downloads.
Compiler Engine: Implements a custom Lexer and recursive-descent Parser in Vanilla JS to parse, tokenize, and validate user incantations with helpful syntax debug logs.