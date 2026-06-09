// The Depths of Tartarus - Grammar Engine

const VALID_ELEMENTS = new Set(['IGNIS', 'AQUA', 'TERRA', 'VENTUS', 'SOL', 'LUNA']);
const BASE_DAMAGE = 10;

/**
 * Tokenizes the input incantation string.
 * @param {string} input 
 * @returns {Array} List of tokens
 */
function tokenize(input) {
    // Strip spaces
    const cleanInput = input.replace(/\s+/g, '');
    const tokens = [];
    let i = 0;
    
    while (i < cleanInput.length) {
        const char = cleanInput[i];
        
        if (char === '(') {
            tokens.push({ type: 'LPAREN', value: '(' });
            i++;
        } else if (char === ')') {
            tokens.push({ type: 'RPAREN', value: ')' });
            i++;
        } else if (char === '+') {
            tokens.push({ type: 'PLUS', value: '+' });
            i++;
        } else if (char === '!') {
            tokens.push({ type: 'EXCLAMATION', value: '!' });
            i++;
        } else if (cleanInput.slice(i, i + 6) === 'invoke') {
            tokens.push({ type: 'INVOKE', value: 'invoke' });
            i += 6;
        } else if (/^[a-zA-Z]/.test(char)) {
            // Read word
            let word = '';
            while (i < cleanInput.length && /^[a-zA-Z0-9]/.test(cleanInput[i])) {
                word += cleanInput[i];
                i++;
            }
            if (VALID_ELEMENTS.has(word.toUpperCase())) {
                tokens.push({ type: 'ELEMENT', value: word.toUpperCase() });
            } else {
                tokens.push({ type: 'INVALID', value: word });
            }
        } else {
            tokens.push({ type: 'INVALID', value: char });
            i++;
        }
    }
    
    return tokens;
}

/**
 * Parses a list of tokens into an AST and calculates depth/fury.
 * @param {Array} tokens 
 * @returns {Object} AST node with depth and fury
 */
function parse(tokens) {
    let index = 0;
    
    function peek() {
        return tokens[index] || null;
    }
    
    function consume(expectedType) {
        const t = peek();
        if (!t) {
            throw new Error(`Expected token of type '${expectedType}', but reached End of Input.`);
        }
        if (t.type !== expectedType) {
            throw new Error(`Expected token of type '${expectedType}', but found '${t.type}' ('${t.value}').`);
        }
        index++;
        return t;
    }
    
    function parseExpression() {
        const terms = [];
        terms.push(parseTerm());
        
        let furyCount = 0;
        while (peek() && peek().type === 'PLUS') {
            consume('PLUS');
            furyCount++;
            
            // Check for trailing '+' or invalid token immediately after '+'
            const nextToken = peek();
            if (!nextToken || nextToken.type === 'EXCLAMATION' || nextToken.type === 'RPAREN') {
                throw new Error("Syntax error: trailing '+' is not allowed.");
            }
            terms.push(parseTerm());
        }
        
        const maxDepth = Math.max(...terms.map(t => t.depth));
        const sumFury = terms.reduce((acc, t) => acc + t.fury, 0);
        const elements = terms.reduce((acc, t) => acc.concat(t.elements), []);

        return {
            type: 'Expression',
            depth: maxDepth,
            fury: sumFury + furyCount,
            elements: elements,
            terms: terms
        };
    }
    
    function parseTerm() {
        const t = peek();
        if (!t) {
            throw new Error("Syntax error: expected an element or command, but reached End of Input.");
        }
        
        if (t.type === 'ELEMENT') {
            consume('ELEMENT');
            return {
                type: 'ElementTerm',
                value: t.value,
                depth: 0,
                fury: 0,
                elements: [t.value]
            };
        } else if (t.type === 'INVOKE') {
            consume('INVOKE');
            consume('LPAREN');
            
            // Handle invoke() - empty invoke check
            if (peek() && peek().type === 'RPAREN') {
                throw new Error("Syntax error: 'invoke()' cannot be empty.");
            }
            
            const expr = parseExpression();
            consume('RPAREN');
            return {
                type: 'InvokeTerm',
                depth: expr.depth + 1,
                fury: expr.fury,
                elements: expr.elements,
                expr: expr
            };
        } else if (t.type === 'INVALID') {
            throw new Error(`Invalid runic term: '${t.value}'`);
        } else {
            throw new Error(`Unexpected token '${t.value}' where a rune or 'invoke' was expected.`);
        }
    }
    
    if (tokens.length === 0) {
        throw new Error("Spell is empty.");
    }
    
    // Check if the spell contains an EXCLAMATION mark at the very end
    const lastToken = tokens[tokens.length - 1];
    if (!lastToken || lastToken.type !== 'EXCLAMATION') {
        throw new Error("Spell must end with an exclamation mark '!'.");
    }
    
    const expr = parseExpression();
    consume('EXCLAMATION');
    
    if (index < tokens.length) {
        throw new Error(`Unexpected content after exclamation mark: '${tokens[index].value}'`);
    }
    
    return expr;
}

