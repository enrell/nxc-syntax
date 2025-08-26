const vscode = require('vscode');
const { SimpleNXCParser } = require('./simple-parser');
const { SemanticAnalyzer } = require('./semantic-analyzer');

class DiagnosticManager {
  constructor() {
    this.parser = new SimpleNXCParser();
    this.semanticAnalyzer = new SemanticAnalyzer();
    this.diagnosticCollection = vscode.languages.createDiagnosticCollection('nxc');
    this.documentCache = new Map();
    this.analysisQueue = new Set();
    this.isAnalyzing = false;
  }

  dispose() {
    this.diagnosticCollection.dispose();
  }

  async analyzeDocument(document) {
    if (document.languageId !== 'nxc') {
      console.log(`Ignoring non-NXC document: ${document.languageId}`);
      return;
    }

    const uri = document.uri.toString();
    console.log(`Starting document analysis: ${document.fileName}`);

    if (this.analysisQueue.has(uri)) {
      console.log(`Analysis already in progress for: ${document.fileName}`);
      return;
    }

    this.analysisQueue.add(uri);

    try {
      await this.performAnalysis(document);
      console.log(`Analysis completed for: ${document.fileName}`);
    } catch (error) {
      console.error('Error during document analysis:', error);
      this.showErrorDiagnostic(document, error);
    } finally {
      this.analysisQueue.delete(uri);
    }
  }

  async performAnalysis(document) {
    const sourceCode = document.getText();
    const uri = document.uri;
    const cacheKey = uri.toString();

    console.log(`Analyzing ${sourceCode.length} characters in ${document.fileName}`);

    const cachedVersion = this.documentCache.get(cacheKey);
    if (cachedVersion && cachedVersion.version === document.version) {
      console.log(`Using cache for ${document.fileName}`);
      return;
    }

    const cleanedCode = this.removeCommentsAndStrings(sourceCode);

    console.log('Executing syntactic analysis...');
    const syntaxResult = this.parser.validateSyntax(sourceCode);
    console.log(`Syntactic analysis: ${syntaxResult.errors.length} errors, ${syntaxResult.warnings.length} warnings`);

    const bracketCheckResult = this.checkBalancedBrackets(cleanedCode);
    console.log(`Bracket balance check: ${bracketCheckResult.errors.length} errors`);

    console.log('Executing semantic analysis...');
    let semanticResult = { errors: [], warnings: [] };
    try {
      semanticResult = this.performBasicSemanticAnalysis(sourceCode, cleanedCode, document);
      console.log(`Semantic analysis: ${semanticResult.errors.length} errors, ${semanticResult.warnings.length} warnings`);
    } catch (error) {
      console.warn('Error in semantic analysis:', error);
    }

    const allDiagnostics = [
      ...this.convertToDiagnostics(syntaxResult.errors, document),
      ...this.convertToDiagnostics(syntaxResult.warnings, document),
      ...this.convertToDiagnostics(bracketCheckResult.errors, document),
      ...this.convertToDiagnostics(semanticResult.errors, document),
      ...this.convertToDiagnostics(semanticResult.warnings, document)
    ];

    console.log(`Total diagnostics: ${allDiagnostics.length}`);
    this.diagnosticCollection.set(uri, allDiagnostics);
    this.documentCache.set(cacheKey, { version: document.version, diagnostics: allDiagnostics });
  }

