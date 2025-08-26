// VS Code module - only require when running in VS Code context
let vscode;
try {
  vscode = require('vscode');
} catch (e) {
  // Running outside VS Code context
  vscode = null;
}

class NXCFormatter {
  constructor() {
    this.indentSize = 4;
    this.useSpaces = true;
  }

  formatDocument(document, options) {
    if (!vscode) throw new Error('VS Code context required for formatDocument');

    const text = document.getText();
    const formattedText = this.formatCode(text, options);

    if (formattedText === text) {
      return [];
    }

    const fullRange = new vscode.Range(
      document.positionAt(0),
      document.positionAt(text.length)
    );

    return [vscode.TextEdit.replace(fullRange, formattedText)];
  }

  formatRange(document, range, options) {
    if (!vscode) throw new Error('VS Code context required for formatRange');

    const text = document.getText(range);
    const formattedText = this.formatCode(text, options);

    if (formattedText === text) {
      return [];
    }

    return [vscode.TextEdit.replace(range, formattedText)];
  }

  formatCode(code, options = {}) {
    // Get formatting options
    let indentSize = 4;
    let useSpaces = true;

    if (vscode) {
      const config = vscode.workspace.getConfiguration('nxc.formatting');
      indentSize = options.tabSize || config.get('indentSize', 4);
      useSpaces = options.insertSpaces !== undefined ? options.insertSpaces : config.get('useSpaces', true);
    } else {
      indentSize = options.tabSize || 4;
      useSpaces = options.insertSpaces !== undefined ? options.insertSpaces : true;
    }

    const indentChar = useSpaces ? ' '.repeat(indentSize) : '\t';

    let lines = code.split(/\r?\n/);
    let formattedLines = [];
    let indentLevel = 0;
    let inMultiLineComment = false;
    let inPreprocessor = false;
    let needsUnindentAfterStatement = false;

    for (let i = 0; i < lines.length; i++) {
      let line = lines[i];
      let originalLine = line;
      let trimmedLine = line.trim();

      // Skip empty lines but preserve them
      if (trimmedLine === '') {
        formattedLines.push('');
        continue;
      }

      // Handle multi-line comments
      if (inMultiLineComment) {
        if (trimmedLine.includes('*/')) {
          inMultiLineComment = false;
        }
        formattedLines.push(this.indentLine(line, indentLevel, indentChar));
        continue;
      }

      if (trimmedLine.startsWith('/*')) {
        if (!trimmedLine.includes('*/')) {
          inMultiLineComment = true;
        }
        formattedLines.push(this.indentLine(line, indentLevel, indentChar));
        continue;
      }

      // Handle preprocessor directives
      if (trimmedLine.startsWith('#')) {
        inPreprocessor = true;
        formattedLines.push(trimmedLine); // Preprocessor directives start at column 0
        continue;
      }

      // Handle single-line comments
      if (trimmedLine.startsWith('//')) {
        formattedLines.push(this.indentLine(line, indentLevel, indentChar));
        continue;
      }

      // Handle unindent after single statements
      if (needsUnindentAfterStatement && !this.isControlStructure(trimmedLine) &&
        !trimmedLine.startsWith('}') && trimmedLine.endsWith(';')) {
        indentLevel = Math.max(0, indentLevel - 1);
        needsUnindentAfterStatement = false;
      }

      // Calculate indentation changes
      let lineIndentChange = this.calculateIndentChange(trimmedLine, i > 0 ? lines[i - 1].trim() : '');
      let preIndentChange = lineIndentChange.pre;
      let postIndentChange = lineIndentChange.post;

      // Apply pre-indent change (for closing braces, etc.)
      indentLevel = Math.max(0, indentLevel + preIndentChange);

      // Format the line
      let formattedLine = this.formatLine(trimmedLine);
      formattedLine = this.indentLine(formattedLine, indentLevel, indentChar);

      formattedLines.push(formattedLine);

      // Apply post-indent change (for opening braces, etc.)
      indentLevel = Math.max(0, indentLevel + postIndentChange);

      // Check if we need to unindent after next statement
      if (this.isControlStructure(trimmedLine) && !trimmedLine.includes('{')) {
        needsUnindentAfterStatement = true;
      }
    }

    return formattedLines.join('\n');
  }

