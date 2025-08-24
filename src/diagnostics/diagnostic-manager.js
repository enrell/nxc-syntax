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

    // Avoid duplicate analyses
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

    // Document cache to avoid unnecessary re-analyses
    const cachedVersion = this.documentCache.get(cacheKey);
    
    if (cachedVersion && cachedVersion.version === document.version) {
      console.log(`Using cache for ${document.fileName}`);
      return; // Document hasn't changed
    }

    // Syntactic analysis
    console.log('Executing syntactic analysis...');
    const syntaxResult = this.parser.validateSyntax(sourceCode);
    console.log(`Syntactic analysis: ${syntaxResult.errors.length} errors, ${syntaxResult.warnings.length} warnings`);
    
    // Basic semantic analysis
    console.log('Executing semantic analysis...');
    let semanticResult = { errors: [], warnings: [] };
    try {
      semanticResult = this.performBasicSemanticAnalysis(sourceCode, document);
      console.log(`Semantic analysis: ${semanticResult.errors.length} errors, ${semanticResult.warnings.length} warnings`);
    } catch (error) {
      console.warn('Error in semantic analysis:', error);
    }

    // Combine all diagnostics
    const allDiagnostics = [
      ...this.convertToDiagnostics(syntaxResult.errors, document),
      ...this.convertToDiagnostics(syntaxResult.warnings, document),
      ...this.convertToDiagnostics(semanticResult.errors, document),
      ...this.convertToDiagnostics(semanticResult.warnings, document)
    ];

    console.log(`Total diagnostics: ${allDiagnostics.length}`);

    // Update diagnostics in VS Code
    this.diagnosticCollection.set(uri, allDiagnostics);

    // Update cache
    this.documentCache.set(cacheKey, {
      version: document.version,
      diagnostics: allDiagnostics
    });
  }

  performBasicSemanticAnalysis(sourceCode, document) {
    const errors = [];
    const warnings = [];
    
    // Remove comments and strings to avoid false positives
    const cleanedCode = this.removeCommentsAndStrings(sourceCode);
    const lines = sourceCode.split(/\r?\n/);
    const cleanedLines = cleanedCode.split(/\r?\n/);

    console.log(`Semantic analysis: processing ${lines.length} lines`);

    // Load NXC built-in functions
    const builtInFunctions = this.loadBuiltInFunctions();
    
    // Basic analysis of common patterns
    const declaredVariables = new Map(); // name -> declaration line
    const usedVariables = new Set();
    const declaredFunctions = new Map(); // name -> declaration line
    const calledFunctions = new Set();

    cleanedLines.forEach((cleanedLine, lineIndex) => {
      const originalLine = lines[lineIndex];
      const trimmedLine = cleanedLine.trim();
      
      // Skip empty lines
      if (!trimmedLine) {
        return;
      }

      // Detect variable declarations (but not in struct definitions or function parameters)
      const varDeclaration = trimmedLine.match(/^\s*(int|float|byte|char|string|bool|mutex|long|short|unsigned)\s+(\w+)/);
      if (varDeclaration && !trimmedLine.includes('typedef') && !trimmedLine.includes('struct')) {
        const varName = varDeclaration[2];
        console.log(`Found variable declaration: ${varName} at line ${lineIndex}`);
        
        // Only flag as duplicate if it's in the same scope (simplified check)
        if (declaredVariables.has(varName)) {
          const prevLine = declaredVariables.get(varName);
          // Only report error if declarations are close together (likely same scope)
          if (Math.abs(lineIndex - prevLine) < 50) {
            errors.push({
              message: `Variable '${varName}' already declared at line ${prevLine + 1}`,
              line: lineIndex,
              column: originalLine.indexOf(varName),
              severity: 'error',
              source: 'semantic-analyzer'
            });
          }
        } else {
          declaredVariables.set(varName, lineIndex);
        }
      }

      // Detect function/task declarations
      const funcDeclaration = trimmedLine.match(/^\s*(?:task|sub|void|int|float|byte|char|string|bool|long|short|unsigned)\s+(\w+)\s*\(/);
      if (funcDeclaration) {
        const funcName = funcDeclaration[1];
        console.log(`Found function declaration: ${funcName} at line ${lineIndex}`);
        
        // Check for duplicates (including built-in functions if they're being redefined)
        if (declaredFunctions.has(funcName)) {
          const prevLine = declaredFunctions.get(funcName);
          errors.push({
            message: `Function/task '${funcName}' already declared at line ${prevLine + 1}`,
            line: lineIndex,
            column: originalLine.indexOf(funcName),
            severity: 'error',
            source: 'semantic-analyzer'
          });
        } else if (builtInFunctions.has(funcName) && funcName !== 'main') {
          // Warn about redefining built-in functions (except main which is expected)
          warnings.push({
            message: `Function '${funcName}' shadows a built-in function`,
            line: lineIndex,
            column: originalLine.indexOf(funcName),
            severity: 'warning',
            source: 'semantic-analyzer'
          });
        }
        
        declaredFunctions.set(funcName, lineIndex);
      }

      // Detect function calls (only in cleaned code to avoid comments)
      const funcCalls = trimmedLine.matchAll(/(\w+)\s*\(/g);
      for (const match of funcCalls) {
        const funcName = match[1];
        // Skip keywords that look like function calls
        if (!this.isKeywordOrType(funcName)) {
          calledFunctions.add(funcName);
        }
      }

      // Variable usage detection removed - was causing too many false positives

      // Check problematic patterns
      this.checkLinePatterns(originalLine, lineIndex, warnings);
    });

    // Variable usage detection removed due to false positives
    // TODO: Implement more robust variable usage analysis in the future

    // Check undefined functions (only for actual function calls, not comments)
    for (const funcName of calledFunctions) {
      if (!declaredFunctions.has(funcName) && !builtInFunctions.has(funcName)) {
        const callLine = this.findFunctionCallLine(cleanedCode, funcName);
        if (callLine >= 0) {
          console.log(`Undefined function: ${funcName} (called at line ${callLine})`);
          errors.push({
            message: `Function '${funcName}' is not defined`,
            line: callLine,
            column: 0,
            severity: 'error',
            source: 'semantic-analyzer'
          });
        }
      }
    }

    console.log(`Semantic analysis completed: ${errors.length} errors, ${warnings.length} warnings`);

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
          result += ' '; // Replace with space to maintain positions
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
          result += char; // Keep newlines
        } else {
          result += ' '; // Replace comment with space
        }
        continue;
      }

      if (inMultiLineComment) {
        if (char === '*' && nextChar === '/') {
          inMultiLineComment = false;
          result += '  '; // Replace */ with spaces
          i++; // Skip next char
        } else {
          result += char === '\n' ? char : ' '; // Keep newlines, replace others with space
        }
        continue;
      }

      if (inString) {
        if (char === '"') {
          inString = false;
        }
        result += ' '; // Replace string content with space
        continue;
      }

      if (inChar) {
        if (char === "'") {
          inChar = false;
        }
        result += ' '; // Replace char content with space
        continue;
      }

      // Check for comment start
      if (char === '/' && nextChar === '/') {
        inSingleLineComment = true;
        result += '  '; // Replace // with spaces
        i++; // Skip next char
        continue;
      }

      if (char === '/' && nextChar === '*') {
        inMultiLineComment = true;
        result += '  '; // Replace /* with spaces
        i++; // Skip next char
        continue;
      }

      // Check for string/char start
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
            // Extract function name from signature like "OnFwd(byte outputs, char pwr)"
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
      'Abs', 'Max', 'Min', 'Constrain', 'Map', 'Random', 'SRandom',
      'main' // main is expected to be defined by user
    ];
    
    essentialFunctions.forEach(fn => builtInFunctions.add(fn));
    
    return builtInFunctions;
  }

  checkLinePatterns(line, lineIndex, warnings) {
    // Skip comment lines entirely
    const trimmed = line.trim();
    if (trimmed.startsWith('//') || trimmed.startsWith('/*') || trimmed.startsWith('*') || !trimmed) {
      return;
    }

    // Check for invalid syntax patterns
    this.checkInvalidSyntax(trimmed, lineIndex, warnings);
    
    // Check for unterminated strings
    this.checkUnterminatedStrings(line, lineIndex, warnings);

    // Line too long
    if (line.length > 120) {
      warnings.push({
        message: 'Line too long (>120 characters)',
        line: lineIndex,
        column: 120,
        severity: 'warning',
        source: 'style-checker'
      });
    }

    // Mixed tabs and spaces
    if (line.includes('\t') && line.includes('  ')) {
      warnings.push({
        message: 'Mixed tabs and spaces for indentation',
        line: lineIndex,
        column: 0,
        severity: 'warning',
        source: 'style-checker'
      });
    }

    // Missing semicolon (improved heuristic)
    if (this.shouldHaveSemicolon(trimmed)) {
      warnings.push({
        message: 'Possible missing semicolon',
        line: lineIndex,
        column: line.length,
        severity: 'warning',
        source: 'syntax-checker'
      });
    }
  }

  checkInvalidSyntax(line, lineIndex, warnings) {
    // Check for invalid assignment patterns like "= ="
    if (line.includes('= =')) {
      const column = line.indexOf('= =');
      warnings.push({
        message: 'Invalid assignment operator "= =", did you mean "==" or "="?',
        line: lineIndex,
        column: column,
        severity: 'error',
        source: 'syntax-checker'
      });
    }

    // Check for random character sequences (heuristic)
    const invalidPattern = /[a-zA-Z]{8,}\d{3,}=/;
    if (invalidPattern.test(line)) {
      const match = line.match(invalidPattern);
      const column = line.indexOf(match[0]);
      warnings.push({
        message: 'Invalid syntax: unexpected character sequence',
        line: lineIndex,
        column: column,
        severity: 'error',
        source: 'syntax-checker'
      });
    }

    // Check for multiple consecutive operators
    const multipleOps = /[=+\-*/%]{3,}/;
    if (multipleOps.test(line)) {
      const match = line.match(multipleOps);
      const column = line.indexOf(match[0]);
      warnings.push({
        message: 'Invalid syntax: multiple consecutive operators',
        line: lineIndex,
        column: column,
        severity: 'error',
        source: 'syntax-checker'
      });
    }
  }

  shouldHaveSemicolon(line) {
    const trimmed = line.trim();
    
    // Skip if already has semicolon or is a control structure
    if (!trimmed || 
        trimmed.endsWith(';') || 
        trimmed.endsWith('{') || 
        trimmed.endsWith('}') || 
        trimmed.startsWith('#') ||
        trimmed.startsWith('//') ||
        trimmed.startsWith('/*') ||
        trimmed.startsWith('*') ||
        trimmed.includes('if(') ||
        trimmed.includes('if (') ||
        trimmed.includes('while(') ||
        trimmed.includes('while (') ||
        trimmed.includes('for(') ||
        trimmed.includes('for (') ||
        trimmed.includes('else') ||
        trimmed.includes('task ') ||
        trimmed.includes('void ') ||
        trimmed.match(/^\s*(int|float|bool|byte|char|string|typedef|struct|enum)\s+\w+\s*[({]/) ||
        trimmed.includes('switch(') ||
        trimmed.includes('switch (') ||
        trimmed.includes('case ') ||
        trimmed.includes('default:') ||
        trimmed.match(/^\s*}\s*$/) ||
        trimmed.match(/^\s*{\s*$/) ||
        trimmed.match(/^\s*}\s*else/) ||
        trimmed.match(/^\s*return\s*;?\s*$/) ||
        trimmed.match(/^\s*break\s*;?\s*$/) ||
        trimmed.match(/^\s*continue\s*;?\s*$/) ||
        // Function definitions
        trimmed.match(/^\s*\w+\s+\w+\s*\([^)]*\)\s*\{?\s*$/) ||
        // Comments only
        trimmed.match(/^\s*\/\//) ||
        // Preprocessor directives
        trimmed.match(/^\s*#/)) {
      return false;
    }
    
    // Only flag obvious cases that need semicolons
    return false; // Disable this check for now as it's too aggressive
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
      
      // Check for comment start - ignore strings in comments
      if (!inString && char === '/' && line[i + 1] === '/') {
        break; // Rest of line is comment
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
    
    // If we're still in a string at the end of the line, it's unterminated
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
      // Control flow
      'if', 'else', 'while', 'for', 'do', 'switch', 'case', 'default',
      'break', 'continue', 'return', 'goto', 'repeat', 'until',
      // Function/task keywords
      'task', 'sub', 'void', 'inline', 'safecall',
      // Types
      'int', 'float', 'byte', 'char', 'string', 'bool', 'mutex', 'long', 'short', 'unsigned', 'signed', 'const',
      'struct', 'enum', 'typedef', 'variant',
      // Literals
      'true', 'false', 'TRUE', 'FALSE', 'NULL',
      // NXC specific
      'start', 'stop', 'priority', 'asm',
      // Preprocessor (without #)
      'define', 'include', 'import', 'download', 'ifdef', 'ifndef', 'endif', 'pragma'
    ]);
    return keywords.has(word);
  }

  findVariableDeclarationLine(sourceCode, varName) {
    const lines = sourceCode.split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
      const regex = new RegExp(`\\b(?:int|float|byte|char|string|bool|mutex)\\s+${varName}\\b`);
      if (regex.test(lines[i])) {
        return i;
      }
    }
    return 0;
  }

  findFunctionCallLine(sourceCode, funcName) {
    const lines = sourceCode.split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
      const regex = new RegExp(`\\b${funcName}\\s*\\(`);
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