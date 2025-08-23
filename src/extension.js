const vscode = require('vscode');
const fs = require('fs');
const path = require('path');
const { DiagnosticManager } = require('./diagnostics/diagnostic-manager');

class NXCExtension {
  constructor() {
    this.diagnosticManager = null;
    this.cache = { 
      functions: new Map(), 
      constants: new Set(), 
      keywords: new Set(),
      types: new Set(['void','bool','byte','char','int','unsigned','short','long','string','float','mutex','struct'])
    };
    this.watchers = [];
  }

  activate(context) {
    console.log('Activating NXC extension...');
    
    try {
      // Initialize diagnostic manager
      this.diagnosticManager = new DiagnosticManager();
      context.subscriptions.push(this.diagnosticManager);

      // Build symbol index
      this.buildIndex(context);

      // Register language providers
      this.registerLanguageProviders(context);

      // Setup watchers for data files
      this.setupFileWatchers(context);

      // Register commands
      this.registerCommands(context);

      // Setup document events
      this.setupDocumentEvents(context);

      console.log('NXC extension activated successfully');
      
      // Force initial analysis of already open documents
      setTimeout(() => {
        vscode.workspace.textDocuments.forEach(document => {
          if (document.languageId === 'nxc') {
            console.log(`Analyzing initial document: ${document.fileName}`);
            this.diagnosticManager.analyzeDocument(document);
          }
        });
      }, 1000);
      
    } catch (error) {
      console.error('Error activating NXC extension:', error);
      vscode.window.showErrorMessage(`Error activating NXC extension: ${error.message}`);
    }
  }

  registerLanguageProviders(context) {
    // Completion provider
    const completionProvider = vscode.languages.registerCompletionItemProvider('nxc', {
      provideCompletionItems: (document, position) => {
        return this.provideCompletionItems(document, position);
      }
    });

    // Hover provider
    const hoverProvider = vscode.languages.registerHoverProvider('nxc', {
      provideHover: (document, position) => {
        return this.provideHover(document, position);
      }
    });

    // Signature help provider
    const signatureProvider = vscode.languages.registerSignatureHelpProvider('nxc', {
      provideSignatureHelp: (document, position) => {
        return this.provideSignatureHelp(document, position);
      }
    }, '(', ',');

    context.subscriptions.push(completionProvider, hoverProvider, signatureProvider);
  }

  setupDocumentEvents(context) {
    // Analyze documents when opened
    const onDidOpenTextDocument = vscode.workspace.onDidOpenTextDocument(document => {
      if (document.languageId === 'nxc') {
        this.diagnosticManager.analyzeDocument(document);
      }
    });

    // Analyze documents when modified
    const onDidChangeTextDocument = vscode.workspace.onDidChangeTextDocument(event => {
      if (event.document.languageId === 'nxc') {
        // Debounce to avoid excessive analyses
        this.debounceAnalysis(event.document);
      }
    });

    // Clear diagnostics when documents are closed
    const onDidCloseTextDocument = vscode.workspace.onDidCloseTextDocument(document => {
      if (document.languageId === 'nxc') {
        this.diagnosticManager.clearDiagnostics(document.uri);
      }
    });

    context.subscriptions.push(onDidOpenTextDocument, onDidChangeTextDocument, onDidCloseTextDocument);

    // Analyze already open documents
    vscode.workspace.textDocuments.forEach(document => {
      if (document.languageId === 'nxc') {
        this.diagnosticManager.analyzeDocument(document);
      }
    });
  }

  debounceAnalysis(document) {
    // Cancel previous analysis if it exists
    if (this.analysisTimeout) {
      clearTimeout(this.analysisTimeout);
    }

    // Schedule new analysis
    this.analysisTimeout = setTimeout(() => {
      this.diagnosticManager.analyzeDocument(document);
    }, 500); // 500ms debounce
  }

