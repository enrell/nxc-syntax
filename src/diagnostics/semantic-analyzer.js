class SemanticAnalyzer {
  constructor() {
    this.symbols = new Map();
    this.scopes = [];
    this.functions = new Map();
    this.errors = [];
    this.warnings = [];
    this.builtInFunctions = new Set();
    this.builtInConstants = new Set();
    this.builtInTypes = new Set(['void', 'int', 'float', 'byte', 'char', 'string', 'bool', 'mutex', 'variant']);

    this.initializeBuiltIns();
  }

  initializeBuiltIns() {
    this.loadApiConstants();
    this.addEssentialConstants();
  }

  loadApiConstants() {
    try {
      const fs = require('fs');
      const path = require('path');

      const apiPath = path.join(__dirname, '../../utils/nxc_api.txt');
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

      apiFunctions.forEach((fn) => this.builtInFunctions.add(fn));

      this.loadConstants(path.join(__dirname, '../../utils/nxc_constants.txt'));
      this.loadKeywords(path.join(__dirname, '../../utils/nxc_keywords.txt'));
    } catch {
      this.addFallbackBuiltIns();
    }
  }

  loadConstants(filePath) {
    const fs = require('fs');
    if (!fs.existsSync(filePath)) {
      return;
    }

    const content = fs.readFileSync(filePath, 'utf8');
    const constants = content
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith('//'));

    constants.forEach((constant) => this.builtInConstants.add(constant));
  }

  loadKeywords(filePath) {
    const fs = require('fs');
    if (!fs.existsSync(filePath)) {
      return;
    }

    const content = fs.readFileSync(filePath, 'utf8');
    const keywords = content
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith('//'));

    keywords.forEach((keyword) => this.builtInConstants.add(keyword));
  }

  addFallbackBuiltIns() {
    const vscode = require('vscode');
    vscode.window.showWarningMessage('Could not load NXC API files, using fallback');

    const builtIns = [
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
      'Sin',
      'Cos',
      'Tan',
      'abs',
      'clamp',
      'now',
      'if',
      'while',
      'switch',
      'return'
    ];

    builtIns.forEach((fn) => this.builtInFunctions.add(fn));
  }

  addEssentialConstants() {
    const constants = [
      'TRUE',
      'FALSE',
      'NULL',
      'true',
      'false',
      'OUT_A',
      'OUT_B',
      'OUT_C',
      'OUT_AB',
      'OUT_AC',
      'OUT_BC',
      'OUT_ABC',
      'IN_1',
      'IN_2',
      'IN_3',
      'IN_4',
      'M_LEFT',
      'M_RIGHT',
      'M_SHOVEL',
      'M_DRIVE',
      'COL_BLACK',
      'COL_BLUE',
      'COL_GREEN',
      'COL_YELLOW',
      'COL_RED',
      'COL_WHITE',
      'COL_BROWN'
    ];

    constants.forEach((constant) => this.builtInConstants.add(constant));
  }

  analyze(ast, sourceCode) {
    this.resetAnalysis();
    this.preScanDeclarations(ast);

    try {
      this.visitNode(ast);
    } catch {
      this.errors.push({
        message: 'Internal semantic analyzer error',
        line: 0,
        column: 0,
        severity: 'error',
        source: 'semantic-analyzer'
      });
    }

    this.checkForMainFunction();

    return {
      errors: this.errors,
      warnings: this.warnings,
      symbols: this.symbols
    };
  }

  resetAnalysis() {
    this.errors = [];
    this.warnings = [];
    this.symbols.clear();
    this.scopes = [new Map()];
    this.functions.clear();
  }

  checkForMainFunction() {
    if (!this.functions.has('main')) {
      this.warnings.push({
        message: 'No "main" function or task found',
        line: 0,
        column: 0,
        severity: 'warning',
        source: 'semantic-analyzer'
      });
    }
  }

  visitNode(node) {
    if (!node || typeof node !== 'object') {
      return;
    }

    const nodeType = node.ctorName || node.constructor.name;

    const visitorMethods = {
      Program: this.visitProgram.bind(this),
      FunctionDefinition: this.visitFunctionDefinition.bind(this),
      TaskDefinition: this.visitTaskDefinition.bind(this),
      Declaration: this.visitDeclaration.bind(this),
      CompoundStatement: this.visitCompoundStatement.bind(this),
      ExpressionStatement: this.visitExpressionStatement.bind(this),
      CallExpression: this.visitCallExpression.bind(this),
      Identifier: this.visitIdentifier.bind(this)
    };

    const visitor = visitorMethods[nodeType];
    if (visitor) {
      visitor(node);
    } else if (node.children) {
      node.children.forEach((child) => this.visitNode(child));
    }
  }

  visitProgram(node) {
    if (node.children) {
      node.children.forEach((child) => this.visitNode(child));
    }
  }

  visitFunctionDefinition(node) {
    const name = this.extractIdentifier(node.name);
    const returnType = this.extractType(node.returnType);
    const params = this.extractParameters(node.parameters);

    if (this.functions.has(name)) {
      this.errors.push({
        message: `Function '${name}' already defined`,
        line: node.line || 0,
        column: node.column || 0,
        severity: 'error',
        source: 'semantic-analyzer'
      });
    } else {
      this.functions.set(name, {
        name,
        returnType,
        parameters: params,
        line: node.line || 0
      });
    }

    this.enterScope();

    params.forEach((param) => {
      this.addSymbol(param.name, param.type, param.line || 0);
    });

    this.visitNode(node.body);

    this.exitScope();
  }

  visitTaskDefinition(node) {
    const name = this.extractIdentifier(node.name);

    if (this.functions.has(name)) {
      this.errors.push({
        message: `Task '${name}' already defined`,
        line: node.line || 0,
        column: node.column || 0,
        severity: 'error',
        source: 'semantic-analyzer'
      });
    } else {
      this.functions.set(name, {
        name,
        returnType: 'void',
        parameters: [],
        isTask: true,
        line: node.line || 0
      });
    }

    this.enterScope();

    this.visitNode(node.body);

    this.exitScope();
  }

  visitDeclaration(node) {
    const type = this.extractType(node.type);
    const declarators = this.extractDeclarators(node.declarators);

    declarators.forEach((decl) => {
      if (this.isSymbolInCurrentScope(decl.name)) {
        this.errors.push({
          message: `Variable '${decl.name}' already declared in this scope`,
          line: decl.line || 0,
          column: decl.column || 0,
          severity: 'error',
          source: 'semantic-analyzer'
        });
      } else {
        this.addSymbol(decl.name, type, decl.line || 0);
      }
    });
  }

  visitCompoundStatement(node) {
    this.enterScope();

    if (node.statements) {
      node.statements.forEach((stmt) => this.visitNode(stmt));
    }

    this.exitScope();
  }

  visitExpressionStatement(node) {
    if (node.expression) {
      this.visitNode(node.expression);
    }
  }

  visitCallExpression(node) {
    const functionName = this.extractIdentifier(node.callee);
    const args = this.extractArguments(node.arguments);

    if (!this.functions.has(functionName) && !this.builtInFunctions.has(functionName)) {
      const suggestion = this.bestBuiltInMatch(functionName);
      if (suggestion) {
        this.warnings.push({
          message: `Function '${functionName}' is not defined. Did you mean '${suggestion}'?`,
          line: node.line || 0,
          column: node.column || 0,
          severity: 'warning',
          source: 'semantic-analyzer'
        });
      }
    } else if (this.functions.has(functionName)) {
      const funcDef = this.functions.get(functionName);
      if (args.length !== funcDef.parameters.length) {
        this.errors.push({
          message: `Function '${functionName}' expects ${funcDef.parameters.length} arguments, but received ${args.length}`,
          line: node.line || 0,
          column: node.column || 0,
          severity: 'error',
          source: 'semantic-analyzer'
        });
      }
    }

    if (node.arguments) {
      node.arguments.forEach((arg) => this.visitNode(arg));
    }
  }

  visitIdentifier(node) {
    const name = this.extractIdentifier(node);

    if (
      !this.isSymbolDefined(name) &&
      !this.builtInConstants.has(name) &&
      !this.functions.has(name)
    ) {
      const suggestion = this.bestConstantMatch(name);
      if (suggestion) {
        this.warnings.push({
          message: `Identifier '${name}' is not defined. Did you mean '${suggestion}'?`,
          line: node.line || 0,
          column: node.column || 0,
          severity: 'warning',
          source: 'semantic-analyzer'
        });
      }
    }
  }

  preScanDeclarations(ast) {
    if (!ast || !ast.children) {
      return;
    }

    ast.children.forEach((node) => {
      if (!node || typeof node !== 'object') {
        return;
      }

      const nodeType = node.ctorName || node.constructor.name;
      if (nodeType === 'FunctionDefinition' || nodeType === 'TaskDefinition') {
        const name = this.extractIdentifier(node.name);
        if (!this.functions.has(name)) {
          this.functions.set(name, {
            name,
            parameters: this.extractParameters(node.parameters || []),
            line: node.line || 0,
            isTask: nodeType === 'TaskDefinition'
          });
        }
      }

      if (node.children) {
        node.children.forEach((child) => this.preScanDeclarations(child));
      }
    });
  }

  bestBuiltInMatch(name) {
    return this.findBestMatch(name, Array.from(this.builtInFunctions));
  }

  bestConstantMatch(name) {
    return this.findBestMatch(name, Array.from(this.builtInConstants));
  }

  findBestMatch(name, candidates) {
    let best = null;
    let bestDist = Infinity;

    for (const candidate of candidates) {
      const dist = this.levenshtein(name.toLowerCase(), candidate.toLowerCase());
      if (dist < bestDist) {
        bestDist = dist;
        best = candidate;
      }
    }

    const threshold = name.length <= 4 ? 1 : 2;
    return bestDist <= threshold ? best : null;
  }

  levenshtein(a, b) {
    if (a === b) {
      return 0;
    }

    const m = a.length;
    const n = b.length;
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

  enterScope() {
    this.scopes.push(new Map());
  }

  exitScope() {
    if (this.scopes.length > 1) {
      this.scopes.pop();
    }
  }

  addSymbol(name, type, line) {
    const currentScope = this.scopes[this.scopes.length - 1];
    currentScope.set(name, { type, line, used: false });

    this.symbols.set(name, { type, line, scope: this.scopes.length - 1 });
  }

  isSymbolInCurrentScope(name) {
    const currentScope = this.scopes[this.scopes.length - 1];
    return currentScope.has(name);
  }

  isSymbolDefined(name) {
    for (let i = this.scopes.length - 1; i >= 0; i--) {
      if (this.scopes[i].has(name)) {
        this.scopes[i].get(name).used = true;
        return true;
      }
    }
    return false;
  }

  extractIdentifier(node) {
    if (typeof node === 'string') {
      return node;
    }
    if (node && node.name) {
      return node.name;
    }
    if (node && node.sourceString) {
      return node.sourceString;
    }
    return 'unknown';
  }

  extractType(node) {
    if (typeof node === 'string') {
      return node;
    }
    if (node && node.type) {
      return node.type;
    }
    if (node && node.sourceString) {
      return node.sourceString;
    }
    return 'unknown';
  }

  extractParameters(node) {
    if (!node || !Array.isArray(node)) {
      return [];
    }

    return node.map((param) => ({
      name: this.extractIdentifier(param.name),
      type: this.extractType(param.type),
      line: param.line || 0
    }));
  }

  extractDeclarators(node) {
    if (!node || !Array.isArray(node)) {
      return [];
    }

    return node.map((decl) => ({
      name: this.extractIdentifier(decl),
      line: decl.line || 0
    }));
  }

  extractArguments(node) {
    if (!node || !Array.isArray(node)) {
      return [];
    }

    return node.map((arg) => this.extractIdentifier(arg));
  }
}

module.exports = { SemanticAnalyzer };
