const vscode = require('vscode');
const fs = require('fs');
const path = require('path');
const { DiagnosticManager } = require('./diagnostics/diagnostic-manager');
const { NXCFormatter } = require('./formatter/nxc-formatter');

class NXCExtension {
  constructor() {
    this.diagnosticManager = null;
    this.formatter = new NXCFormatter();
    this.cache = {
      functions: new Map(),
      constants: new Set(),
      keywords: new Set(),
      types: new Set(['void', 'bool', 'byte', 'char', 'int', 'unsigned', 'short', 'long', 'string', 'float', 'mutex', 'struct'])
    };
    this.watchers = [];
  }

  activate(context) {
    try {
      this.diagnosticManager = new DiagnosticManager();
      context.subscriptions.push(this.diagnosticManager);
      this.buildIndex(context);
      this.registerLanguageProviders(context);
      this.setupFileWatchers(context);
      this.registerCommands(context);
      this.setupDocumentEvents(context);
      this.analyzeInitialDocuments();
    } catch (error) {
      vscode.window.showErrorMessage(`Failed to activate NXC extension: ${error.message}`);
    }
  }

  analyzeInitialDocuments() {
    setTimeout(() => {
      vscode.workspace.textDocuments.forEach((document) => {
        if (document.languageId === 'nxc') {
          this.diagnosticManager.analyzeDocument(document);
        }
      });
    }, 1000);
  }

  registerLanguageProviders(context) {
    const completionProvider = vscode.languages.registerCompletionItemProvider('nxc', {
      provideCompletionItems: (document, position) => this.provideCompletionItems(document, position)
    });

    const hoverProvider = vscode.languages.registerHoverProvider('nxc', {
      provideHover: (document, position) => this.provideHover(document, position)
    });

    const signatureProvider = vscode.languages.registerSignatureHelpProvider('nxc', {
      provideSignatureHelp: (document, position) => this.provideSignatureHelp(document, position);
    }, '(', ',');

    const formattingProvider = vscode.languages.registerDocumentFormattingEditProvider('nxc', {
      provideDocumentFormattingEdits: (document, options) =>
        this.provideDocumentFormattingEdits(document, options)
    });

    const rangeFormattingProvider = vscode.languages.registerDocumentRangeFormattingEditProvider('nxc', {
      provideDocumentRangeFormattingEdits: (document, range, options) =>
        this.provideDocumentRangeFormattingEdits(document, range, options)
    });

    context.subscriptions.push(
      completionProvider,
      hoverProvider,
      signatureProvider,
      formattingProvider,
      rangeFormattingProvider
    );
  }

  setupDocumentEvents(context) {
    const onDidOpenTextDocument = vscode.workspace.onDidOpenTextDocument((document) => {
      if (document.languageId === 'nxc') {
        this.diagnosticManager.analyzeDocument(document);
      }
    });

    const onDidChangeTextDocument = vscode.workspace.onDidChangeTextDocument((event) => {
      if (event.document.languageId === 'nxc') {
        this.debounceAnalysis(event.document);
      }
    });

    const onDidCloseTextDocument = vscode.workspace.onDidCloseTextDocument((document) => {
      if (document.languageId === 'nxc') {
        this.diagnosticManager.clearDiagnostics(document.uri);
      }
    });

    const onWillSaveTextDocument = vscode.workspace.onWillSaveTextDocument((event) => {
      if (event.document.languageId === 'nxc') {
        this.handleFormatOnSave(event);
      }
    });

    context.subscriptions.push(
      onDidOpenTextDocument,
      onDidChangeTextDocument,
      onDidCloseTextDocument,
      onWillSaveTextDocument
    );
  }

  handleFormatOnSave(event) {
    const config = vscode.workspace.getConfiguration('nxc.formatting');
    if (config.get('formatOnSave', false)) {
      const edits = this.provideDocumentFormattingEdits(event.document, {
        tabSize: vscode.workspace.getConfiguration('editor').get('tabSize', 4),
        insertSpaces: vscode.workspace.getConfiguration('editor').get('insertSpaces', true)
      });
      if (edits && edits.length > 0) {
        event.waitUntil(Promise.resolve(edits));
      }
    }
  }

