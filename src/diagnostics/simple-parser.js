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
      return {
        isValid: false,
        errors: [
          {
            message: `Internal error: ${error.message}`,
            position: 0,
            line: 0,
            column: 0,
            severity: 'error',
            source: 'simple-parser'
          }
        ],
        warnings: []
      };
    }
  }

  analyzeBasicSyntax(sourceCode) {
    const lines = sourceCode.split(/\r?\n/);

    this.resetCounters();

    lines.forEach((line, lineIndex) => {
      this.checkLinePatterns(line, lineIndex);
    });

    lines.forEach((line, lineIndex) => {
      this.checkBalancing(line, lineIndex);
    });

    this.checkUnclosedBrackets(lines);
    this.performSemanticAnalysis(sourceCode);
  }

  resetCounters() {
    this.braceCount = 0;
    this.parenCount = 0;
    this.bracketCount = 0;
    this.braceStack = [];
  }

  checkUnclosedBrackets(lines) {
    if (this.braceCount > 0) {
      const lastBrace = this.braceStack[this.braceStack.length - 1];
      if (lastBrace) {
        this.addError(
          'Opening brace without matching closing brace',
          lastBrace.line,
          lastBrace.column
        );
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
  }

  performSemanticAnalysis(sourceCode) {
    const cleanedCode = this.removeCommentsAndStrings(sourceCode);
    const lines = sourceCode.split(/\r?\n/);
    const cleanedLines = cleanedCode.split(/\r?\n/);

    const builtInFunctions = this.loadBuiltInFunctions();
    const declaredFunctions = new Map();
    builtInFunctions.forEach((fn) => declaredFunctions.set(fn, { line: -1, conditional: false }));
    const calledFunctions = new Map();
    const declaredMacros = new Set();
    let conditionalDepth = 0;

    this.scanDeclarations(cleanedLines, lines, declaredFunctions, declaredMacros, conditionalDepth);

    const scopes = [new Map()];
    let inMultilineMacro = false;

    cleanedLines.forEach((cleanedLine, lineIndex) => {
      const originalLine = lines[lineIndex];
      const trimmed = cleanedLine.trim();

      if (!trimmed) {
        return;
      }

      if (this.isMultilineMacroEnd(inMultilineMacro, trimmed, lines, lineIndex)) {
        inMultilineMacro = trimmedLineEndsWithBackslash(trimmed, originalLine);
      } else if (trimmedLine.startsWith('#define') && originalLine.trim().endsWith('\\')) {
        if (trimmedLineEndsWithBackslash(trimmed, originalLine)) {
          inMultilineMacro = true;
        }
      }

      if (inMultilineMacro && !trimmed.startsWith('#')) {
        return;
      }

      conditionalDepth = this.updateConditionalDepth(trimmed, conditionalDepth);

      const funcDeclaration = trimmed.match(
        /^\s*(?:(?:inline|safecall|static)\s+)*?(?:task|sub|void|int|float|byte|char|string|bool|long|short|unsigned)\s+(\w+)\s*\(/
      );

      this.analyzeLineForVariables(trimmed, originalLine, lineIndex, scopes, funcDeclaration);
      this.handleForLoopVariables(trimmed, originalLine, lineIndex, scopes, funcDeclaration);
      this.manageScopesAndDeclarations(
        cleanedLine,
        trimmed,
        originalLine,
        lineIndex,
        scopes,
        funcDeclaration,
        calledFunctions,
        builtInFunctions,
        declaredMacros
      );
      this.analyzeVariableUsages(
        trimmed,
        originalLine,
        lineIndex,
        scopes,
        builtInFunctions,
        declaredFunctions,
        declaredMacros,
        inMultilineMacro,
        funcDeclaration
      );
    });

    this.checkBracedInitializerAccesses(cleanedCode, sourceCode);
    this.suggestAlternativeFunctions(
      calledFunctions,
      declaredFunctions,
      declaredMacros,
      builtInFunctions
    );
  }

  isMultilineMacroEnd(inMultilineMacro, trimmed, lines, lineIndex) {
    if (inMultilineMacro && lineIndex > 0) {
      const prevLine = lines[lineIndex - 1].trim();
      return !prevLine.endsWith('\\');
    }
    return false;
  }

  trimmedLineEndsWithBackslash(trimmed, originalLine) {
    return originalLine.trim().endsWith('\\') && trimmed.startsWith('#define');
  }

  scanDeclarations(cleanedLines, lines, declaredFunctions, declaredMacros, conditionalDepth) {
    cleanedLines.forEach((cleanedLine, lineIndex) => {
      const trimmed = cleanedLine.trim();
      if (!trimmed) {
        return;
      }

      const macroDefinition = trimmed.match(/^\s*#\s*define\s+([a-zA-Z_][a-zA-Z0-9_]*)/);
      if (macroDefinition) {
        declaredMacros.add(macroDefinition[1]);
      }

      conditionalDepth = this.updateConditionalDepth(trimmed, conditionalDepth);

      const funcDeclaration = trimmed.match(
        /^\s*(?:(?:inline|safecall|static)\s+)*?(?:task|sub|void|int|float|byte|char|string|bool|long|short|unsigned)\s+(\w+)\s*\(/
      );
      if (funcDeclaration) {
        const funcName = funcDeclaration[1];
        const isConditional = conditionalDepth > 0;
        this.handleFunctionDeclaration(
          funcName,
          lineIndex,
          lines[lineIndex],
          declaredFunctions,
          isConditional
        );
      }
    });
  }

  handleFunctionDeclaration(funcName, lineIndex, originalLine, declaredFunctions, isConditional) {
    if (!declaredFunctions.has(funcName)) {
      declaredFunctions.set(funcName, { line: lineIndex, conditional: isConditional });
    } else {
      const existing = declaredFunctions.get(funcName);
      if (!existing.conditional && !isConditional) {
        const column = originalLine.indexOf(funcName);
        this.addError(
          `Function/task '${funcName}' already declared at line ${existing.line + 1}`,
          lineIndex,
          column,
          funcName.length
        );
      } else if (!existing.conditional || !isConditional) {
        const column = originalLine.indexOf(funcName);
        this.addError(
          `Function/task '${funcName}' conflicts with declaration at line ${existing.line + 1}`,
          lineIndex,
          column,
          funcName.length
        );
      } else if (existing.conditional && !isConditional) {
        declaredFunctions.set(funcName, { line: lineIndex, conditional: false });
      }
    }
  }

  updateConditionalDepth(trimmed, currentDepth) {
    const pp = trimmed.match(/^#\s*(if|ifdef|ifndef|else|endif)\b/);
    if (!pp) {
      return currentDepth;
    }

    const directive = pp[1];
    if (directive === 'if' || directive === 'ifdef' || directive === 'ifndef') {
      return currentDepth + 1;
    } else if (directive === 'endif') {
      return Math.max(0, currentDepth - 1);
    }
    return currentDepth;
  }

  analyzeLineForVariables(trimmed, originalLine, lineIndex, scopes, funcDeclaration) {
    if (funcDeclaration) {
      return;
    }

    const allVarDeclarations = [
      ...trimmed.matchAll(
        /\b(int|float|byte|char|string|bool|mutex|long|short|unsigned)\s+([a-zA-Z_][a-zA-Z0-9_]*(?:\s*=\s*[^,;]+)?(?:\s*,\s*[a-zA-Z_][a-zA-Z0-9_]*(?:\s*=\s*[^,;]+)?)*)/g
      )
    ];

    allVarDeclarations.forEach((match) => {
      if (
        trimmed.match(/for\s*\(\s*(int|float|byte|char|string|bool|mutex|long|short|unsigned)\s+/)
      ) {
        return;
      }

      const varList = match[2];
      const varNames = this.splitTopLevelCommas(varList)
        .map((v) => {
          const trimmed = v.trim();
          const varMatch = trimmed.match(/^([a-zA-Z_][a-zA-Z0-9_]*)/);
          return varMatch ? varMatch[1] : null;
        })
        .filter((name) => name);

      varNames.forEach((varName) => {
        if (varName && varName.match(/^[a-zA-Z_][a-zA-Z0-9_]*$/)) {
          const column = originalLine.indexOf(varName);
          if (column >= 0) {
            const currentScope = scopes[scopes.length - 1];
            if (currentScope.has(varName)) {
              const existing = currentScope.get(varName);
              this.addError(
                `Variable '${varName}' already declared at line ${existing.line + 1}`,
                lineIndex,
                column,
                varName.length
              );
            } else {
              currentScope.set(varName, { line: lineIndex, column, used: false });
            }
          }
        }
      });
    });
  }

  handleForLoopVariables(trimmed, originalLine, lineIndex, scopes, funcDeclaration) {
    const forLoopVarMatch = trimmed.match(
      /for\s*\(\s*(int|float|byte|char|string|bool|mutex|long|short|unsigned)\s+(\w+)/
    );
    if (forLoopVarMatch) {
      const varName = forLoopVarMatch[2];
      const column = originalLine.indexOf(varName);
      if (column >= 0) {
        scopes.push(new Map());
        const forLoopScope = scopes[scopes.length - 1];
        forLoopScope.set(varName, { line: lineIndex, column, used: false });
      }
    }
  }

  manageScopesAndDeclarations(
    cleanedLine,
    trimmed,
    originalLine,
    lineIndex,
    scopes,
    funcDeclaration,
    calledFunctions,
    builtInFunctions,
    declaredMacros
  ) {
    const openCount = (cleanedLine.match(/{/g) || []).length;
    for (let i = 0; i < openCount; i++) {
      if (
        !trimmed.match(
          /for\s*\(\s*(int|float|byte|char|string|bool|mutex|long|short|unsigned)\s+/
        ) &&
        !funcDeclaration
      ) {
        scopes.push(new Map());
      }
    }

    if (!trimmed.startsWith('#')) {
      const funcCalls = [...trimmed.matchAll(/(\w+)\s*\(/g)];
      funcCalls.forEach((match) => {
        const funcName = match[1];
        if (!this.isKeyword(funcName)) {
          const column = originalLine.indexOf(funcName);
          if (column >= 0) {
            calledFunctions.set(funcName, { line: lineIndex, column });
          }
        }
      });
    }

    if (funcDeclaration) {
      scopes.push(new Map());
      const funcMatch = trimmed.match(
        /^\s*(?:(?:inline|safecall|static)\s+)*?(?:task|sub|void|int|float|byte|char|string|bool|long|short|unsigned)\s+\w+\s*\(([^)]*)\)/
      );
      if (funcMatch && funcMatch[1].trim()) {
        const params = funcMatch[1].split(',');
        params.forEach((param) => {
          const paramMatch = param
            .trim()
            .match(/^\s*(int|float|byte|char|string|bool|mutex|long|short|unsigned)\s+(\w+)/);
          if (paramMatch) {
            const paramName = paramMatch[2];
            const functionScope = scopes[scopes.length - 1];
            functionScope.set(paramName, {
              line: lineIndex,
              column: originalLine.indexOf(paramName),
              used: false
            });
          }
        });
      }
    }

    const closeCount = (cleanedLine.match(/}/g) || []).length;
    for (let i = 0; i < closeCount; i++) {
      if (scopes.length > 1) {
        scopes.pop();
      }
    }
  }

  analyzeVariableUsages(
    trimmed,
    originalLine,
    lineIndex,
    scopes,
    builtInFunctions,
    declaredFunctions,
    declaredMacros,
    inMultilineMacro,
    funcDeclaration
  ) {
    if (trimmed.startsWith('#') || inMultilineMacro || funcDeclaration) {
      return;
    }

    const varUsages = [...trimmed.matchAll(/\b([a-zA-Z_][a-zA-Z0-9_]*)\b/g)];
    varUsages.forEach((match) => {
      const varName = match[1];
      if (
        !this.isKeyword(varName) &&
        !declaredMacros.has(varName) &&
        !builtInFunctions.has(varName) &&
        !declaredFunctions.has(varName)
      ) {
        let found = false;
        for (let s = scopes.length - 1; s >= 0; s--) {
          if (scopes[s].has(varName)) {
            scopes[s].get(varName).used = true;
            found = true;
            break;
          }
        }
        if (
          !found &&
          !trimmed.match(new RegExp(`\\b${varName}\\s*\\(`)) &&
          !trimmed.match(
            new RegExp(
              `^\\s*(int|float|byte|char|string|bool|mutex|long|short|unsigned)\\s+${varName}\\b`
            )
          )
        ) {
          const column = originalLine.indexOf(varName);
          if (column >= 0) {
            this.addError(
              `Variable '${varName}' is not defined`,
              lineIndex,
              column,
              varName.length
            );
          }
        }
      }
    });
  }

  checkBracedInitializerAccesses(cleanedCode, sourceCode) {
    try {
      const badInitRegex = /=\s*\{[\s\S]*?\}\s*\[/g;
      let m;
      while ((m = badInitRegex.exec(cleanedCode)) !== null) {
        const idx = m.index;
        const upto = sourceCode.substring(0, idx);
        const lineNum = upto.split(/\r?\n/).length - 1;
        const col = upto.split(/\r?\n/).pop().length;
        this.addError('Array access on braced initializer is not allowed', lineNum, col);
      }
    } catch (err) {
      vscode.window.showWarningMessage(
        `Error checking braced-initializer accesses: ${err.message}`
      );
    }
  }

  suggestAlternativeFunctions(
    calledFunctions,
    declaredFunctions,
    declaredMacros,
    builtInFunctions
  ) {
    const builtInsArray = Array.from(builtInFunctions);
    for (const [funcName, info] of calledFunctions) {
      if (declaredFunctions.has(funcName) || declaredMacros.has(funcName)) {
        continue;
      }
      let best = null;
      let bestDist = Infinity;
      for (const bi of builtInsArray) {
        const d = this.levenshtein(funcName.toLowerCase(), bi.toLowerCase());
        if (d < bestDist) {
          bestDist = d;
          best = bi;
        }
      }
      const threshold = funcName.length <= 4 ? 1 : 2;
      if (best && bestDist <= threshold) {
        this.addWarning(
          `Function '${funcName}' is not defined. Did you mean '${best}'?`,
          info.line,
          info.column,
          funcName.length
        );
      }
    }
  }

  levenshtein(a, b) {
    if (a === b) {
      return 0;
    }
    const m = a.length,
      n = b.length;
    const dp = Array.from({ length: m + 1 }, () => new Array(n + 1));
    for (let i = 0; i <= m; i++) {
      dp[i][0] = i;
    }
    for (let j = 0; j <= n; j++) {
      dp[0][j] = j;
    }
    for (let i = 1; i <= m; i++) {
      for (let j = 1; j <= n; j++) {
        const cost = a[i - 1] === b[j - 1] ? 0 : 1;
        dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + cost);
      }
    }
    return dp[m][n];
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

      if (char === '/' && (nextChar === '/' || this.peekNextNonSpace(sourceCode, i) === '/')) {
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

  peekNextNonSpace(sourceCode, index) {
    let j = index + 1;
    while (j < sourceCode.length && (sourceCode[j] === ' ' || sourceCode[j] === '\t')) {
      j++;
    }
    return sourceCode[j];
  }

  splitTopLevelCommas(s) {
    const parts = [];
    let buf = '';
    let paren = 0,
      brace = 0,
      bracket = 0;
    let inString = false,
      inChar = false,
      escaped = false;

    for (let i = 0; i < s.length; i++) {
      const ch = s[i];
      if (escaped) {
        buf += ch;
        escaped = false;
        continue;
      }
      if (ch === '\\') {
        buf += ch;
        escaped = true;
        continue;
      }
      if (ch === '"' && !inChar) {
        inString = !inString;
        buf += ch;
        continue;
      }
      if (ch === "'" && !inString) {
        inChar = !inChar;
        buf += ch;
        continue;
      }
      if (inString || inChar) {
        buf += ch;
        continue;
      }
      if (ch === '(') {
        paren++;
        buf += ch;
        continue;
      }
      if (ch === ')') {
        if (paren > 0) paren--;
        buf += ch;
        continue;
      }
      if (ch === '{') {
        brace++;
        buf += ch;
        continue;
      }
      if (ch === '}') {
        if (brace > 0) brace--;
        buf += ch;
        continue;
      }
      if (ch === '[') {
        bracket++;
        buf += ch;
        continue;
      }
      if (ch === ']') {
        if (bracket > 0) bracket--;
        buf += ch;
        continue;
      }
      if (ch === ',' && paren === 0 && brace === 0 && bracket === 0) {
        parts.push(buf);
        buf = '';
        continue;
      }
      buf += ch;
    }
    if (buf.length) {
      parts.push(buf);
    }
    return parts;
  }

  loadBuiltInFunctions() {
    const builtInFunctions = new Set();

    try {
      const fs = require('fs');
      const path = require('path');

      const apiPath = path.join(__dirname, '../../utils/nxc_api.txt');
      if (fs.existsSync(apiPath)) {
        const apiContent = fs.readFileSync(apiPath, 'utf8');
        const apiFunctions = apiContent
          .split('\n')
          .map((line) => line.trim())
          .filter((line) => line && !line.startsWith('//'))
          .map((line) => {
            const match = line.match(/^([a-zA-Z_][a-zA-Z0-9_]*)\s*\(/);
            return match ? match[1] : null;
          })
          .filter((name) => name);

        apiFunctions.forEach((fn) => builtInFunctions.add(fn));
      }
    } catch (error) {
      const vscode = require('vscode');
      vscode.window.showWarningMessage(`Could not load NXC API file: ${error.message}`);
    }

    const essentialFunctions = [
      'OnFwd',
      'OnRev',
      'Off',
      'Wait',
      'CurrentTick',
      'Sensor',
      'ColorSensor',
      'SensorUS',
      'SetSensorColorFull',
      'SetSensorUltrasonic',
      'ResetRotationCount',
      'MotorRotationCount',
      'SetSensorType',
      'SetSensorMode',
      'ClearSensor',
      'ResetSensor',
      'SetSensor',
      'SetSensorTouch',
      'SetSensorLight',
      'SetSensorSound',
      'SetSensorLowspeed',
      'SetSensorEMeter',
      'SetSensorTemperature',
      'SetSensorColorRed',
      'SetSensorColorGreen',
      'SetSensorColorBlue',
      'SetSensorColorNone',
      'ClearScreen',
      'ClearLine',
      'PlaySound',
      'PlayTones',
      'TextOut',
      'NumOut',
      'PointOut',
      'LineOut',
      'CircleOut',
      'RectOut',
      'PolyOut',
      'EllipseOut',
      'FontTextOut',
      'FontNumOut',
      'Sin',
      'Cos',
      'Tan',
      'ASin',
      'ACos',
      'ATan',
      'ATan2',
      'Sinh',
      'Cosh',
      'Tanh',
      'Exp',
      'Log',
      'Log10',
      'Sqrt',
      'Pow',
      'Ceil',
      'Floor',
      'Trunc',
      'Frac',
      'Sign',
      'Abs',
      'Max',
      'Min',
      'Constrain',
      'Map',
      'Random',
      'SRandom'
    ];

    essentialFunctions.forEach((fn) => builtInFunctions.add(fn));

    return builtInFunctions;
  }

  isKeyword(word) {
    const keywords = new Set([
      'if',
      'else',
      'while',
      'for',
      'do',
      'switch',
      'case',
      'default',
      'break',
      'continue',
      'return',
      'goto',
      'repeat',
      'until',
      'task',
      'sub',
      'void',
      'inline',
      'safecall',
      'int',
      'float',
      'byte',
      'char',
      'string',
      'bool',
      'mutex',
      'long',
      'short',
      'unsigned',
      'signed',
      'const',
      'struct',
      'enum',
      'typedef',
      'variant',
      'true',
      'false',
      'TRUE',
      'FALSE',
      'NULL',
      'start',
      'stop',
      'priority',
      'asm'
    ]);
    return keywords.has(word);
  }

  checkLinePatterns(line, lineIndex) {
    const trimmed = line.trim();

    if (
      trimmed.startsWith('//') ||
      trimmed.startsWith('/*') ||
      trimmed.startsWith('*') ||
      !trimmed
    ) {
      return;
    }

    if (this.shouldHaveSemicolon(trimmed)) {
      this.addWarning('Missing semicolon', lineIndex, line.length - 1);
    }

    if (line.length > 120) {
      this.addWarning('Line too long (>120 characters)', lineIndex, 120);
    }

    const leadingWhitespace = line.match(/^[\t ]+/);
    if (
      leadingWhitespace &&
      leadingWhitespace[0].includes('\t') &&
      leadingWhitespace[0].includes(' ')
    ) {
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
    const codeOnly = trimmed.replace(/\/\/.*$/, '').trim();

    if (
      !codeOnly ||
      trimmed.startsWith('//') ||
      trimmed.startsWith('/*') ||
      trimmed.startsWith('*') ||
      codeOnly.endsWith(';') ||
      codeOnly.endsWith('{') ||
      codeOnly.endsWith('}') ||
      trimmed.startsWith('#') ||
      codeOnly.match(/^\s*}\s*$/) ||
      codeOnly.match(/^\s*{\s*$/) ||
      codeOnly.match(/^\s*}\s*else/)
    ) {
      return false;
    }

    if (
      codeOnly.match(/^\s*(if|while|for|until|repeat|switch)\s*\(/) ||
      codeOnly.match(/^\s*else\s*$/) ||
      codeOnly.includes('case ') ||
      codeOnly.includes('default:')
    ) {
      return false;
    }

    if (
      codeOnly.match(
        /^\s*(task|sub|void|int|float|bool|byte|char|string|long|short|unsigned)\s+\w+\s*\([^)]*\)\s*\{?\s*$/
      )
    ) {
      return false;
    }

    const patterns = [
      /^\s*(int|float|bool|byte|char|string|long|short|unsigned)\s+\w+/,
      /^\s*\w+\s*=/,
      /^\s*\w+\s*\([^)]*\)\s*$/,
      /^\s*(return|break|continue)(\s|$)/
    ];

    return patterns.some((pattern) => pattern.test(codeOnly));
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