  checkBalancedBrackets(cleanedCode) {
    const errors = [];
    const stack = [];
    const lines = cleanedCode.split(/\r?\n/);

    for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
      const line = lines[lineIndex];
      for (let columnIndex = 0; columnIndex < line.length; columnIndex++) {
        const char = line[columnIndex];
        if (['(', '{', '['].includes(char)) {
          stack.push({ char, line: lineIndex, column: columnIndex });
        } else if (char === ')') {
          if (stack.length === 0 || stack[stack.length - 1].char !== '(') {
            errors.push({ message: "Unexpected closing parenthesis ')'", line: lineIndex, column: columnIndex, severity: 'error', source: 'syntax-checker' });
            return { errors };
          }
          stack.pop();
        } else if (char === '}') {
          if (stack.length === 0 || stack[stack.length - 1].char !== '{') {
            errors.push({ message: "Unexpected closing brace '}'", line: lineIndex, column: columnIndex, severity: 'error', source: 'syntax-checker' });
            return { errors };
          }
          stack.pop();
        } else if (char === ']') {
          if (stack.length === 0 || stack[stack.length - 1].char !== '[') {
            errors.push({ message: "Unexpected closing bracket ']'", line: lineIndex, column: columnIndex, severity: 'error', source: 'syntax-checker' });
            return { errors };
          }
          stack.pop();
        }
      }
    }

    if (stack.length > 0) {
      const unclosed = stack.pop();
      errors.push({ message: `Unclosed '${unclosed.char}'`, line: unclosed.line, column: unclosed.column, severity: 'error', source: 'syntax-checker' });
    }