  debounceAnalysis(document) {
    if (this.analysisTimeout) {
      clearTimeout(this.analysisTimeout);
    }
    this.analysisTimeout = setTimeout(() => {
      this.diagnosticManager.analyzeDocument(document);
    }, 500);
  }

  registerCommands(context) {
    const commands = [
      {
        id: 'nxc.rebuildIndex',
        handler: () => {
          this.buildIndex(context);
          vscode.window.showInformationMessage('NXC index rebuilt successfully');
        }
      },
      {
        id: 'nxc.reparseOpenFiles',
        handler: () => {
          vscode.workspace.textDocuments.forEach((document) => {
            if (document.languageId === 'nxc') {
              this.diagnosticManager.analyzeDocument(document);
            }
          });
          vscode.window.showInformationMessage('NXC files reanalyzed');
        }
      },
      {
        id: 'nxc.clearDiagnostics',
        handler: () => {
          this.diagnosticManager.clearAllDiagnostics();
          vscode.window.showInformationMessage('Diagnostics cleared');
        }
      },
      {
        id: 'nxc.formatDocument',
        handler: () => {
          const editor = vscode.window.activeTextEditor;
          if (editor && editor.document.languageId === 'nxc') {
            vscode.commands.executeCommand('editor.action.formatDocument');
          }
        }
      }
    ];

    commands.forEach(({ id, handler }) => {
      context.subscriptions.push(vscode.commands.registerCommand(id, handler));
    });
  }

  setupFileWatchers(context) {
    const filesToWatch = [
      'utils/nxc_api.txt',
      'utils/nxc_constants.txt',
      'utils/nxc_keywords.txt',
      'utils/NXC_templates.txt'
    ];

    filesToWatch.forEach((relativePath) => {
      const fullPath = path.join(context.extensionPath, relativePath);
      if (!fs.existsSync(fullPath)) {
        return;
      }

      try {
        const watcher = fs.watch(fullPath, { persistent: false }, (eventType) => {
          if (eventType === 'change') {
            this.buildIndex(context);
          }
        });

        this.watchers.push(watcher);
        context.subscriptions.push({ dispose: () => watcher.close() });
      } catch (error) {
        vscode.window.showWarningMessage(`Could not create watcher for ${relativePath}: ${error.message}`);
      }
    });
  }

  buildIndex(context) {
    this.cache.functions.clear();
    this.cache.constants.clear();
    this.cache.keywords.clear();

    const utilsPath = path.join(context.extensionPath, 'utils');

    try {
      this.parseKeywords(path.join(utilsPath, 'nxc_keywords.txt'));
      this.parseConstants(path.join(utilsPath, 'nxc_constants.txt'));
      this.parseApi(path.join(utilsPath, 'nxc_api.txt'));
      this.parseTemplates(path.join(utilsPath, 'NXC_templates.txt'));
    } catch (error) {
      vscode.window.showErrorMessage(`Error building NXC index: ${error.message}`);
    }
  }

  parseKeywords(filePath) {
    if (!fs.existsSync(filePath)) {
      return;
    }

    try {
      const content = fs.readFileSync(filePath, 'utf8');
      content
        .split(/\r?\n/)
        .forEach((line) => {
          const trimmed = line.trim();
          if (trimmed && !trimmed.startsWith('//') && !trimmed.startsWith('#')) {
            this.cache.keywords.add(trimmed);
          }
        });
    } catch {
      vscode.window.showWarningMessage(`Error reading ${filePath}`);
    }
  }

  parseConstants(filePath) {
    if (!fs.existsSync(filePath)) {
      return;
    }

    try {
      const content = fs.readFileSync(filePath, 'utf8');
      content
        .split(/\r?\n/)
        .forEach((line) => {
          const trimmed = line.trim();
          if (trimmed && !trimmed.startsWith('//') && !trimmed.startsWith('#')) {
            this.cache.constants.add(trimmed);
          }
        });
    } catch {
      vscode.window.showWarningMessage(`Error reading ${filePath}`);
    }
  }

