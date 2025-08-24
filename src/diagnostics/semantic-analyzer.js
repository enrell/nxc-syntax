class SemanticAnalyzer {
  constructor() {
    this.symbols = new Map(); // Symbol table
    this.scopes = []; // Scope stack
    this.functions = new Map(); // Defined functions
    this.errors = [];
    this.warnings = [];
    this.builtInFunctions = new Set();
    this.builtInConstants = new Set();
    this.builtInTypes = new Set(['void', 'int', 'float', 'byte', 'char', 'string', 'bool', 'mutex', 'variant']);
    
    this.initializeBuiltIns();
  }

  initializeBuiltIns() {
    // Load NXC API functions from utils file
    const fs = require('fs');
    const path = require('path');
    
    try {
      // Load API functions
      const apiPath = path.join(__dirname, '../../utils/nxc_api.txt');
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
      
      apiFunctions.forEach(fn => this.builtInFunctions.add(fn));
      
      // Load constants
      const constantsPath = path.join(__dirname, '../../utils/nxc_constants.txt');
      if (fs.existsSync(constantsPath)) {
        const constantsContent = fs.readFileSync(constantsPath, 'utf8');
        const constants = constantsContent.split('\n')
          .map(line => line.trim())
          .filter(line => line && !line.startsWith('//'));
        constants.forEach(constant => this.builtInConstants.add(constant));
      }
      
      // Load keywords
      const keywordsPath = path.join(__dirname, '../../utils/nxc_keywords.txt');
      if (fs.existsSync(keywordsPath)) {
        const keywordsContent = fs.readFileSync(keywordsPath, 'utf8');
        const keywords = keywordsContent.split('\n')
          .map(line => line.trim())
          .filter(line => line && !line.startsWith('//'));
        keywords.forEach(keyword => this.builtInConstants.add(keyword));
      }
      
    } catch (error) {
      console.warn('Could not load NXC API files, using fallback:', error.message);
      // Fallback to basic set
      const builtIns = [
        'OnFwd', 'OnRev', 'Off', 'Wait', 'CurrentTick', 'Sensor', 'ColorSensor', 'SensorUS',
        'SetSensorColorFull', 'SetSensorUltrasonic', 'ResetRotationCount', 'MotorRotationCount',
        'Sin', 'Cos', 'Tan', 'abs', 'clamp', 'now', 'if', 'while', 'switch', 'return'
      ];
      builtIns.forEach(fn => this.builtInFunctions.add(fn));
    }
    
    // Built-in constants
    const constants = [
      'TRUE', 'FALSE', 'NULL', 'true', 'false',
      'OUT_A', 'OUT_B', 'OUT_C', 'OUT_AB', 'OUT_AC', 'OUT_BC', 'OUT_ABC',
      'IN_1', 'IN_2', 'IN_3', 'IN_4', 'M_LEFT', 'M_RIGHT', 'M_SHOVEL', 'M_DRIVE',
      'COL_BLACK', 'COL_BLUE', 'COL_GREEN', 'COL_YELLOW', 'COL_RED', 'COL_WHITE', 'COL_BROWN'
    ];
    
    constants.forEach(constant => this.builtInConstants.add(constant));
  }

  analyze(ast, sourceCode) {
    this.errors = [];
    this.warnings = [];
    this.symbols.clear();
    this.scopes = [new Map()]; // Global scope
    this.functions.clear();
    
    try {
      this.visitNode(ast);
    } catch (error) {
      console.error('Error during semantic analysis:', error);
      this.errors.push({
        message: 'Internal semantic analyzer error',
        line: 0,
        column: 0,
        severity: 'error',
        source: 'semantic-analyzer'
      });
    }
    
    return {
      errors: this.errors,
      warnings: this.warnings,
      symbols: this.symbols
    };
  }

  visitNode(node) {
    if (!node || typeof node !== 'object') return;
    
    const nodeType = node.ctorName || node.constructor.name;
    
    switch (nodeType) {
      case 'Program':
        this.visitProgram(node);
        break;
      case 'FunctionDefinition':
        this.visitFunctionDefinition(node);
        break;
      case 'TaskDefinition':
        this.visitTaskDefinition(node);
        break;
      case 'Declaration':
        this.visitDeclaration(node);
        break;
      case 'CompoundStatement':
        this.visitCompoundStatement(node);
        break;
      case 'ExpressionStatement':
        this.visitExpressionStatement(node);
        break;
      case 'CallExpression':
        this.visitCallExpression(node);
        break;
      case 'Identifier':
        this.visitIdentifier(node);
        break;
      default:
        // Visit children recursively
        if (node.children) {
          node.children.forEach(child => this.visitNode(child));
        }
    }
  }

  visitProgram(node) {
    if (node.children) {
      node.children.forEach(child => this.visitNode(child));
    }
    
    // Check if main function/task exists
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
    
    // Enter function scope
    this.enterScope();
    
    // Add parameters to scope
    params.forEach(param => {
      this.addSymbol(param.name, param.type, param.line || 0);
    });
    
    // Visit function body
    this.visitNode(node.body);
    
    // Exit function scope
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
    
    // Enter task scope
    this.enterScope();
    
    // Visit task body
    this.visitNode(node.body);
    
    // Exit task scope
    this.exitScope();
  }

  visitDeclaration(node) {
    const type = this.extractType(node.type);
    const declarators = this.extractDeclarators(node.declarators);
    
    declarators.forEach(decl => {
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

  visitCallExpression(node) {
    const functionName = this.extractIdentifier(node.callee);
    const args = this.extractArguments(node.arguments);
    
    // Check if function exists
    if (!this.functions.has(functionName) && !this.builtInFunctions.has(functionName)) {
      this.errors.push({
        message: `Function '${functionName}' is not defined`,
        line: node.line || 0,
        column: node.column || 0,
        severity: 'error',
        source: 'semantic-analyzer'
      });
    } else if (this.functions.has(functionName)) {
      // Check number of arguments
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
    
    // Visit arguments
    if (node.arguments) {
      node.arguments.forEach(arg => this.visitNode(arg));
    }
  }

  visitIdentifier(node) {
    const name = this.extractIdentifier(node);
    
    if (!this.isSymbolDefined(name) && !this.builtInConstants.has(name) && !this.functions.has(name)) {
      this.errors.push({
        message: `Identifier '${name}' is not defined`,
        line: node.line || 0,
        column: node.column || 0,
        severity: 'error',
        source: 'semantic-analyzer'
      });
    }
  }

  visitCompoundStatement(node) {
    this.enterScope();
    
    if (node.statements) {
      node.statements.forEach(stmt => this.visitNode(stmt));
    }
    
    this.exitScope();
  }

  visitExpressionStatement(node) {
    if (node.expression) {
      this.visitNode(node.expression);
    }
  }

  // Helper methods
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
    
    // Add to global symbol map
    this.symbols.set(name, { type, line, scope: this.scopes.length - 1 });
  }

  isSymbolInCurrentScope(name) {
    const currentScope = this.scopes[this.scopes.length - 1];
    return currentScope.has(name);
  }

  isSymbolDefined(name) {
    for (let i = this.scopes.length - 1; i >= 0; i--) {
      if (this.scopes[i].has(name)) {
        // Mark as used
        this.scopes[i].get(name).used = true;
        return true;
      }
    }
    return false;
  }

  // Extraction methods (simplified - would need to be adapted for real AST)
  extractIdentifier(node) {
    if (typeof node === 'string') return node;
    if (node && node.name) return node.name;
    if (node && node.sourceString) return node.sourceString;
    return 'unknown';
  }

  extractType(node) {
    if (typeof node === 'string') return node;
    if (node && node.type) return node.type;
    if (node && node.sourceString) return node.sourceString;
    return 'unknown';
  }

  extractParameters(node) {
    if (!node || !Array.isArray(node)) return [];
    return node.map(param => ({
      name: this.extractIdentifier(param.name),
      type: this.extractType(param.type),
      line: param.line || 0
    }));
  }

  extractDeclarators(node) {
    if (!node || !Array.isArray(node)) return [];
    return node.map(decl => ({
      name: this.extractIdentifier(decl),
      line: decl.line || 0
    }));
  }

  extractArguments(node) {
    if (!node || !Array.isArray(node)) return [];
    return node.map(arg => this.extractIdentifier(arg));
  }
}

module.exports = { SemanticAnalyzer };