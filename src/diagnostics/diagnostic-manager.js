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
      return;
    }

    if (!this.isDiagnosticsEnabled()) {
      this.diagnosticCollection.delete(document.uri);
      return;
    }

    const uri = document.uri.toString();

    if (this.analysisQueue.has(uri)) {
      return;
    }

    this.analysisQueue.add(uri);

    try {
      await this.performAnalysis(document);
    } catch (error) {
      this.showErrorDiagnostic(document, error);
    } finally {
      this.analysisQueue.delete(uri);
    }
  }

  isDiagnosticsEnabled() {
    const config = vscode.workspace.getConfiguration('nxc');
    return config.get('diagnostics.enabled');
  }

  async performAnalysis(document) {
    const sourceCode = document.getText();
    const uri = document.uri;
    const cacheKey = uri.toString();

    const cachedVersion = this.documentCache.get(cacheKey);
    if (cachedVersion && cachedVersion.version === document.version) {
      return;
    }

    const cleanedCode = this.removeCommentsAndStrings(sourceCode);

    const syntaxResult = this.parser.validateSyntax(sourceCode);
    const bracketCheckResult = this.checkBalancedBrackets(cleanedCode);

    let semanticResult = { errors: [], warnings: [] };
    try {
      semanticResult = this.performBasicSemanticAnalysis(sourceCode, cleanedCode, document);
    } catch (error) {
      vscode.window.showWarningMessage(`Error in semantic analysis: ${error.message}`);
    }

    const allDiagnostics = [
      ...this.convertToDiagnostics(syntaxResult.errors, document),
      ...this.convertToDiagnostics(syntaxResult.warnings, document),
      ...this.convertToDiagnostics(bracketCheckResult.errors, document),
      ...this.convertToDiagnostics(semanticResult.errors, document),
      ...this.convertToDiagnostics(semanticResult.warnings, document)
    ];

    this.diagnosticCollection.set(uri, allDiagnostics);
    this.documentCache.set(cacheKey, { version: document.version, diagnostics: allDiagnostics });
  }

  checkBalancedBrackets(cleanedCode) {
    const errors = [];
    const stack = [];
    const lines = cleanedCode.split(/\r?\n/);
    const bracketPairs = {
      '(': ')',
      '{': '}',
      '[': ']'
    };

    for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
      const line = lines[lineIndex];
      for (let columnIndex = 0; columnIndex < line.length; columnIndex++) {
        const char = line[columnIndex];

        if (Object.keys(bracketPairs).includes(char)) {
          stack.push({ char, line: lineIndex, column: columnIndex });
        } else if (Object.values(bracketPairs).includes(char)) {
          const expectedOpening = Object.keys(bracketPairs).find(
            (key) => bracketPairs[key] === char
          );

          if (stack.length === 0 || stack[stack.length - 1].char !== expectedOpening) {
            const errorMessages = {
              ')': 'Unexpected closing parenthesis',
              '}': 'Unexpected closing brace',
              ']': 'Unexpected closing bracket'
            };
            errors.push({
              message: `${errorMessages[char]}`,
              line: lineIndex,
              column: columnIndex,
              severity: 'error',
              source: 'syntax-checker'
            });
            return { errors };
          }
          stack.pop();
        }
      }
    }

    if (stack.length > 0) {
      const unclosed = stack.pop();
      errors.push({
        message: `Unclosed '${unclosed.char}'`,
        line: unclosed.line,
        column: unclosed.column,
        severity: 'error',
        source: 'syntax-checker'
      });
    }

    return { errors };
  }

  performBasicSemanticAnalysis(sourceCode, cleanedCode, document) {
    const lines = sourceCode.split(/\r?\n/);
    const cleanedLines = cleanedCode.split(/\r?\n/);

    const builtInFunctions = this.loadBuiltInFunctions();
    const declaredVariables = new Map();
    const declaredFunctions = new Map();
    const calledFunctions = new Set();
    const declaredMacros = new Set();
    let conditionalDepth = 0;

    cleanedLines.forEach((cleanedLine, lineIndex) => {
      const originalLine = lines[lineIndex];
      const trimmedLine = cleanedLine.trim();

      if (!trimmedLine) {
        return;
      }

      this.analyzeLine(
        trimmedLine,
        originalLine,
        lineIndex,
        declaredVariables,
        declaredFunctions,
        calledFunctions,
        declaredMacros,
        builtInFunctions,
        conditionalDepth
      );

      conditionalDepth = this.updateConditionalDepth(trimmedLine, conditionalDepth);
    });

    const errors = this.findUndefinedFunctions(
      calledFunctions,
      declaredFunctions,
      declaredMacros,
      builtInFunctions,
      cleanedCode
    );
    const warnings = [];

    return { errors, warnings };
  }

  analyzeLine(
    trimmedLine,
    originalLine,
    lineIndex,
    declaredVariables,
    declaredFunctions,
    calledFunctions,
    declaredMacros,
    builtInFunctions,
    conditionalDepth
  ) {
    const macroDefinition = trimmedLine.match(/^\s*#\s*define\s+([a-zA-Z_][a-zA-Z0-9_]*)/);
    if (macroDefinition) {
      declaredMacros.add(macroDefinition[1]);
    }

    const varDeclaration = trimmedLine.match(
      /^\s*(int|float|byte|char|string|bool|mutex|long|short|unsigned)\s+(\w+)/
    );
    if (varDeclaration && !trimmedLine.includes('typedef') && !trimmedLine.includes('struct')) {
      const varName = varDeclaration[2];
      if (!declaredVariables.has(varName)) {
        declaredVariables.set(varName, lineIndex);
      }
    }

    const funcDeclaration = trimmedLine.match(
      /^\s*(?:task|sub|void|int|float|byte|char|string|bool|long|short|unsigned)\s+(\w+)\s*\(/
    );
    if (funcDeclaration) {
      const funcName = funcDeclaration[1];
      const isConditional = conditionalDepth > 0;
      this.handleFunctionDeclaration(
        funcName,
        lineIndex,
        originalLine,
        declaredFunctions,
        builtInFunctions,
        isConditional
      );
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
  }

  handleFunctionDeclaration(
    funcName,
    lineIndex,
    originalLine,
    declaredFunctions,
    builtInFunctions,
    isConditional
  ) {
    if (declaredFunctions.has(funcName)) {
      const existing = declaredFunctions.get(funcName);
      if (!existing.conditional && !isConditional) {
        return {
          error: `Function/task '${funcName}' already declared`,
          lineIndex,
          column: originalLine.indexOf(funcName)
        };
      }
    } else {
      if (builtInFunctions.has(funcName) && funcName !== 'main') {
        vscode.window.showWarningMessage(`Function '${funcName}' shadows a built-in function`);
      }
      declaredFunctions.set(funcName, { line: lineIndex, conditional: isConditional });
    }
    return null;
  }

  updateConditionalDepth(trimmedLine, currentDepth) {
    const pp = trimmedLine.match(/^#\s*(if|ifdef|ifndef|else|endif)\b/);
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

  findUndefinedFunctions(
    calledFunctions,
    declaredFunctions,
    declaredMacros,
    builtInFunctions,
    cleanedCode
  ) {
    const errors = [];
    for (const funcName of calledFunctions) {
      if (
        !declaredFunctions.has(funcName) &&
        !builtInFunctions.has(funcName) &&
        !declaredMacros.has(funcName)
      ) {
        const callLine = this.findFunctionCallLine(cleanedCode, funcName);
        if (callLine >= 0) {
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
    return errors;
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
      'SRandom',
      'main'
    ];

    essentialFunctions.forEach((fn) => builtInFunctions.add(fn));

    return builtInFunctions;
  }

  isKeywordOrType(word) {
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
      'asm',
      'define',
      'include',
      'import',
      'download',
      'ifdef',
      'ifndef',
      'endif',
      'pragma'
    ]);
    return keywords.has(word);
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
    return diagnosticData.map((diag) => {
      const range = diag.range
        ? new vscode.Range(
            new vscode.Position(diag.range.start.line, diag.range.start.character),
            new vscode.Position(diag.range.end.line, diag.range.end.character)
          )
        : new vscode.Range(
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
    const severityMap = {
      error: vscode.DiagnosticSeverity.Error,
      warning: vscode.DiagnosticSeverity.Warning,
      info: vscode.DiagnosticSeverity.Information,
      hint: vscode.DiagnosticSeverity.Hint
    };
    return severityMap[severity] || vscode.DiagnosticSeverity.Error;
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
