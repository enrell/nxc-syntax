const vscode = require('vscode');

class NXCConfig {
  constructor() {
    this.configSection = 'nxc';
  }

  get diagnosticsEnabled() {
    return this.getConfig('diagnostics.enabled', true);
  }

  get maxLineLength() {
    return this.getConfig('diagnostics.maxLineLength', 120);
  }

  get checkUnusedVariables() {
    return this.getConfig('diagnostics.checkUnusedVariables', true);
  }

  get suggestBuiltins() {
    return this.getConfig('completion.suggestBuiltins', true);
  }

  get parameterHints() {
    return this.getConfig('completion.parameterHints', true);
  }

  getConfig(key, defaultValue) {
    const config = vscode.workspace.getConfiguration(this.configSection);
    return config.get(key, defaultValue);
  }

  onConfigurationChanged(callback) {
    return vscode.workspace.onDidChangeConfiguration(event => {
      if (event.affectsConfiguration(this.configSection)) {
        callback();
      }
    });
  }

  getSyntaxRules() {
    return {
      maxLineLength: this.maxLineLength,
      allowMixedIndentation: false,
      requireSemicolons: true,
      allowEmptyBlocks: false
    };
  }

  getSemanticRules() {
    return {
      checkUnusedVariables: this.checkUnusedVariables,
      checkUndefinedFunctions: true,
      checkTypeCompatibility: true,
      warnOnShadowing: true
    };
  }

  getCompletionSettings() {
    return {
      suggestBuiltins: this.suggestBuiltins,
      parameterHints: this.parameterHints,
      maxSuggestions: 50,
      sortByRelevance: true
    };
  }
}

module.exports = { NXCConfig };