    return { errors };
  }

  performBasicSemanticAnalysis(sourceCode, cleanedCode, document) {
    const errors = [];
    const warnings = [];
    
    const lines = sourceCode.split(/\r?\n/);
    const cleanedLines = cleanedCode.split(/\r?\n/);

    console.log(`Semantic analysis: processing ${lines.length} lines`);

    const builtInFunctions = this.loadBuiltInFunctions();
    const declaredVariables = new Map();
    const declaredFunctions = new Map(); // Will map name -> { line, conditional }
    const calledFunctions = new Set();
    const declaredMacros = new Set();

    // Track preprocessor conditional nesting
    let conditionalDepth = 0;

    cleanedLines.forEach((cleanedLine, lineIndex) => {
      const originalLine = lines[lineIndex];
      const trimmedLine = cleanedLine.trim();
      
      if (!trimmedLine) {
        return;
      }

      // Look for macro definitions and add them to our set
      const macroDefinition = trimmedLine.match(/^\s*#\s*define\s+([a-zA-Z_][a-zA-Z0-9_]*)/);
      if (macroDefinition) {
        const macroName = macroDefinition[1];
        console.log(`Found macro definition: ${macroName}`);
        declaredMacros.add(macroName);
      }

      // Track preprocessor conditionals
      const pp = trimmedLine.match(/^#\s*(if|ifdef|ifndef|else|endif)\b/);
      if (pp) {
        const directive = pp[1];
        if (directive === 'if' || directive === 'ifdef' || directive === 'ifndef') {
          conditionalDepth++;
        } else if (directive === 'endif') {
          conditionalDepth = Math.max(0, conditionalDepth - 1);
        }
      }

      const varDeclaration = trimmedLine.match(/^\s*(int|float|byte|char|string|bool|mutex|long|short|unsigned)\s+(\w+)/);
      if (varDeclaration && !trimmedLine.includes('typedef') && !trimmedLine.includes('struct')) {
        const varName = varDeclaration[2];
        if (!declaredVariables.has(varName)) {
            declaredVariables.set(varName, lineIndex);
        }
      }

      const funcDeclaration = trimmedLine.match(/^\s*(?:task|sub|void|int|float|byte|char|string|bool|long|short|unsigned)\s+(\w+)\s*\(/);
      if (funcDeclaration) {
        const funcName = funcDeclaration[1];
        const isConditional = conditionalDepth > 0;
        
        if (declaredFunctions.has(funcName)) {
          const existing = declaredFunctions.get(funcName);
          // Flag as error if both are non-conditional OR if one is non-conditional (will conflict)
          if (!existing.conditional && !isConditional) {
            errors.push({ 
              message: `Function/task '${funcName}' already declared at line ${existing.line + 1}`, 
              line: lineIndex, 
              column: originalLine.indexOf(funcName), 
              severity: 'error', 
              source: 'semantic-analyzer' 
            });
          } else if (!existing.conditional || !isConditional) {
            errors.push({ 
              message: `Function/task '${funcName}' conflicts with declaration at line ${existing.line + 1}`, 
              line: lineIndex, 
              column: originalLine.indexOf(funcName), 
              severity: 'error', 
              source: 'semantic-analyzer' 
            });
          }
          // Both are conditional - that's fine, they're in different preprocessor branches
          
          // Update to keep the non-conditional one if there is one
          if (existing.conditional && !isConditional) {
            declaredFunctions.set(funcName, { line: lineIndex, conditional: false });
          }
        } else {
          if (builtInFunctions.has(funcName) && funcName !== 'main') {
            warnings.push({ 
              message: `Function '${funcName}' shadows a built-in function`, 
              line: lineIndex, 
              column: originalLine.indexOf(funcName), 
              severity: 'warning', 
              source: 'semantic-analyzer' 
            });
          }
          declaredFunctions.set(funcName, { line: lineIndex, conditional: isConditional });
        }
      }

      if (!trimmedLine.startsWith('#')) {
        const funcCalls = trimmedLine.matchAll(/(\w+)\s*\(/g);
        for (const match of funcCalls) {
          const funcName = match[1];
          if (!this.isKeywordOrType(funcName)) {
            calledFunctions.add(funcName);
          }
        }
      }

      this.checkLinePatterns(originalLine, cleanedLine, lineIndex, warnings);
    });

    // FIX: When checking for undefined functions, also check if the name is a known macro
    for (const funcName of calledFunctions) {
      if (!declaredFunctions.has(funcName) && !builtInFunctions.has(funcName) && !declaredMacros.has(funcName)) {
        const callLine = this.findFunctionCallLine(cleanedCode, funcName);
        if (callLine >= 0) {
          errors.push({ message: `Function '${funcName}' is not defined`, line: callLine, column: 0, severity: 'error', source: 'semantic-analyzer' });
        }
      }
    }

    return { errors, warnings };
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
        console.log(`Loaded ${apiFunctions.length} NXC API functions`);
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
      'Abs', 'Max', 'Min', 'Constrain', 'Map', 'Random', 'SRandom',
      'main'
    ];
    
    essentialFunctions.forEach(fn => builtInFunctions.add(fn));
    
    return builtInFunctions;
  }

  checkLinePatterns(originalLine, cleanedLine, lineIndex, warnings) {
    if (!originalLine.trim()) {
      return;
    }

    this.checkInvalidSyntax(originalLine, cleanedLine, lineIndex, warnings);
    this.checkUnterminatedStrings(originalLine, lineIndex, warnings);

  if (originalLine.includes('\t') && originalLine.includes('  ')) {
      warnings.push({
        message: 'Mixed tabs and spaces for indentation',
        line: lineIndex,
        column: 0,
        severity: 'warning',
        source: 'style-checker'
      });
    }


  }

  checkInvalidSyntax(originalLine, cleanedLine, lineIndex, warnings) {
    if (cleanedLine.includes('= =')) {
      const column = originalLine.indexOf('= =');
      warnings.push({
        message: 'Invalid assignment operator "= =". did you mean "==" or "="?',
        line: lineIndex,
        column: column,
        severity: 'error',
        source: 'syntax-checker'
      });
    }

    const invalidPattern = /[a-zA-Z]{8,}\d{3,}=/;
    if (invalidPattern.test(cleanedLine)) {
      const match = originalLine.match(invalidPattern);
      const column = originalLine.indexOf(match[0]);
      warnings.push({
        message: 'Invalid syntax: unexpected character sequence',
        line: lineIndex,
        column: column,
        severity: 'error',
        source: 'syntax-checker'
      });
    }

    const multipleOps = /[=+\-*/%]{3,}/;
    if (multipleOps.test(cleanedLine)) {
      const match = originalLine.match(multipleOps);
      const column = originalLine.indexOf(match[0]);
      warnings.push({
        message: 'Invalid syntax: multiple consecutive operators',
        line: lineIndex,
        column: column,
        severity: 'error',
        source: 'syntax-checker'
      });
    }
  }



  checkUnterminatedStrings(line, lineIndex, warnings) {
    let inString = false;
    let escaped = false;
    let stringStart = -1;
    
    for (let i = 0; i < line.length; i++) {
      const char = line[i];
      
      if (escaped) {
        escaped = false;
        continue;
      }
      
      if (char === '\\' && inString) {
        escaped = true;
        continue;
      }
      
      if (!inString && char === '/' && line[i + 1] === '/') {
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
      warnings.push({
        message: 'Unterminated string literal',
        line: lineIndex,
        column: stringStart,
        severity: 'error',
        source: 'syntax-checker'
      });
    }
  }

  isKeywordOrType(word) {
    const keywords = new Set([
      'if', 'else', 'while', 'for', 'do', 'switch', 'case', 'default',
      'break', 'continue', 'return', 'goto', 'repeat', 'until',
      'task', 'sub', 'void', 'inline', 'safecall',
      'int', 'float', 'byte', 'char', 'string', 'bool', 'mutex', 'long', 'short', 'unsigned', 'signed', 'const',
      'struct', 'enum', 'typedef', 'variant',
      'true', 'false', 'TRUE', 'FALSE', 'NULL',
      'start', 'stop', 'priority', 'asm',
      'define', 'include', 'import', 'download', 'ifdef', 'ifndef', 'endif', 'pragma'
    ]);
    return keywords.has(word);
  }

  findVariableDeclarationLine(sourceCode, varName) {
    const lines = sourceCode.split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
      const regex = new RegExp(`\b(?:int|float|byte|char|string|bool|mutex)\s+${varName}\b`);
      if (regex.test(lines[i])) {
        return i;
      }
    }
    return 0;
  }

  findFunctionCallLine(sourceCode, funcName) {
    const lines = sourceCode.split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
      const regex = new RegExp(`\b${funcName}\s*\(`);
      if (regex.test(lines[i])) {
        return i;
      }
    }
    return 0;
  }

  convertToDiagnostics(diagnosticData, document) {
    return diagnosticData.map(diag => {
      const range = diag.range ? 
        new vscode.Range(
          new vscode.Position(diag.range.start.line, diag.range.start.character),
          new vscode.Position(diag.range.end.line, diag.range.end.character)
        ) :
        new vscode.Range(
          new vscode.Position(diag.line || 0, diag.column || 0),
          new vscode.Position(diag.line || 0, (diag.column || 0) + 1)
        );

      const severity = this.mapSeverity(diag.severity);
      
      const diagnostic = new vscode.Diagnostic(range, diag.message, severity);
      diagnostic.source = diag.source || 'nxc';
      
      return diagnostic;
    });
  }

  mapSeverity(severity) {
    switch (severity) {
      case 'error': return vscode.DiagnosticSeverity.Error;
      case 'warning': return vscode.DiagnosticSeverity.Warning;
      case 'info': return vscode.DiagnosticSeverity.Information;
      case 'hint': return vscode.DiagnosticSeverity.Hint;
      default: return vscode.DiagnosticSeverity.Error;
    }
  }

  showErrorDiagnostic(document, error) {
    const diagnostic = new vscode.Diagnostic(
      new vscode.Range(0, 0, 0, 1),
      `Internal analyzer error: ${error.message}`,
      vscode.DiagnosticSeverity.Error
    );
    diagnostic.source = 'nxc-internal';
    
    this.diagnosticCollection.set(document.uri, [diagnostic]);
  }

  clearDiagnostics(uri) {
    this.diagnosticCollection.delete(uri);
    this.documentCache.delete(uri.toString());
  }

  clearAllDiagnostics() {
    this.diagnosticCollection.clear();
    this.documentCache.clear();
  }
}

module.exports = { DiagnosticManager };