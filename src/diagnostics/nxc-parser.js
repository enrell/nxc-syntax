const ohm = require('ohm-js');

class NXCParser {
  constructor() {
    this.grammar = null;
    this.initializeGrammar();
  }

  initializeGrammar() {
    // Use the original grammar that worked
    const grammarText = `
NXC {
  Program = ListOf<TopLevelItem, "">

  TopLevelItem = PreprocessorDirective | Declaration | FunctionDefinition | TaskDefinition

  PreprocessorDirective = "#" (IncludeDirective | DefineDirective | ImportDirective | DownloadDirective | ConditionalDirective | PragmaDirective)

  IncludeDirective = "include" stringLiteral

  DefineDirective = "define" ident ( "(" ParameterList? ")" )? ( ~\\n any )* \\n

  ImportDirective = "import" stringLiteral

  DownloadDirective = "download" stringLiteral

  ConditionalDirective = ("if" | "ifdef" | "ifndef") Expression ("else" Expression)? "endif"

  PragmaDirective = "pragma" ( ~\\n any )* \\n

  FunctionDefinition = FunctionSpecifier* ("sub" | "void" | TypeSpecifier) ident "(" ParameterList? ")" CompoundStatement

  FunctionSpecifier = "safecall" | "inline"

  TaskDefinition = "task" ident "(" ")" CompoundStatement

  ParameterList = Parameter ("," Parameter)*

  Parameter = ("const" ws)? TypeSpecifier ("&" ws)? ident ("=" Expression)?

  Declaration = TypeSpecifier Declarator ("," Declarator)* ";"
    | "enum" ident? "{" EnumList? "}" ";"

  EnumList = EnumItem ("," EnumItem)* ","?

  EnumItem = ident ("=" Expression)?

  Declarator = ident ArraySpecifier? ("=" Initializer)?

  ArraySpecifier = "[" Expression? "]"+  -- up to 4 dimensions

  Initializer = Expression | "{" InitializerList "}"

  InitializerList = Initializer ("," Initializer)* ","?

  TypeSpecifier = ("unsigned" | "signed" ws)? BasicType | StructType | EnumType

  BasicType = "bool" | "byte" | "char" | "int" | "short" | "long" | "float" | "mutex" | "string" | "variant" | "void" | ident

  StructType = "struct" ident "{" FieldDeclaration* "}"

  EnumType = "enum" ident

  FieldDeclaration = TypeSpecifier ident ";"

  CompoundStatement = "{" BlockItem* "}"

  BlockItem = Declaration | Statement

  Statement = LabeledStatement
    | CompoundStatement
    | ExpressionStatement
    | SelectionStatement
    | IterationStatement
    | JumpStatement
    | AsmStatement
    | TaskControlStatement

  LabeledStatement = ident ":" Statement
    | "case" Expression ":" Statement
    | "default" ":" Statement

  ExpressionStatement = Expression? ";"

  SelectionStatement = "if" "(" Expression ")" Statement ("else" Statement)?
    | "switch" "(" Expression ")" Statement

  IterationStatement = "while" "(" Expression ")" Statement
    | "until" "(" Expression ")" Statement
    | "do" Statement "while" "(" Expression ")" ";"
    | "for" "(" Expression? ";" Expression? ";" Expression? ")" Statement
    | "repeat" "(" Expression ")" Statement

  JumpStatement = "goto" ident ";"
    | "continue" ";"
    | "break" ";"
    | "return" Expression? ";"

  AsmStatement = "asm" "{" ( ~"}" any )* "}"

  TaskControlStatement = "start" ident ";"
    | "stop" ident ";"
    | "priority" ident "," Expression ";"

  Expression = AssignmentExpression ( "," AssignmentExpression )*

  AssignmentExpression = ConditionalExpression (AssignmentOperator AssignmentExpression)?

  AssignmentOperator = "=" | "*=" | "/=" | "%=" | "+=" | "-=" | "<<=" | ">>=" | "&=" | "^=" | "|="

  ConditionalExpression = LogicalOrExpression ("?" Expression ":" ConditionalExpression)?

  LogicalOrExpression = LogicalAndExpression ("||" LogicalAndExpression)*

  LogicalAndExpression = BitwiseOrExpression ("&&" BitwiseOrExpression)*

  BitwiseOrExpression = BitwiseXorExpression ("|" BitwiseXorExpression)*

  BitwiseXorExpression = BitwiseAndExpression ("^" BitwiseAndExpression)*

  BitwiseAndExpression = EqualityExpression ("&" EqualityExpression)*

  EqualityExpression = RelationalExpression (("==" | "!=") RelationalExpression)*

  RelationalExpression = ShiftExpression (("<" | ">" | "<=" | ">=") ShiftExpression)*

  ShiftExpression = AdditiveExpression (("<<" | ">>") AdditiveExpression)*

  AdditiveExpression = MultiplicativeExpression (("+" | "-") MultiplicativeExpression)*

  MultiplicativeExpression = UnaryExpression (("*" | "/" | "%") UnaryExpression)*

  UnaryExpression = PostfixExpression
    | ("++" | "--") UnaryExpression
    | UnaryOperator CastExpression

  UnaryOperator = "&" | "*" | "+" | "-" | "~" | "!"

  CastExpression = "(" TypeSpecifier ")" UnaryExpression

  PostfixExpression = PrimaryExpression PostfixOperator*

  PostfixOperator = "[" Expression "]"
    | "(" ArgumentList? ")"
    | "." ident
    | "++"
    | "--"

  ArgumentList = AssignmentExpression ("," AssignmentExpression)*

  PrimaryExpression = ident
    | Constant
    | stringLiteral
    | "(" Expression ")"

  Constant = IntegerConstant | FloatConstant | CharConstant

  IntegerConstant = HexConstant | BinaryConstant | OctalConstant | DecimalConstant

  HexConstant = "0x" hexDigit+

  BinaryConstant = "0b" ("0" | "1")+

  OctalConstant = "0" digit+

  DecimalConstant = digit+ 

  FloatConstant = digit* "." digit+ ("e" ("+" | "-")? digit+)?

  CharConstant = "'" (escapeSeq | ~["'\\\\"]) "'"

  stringLiteral = "\\"" (escapeSeq | ~["\\\\\\"" ])* "\\""

  escapeSeq = "\\\\" (["'\\"nr t] | "x" hexDigit hexDigit)

  ident = letter (letter | digit | "_")*

  hexDigit = digit | [a-f] | [A-F]

  digit = [0-9]

  letter = [a-z] | [A-Z]

  space += " " | "\\t" | "\\r" | "\\n" | Comment

  Comment = "//" (~"\\n" any)* "\\n"
    | "/*" (~"*/" any)* "*/"

  ws = space*
}
`;

    try {
      this.grammar = ohm.grammar(grammarText);
    } catch (error) {
      console.error('Error initializing NXC grammar:', error);
      throw error;
    }
  }