  calculateIndentChange(line, previousLine = '') {
    let pre = 0;
    let post = 0;

    // Closing braces decrease indent before the line
    if (line.startsWith('}')) {
      pre = -1;
    }

    // Opening braces increase indent after the line
    if (line.includes('{')) {
      // Count opening and closing braces
      const openBraces = (line.match(/\{/g) || []).length;
      const closeBraces = (line.match(/\}/g) || []).length;
      post += openBraces - closeBraces;
    }

    // Handle case/default statements
    if (line.startsWith('case ') || line.startsWith('default:')) {
      if (line.endsWith(':')) {
        post = 1;
      }
    }

    // Handle else statements without braces
    if (line.startsWith('else') && !line.includes('{')) {
      // If previous line was a single statement after if, we need to unindent first
      if (previousLine && !previousLine.includes('{') && !previousLine.startsWith('}')) {
        pre = -1;
      }
    }

    // Handle single statements after control structures
    if (!this.isControlStructure(line) && !line.startsWith('}') &&
      !line.startsWith('case ') && !line.startsWith('default:') &&
      !line.includes('{') && !line.startsWith('//') &&
      !line.startsWith('#') && line.endsWith(';') &&
      previousLine && this.isControlStructure(previousLine) && !previousLine.includes('{')) {
      // This is a single statement after a control structure without braces
      // It should be unindented after execution
      post = -1;
    }

    return { pre, post };
  }

  isControlStructure(line) {
    const controlKeywords = [
      'if', 'else', 'while', 'for', 'do', 'switch', 'task', 'sub'
    ];

    return controlKeywords.some(keyword => {
      const regex = new RegExp(`^${keyword}\\b`);
      return regex.test(line);
    });
  }

  formatLine(line) {
    // Remove extra whitespace
    line = line.replace(/\s+/g, ' ').trim();

    // Format operators with proper spacing
    line = this.formatOperators(line);

    // Format function calls and declarations
    line = this.formatFunctions(line);

    // Format control structures
    line = this.formatControlStructures(line);

    // Format semicolons
    line = this.formatSemicolons(line);

    // Format commas
    line = this.formatCommas(line);

    return line;
  }

  formatOperators(line) {
    // Handle increment/decrement operators first (avoid breaking ++ and --)
    line = line.replace(/\+\+/g, '§PLUSPLUS§');
    line = line.replace(/--/g, '§MINUSMINUS§');

    // Assignment operators
    line = line.replace(/\s*([=!<>]=?|\+=|-=|\*=|\/=|%=|\|=|&=|\^=|<<=|>>=)\s*/g, ' $1 ');

    // Arithmetic operators (but not ++ or --)
    line = line.replace(/\s*([+\-*/%])\s*/g, ' $1 ');

    // Logical operators
    line = line.replace(/\s*(&&|\|\|)\s*/g, ' $1 ');

    // Bitwise operators
    line = line.replace(/\s*([&|^~])\s*/g, ' $1 ');

    // Shift operators
    line = line.replace(/\s*(<<|>>)\s*/g, ' $1 ');

    // Restore increment/decrement operators
    line = line.replace(/§PLUSPLUS§/g, '++');
    line = line.replace(/§MINUSMINUS§/g, '--');

    // Fix spacing around parentheses in expressions
    line = line.replace(/\s*\(\s*/g, '(');
    line = line.replace(/\s*\)\s*/g, ')');

    // Fix spacing around brackets
    line = line.replace(/\s*\[\s*/g, '[');
    line = line.replace(/\s*\]\s*/g, ']');

    return line;
  }

  formatFunctions(line) {
    // Function calls: remove space before parentheses
    line = line.replace(/([a-zA-Z_][a-zA-Z0-9_]*)\s+\(/g, '$1(');

    // Function parameters: space after commas
    line = line.replace(/,\s*/g, ', ');

    return line;
  }

  formatControlStructures(line) {
    // Control structures: space before opening parenthesis
    const controlKeywords = ['if', 'while', 'for', 'switch'];
    controlKeywords.forEach(keyword => {
      const regex = new RegExp(`\\b${keyword}\\s*\\(`, 'g');
      line = line.replace(regex, `${keyword} (`);
    });

    // Function/task/sub declarations: space before opening parenthesis
    const functionKeywords = ['task', 'sub'];
    functionKeywords.forEach(keyword => {
      const regex = new RegExp(`\\b${keyword}\\s+([a-zA-Z_][a-zA-Z0-9_]*)\\s*\\(`, 'g');
      line = line.replace(regex, `${keyword} $1(`);
    });

    // Opening brace on same line with space
    line = line.replace(/\)\s*{/g, ') {');
    line = line.replace(/\s*{\s*/g, ' {');

    // Handle else statements
    line = line.replace(/}\s*else\s*{/g, '} else {');
    line = line.replace(/}\s*else\s+/g, '} else ');

    return line;
  }

  formatSemicolons(line) {
    // Remove space before semicolons
    line = line.replace(/\s*;/g, ';');

    // Handle return statements - add space after return keyword
    line = line.replace(/\breturn\s*([^;])/g, 'return $1');
    line = line.replace(/\breturn\s*;/g, 'return;');

    return line;
  }

  formatCommas(line) {
    // Space after commas, no space before
    line = line.replace(/\s*,\s*/g, ', ');
    return line;
  }

  indentLine(line, level, indentChar) {
    const trimmed = line.trim();
    if (trimmed === '') return '';
    return indentChar.repeat(level) + trimmed;
  }
}

module.exports = { NXCFormatter };