/**
 * Validates a raw spell string and calculates damage.
 * @param {string} spellText 
 * @returns {Object} Result object
 */
function processSpell(spellText) {
    try {
        const tokens = tokenize(spellText);
        
        // Quick pass: check for any basic invalid tokens during lexing
        for (let t of tokens) {
            if (t.type === 'INVALID') {
                throw new Error(`Invalid runic symbol or term: '${t.value}'`);
            }
        }
        
        const ast = parse(tokens);
        const damage = BASE_DAMAGE * (1 + ast.depth) * (1 + ast.fury);

        return {
            valid: true,
            depth: ast.depth,
            fury: ast.fury,
            damage: damage,
            elements: Array.from(new Set(ast.elements)),
            error: null
        };
    } catch (err) {
        return {
            valid: false,
            depth: 0,
            fury: 0,
            damage: 0,
            elements: [],
            error: err.message
        };
    }
}

// 10 Mandatory Edge Cases for Self-Check Test Suite
const TEST_CASES = [
    { input: "IGNIS!", expectedValid: true, expectedDepth: 0, expectedFury: 0, expectedDmg: 10 },
    { input: "invoke(IGNIS)!", expectedValid: true, expectedDepth: 1, expectedFury: 0, expectedDmg: 20 },
    { input: "invoke(IGNIS) + AQUA!", expectedValid: true, expectedDepth: 1, expectedFury: 1, expectedDmg: 40 },
    { input: "invoke(invoke(IGNIS))!", expectedValid: true, expectedDepth: 2, expectedFury: 0, expectedDmg: 30 },
    { input: "invoke(invoke(IGNIS) + AQUA) + TERRA!", expectedValid: true, expectedDepth: 2, expectedFury: 2, expectedDmg: 90 },
    { input: "invoke()!", expectedValid: false, expectedDepth: 0, expectedFury: 0, expectedDmg: 0 },
    { input: "invoke(IGNIS!", expectedValid: false, expectedDepth: 0, expectedFury: 0, expectedDmg: 0 },
    { input: "IGNIS + !", expectedValid: false, expectedDepth: 0, expectedFury: 0, expectedDmg: 0 },
    { input: "invoke(INVALID_ELEMENT)!", expectedValid: false, expectedDepth: 0, expectedFury: 0, expectedDmg: 0 },
    { input: "invoke(IGNIS) + AQUA", expectedValid: false, expectedDepth: 0, expectedFury: 0, expectedDmg: 0 }
];

/**
 * Runs the self-check suite and renders results to the DOM and console.
 */
function runSelfCheck() {
    const resultsContainer = document.getElementById('test-results-body');
    if (resultsContainer) {
        resultsContainer.innerHTML = '';
    }
    
    console.log("=== GRAMMAR SYSTEM SELF-CHECK INITIALIZED ===");
    let allPassed = true;
    
    TEST_CASES.forEach((tc, idx) => {
        const res = processSpell(tc.input);
        
        let passed = res.valid === tc.expectedValid;
        if (res.valid) {
            passed = passed && res.depth === tc.expectedDepth && res.fury === tc.expectedFury && res.damage === tc.expectedDmg;
        }
        
        if (!passed) {
            allPassed = false;
        }
        
        const statusText = passed ? "PASS" : "FAIL";
        const statusClass = passed ? "log-success" : "log-error";
        
        const logLine = `Case #${idx + 1}: "${tc.input}" -> ${statusText} | Valid: ${res.valid} | Depth: ${res.depth} | Fury: ${res.fury} | DMG: ${res.damage} ${res.error ? '(' + res.error + ')' : ''}`;
        console.log(logLine);
        
        if (resultsContainer) {
            const div = document.createElement('div');
            div.className = statusClass;
            div.textContent = `[${statusText}] ${tc.input} (DMG: ${res.damage})`;
            resultsContainer.appendChild(div);
        }
    });
    
    console.log(allPassed ? "RESULT: ALL TESTS PASSED ✅" : "RESULT: SOME TESTS FAILED ❌");
    console.log("=========================================");
    
    if (resultsContainer) {
        const summaryDiv = document.createElement('div');
        summaryDiv.style.borderTop = "1px solid rgba(255,255,255,0.1)";
        summaryDiv.style.marginTop = "8px";
        summaryDiv.style.paddingTop = "4px";
        summaryDiv.className = allPassed ? "log-success" : "log-error";
        summaryDiv.textContent = allPassed ? "SYSTEM STATUS: SECURE ✅" : "SYSTEM STATUS: CORRUPT ❌";
        resultsContainer.appendChild(summaryDiv);
    }
}

// Hook self-check execution safely
if (document.readyState === 'loading') {
    window.addEventListener('DOMContentLoaded', () => setTimeout(runSelfCheck, 100));
} else {
    setTimeout(runSelfCheck, 100);
}
