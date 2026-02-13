const vscode = require('vscode');

class NXCFormatter {
  constructor() {
    this.indentSize = 4;
    this.useSpaces = true;
  }

  getConfig(options) {
    if (vscode) {
      const config = vscode.workspace.getConfiguration('nxc.formatting');
      return {
        indentSize: options.tabSize || config.get('indentSize', 4),
        useSpaces:
          options.insertSpaces !== undefined ? options.insertSpaces : config.get('useSpaces', true)
      };
    }
    return {
      indentSize: options.tabSize || 4,
      useSpaces: options.insertSpaces !== undefined ? options.insertSpaces : true
    };
  }

  formatDocument(document, options) {
    if (!vscode) {
      throw new Error('VS Code context required for formatDocument');
    }

    const text = document.getText();
    const formattedText = this.formatCode(text, options);

    if (formattedText === text) {
      return [];
    }

    const fullRange = new vscode.Range(document.positionAt(0), document.positionAt(text.length));

    return [vscode.TextEdit.replace(fullRange, formattedText)];
  }

  formatRange(document, range, options) {
    if (!vscode) {
      throw new Error('VS Code context required for formatRange');
    }

    const text = document.getText(range);
    const formattedText = this.formatCode(text, options);

    if (formattedText === text) {
      return [];
    }

    return [vscode.TextEdit.replace(range, formattedText)];
  }

  formatCode(code, options = {}) {
    const config = this.getConfig(options);
    const indentChar = config.useSpaces ? ' '.repeat(config.indentSize) : '\t';

    return this.processLines(code.split(/\r?\n/), indentChar).join('\n');
  }

  processLines(lines, indentChar) {
    const formattedLines = [];
    let indentLevel = 0;
    let inMultiLineComment = false;
    let needsUnindentAfterStatement = false;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const trimmedLine = line.trim();

      if (trimmedLine === '') {
        formattedLines.push('');
        continue;
      }

      if (
        this.handleCommentLine(
          trimmedLine,
          line,
          formattedLines,
          indentLevel,
          indentChar,
          inMultiLineComment
        )
      ) {
        inMultiLineComment =
          formattedLines[formattedLines.length - 1] !== '' && !line.includes('*/');
        continue;
      }

      if (trimmedLine.startsWith('/*') && !trimmedLine.includes('*/')) {
        inMultiLineComment = true;
      }

      if (inMultiLineComment) {
        if (trimmedLine.includes('*/')) {
          inMultiLineComment = false;
        }
        formattedLines.push(this.indentLine(line, indentLevel, indentChar));
        continue;
      }

      if (trimmedLine.startsWith('//')) {
        formattedLines.push(this.indentLine(line, indentLevel, indentChar));
        continue;
      }

      if (trimmedLine.startsWith('#')) {
        formattedLines.push(trimmedLine);
        continue;
      }

      if (
        needsUnindentAfterStatement &&
        !this.isControlStructure(trimmedLine) &&
        !trimmedLine.startsWith('}') &&
        trimmedLine.endsWith(';')
      ) {
        indentLevel = Math.max(0, indentLevel - 1);
        needsUnindentAfterStatement = false;
      }

      const indentChange = this.calculateIndentChange(
        trimmedLine,
        i > 0 ? lines[i - 1].trim() : ''
      );
      indentLevel = Math.max(0, indentLevel + indentChange.pre);

      const formattedLine = this.formatLine(trimmedLine);
      formattedLines.push(this.indentLine(formattedLine, indentLevel, indentChar));

      indentLevel = Math.max(0, indentLevel + indentChange.post);

      if (this.isControlStructure(trimmedLine) && !trimmedLine.includes('{')) {
        needsUnindentAfterStatement = true;
      }
    }