  parseApi(filePath) {
    if (!fs.existsSync(filePath)) {
      return;
    }

    try {
      const content = fs.readFileSync(filePath, 'utf8');
      content
        .split(/\r?\n/)
        .forEach((line) => {
          const trimmed = line.trim();
          if (!trimmed || trimmed.startsWith('//')) {
            return;
          }

          const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*\(([^)]*)\)$/);
          if (!match) {
            return;
          }

          const name = match[1];
          const params = match[2].trim();

          if (this.cache.keywords.has(name) || this.cache.types.has(name)) {
            return;
          }

          const paramList = params.length ? params.split(',').map((p) => p.trim()) : [];
          const paramNames = paramList.map((param) => {
            const cleaned = param.replace(/=.*$/, '').replace(/\[.*\]/, '').trim();
            const parts = cleaned.split(/\s+/);
            return parts[parts.length - 1] || param;
          });

          this.cache.functions.set(name, {
            name,
            signature: `(${params})`,
            params: paramNames,
            rawParams: paramList,
            fullSignature: trimmed,
            documentation: this.generateDocumentation(name, paramList)
          });
        });
    } catch {
      vscode.window.showWarningMessage(`Error reading ${filePath}`);
    }
  }

  parseTemplates(filePath) {
    if (!fs.existsSync(filePath)) {
      return;
    }

    try {
      const content = fs.readFileSync(filePath, 'utf8');
      content
        .split(/\r?\n/)
        .forEach((line) => {
          const trimmed = line.trim();
          if (!trimmed || trimmed.startsWith('-') || trimmed.startsWith('|') || trimmed.startsWith('#')) {
            return;
          }

          const functionMatch = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*(?:\(|"|;)/);
          if (functionMatch) {
            const name = functionMatch[1];
            if (!this.cache.keywords.has(name) && !this.cache.types.has(name) && !this.cache.functions.has(name)) {
              this.cache.functions.set(name, {
                name,
                signature: '()',
                params: [],
                rawParams: [],
                fullSignature: `${name}()`,
                documentation: `Template function: ${name}`
              });
            }
          }
        });
    } catch {
      vscode.window.showWarningMessage(`Error reading ${filePath}`);
    }
  }

  generateDocumentation(functionName, params) {
    const paramDocs =
      params.length > 0
        ? `\n\n**Parameters:**\n${params.map((p) => `- \`${p}\``).join('\n')}`
        : '';

    return `NXC Function: \`${functionName}\`${paramDocs}`;
  }

  provideCompletionItems(document, position) {
    const range = document.getWordRangeAtPosition(position) || new vscode.Range(position, position);
    const items = [];

    for (const keyword of this.cache.keywords) {
      const item = new vscode.CompletionItem(keyword, vscode.CompletionItemKind.Keyword);
      item.range = range;
      item.sortText = `1_${keyword}`;
      items.push(item);
    }

    for (const type of this.cache.types) {
      const item = new vscode.CompletionItem(type, vscode.CompletionItemKind.Struct);
      item.range = range;
      item.sortText = `2_${type}`;
      items.push(item);
    }

    for (const func of this.cache.functions.values()) {
      const item = new vscode.CompletionItem(func.name, vscode.CompletionItemKind.Function);
      item.detail = func.fullSignature;
      item.documentation = new vscode.MarkdownString(func.documentation);

      if (func.params.length > 0) {
        const placeholders = func.params.map((param, index) => {
          const suggestion = this.suggestParameterValue(param, func.rawParams[index]);
          return `\${${index + 1}:${suggestion}}`;
        });
        item.insertText = new vscode.SnippetString(`${func.name}(${placeholders.join(', ')})`);
      } else {
        item.insertText = new vscode.SnippetString(`${func.name}()`);
      }

      item.range = range;
      item.sortText = `3_${func.name}`;
      items.push(item);
    }

    for (const constant of this.cache.constants) {
      if (this.cache.keywords.has(constant) || this.cache.types.has(constant) || this.cache.functions.has(constant)) {
        continue;
      }

      const item = new vscode.CompletionItem(constant, vscode.CompletionItemKind.Constant);
      item.range = range;
      item.sortText = `4_${constant}`;
      items.push(item);
    }

    return items;
  }

  provideHover(document, position) {
    const range = document.getWordRangeAtPosition(position, /[A-Za-z_][A-Za-z0-9_]*/);
    if (!range) {
      return undefined;
    }

    const word = document.getText(range);

    const func = this.cache.functions.get(word);
    if (func) {
      const markdown = new vscode.MarkdownString();
      markdown.appendCodeblock(func.fullSignature, 'nxc');
      if (func.documentation) {
        markdown.appendMarkdown('\n\n' + func.documentation);
      }
      return new vscode.Hover(markdown, range);
    }

    if (this.cache.constants.has(word)) {
      const markdown = new vscode.MarkdownString();
      markdown.appendCodeblock(`${word} (constant)`, 'nxc');
      return new vscode.Hover(markdown, range);
    }

    if (this.cache.keywords.has(word)) {
      const markdown = new vscode.MarkdownString();
      markdown.appendCodeblock(`${word} (keyword)`, 'nxc');
      return new vscode.Hover(markdown, range);
    }

    return undefined;
  }

  provideSignatureHelp(document, position) {
    const line = document.lineAt(position.line).text.substring(0, position.character);
    const callMatch = /([A-Za-z_][A-Za-z0-9_]*)\s*\(([^()]*)$/.exec(line);

    if (!callMatch) {
      return null;
    }

    const functionName = callMatch[1];
    const func = this.cache.functions.get(functionName);

    if (!func) {
      return null;
    }

    const signature = new vscode.SignatureInformation(func.fullSignature);
    signature.documentation = new vscode.MarkdownString(func.documentation);

    func.rawParams.forEach((param) => {
      signature.parameters.push(new vscode.ParameterInformation(param.trim()));
    });

    const help = new vscode.SignatureHelp();
    help.signatures = [signature];
    help.activeSignature = 0;

    const argsSoFar = callMatch[2];
    const commaCount = (argsSoFar.match(/,/g) || []).length;
    help.activeParameter = argsSoFar.trim() === '' ? 0 : commaCount;

    return help;
  }

  suggestParameterValue(paramName, paramType = '') {
    const name = paramName.toLowerCase();
    const type = paramType.toLowerCase();

    if (type.includes('byte') && name.includes('output')) {
      return 'OUT_A';
    }
    if (type.includes('byte') && name.includes('port')) {
      return 'IN_1';
    }
    if (name.includes('string') || type.includes('string')) {
      return '""';
    }
    if (type.includes('bool')) {
      return 'true';
    }

    const suggestions = {
      'outputs?': 'OUT_A',
      'ports?': 'IN_1',
      'pwr|power': '75',
      'speed': '75',
      'angle|deg': '360',
      'time|ms|duration': '1000',
      'channel': '1',
      'i2caddr|addr': '0x02',
      'mode': '0',
      'value|val': '0',
      'count|cnt|len': '1',
      'filename|file|fname': '"file.txt"',
      'str|text|msg': '""',
      'buffer|data': 'buffer',
      'mutex': 'myMutex',
      'handle': 'handle',
      'x|y|z': '0',
      'width|height': '50',
      'frequency|freq': '1000'
    };

    for (const [pattern, value] of Object.entries(suggestions)) {
      if (new RegExp(`^(${pattern})$`).test(name)) {
        return value;
      }
    }

    return '0';
  }

  provideDocumentFormattingEdits(document, options) {
    try {
      return this.formatter.formatDocument(document, options);
    } catch (error) {
      vscode.window.showErrorMessage(`Error formatting NXC document: ${error.message}`);
      return [];
    }
  }

  provideDocumentRangeFormattingEdits(document, range, options) {
    try {
      return this.formatter.formatRange(document, range, options);
    } catch (error) {
      vscode.window.showErrorMessage(`Error formatting NXC range: ${error.message}`);
      return [];
    }
  }

  deactivate() {
    this.watchers.forEach((watcher) => {
      try {
        watcher.close();
      } catch {
        // Ignore errors when closing watchers
      }
    });

    if (this.analysisTimeout) {
      clearTimeout(this.analysisTimeout);
    }
  }
}

let nxcExtension = null;

function activate(context) {
  nxcExtension = new NXCExtension();
  nxcExtension.activate(context);
}

function deactivate() {
  if (nxcExtension) {
    nxcExtension.deactivate();
    nxcExtension = null;
  }
}

module.exports = { activate, deactivate };
