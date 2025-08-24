class SimpleNXCParser {
  constructor() {
    this.errors = [];
    this.warnings = [];
    this.braceCount = 0;
    this.parenCount = 0;
    this.bracketCount = 0;
    this.braceStack = [];
  }

  validateSyntax(sourceCode) {
    console.log('SimpleParser: Starting validation...');
    
    this.errors = [];
    this.warnings = [];
    
    try {
      this.analyzeBasicSyntax(sourceCode);
      
      return {
        isValid: this.errors.length === 0,
        errors: this.errors,
        warnings: this.warnings
      };
    } catch (error) {
      console.error('SimpleParser: Error during validation:', error);
      return {
        isValid: false,
        errors: [{
          message: `Internal error: ${error.message}`,
          position: 0,
          line: 0,
          column: 0,
          severity: 'error',
          source: 'simple-parser'
        }],
        warnings: []
      };
    }
  }

  analyzeBasicSyntax(sourceCode) {
    const lines = sourceCode.split(/\r?\n/);
    
    this.braceCount = 0;
    this.parenCount = 0;
    this.bracketCount = 0;
    this.braceStack = [];
    
    lines.forEach((line, lineIndex) => {
      this.checkLinePatterns(line, lineIndex);
    });
    
    lines.forEach((line, lineIndex) => {
      this.checkBalancing(line, lineIndex);
    });
    
    if (this.braceCount > 0) {
      const lastBrace = this.braceStack[this.braceStack.length - 1];
      if (lastBrace) {
        this.addError('Opening brace without matching closing brace', lastBrace.line, lastBrace.column);
      } else {
        this.addError('Unbalanced braces - missing closing braces', lines.length - 1, 0);
      }
    }
    
    if (this.parenCount > 0) {
      this.addError('Unbalanced parentheses - missing closing parentheses', lines.length - 1, 0);
    }
    
    if (this.bracketCount > 0) {
      this.addError('Unbalanced brackets - missing closing brackets', lines.length - 1, 0);
    }
    
    this.performSemanticAnalysis(sourceCode);
    
    console.log(`SimpleParser: Found ${this.errors.length} errors and ${this.warnings.length} warnings`);
  }

  performSemanticAnalysis(sourceCode) {
    const cleanedCode = this.removeCommentsAndStrings(sourceCode);
    const lines = sourceCode.split(/\r?\n/);
    const cleanedLines = cleanedCode.split(/\r?\n/);
    
  const builtInFunctions = this.loadBuiltInFunctions();
  // declaredFunctions will map name -> { line, conditional }
  const declaredFunctions = new Map();
  // initialize built-ins as declared (non-conditional)
  builtInFunctions.forEach(fn => declaredFunctions.set(fn, { line: -1, conditional: false }));
  const calledFunctions = new Map();
    
    // FIX: Add a set to store the names of all defined macros
    const declaredMacros = new Set();
    
    let scopes = [new Map()];

  // Track preprocessor conditional nesting so we can avoid flagging duplicates across branches
  let conditionalDepth = 0;
    // First pass: collect macros and declarations
    cleanedLines.forEach((cleanedLine, lineIndex) => {
      const originalLine = lines[lineIndex];
      const trimmed = cleanedLine.trim();

      if (!trimmed) return;

      const macroDefinition = trimmed.match(/^\s*#\s*define\s+([a-zA-Z_][a-zA-Z0-9_]*)/);
      if (macroDefinition) declaredMacros.add(macroDefinition[1]);

      const pp = trimmed.match(/^#\s*(if|ifdef|ifndef|else|endif)\b/);
      if (pp) {
        const directive = pp[1];
        if (directive === 'if' || directive === 'ifdef' || directive === 'ifndef') conditionalDepth++;
        else if (directive === 'endif') conditionalDepth = Math.max(0, conditionalDepth - 1);
      }

      const funcDeclaration = trimmed.match(/^\s*(?:(?:inline|safecall|static)\s+)*?(?:task|sub|void|int|float|byte|char|string|bool|long|short|unsigned)\s+(\w+)\s*\(/);
      if (funcDeclaration) {
        const funcName = funcDeclaration[1];
        const isConditional = conditionalDepth > 0;
        if (!declaredFunctions.has(funcName)) {
          declaredFunctions.set(funcName, { line: lineIndex, conditional: isConditional });
        } else {
          const existing = declaredFunctions.get(funcName);
          // Flag as error if both are non-conditional OR if one is non-conditional (will conflict)
          if (!existing.conditional && !isConditional) {
            const column = originalLine.indexOf(funcName);
            this.addError(`Function/task '${funcName}' already declared at line ${existing.line + 1}`, lineIndex, column, funcName.length);
          } else if (!existing.conditional || !isConditional) {
            const column = originalLine.indexOf(funcName);
            this.addError(`Function/task '${funcName}' conflicts with declaration at line ${existing.line + 1}`, lineIndex, column, funcName.length);
          } else {
            // Both are conditional - that's fine, they're in different preprocessor branches
          }
          
          // Update to keep the non-conditional one if there is one
          if (existing.conditional && !isConditional) {
            declaredFunctions.set(funcName, { line: lineIndex, conditional: false });
          }
        }
      }
    });

    // Second pass: validate calls/usages
    conditionalDepth = 0;
    let inMultilineMacro = false;
    cleanedLines.forEach((cleanedLine, lineIndex) => {
      const originalLine = lines[lineIndex];
      const trimmed = cleanedLine.trim();
      if (!trimmed) return;

      // Check if we're continuing a multiline macro from previous line
      if (lineIndex > 0) {
        const prevLine = lines[lineIndex - 1].trim();
        if (prevLine.endsWith('\\')) {
          inMultilineMacro = true;
        } else {
          inMultilineMacro = false;
        }
      }

      // Check if this line starts a multiline macro
      if (trimmed.startsWith('#define') && originalLine.trim().endsWith('\\')) {
        inMultilineMacro = true;
      }

      // Skip processing if we're in a multiline macro continuation
      if (inMultilineMacro && !trimmed.startsWith('#')) {
        return;
      }

      const pp = trimmed.match(/^#\s*(if|ifdef|ifndef|else|endif)\b/);
      if (pp) {
        const directive = pp[1];
        if (directive === 'if' || directive === 'ifdef' || directive === 'ifndef') conditionalDepth++;
        else if (directive === 'endif') conditionalDepth = Math.max(0, conditionalDepth - 1);
      }
      
      // Handle multiple variable declarations on the same line
      // But skip for-loop variable declarations as they're handled separately
      const allVarDeclarations = [...trimmed.matchAll(/\b(int|float|byte|char|string|bool|mutex|long|short|unsigned)\s+([a-zA-Z_][a-zA-Z0-9_]*(?:\s*,\s*[a-zA-Z_][a-zA-Z0-9_]*)*)/g)];
      allVarDeclarations.forEach(match => {
        // Skip if this is a for-loop variable declaration
        if (trimmed.match(/for\s*\(\s*(int|float|byte|char|string|bool|mutex|long|short|unsigned)\s+/)) {
          return;
        }
        
        const type = match[1];
        const varList = match[2];
        // Handle comma-separated variable declarations
        const varNames = varList.split(',').map(v => v.trim().split(/\s+/)[0].replace(/[=\[\]();].*/,''));
        
        varNames.forEach(varName => {
          if (varName && varName.match(/^[a-zA-Z_][a-zA-Z0-9_]*$/)) {
            const column = originalLine.indexOf(varName);
            if (column >= 0) {
              const currentScope = scopes[scopes.length - 1];
              if (currentScope.has(varName)) {
                const existing = currentScope.get(varName);
                this.addError(`Variable '${varName}' already declared at line ${existing.line + 1}`, lineIndex, column, varName.length);
              } else {
                currentScope.set(varName, { line: lineIndex, column, used: false });
              }
            }
          }
        });
      });
      
      // Handle for loop variable declarations like "for (int i = 1000; ...)"
      const forLoopVarMatch = trimmed.match(/for\s*\(\s*(int|float|byte|char|string|bool|mutex|long|short|unsigned)\s+(\w+)/);
      if (forLoopVarMatch) {
        const varName = forLoopVarMatch[2];
        const column = originalLine.indexOf(varName);
        if (column >= 0) {
          // For-loop variable declarations create a new scope (like in C)
          // This allows shadowing of outer scope variables
          scopes.push(new Map());
          const forLoopScope = scopes[scopes.length - 1];
          forLoopScope.set(varName, { line: lineIndex, column, used: false });
        }
      }
      
      // Handle scope changes from braces AFTER for-loop variable handling
      const openCount = (cleanedLine.match(/{/g) || []).length;
      for (let i = 0; i < openCount; i++) {
        // Only create new scope if we haven't already created one for a for-loop
        if (!forLoopVarMatch) {
          scopes.push(new Map());
        }
      }
      
      // collect function calls and var usages for the second pass
      const funcCalls = [...trimmed.matchAll(/(\w+)\s*\(/g)];
      funcCalls.forEach(match => {
        const funcName = match[1];
        if (!this.isKeyword(funcName)) {
          const column = originalLine.indexOf(funcName);
          if (column >= 0) calledFunctions.set(funcName, { line: lineIndex, column });
        }
      });

  const funcDeclaration = trimmed.match(/^\s*(?:(?:inline|safecall|static)\s+)*?(?:task|sub|void|int|float|byte|char|string|bool|long|short|unsigned)\s+(\w+)\s*\(/);
      
      // Parse function parameters and add them to current scope
      if (funcDeclaration) {
        const funcMatch = trimmed.match(/^\s*(?:(?:inline|safecall|static)\s+)*?(?:task|sub|void|int|float|byte|char|string|bool|long|short|unsigned)\s+\w+\s*\(([^)]*)\)/);
        if (funcMatch && funcMatch[1].trim()) {
          const params = funcMatch[1].split(',');
          params.forEach(param => {
            const paramMatch = param.trim().match(/^\s*(int|float|byte|char|string|bool|mutex|long|short|unsigned)\s+(\w+)/);
            if (paramMatch) {
              const paramName = paramMatch[2];
              const currentScope = scopes[scopes.length - 1];
              if (!currentScope.has(paramName)) {
                const column = originalLine.indexOf(paramName);
                currentScope.set(paramName, { line: lineIndex, column: column >= 0 ? column : 0, used: false });
              }
            }
          });
        }
      }
  
      // Check variable usage in all non-preprocessor lines and non-macro continuation lines
      if (!trimmed.startsWith('#') && !inMultilineMacro) {
        const varUsages = [...trimmed.matchAll(/\b([a-zA-Z_][a-zA-Z0-9_]*)\b/g)];
        varUsages.forEach(match => {
          const varName = match[1];
          if (!this.isKeyword(varName) && !declaredMacros.has(varName) && !builtInFunctions.has(varName) && !this.isBuiltInConstant(varName)) {
            let found = false;
            for (let s = scopes.length - 1; s >= 0; s--) {
              if (scopes[s].has(varName)) {
                scopes[s].get(varName).used = true;
                found = true;
                break;
              }
            }
            // Check if it's an undefined variable (but not in function calls or variable declarations)
            if (!found && 
                !trimmed.match(new RegExp(`\\b${varName}\\s*\\(`)) && 
                !trimmed.match(new RegExp(`^\\s*(int|float|byte|char|string|bool|mutex|long|short|unsigned)\\s+${varName}\\b`))) {
              const column = originalLine.indexOf(varName);
              if (column >= 0) {
                this.addError(`Variable '${varName}' is not defined`, lineIndex, column, varName.length);
              }
            }
          }
        });
      }
      
      const closeCount = (cleanedLine.match(/}/g) || []).length;
      for (let i = 0; i < closeCount; i++) {
        if (scopes.length > 1) {
          scopes.pop();
        }
      }
    });

    // Additional semantic/syntax check: disallow array access immediately after a braced initializer
    // e.g. int y = {1, 2, 3}[0];  --> invalid in NXC
    try {
      const badInitRegex = /=\s*\{[\s\S]*?\}\s*\[/g; // matches '=' then a braced initializer then '['
      let m;
      while ((m = badInitRegex.exec(cleanedCode)) !== null) {
        const idx = m.index;
        // compute line/column
        const upto = sourceCode.substring(0, idx);
        const lineNum = upto.split(/\r?\n/).length - 1;
        const col = upto.split(/\r?\n/).pop().length;
        this.addError("Array access on braced initializer is not allowed", lineNum, col);
      }
    } catch (err) {
      // don't crash analysis on regex issues
      console.warn('Error checking braced-initializer accesses:', err.message);
    }
    
    scopes.forEach(scope => {
      for (const [varName, info] of scope) {
        if (!info.used && 
            !varName.match(/^[A-Z_][A-Z0-9_]*$/) &&
            !varName.startsWith('g') &&
            varName !== 'main' &&
            varName.length > 1) {
          // this.addWarning(`Variable '${varName}' declared but never used`, info.line, info.column, varName.length);
        }
      }
    });
    
    // Reintroduce helpful warnings: if an undefined function closely matches a built-in name,
    // warn with suggestion. Otherwise, do not warn to avoid noisy diagnostics.
    function levenshtein(a, b) {
      if (a === b) return 0;
      const m = a.length, n = b.length;
      const dp = Array.from({ length: m + 1 }, () => new Array(n + 1));
      for (let i = 0; i <= m; i++) dp[i][0] = i;
      for (let j = 0; j <= n; j++) dp[0][j] = j;
      for (let i = 1; i <= m; i++) {
        for (let j = 1; j <= n; j++) {
          const cost = a[i - 1] === b[j - 1] ? 0 : 1;
          dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + cost);
        }
      }
      return dp[m][n];
    }

    const builtInsArray = Array.from(builtInFunctions);
    for (const [funcName, info] of calledFunctions) {
      if (declaredFunctions.has(funcName) || declaredMacros.has(funcName)) continue;
      // find best match among built-ins
      let best = null;
      let bestDist = Infinity;
      for (const bi of builtInsArray) {
        const d = levenshtein(funcName.toLowerCase(), bi.toLowerCase());
        if (d < bestDist) { bestDist = d; best = bi; }
      }
      const threshold = funcName.length <= 4 ? 1 : 2;
      if (best && bestDist <= threshold) {
        this.addWarning(`Function '${funcName}' is not defined. Did you mean '${best}'?`, info.line, info.column, funcName.length);
      }
    }
  }

  removeCommentsAndStrings(sourceCode) {
    let result = '';
    let inSingleLineComment = false;
    let inMultiLineComment = false;
    let inString = false;
    let inChar = false;
    let escaped = false;

    for (let i = 0; i < sourceCode.length; i++) {
      const char = sourceCode[i];
      const nextChar = sourceCode[i + 1];

      if (escaped) {
        escaped = false;
        if (!inSingleLineComment && !inMultiLineComment) {
          result += ' ';
        }
        continue;
      }

      if (char === '\\' && (inString || inChar)) {
        escaped = true;
        if (!inSingleLineComment && !inMultiLineComment) {
          result += ' ';
        }
        continue;
      }

      if (inSingleLineComment) {
        if (char === '\n') {
          inSingleLineComment = false;
          result += char;
        } else {
          result += ' ';
        }
        continue;
      }

      if (inMultiLineComment) {
        if (char === '*' && nextChar === '/') {
          inMultiLineComment = false;
          result += '  ';
          i++;
        } else {
          result += char === '\n' ? char : ' ';
        }
        continue;
      }

      if (inString) {
        if (char === '"') {
          inString = false;
        }
        result += ' ';
        continue;
      }

      if (inChar) {
        if (char === "'") {
          inChar = false;
        }
        result += ' ';
        continue;
      }

      if (char === '/' && nextChar === '/') {
        inSingleLineComment = true;
        result += '  ';
        i++;
        continue;
      }

      if (char === '/' && nextChar === '*') {
        inMultiLineComment = true;
        result += '  ';
        i++;
        continue;
      }

      if (char === '"') {
        inString = true;
        result += ' ';
        continue;
      }

      if (char === "'") {
        inChar = true;
        result += ' ';
        continue;
      }

      result += char;
    }

    return result;
  }

  loadBuiltInFunctions() {
    const builtInFunctions = new Set();
    
    try {
      const fs = require('fs');
      const path = require('path');
      
      const apiPath = path.join(__dirname, '../../utils/nxc_api.txt');
      if (fs.existsSync(apiPath)) {
        const apiContent = fs.readFileSync(apiPath, 'utf8');
        const apiFunctions = apiContent.split('\n')
          .map(line => line.trim())
          .filter(line => line && !line.startsWith('//'))
          .map(line => {
            const match = line.match(/^([a-zA-Z_][a-zA-Z0-9_]*)\s*\(/);
            return match ? match[1] : null;
          })
          .filter(name => name);
        
        apiFunctions.forEach(fn => builtInFunctions.add(fn));
      }
    } catch (error) {
      console.warn('Could not load NXC API file:', error.message);
    }
    
    const essentialFunctions = [
      'OnFwd', 'OnRev', 'Off', 'Wait', 'CurrentTick', 'Sensor', 'ColorSensor', 'SensorUS',
      'SetSensorColorFull', 'SetSensorUltrasonic', 'ResetRotationCount', 'MotorRotationCount',
      'SetSensorType', 'SetSensorMode', 'ClearSensor', 'ResetSensor', 'SetSensor',
      'SetSensorTouch', 'SetSensorLight', 'SetSensorSound', 'SetSensorLowspeed',
      'SetSensorEMeter', 'SetSensorTemperature', 'SetSensorColorRed', 'SetSensorColorGreen',
      'SetSensorColorBlue', 'SetSensorColorNone', 'ClearScreen', 'ClearLine',
      'PlaySound', 'PlayTones', 'TextOut', 'NumOut', 'PointOut', 'LineOut', 'CircleOut',
      'RectOut', 'PolyOut', 'EllipseOut', 'FontTextOut', 'FontNumOut',
      'Sin', 'Cos', 'Tan', 'ASin', 'ACos', 'ATan', 'ATan2', 'Sinh', 'Cosh', 'Tanh',
      'Exp', 'Log', 'Log10', 'Sqrt', 'Pow', 'Ceil', 'Floor', 'Trunc', 'Frac', 'Sign',
      'Abs', 'Max', 'Min', 'Constrain', 'Map', 'Random', 'SRandom'
    ];
    
    essentialFunctions.forEach(fn => builtInFunctions.add(fn));
    
    return builtInFunctions;
  }

  isKeyword(word) {
    const keywords = new Set([
      'if', 'else', 'while', 'for', 'do', 'switch', 'case', 'default',
      'break', 'continue', 'return', 'goto', 'repeat', 'until',
      'task', 'sub', 'void', 'inline', 'safecall',
      'int', 'float', 'byte', 'char', 'string', 'bool', 'mutex', 'long', 'short', 'unsigned', 'signed', 'const',
      'struct', 'enum', 'typedef', 'variant',
      'true', 'false', 'TRUE', 'FALSE', 'NULL',
      'start', 'stop', 'priority', 'asm'
    ]);
    return keywords.has(word);
  }

  isBuiltInConstant(word) {
    const constants = new Set([
      'TRUE', 'FALSE', 'NULL', 'true', 'false',
      'OUT_A', 'OUT_B', 'OUT_C', 'OUT_AB', 'OUT_AC', 'OUT_BC', 'OUT_ABC',
      'IN_1', 'IN_2', 'IN_3', 'IN_4', 
      'SENSOR_1', 'SENSOR_2', 'SENSOR_3', 'SENSOR_4',
      'LCD_LINE1', 'LCD_LINE2', 'LCD_LINE3', 'LCD_LINE4', 'LCD_LINE5', 'LCD_LINE6', 'LCD_LINE7', 'LCD_LINE8',
      'NO_ERR', 'ERR_ARG', 'ERR_INVAL', 'ERR_FILE', 'ERR_COMM',
      'COL_BLACK', 'COL_BLUE', 'COL_GREEN', 'COL_YELLOW', 'COL_RED', 'COL_WHITE', 'COL_BROWN',
      // Output mode constants
      'OUT_MODE_MOTORON', 'OUT_MODE_BRAKE', 'OUT_MODE_REGULATED', 'OUT_MODE_COAST',
      'OUT_REGMODE_IDLE', 'OUT_REGMODE_SPEED', 'OUT_REGMODE_SYNC',
      'OUT_RUNSTATE_IDLE', 'OUT_RUNSTATE_RAMPUP', 'OUT_RUNSTATE_RUNNING', 'OUT_RUNSTATE_RAMPDOWN'
    ]);
    return constants.has(word);
  }

  checkLinePatterns(line, lineIndex) {
    const trimmed = line.trim();
    
    if (trimmed.startsWith('//') || trimmed.startsWith('/*') || trimmed.startsWith('*') || !trimmed) {
      return;
    }
    
    if (this.shouldHaveSemicolon(trimmed)) {
      this.addWarning('Missing semicolon', lineIndex, line.length - 1);
    }
    
    if (line.length > 120) {
      this.addWarning('Line too long (>120 characters)', lineIndex, 120);
    }
    
    const leadingWhitespace = line.match(/^[\t ]+/);
    if (leadingWhitespace && leadingWhitespace[0].includes('\t') && leadingWhitespace[0].includes(' ')) {
      this.addWarning('Mixed tabs and spaces for indentation', lineIndex, 0);
    }
    
    this.checkUnterminatedStrings(line, lineIndex);
    
    const charMatches = trimmed.match(/'/g);
    if (charMatches && charMatches.length % 2 !== 0) {
      this.addError('Unterminated character literal', lineIndex, trimmed.indexOf("'"));
    }
  }

  shouldHaveSemicolon(line) {
    const trimmed = line.trim();
    
    // Remove inline comments for analysis
    const codeOnly = trimmed.replace(/\/\/.*$/, '').trim();
    
    // Lines that should NOT have semicolons
    if (!codeOnly || 
        trimmed.startsWith('//') || 
        trimmed.startsWith('/*') || 
        trimmed.startsWith('*') ||
        codeOnly.endsWith(';') || 
        codeOnly.endsWith('{') || 
        codeOnly.endsWith('}') || 
        trimmed.startsWith('#') ||
        codeOnly.match(/^\s*}\s*$/) ||
        codeOnly.match(/^\s*{\s*$/) ||
        codeOnly.match(/^\s*}\s*else/)) {
      return false;
    }
    
    // Control structures that don't need semicolons
    if (codeOnly.match(/^\s*(if|while|for|until|repeat|switch)\s*\(/) ||
        codeOnly.match(/^\s*else\s*$/) ||
        codeOnly.includes('case ') ||
        codeOnly.includes('default:')) {
      return false;
    }
    
    // Function/task declarations don't need semicolons
    if (codeOnly.match(/^\s*(task|sub|void|int|float|bool|byte|char|string|long|short|unsigned)\s+\w+\s*\([^)]*\)\s*\{?\s*$/)) {
      return false;
    }
    
    // Variable declarations that should have semicolons
    if (codeOnly.match(/^\s*(int|float|bool|byte|char|string|long|short|unsigned)\s+\w+/)) {
      return true;
    }
    
    // Assignment statements that should have semicolons
    if (codeOnly.match(/^\s*\w+\s*=/)) {
      return true;
    }
    
    // Function calls that should have semicolons (but not control structures)
    if (codeOnly.match(/^\s*\w+\s*\([^)]*\)\s*$/) && 
        !codeOnly.match(/^\s*(if|while|for|until|repeat|switch)\s*\(/)) {
      return true;
    }
    
    // Return, break, continue statements
    if (codeOnly.match(/^\s*(return|break|continue)(\s|$)/)) {
      return true;
    }
    
    return false;
  }

  addError(message, line, column, length = 1) {
    this.errors.push({
      message,
      position: 0,
      line,
      column,
      severity: 'error',
      source: 'simple-parser',
      range: {
        start: { line, character: column },
        end: { line, character: column + length }
      }
    });
  }

  addWarning(message, line, column, length = 1) {
    this.warnings.push({
      message,
      position: 0,
      line,
      column,
      severity: 'warning',
      source: 'simple-parser',
      range: {
        start: { line, character: column },
        end: { line, character: column + length }
      }
    });
  }

  checkUnterminatedStrings(line, lineIndex) {
    let inString = false;
    let escaped = false;
    let stringStart = -1;
    
    for (let i = 0; i < line.length; i++) {
      const char = line[i];
      const next = line[i + 1];
      
      if (escaped) {
        escaped = false;
        continue;
      }
      
      if (char === '\\' && inString) {
        escaped = true;
        continue;
      }
      
      if (inString && char === '/' && next === '/') {
        this.addError('Unterminated string literal before comment', lineIndex, stringStart);
        return;
      }
      
      if (!inString && char === '/' && next === '/') {
        break;
      }
      
      if (char === '"') {
        if (inString) {
          inString = false;
          stringStart = -1;
        } else {
          inString = true;
          stringStart = i;
        }
      }
    }
    
    if (inString && stringStart >= 0) {
      this.addError('Unterminated string literal', lineIndex, stringStart);
    }
  }

  checkBalancing(line, lineIndex) {
    let inString = false;
    let inComment = false;
    let escaped = false;
    
    for (let i = 0; i < line.length; i++) {
      const char = line[i];
      const nextChar = line[i + 1];
      
      if (escaped) {
        escaped = false;
        continue;
      }
      
      if (char === '\\' && inString) {
        escaped = true;
        continue;
      }
      
      if (!inString && char === '/' && nextChar === '/') {
        inComment = true;
        break;
      }
      
      if (inComment) {
        break;
      }
      
      if (char === '"') {
        inString = !inString;
        continue;
      }
      
      if (inString) {
        continue;
      }
      
      switch (char) {
        case '{':
          this.braceCount++;
          this.braceStack.push({ line: lineIndex, column: i, type: 'brace' });
          break;
          
        case '}':
          this.braceCount--;
          if (this.braceCount < 0) {
            this.addError('Closing brace without matching opening brace', lineIndex, i);
            this.braceCount = 0;
          } else {
            this.braceStack.pop();
          }
          break;
          
        case '(':
          this.parenCount++;
          break;
          
        case ')':
          this.parenCount--;
          if (this.parenCount < 0) {
            this.addError('Closing parenthesis without matching opening parenthesis', lineIndex, i);
            this.parenCount = 0;
          }
          break;
          
        case '[':
          this.bracketCount++;
          break;
          
        case ']':
          this.bracketCount--;
          if (this.bracketCount < 0) {
            this.addError('Closing bracket without matching opening bracket', lineIndex, i);
            this.bracketCount = 0;
          }
          break;
      }
    }
  }
}

module.exports = { SimpleNXCParser };