  registerCommands(context) {
    // Command to rebuild index
    const rebuildIndexCommand = vscode.commands.registerCommand('nxc.rebuildIndex', () => {
      this.buildIndex(context);
      vscode.window.showInformationMessage('NXC index rebuilt successfully');
    });

    // Command to reanalyze open files
    const reparseCommand = vscode.commands.registerCommand('nxc.reparseOpenFiles', () => {
      vscode.workspace.textDocuments.forEach(document => {
        if (document.languageId === 'nxc') {
          this.diagnosticManager.analyzeDocument(document);
        }
      });
      vscode.window.showInformationMessage('NXC files reanalyzed');
    });

    // Command to clear all diagnostics
    const clearDiagnosticsCommand = vscode.commands.registerCommand('nxc.clearDiagnostics', () => {
      this.diagnosticManager.clearAllDiagnostics();
      vscode.window.showInformationMessage('Diagnostics cleared');
    });

    context.subscriptions.push(rebuildIndexCommand, reparseCommand, clearDiagnosticsCommand);
  }

  setupFileWatchers(context) {
    const filesToWatch = [
      'utils/nxc_api.txt',
      'utils/nxc_constants.txt', 
      'utils/nxc_keywords.txt',
      'utils/NXC_templates.txt'
    ];
    
    filesToWatch.forEach(relativePath => {
      const fullPath = path.join(context.extensionPath, relativePath);
      if (fs.existsSync(fullPath)) {
        try {
          const watcher = fs.watch(fullPath, { persistent: false }, (eventType) => {
            if (eventType === 'change') {
              console.log(`NXC: Reloading index due to change in ${relativePath}`);
              this.buildIndex(context);
            }
          });
          
          this.watchers.push(watcher);
          context.subscriptions.push({ dispose: () => watcher.close() });
        } catch (error) {
          console.warn(`Could not create watcher for ${relativePath}:`, error);
        }
      }
    });
  }

  buildIndex(context) {
    console.log('Building NXC index...');
    
    this.cache.functions.clear();
    this.cache.constants.clear();
    this.cache.keywords.clear();
    
    const utilsPath = path.join(context.extensionPath, 'utils');
    
    try {
      this.parseKeywords(path.join(utilsPath, 'nxc_keywords.txt'));
      this.parseConstants(path.join(utilsPath, 'nxc_constants.txt'));
      this.parseApi(path.join(utilsPath, 'nxc_api.txt'));
      this.parseTemplates(path.join(utilsPath, 'NXC_templates.txt'));
      
      console.log(`Index built: ${this.cache.functions.size} functions, ${this.cache.constants.size} constants, ${this.cache.keywords.size} keywords`);
    } catch (error) {
      console.error('Error building index:', error);
      vscode.window.showErrorMessage(`Error building NXC index: ${error.message}`);
    }
  }

  parseKeywords(filePath) {
    if (!fs.existsSync(filePath)) return;
    
    try {
      const content = fs.readFileSync(filePath, 'utf8');
      content.split(/\r?\n/).forEach(line => {
        const trimmed = line.trim();
        if (trimmed && !trimmed.startsWith('//') && !trimmed.startsWith('#')) {
          this.cache.keywords.add(trimmed);
        }
      });
    } catch (error) {
      console.warn(`Erro ao ler ${filePath}:`, error);
    }
  }

  parseConstants(filePath) {
    if (!fs.existsSync(filePath)) return;
    
    try {
      const content = fs.readFileSync(filePath, 'utf8');
      content.split(/\r?\n/).forEach(line => {
        const trimmed = line.trim();
        if (trimmed && !trimmed.startsWith('//') && !trimmed.startsWith('#')) {
          this.cache.constants.add(trimmed);
        }
      });
    } catch (error) {
      console.warn(`Erro ao ler ${filePath}:`, error);
    }
  }

