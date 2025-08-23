class SimpleNXCParser {
  constructor() {
    this.errors = [];
    this.warnings = [];
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
    
    // Counters to check balancing
    let braceCount = 0;
    let parenCount = 0;
    let bracketCount = 0;
    
    // Stack to track context
    const braceStack = [];
    
    // First step: check warnings on all lines
    lines.forEach((line, lineIndex) => {
      this.checkLinePatterns(line, lineIndex);
    });
    
    // Second step: check balancing
    lines.forEach((line, lineIndex) => {
      const trimmed = line.trim();
      
      if (!trimmed || trimmed.startsWith('//') || trimmed.startsWith('/*')) {
        return;
      }
      
      // Check character balancing
      for (let i = 0; i < line.length; i++) {
        const char = line[i];
        const column = i;
        
        switch (char) {
          case '{':
            braceCount++;
            braceStack.push({ line: lineIndex, column, type: 'brace' });
            break;
            
          case '}':
            braceCount--;
            if (braceCount < 0) {
              this.addError('Closing brace without matching opening brace', lineIndex, column);
              braceCount = 0; // Reset to continue analysis
            } else {
              braceStack.pop();
            }
            break;
            
          case '(':
            parenCount++;
            break;
            
          case ')':
            parenCount--;
            if (parenCount < 0) {
              this.addError('Closing parenthesis without matching opening parenthesis', lineIndex, column);
              parenCount = 0;
            }
            break;
            
          case '[':
            bracketCount++;
            break;
            
          case ']':
            bracketCount--;
            if (bracketCount < 0) {
              this.addError('Closing bracket without matching opening bracket', lineIndex, column);
              bracketCount = 0;
            }
            break;
        }
      }
    });
    
    // Check for unclosed braces
    if (braceCount > 0) {
      const lastBrace = braceStack[braceStack.length - 1];
      if (lastBrace) {
        this.addError('Opening brace without matching closing brace', lastBrace.line, lastBrace.column);
      } else {
        this.addError('Unbalanced braces - missing closing braces', lines.length - 1, 0);
      }
    }
    
    // Check unclosed parentheses
    if (parenCount > 0) {
      this.addError('Unbalanced parentheses - missing closing parentheses', lines.length - 1, 0);
    }
    
    // Check unclosed brackets
    if (bracketCount > 0) {
      this.addError('Unbalanced brackets - missing closing brackets', lines.length - 1, 0);
    }
    
    // Basic semantic analysis
    this.performSemanticAnalysis(sourceCode);
    
    console.log(`SimpleParser: Found ${this.errors.length} errors and ${this.warnings.length} warnings`);
  }

  performSemanticAnalysis(sourceCode) {
    const lines = sourceCode.split(/\r?\n/);
    
    // Maps to track declarations and usage
    const declaredVariables = new Map(); // name -> {line, column, used}
    const declaredFunctions = new Set(['main', 'OnFwd', 'OnRev', 'Wait', 'PlaySound', 'PlayTone', 'ReadSensor', 'SetSensorType']);
    const calledFunctions = new Map(); // name -> {line, column}
    
    lines.forEach((line, lineIndex) => {
      const trimmed = line.trim();
      
      // Ignora comentários e linhas vazias
      if (!trimmed || trimmed.startsWith('//') || trimmed.startsWith('/*')) {
        return;
      }
      
      // Detect variable declarations
      const varDeclaration = trimmed.match(/^\s*(int|float|byte|char|string|bool|mutex)\s+(\w+)/);
      if (varDeclaration) {
        const varName = varDeclaration[2];
        const column = line.indexOf(varName);
        declaredVariables.set(varName, { line: lineIndex, column, used: false });
      }
      
      // Detect function/task declarations
      const funcDeclaration = trimmed.match(/^\s*(?:task|sub|void|int|float|byte|char|string|bool)\s+(\w+)\s*\(/);
      if (funcDeclaration) {
        const funcName = funcDeclaration[1];
        declaredFunctions.add(funcName);
      }
      
      // Detect function calls
      const funcCalls = [...trimmed.matchAll(/(\w+)\s*\(/g)];
      funcCalls.forEach(match => {
        const funcName = match[1];
        const column = line.indexOf(match[0]);
        calledFunctions.set(funcName, { line: lineIndex, column });
      });
      
      // Detect variable usage (excluding declarations)
      if (!trimmed.match(/^\s*(int|float|byte|char|string|bool|mutex)\s+\w+/)) {
        const varUsages = [...trimmed.matchAll(/\b(\w+)\b/g)];
        varUsages.forEach(match => {
          const varName = match[1];
          if (declaredVariables.has(varName)) {
            declaredVariables.get(varName).used = true;
          }
        });
      }
    });
    
    // Check unused variables
    for (const [varName, info] of declaredVariables) {
      if (!info.used) {
        this.addWarning(`Variable '${varName}' is declared but never used`, info.line, info.column, varName.length);
      }
    }
    
    // Check undefined functions
    for (const [funcName, info] of calledFunctions) {
      if (!declaredFunctions.has(funcName)) {
        this.addError(`Function '${funcName}' is not defined`, info.line, info.column, funcName.length);
      }
    }
  }

  checkLinePatterns(line, lineIndex) {
    const trimmed = line.trim();
    
    // Check missing semicolon (heuristic)
    if (this.shouldHaveSemicolon(trimmed)) {
      this.addWarning('Possible missing semicolon', lineIndex, line.length);
    }
    
    // Check line too long
    if (line.length > 120) {
      this.addWarning('Line too long (>120 characters)', lineIndex, 120);
    }
    
    // Check mixed tabs and spaces
    if (line.includes('\t') && line.includes('  ')) {
      this.addWarning('Mixed tabs and spaces for indentation', lineIndex, 0);
    }
    
    // Check unterminated strings (basic)
    const stringMatches = trimmed.match(/"/g);
    if (stringMatches && stringMatches.length % 2 !== 0) {
      this.addError('Unterminated string literal', lineIndex, trimmed.indexOf('"'));
    }
    
    // Check unterminated characters (basic)
    const charMatches = trimmed.match(/'/g);
    if (charMatches && charMatches.length % 2 !== 0) {
      this.addError('Unterminated character literal', lineIndex, trimmed.indexOf("'"));
    }
  }

  shouldHaveSemicolon(line) {
    // Simple heuristic to detect lines that should have semicolon
    if (!line || 
        line.endsWith(';') || 
        line.endsWith('{') || 
        line.endsWith('}') || 
        line.startsWith('//') || 
        line.startsWith('/*') || 
        line.startsWith('#') ||
        line.includes('if') ||
        line.includes('while') ||
        line.includes('for') ||
        line.includes('else') ||
        line.includes('task') ||
        line.includes('sub')) {
      return false;
    }
    
    // If contains assignment or function call, probably needs ;
    return line.includes('=') || /\w+\s*\(/.test(line);
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
}

module.exports = { SimpleNXCParser };