    return formattedLines;
  }

  handleCommentLine(
    trimmedLine,
    originalLine,
    formattedLines,
    indentLevel,
    indentChar,
    inMultiLineComment
  ) {
    if (trimmedLine.startsWith('/*')) {
      if (!trimmedLine.includes('*/')) {
        formattedLines.push(this.indentLine(originalLine, indentLevel, indentChar));
        return true;
      }
    }
    return false;
  }

  calculateIndentChange(line, previousLine = '') {
    let pre = 0;
    let post = 0;

    if (line.startsWith('}')) {
      pre = -1;
    }

    if (line.includes('{')) {
      const openBraces = (line.match(/\{/g) || []).length;
      const closeBraces = (line.match(/\}/g) || []).length;
      post += openBraces - closeBraces;
    }

    if (line.startsWith('case ') || line.startsWith('default:')) {
      if (line.endsWith(':')) {
        post = 1;
      }
    }

    if (line.startsWith('else') && !line.includes('{')) {
      if (previousLine && !previousLine.includes('{') && !previousLine.startsWith('}')) {
        pre = -1;
      }
    }

    if (
      !this.isControlStructure(line) &&
      !line.startsWith('}') &&
      !line.startsWith('case ') &&
      !line.startsWith('default:') &&
      !line.includes('{') &&
      !line.startsWith('//') &&
      !line.startsWith('#') &&
      line.endsWith(';') &&
      previousLine &&
      this.isControlStructure(previousLine) &&
      !previousLine.includes('{')
    ) {
      post = -1;
    }

    return { pre, post };
  }

  isControlStructure(line) {
    const controlKeywords = ['if', 'else', 'while', 'for', 'do', 'switch', 'task', 'sub'];

    return controlKeywords.some((keyword) => {
      const regex = new RegExp(`^${keyword}\\b`);
      return regex.test(line);
    });
  }

  formatLine(line) {
    line = line.replace(/\s+/g, ' ').trim();

    line = this.formatOperators(line);
    line = this.formatFunctions(line);
    line = this.formatControlStructures(line);
    line = this.formatSemicolons(line);
    line = this.formatCommas(line);

    return line;
  }

  formatOperators(line) {
    const operators = ['++', '--'];

    operators.forEach((op) => {
      const placeholder = `§${op.toUpperCase()}§`;
      line = line.replace(new RegExp(op.replace('+', '\\+').replace('-', '\\-'), 'g'), placeholder);
    });

    line = line.replace(/\s*([=!<>]=?|\+=|-=|\*=|\/=|%=|\|=|&=|\^=|<<=|>>=)\s*/g, ' $1 ');
    line = line.replace(/\s*([+\-*/%])\s*/g, ' $1 ');
    line = line.replace(/\s*(&&|\|\|)\s*/g, ' $1 ');
    line = line.replace(/\s*([&|^~])\s*/g, ' $1 ');
    line = line.replace(/\s*(<<|>>)\s*/g, ' $1 ');

    line = line.replace(/§PLUSPLUS§/g, '++');
    line = line.replace(/§MINUSMINUS§/g, '--');

    line = line.replace(/\s*\(\s*/g, '(');
    line = line.replace(/\s*\)\s*/g, ')');
    line = line.replace(/\s*\[\s*/g, '[');
    line = line.replace(/\s*\]\s*/g, ']');

    return line;
  }

  formatFunctions(line) {
    line = line.replace(/([a-zA-Z_][a-zA-Z0-9_]*)\s+\(/g, '$1(');
    line = line.replace(/,\s*/g, ', ');

    return line;
  }

  formatControlStructures(line) {
    const controlKeywords = ['if', 'while', 'for', 'switch'];
    controlKeywords.forEach((keyword) => {
      const regex = new RegExp(`\\b${keyword}\\s*\\(`, 'g');
      line = line.replace(regex, `${keyword} (`);
    });

    const functionKeywords = ['task', 'sub'];
    functionKeywords.forEach((keyword) => {
      const regex = new RegExp(`\\b${keyword}\\s+([a-zA-Z_][a-zA-Z0-9_]*)\\s*\\(`, 'g');
      line = line.replace(regex, `${keyword} $1(`);
    });

    line = line.replace(/\)\s*{/g, ') {');
    line = line.replace(/\s*{\s*/g, ' {');
    line = line.replace(/}\s*else\s*{/g, '} else {');
    line = line.replace(/}\s*else\s+/g, '} else ');

    return line;
  }

  formatSemicolons(line) {
    line = line.replace(/\s*;/g, ';');
    line = line.replace(/\breturn\s*([^;])/g, 'return $1');
    line = line.replace(/\breturn\s*;/g, 'return;');

    return line;
  }

  formatCommas(line) {
    line = line.replace(/\s*,\s*/g, ', ');
    return line;
  }

  indentLine(line, level, indentChar) {
    const trimmed = line.trim();
    if (trimmed === '') {
      return '';
    }
    return indentChar.repeat(level) + trimmed;
  }
}

module.exports = { NXCFormatter };