  parseApi(filePath) {
    if (!fs.existsSync(filePath)) return;
    
    try {
      const content = fs.readFileSync(filePath, 'utf8');
      content.split(/\r?\n/).forEach(line => {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('//')) return;
        
        const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*\(([^)]*)\)$/);
        if (!match) return;
        
        const name = match[1];
        const params = match[2].trim();
        
        if (this.cache.keywords.has(name) || this.cache.types.has(name)) return;
        
        const paramList = params.length ? params.split(',').map(p => p.trim()) : [];
        const paramNames = paramList.map(param => {
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
    } catch (error) {
      console.warn(`Erro ao ler ${filePath}:`, error);
    }
  }

  parseTemplates(filePath) {
    if (!fs.existsSync(filePath)) return;
    
    try {
      const content = fs.readFileSync(filePath, 'utf8');
      content.split(/\r?\n/).forEach(line => {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('-') || trimmed.startsWith('|') || trimmed.startsWith('#')) return;
        
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
    } catch (error) {
      console.warn(`Erro ao ler ${filePath}:`, error);
    }
  }

  generateDocumentation(functionName, params) {
    const paramDocs = params.length > 0 ? 
      `\n\n**Parameters:**\n${params.map(p => `- \`${p}\``).join('\n')}` : '';
    
    return `NXC Function: \`${functionName}\`${paramDocs}`;
  }

  provideCompletionItems(document, position) {
    const range = document.getWordRangeAtPosition(position) || new vscode.Range(position, position);
    const items = [];
    
    // Add keywords
    for (const keyword of this.cache.keywords) {
      const item = new vscode.CompletionItem(keyword, vscode.CompletionItemKind.Keyword);
      item.range = range;
      item.sortText = `1_${keyword}`; // High priority
      items.push(item);
    }
    
    // Add types
    for (const type of this.cache.types) {
      const item = new vscode.CompletionItem(type, vscode.CompletionItemKind.Struct);
      item.range = range;
      item.sortText = `2_${type}`;
      items.push(item);
    }
    
    // Add functions
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
    
    // Add constants
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
    if (!range) return;
    
    const word = document.getText(range);
    
    // Check if it's a function
    const func = this.cache.functions.get(word);
    if (func) {
      const markdown = new vscode.MarkdownString();
      markdown.appendCodeblock(func.fullSignature, 'nxc');
      if (func.documentation) {
        markdown.appendMarkdown('\n\n' + func.documentation);
      }
      return new vscode.Hover(markdown, range);
    }
    
    // Check if it's a constant
    if (this.cache.constants.has(word)) {
      const markdown = new vscode.MarkdownString();
      markdown.appendCodeblock(`${word} (constant)`, 'nxc');
      return new vscode.Hover(markdown, range);
    }
    
    // Check if it's a keyword
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
    
    if (!callMatch) return null;
    
    const functionName = callMatch[1];
    const func = this.cache.functions.get(functionName);
    
    if (!func) return null;
    
    const signature = new vscode.SignatureInformation(func.fullSignature);
    signature.documentation = new vscode.MarkdownString(func.documentation);
    
    // Add parameter information
    func.rawParams.forEach(param => {
      signature.parameters.push(new vscode.ParameterInformation(param.trim()));
    });
    
    const help = new vscode.SignatureHelp();
    help.signatures = [signature];
    help.activeSignature = 0;
    
    // Calculate active parameter
    const argsSoFar = callMatch[2];
    const commaCount = (argsSoFar.match(/,/g) || []).length;
    help.activeParameter = argsSoFar.trim() === '' ? 0 : commaCount;
    
    return help;
  }

  suggestParameterValue(paramName, paramType = '') {
    const name = paramName.toLowerCase();
    const type = paramType.toLowerCase();
    
    // Type-based suggestions
    if (type.includes('byte') && name.includes('output')) return 'OUT_A';
    if (type.includes('byte') && name.includes('port')) return 'IN_1';
    if (name.includes('string') || type.includes('string')) return '""';
    if (type.includes('bool')) return 'true';
    
    // Name-based suggestions
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

  deactivate() {
    console.log('Deactivating NXC extension...');
    
    // Close watchers
    this.watchers.forEach(watcher => {
      try {
        watcher.close();
      } catch (error) {
        console.warn('Error closing watcher:', error);
      }
    });
    
    // Clear analysis timeout
    if (this.analysisTimeout) {
      clearTimeout(this.analysisTimeout);
    }
    
    console.log('NXC extension deactivated');
  }
}

// Global extension instance
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