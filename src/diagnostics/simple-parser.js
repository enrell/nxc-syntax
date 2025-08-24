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
    
    // Reset counters
    this.braceCount = 0;
    this.parenCount = 0;
    this.bracketCount = 0;
    this.braceStack = [];
    
    // First step: check warnings on all lines
    lines.forEach((line, lineIndex) => {
      this.checkLinePatterns(line, lineIndex);
    });
    
    // Second step: check balancing (improved to handle strings and comments)
    lines.forEach((line, lineIndex) => {
      this.checkBalancing(line, lineIndex);
    });
    
    // Check for unclosed braces
    if (this.braceCount > 0) {
      const lastBrace = this.braceStack[this.braceStack.length - 1];
      if (lastBrace) {
        this.addError('Opening brace without matching closing brace', lastBrace.line, lastBrace.column);
      } else {
        this.addError('Unbalanced braces - missing closing braces', lines.length - 1, 0);
      }
    }
    
    // Check unclosed parentheses
    if (this.parenCount > 0) {
      this.addError('Unbalanced parentheses - missing closing parentheses', lines.length - 1, 0);
    }
    
    // Check unclosed brackets
    if (this.bracketCount > 0) {
      this.addError('Unbalanced brackets - missing closing brackets', lines.length - 1, 0);
    }
    
    // Basic semantic analysis
    this.performSemanticAnalysis(sourceCode);
    
    console.log(`SimpleParser: Found ${this.errors.length} errors and ${this.warnings.length} warnings`);
  }

  performSemanticAnalysis(sourceCode) {
    // Remove comments and strings to avoid false positives
    const cleanedCode = this.removeCommentsAndStrings(sourceCode);
    const lines = sourceCode.split(/\r?\n/);
    const cleanedLines = cleanedCode.split(/\r?\n/);
    
    // Load built-in functions
    const builtInFunctions = this.loadBuiltInFunctions();
    
    // Track functions
    const declaredFunctions = new Set(builtInFunctions);
    
    // Track called functions
    const calledFunctions = new Map(); // name -> {line, column}
    
    // Scope stack for variables: array of Maps (index 0 is global)
    let scopes = [new Map()]; // Start with global scope
    
    cleanedLines.forEach((cleanedLine, lineIndex) => {
      const originalLine = lines[lineIndex];
      const trimmed = cleanedLine.trim();
      
      // Skip empty lines
      if (!trimmed) {
        return;
      }
      
      // Detect function/task declarations
      const funcDeclaration = trimmed.match(/^\s*(?:task|sub|void|int|float|byte|char|string|bool|long|short|unsigned)\s+(\w+)\s*\(/);
      if (funcDeclaration) {
        const funcName = funcDeclaration[1];
        const column = originalLine.indexOf(funcName);
        if (declaredFunctions.has(funcName)) {
          this.addError(`Function '${funcName}' already defined`, lineIndex, column, funcName.length);
        } else {
          declaredFunctions.add(funcName);
        }
      }
      
      // Detect variable declarations
      const varDeclarationMatch = trimmed.match(/^\s*(int|float|byte|char|string|bool|mutex|long|short|unsigned)\s+(\w+)/);
      if (varDeclarationMatch) {
        const varName = varDeclarationMatch[2];
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
      
      // Detect function calls
      const funcCalls = [...trimmed.matchAll(/(\w+)\s*\(/g)];
      funcCalls.forEach(match => {
        const funcName = match[1];
        if (!this.isKeyword(funcName)) {
          const column = originalLine.indexOf(funcName);
          if (column >= 0) {
            calledFunctions.set(funcName, { line: lineIndex, column });
          }
        }
      });
      
      // Detect variable usage (excluding declaration lines and function def lines)
      if (!varDeclarationMatch && !funcDeclaration) {
        const varUsages = [...trimmed.matchAll(/\b(\w+)\b/g)];
        varUsages.forEach(match => {
          const varName = match[1];
          if (!this.isKeyword(varName)) {
            // Find the variable in scopes, from inner to outer
            for (let s = scopes.length - 1; s >= 0; s--) {
              if (scopes[s].has(varName)) {
                scopes[s].get(varName).used = true;
                break;
              }
            }
          }
        });
      }
      
      // Update scopes based on braces in this line
      const openCount = (cleanedLine.match(/{/g) || []).length;
      for (let i = 0; i < openCount; i++) {
        scopes.push(new Map());
      }
      
      const closeCount = (cleanedLine.match(/}/g) || []).length;
      for (let i = 0; i < closeCount; i++) {
        if (scopes.length > 1) {
          scopes.pop();
        }
      }
    });
    
    // Check unused variables (lenient)
    scopes.forEach(scope => {
      for (const [varName, info] of scope) {
        if (!info.used && 
            !varName.match(/^[A-Z_][A-Z0-9_]*$/) && // Skip constants
            !varName.startsWith('g') && // Skip globals prefix
            varName !== 'main' &&
            varName.length > 1) {
          // this.addWarning(`Variable '${varName}' declared but never used`, info.line, info.column, varName.length);
        }
      }
    });
    
    // Check undefined functions
    for (const [funcName, info] of calledFunctions) {
      if (!declaredFunctions.has(funcName)) {
        this.addError(`Function '${funcName}' is not defined`, info.line, info.column, funcName.length);
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
      
      // Load from NXC API file
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
    
    // Add essential built-ins as fallback (only real NXC built-in functions)
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
      // Removed 'main' as it should be user-defined
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

  checkLinePatterns(line, lineIndex) {
    const trimmed = line.trim();
    
    // Skip comment lines entirely
    if (trimmed.startsWith('//') || trimmed.startsWith('/*') || trimmed.startsWith('*') || !trimmed) {
      return;
    }
    
    // Check missing semicolon (heuristic)
    if (this.shouldHaveSemicolon(trimmed)) {
      this.addWarning('Possible missing semicolon', lineIndex, line.length);
    }
    
    // Check line too long
    if (line.length > 120) {
      this.addWarning('Line too long (>120 characters)', lineIndex, 120);
    }
    
    // Check mixed tabs and spaces in indentation
    const leadingWhitespace = line.match(/^[\t ]+/);
    if (leadingWhitespace && leadingWhitespace[0].includes('\t') && leadingWhitespace[0].includes(' ')) {
      this.addWarning('Mixed tabs and spaces for indentation', lineIndex, 0);
    }
    
    // Check unterminated strings
    this.checkUnterminatedStrings(line, lineIndex);
    
    // Check unterminated characters
    const charMatches = trimmed.match(/'/g);
    if (charMatches && charMatches.length % 2 !== 0) {
      this.addError('Unterminated character literal', lineIndex, trimmed.indexOf("'"));
    }
  }

  shouldHaveSemicolon(line) {
    const trimmed = line.trim();
    
    // Skip various cases
    if (!trimmed || 
        trimmed.startsWith('//') || 
        trimmed.startsWith('/*') || 
        trimmed.startsWith('*') ||
        trimmed.endsWith(';') || 
        trimmed.endsWith('{') || 
        trimmed.endsWith('}') || 
        trimmed.startsWith('#') ||
        trimmed.includes('if(') ||
        trimmed.includes('if (') ||
        trimmed.includes('while(') ||
        trimmed.includes('while (') ||
        trimmed.includes('for(') ||
        trimmed.includes('for (') ||
        trimmed.includes('else') ||
        trimmed.includes('task ') ||
        trimmed.includes('sub ') ||
        trimmed.includes('void ') ||
        trimmed.match(/^\s*(int|float|bool|byte|char|string|typedef|struct|enum)\s/) ||
        trimmed.includes('switch(') ||
        trimmed.includes('switch (') ||
        trimmed.includes('case ') ||
        trimmed.includes('default:') ||
        trimmed.match(/^\s*}\s*$/) ||
        trimmed.match(/^\s*{\s*$/) ||
        // Function definitions
        trimmed.match(/^\s*\w+\s+\w+\s*\([^)]*\)\s*\{?\s*$/)) {
      return false;
    }
    
    // Currently disabled
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
        // Potential comment start while in string - treat as unterminated
        this.addError('Unterminated string literal before comment', lineIndex, stringStart);
        return; // Stop checking this line
      }
      
      if (!inString && char === '/' && next === '/') {
        break; // Comment starts, stop checking
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
      
      // Check for comment start
      if (!inString && char === '/' && nextChar === '/') {
        inComment = true;
        break; // Rest of line is comment
      }
      
      // Skip if we're in a comment
      if (inComment) {
        break;
      }
      
      // Handle strings
      if (char === '"') {
        inString = !inString;
        continue;
      }
      
      // Skip balancing checks if we're inside a string
      if (inString) {
        continue;
      }
      
      // Check balancing for characters outside strings and comments
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