  parse(sourceCode) {
    if (!this.grammar) {
      throw new Error('Grammar not initialized');
    }

    const matchResult = this.grammar.match(sourceCode);
    
    return {
      success: matchResult.succeeded(),
      result: matchResult,
      errors: matchResult.succeeded() ? [] : this.extractErrors(matchResult, sourceCode)
    };
  }

  extractErrors(matchResult, sourceCode) {
    const errors = [];
    
    try {
      const failure = matchResult.failure();
      const position = failure.position;
      const message = this.formatErrorMessage(failure);
      
      const lineInfo = this.getLineInfo(sourceCode, position);
      
      console.log(`Parser: Erro encontrado na linha ${lineInfo.line}, coluna ${lineInfo.column}: ${message}`);
      
      errors.push({
        message,
        position,
        line: lineInfo.line,
        column: lineInfo.column,
        severity: 'error',
        source: 'nxc-parser',
        range: {
          start: { line: lineInfo.line, character: lineInfo.column },
          end: { line: lineInfo.line, character: Math.min(lineInfo.column + 10, sourceCode.split('\n')[lineInfo.line]?.length || lineInfo.column + 1) }
        }
      });
    } catch (error) {
      console.error('Error extracting error information:', error);
      errors.push({
        message: `Syntax error: ${error.message}`,
        position: 0,
        line: 0,
        column: 0,
        severity: 'error',
        source: 'nxc-parser'
      });
    }

    return errors;
  }

  formatErrorMessage(failure) {
    const shortMessage = failure.shortMessage;
    const expected = failure.getExpectedText();
    
    if (shortMessage) {
      return `Syntax error: ${shortMessage}`;
    }
    
    if (expected) {
      return `Expected: ${expected}`;
    }
    
    return 'Syntax error';
  }

  getLineInfo(sourceCode, position) {
    const lines = sourceCode.substring(0, position).split(/\r?\n/);
    const line = lines.length - 1;
    const column = lines[lines.length - 1].length;
    
    return { line, column };
  }

  validateSyntax(sourceCode) {
    console.log('Parser: Starting syntax validation...');
    
    try {
      const result = this.parse(sourceCode);
      console.log(`Parser: Result - success: ${result.success}, errors: ${result.errors.length}`);
      
      const warnings = this.generateWarnings(sourceCode);
      console.log(`Parser: Generated ${warnings.length} warnings`);
      
      return {
        isValid: result.success,
        errors: result.errors,
        warnings: warnings
      };
    } catch (error) {
      console.error('Parser: Error during validation:', error);
      return {
        isValid: false,
        errors: [{
          message: `Internal parser error: ${error.message}`,
          position: 0,
          line: 0,
          column: 0,
          severity: 'error',
          source: 'nxc-parser'
        }],
        warnings: []
      };
    }
  }

  generateWarnings(sourceCode) {
    const warnings = [];
    const lines = sourceCode.split(/\r?\n/);
    
    lines.forEach((line, index) => {
      // Warning for lines too long
      if (line.length > 120) {
        warnings.push({
          message: 'Line too long (>120 characters)',
          line: index,
          column: 120,
          severity: 'warning',
          source: 'nxc-parser'
        });
      }
      
      // Warning for mixed tabs and spaces
      if (line.includes('\t') && line.includes('  ')) {
        warnings.push({
          message: 'Mixed tabs and spaces for indentation',
          line: index,
          column: 0,
          severity: 'warning',
          source: 'nxc-parser'
        });
      }
      
      // Warning for unused variables (basic)
      const varMatch = line.match(/^\s*(int|float|byte|char|string|bool)\s+(\w+)/);
      if (varMatch) {
        const varName = varMatch[2];
        const restOfCode = lines.slice(index + 1).join('\n');
        if (!restOfCode.includes(varName)) {
          warnings.push({
            message: `Variable '${varName}' declared but never used`,
            line: index,
            column: line.indexOf(varName),
            severity: 'info',
            source: 'nxc-parser'
          });
        }
      }
    });
    
    return warnings;
  }
}

module.exports = { NXCParser };