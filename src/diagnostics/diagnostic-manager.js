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
    const lines = sourceCode.split(/\r?\n/);

    console.log(`Semantic analysis: processing ${lines.length} lines`);

    // Basic analysis of common patterns
    const declaredVariables = new Map(); // name -> declaration line
    const usedVariables = new Set();
    const declaredFunctions = new Map(); // name -> declaration line
    const calledFunctions = new Set();

    lines.forEach((line, lineIndex) => {
      const trimmedLine = line.trim();
      
      // Ignore comments and empty lines
      if (!trimmedLine || trimmedLine.startsWith('//') || trimmedLine.startsWith('/*')) {
        return;
      }

      // Detect variable declarations
      const varDeclaration = trimmedLine.match(/^\s*(int|float|byte|char|string|bool|mutex)\s+(\w+)/);
      if (varDeclaration) {
        const varName = varDeclaration[2];
        console.log(`Found variable declaration: ${varName} at line ${lineIndex}`);
        
        if (declaredVariables.has(varName)) {
          errors.push({
            message: `Variable '${varName}' already declared at line ${declaredVariables.get(varName)}`,
            line: lineIndex,
            column: line.indexOf(varName),
            severity: 'error',
            source: 'semantic-analyzer'
          });
        } else {
          declaredVariables.set(varName, lineIndex);
        }
      }

      // Detect function/task declarations
      const funcDeclaration = trimmedLine.match(/^\s*(?:task|sub|void|int|float|byte|char|string|bool)\s+(\w+)\s*\(/);
      if (funcDeclaration) {
        const funcName = funcDeclaration[1];
        console.log(`Found function declaration: ${funcName} at line ${lineIndex}`);
        
        if (declaredFunctions.has(funcName)) {
          errors.push({
            message: `Function '${funcName}' already declared at line ${declaredFunctions.get(funcName)}`,
            line: lineIndex,
            column: line.indexOf(funcName),
            severity: 'error',
            source: 'semantic-analyzer'
          });
        } else {
          declaredFunctions.set(funcName, lineIndex);
        }
      }

      // Detect function calls
      const funcCalls = trimmedLine.matchAll(/(\w+)\s*\(/g);
      for (const match of funcCalls) {
        const funcName = match[1];
        calledFunctions.add(funcName);
      }

      // Detect variable usage
      const varUsage = trimmedLine.matchAll(/\b(\w+)\b/g);
      for (const match of varUsage) {
        const varName = match[1];
        // Ignore keywords and types
        if (!this.isKeywordOrType(varName)) {
          usedVariables.add(varName);
        }
      }

      // Check problematic patterns
      this.checkLinePatterns(line, lineIndex, warnings);
    });

    // Check unused variables
    for (const [varName, declarationLine] of declaredVariables) {
      if (!usedVariables.has(varName)) {
        console.log(`Unused variable: ${varName} (declared at line ${declarationLine})`);
        warnings.push({
          message: `Variable '${varName}' declared but never used`,
          line: declarationLine,
          column: 0,
          severity: 'info',
          source: 'semantic-analyzer'
        });
      }
    }

    // Check undefined functions (basic)
    const builtInFunctions = new Set([
      'OnFwd', 'OnRev', 'RotateMotor', 'Wait', 'PlayTone', 'PlaySound',
      'SetSensorType', 'ReadSensor', 'ReadSensorUS', 'Random', 'Abs',
      'Sin', 'Cos', 'Sqrt', 'NumToStr', 'StrToNum', 'main'
    ]);

    for (const funcName of calledFunctions) {
      if (!declaredFunctions.has(funcName) && !builtInFunctions.has(funcName)) {
        const callLine = this.findFunctionCallLine(sourceCode, funcName);
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

    console.log(`Semantic analysis completed: ${errors.length} errors, ${warnings.length} warnings`);

    return { errors, warnings };
  }

  checkLinePatterns(line, lineIndex, warnings) {
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

    // Missing semicolon (simple heuristic)
    const trimmed = line.trim();
    if (trimmed && 
        !trimmed.endsWith(';') && 
        !trimmed.endsWith('{') && 
        !trimmed.endsWith('}') && 
        !trimmed.startsWith('//') && 
        !trimmed.startsWith('/*') && 
        !trimmed.startsWith('#') &&
        !trimmed.includes('if') &&
        !trimmed.includes('while') &&
        !trimmed.includes('for') &&
        !trimmed.includes('else') &&
        trimmed.includes('=')) {
      warnings.push({
        message: 'Possible missing semicolon',
        line: lineIndex,
        column: line.length,
        severity: 'warning',
        source: 'syntax-checker'
      });
    }
  }

  isKeywordOrType(word) {
    const keywords = new Set([
      'if', 'else', 'while', 'for', 'do', 'switch', 'case', 'default',
      'break', 'continue', 'return', 'goto', 'task', 'sub', 'void',
      'int', 'float', 'byte', 'char', 'string', 'bool', 'mutex',
      'true', 'false', 'TRUE', 'FALSE', 'const', 'struct', 'enum'
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