# NXC Syntax

A Visual Studio Code extension that provides syntax highlighting and linting for the NXC (Not eXactly C) language used with LEGO Mindstorms.


---

Extension ID: `enrell.nxc-syntax`

Marketplace: https://marketplace.visualstudio.com/items?itemName=enrell.nxc-syntax

Repository: https://github.com/enrell/nxc-syntax


## Features

- **Syntax highlighting** for `.nxc` files
- **Code formatting** with customizable indentation and style
- **Real-time error detection** with configurable diagnostics
- **Auto-completion** for functions and constants
- **Hover information** for functions
- **Basic semantic analysis**

### Error Detection
- Unclosed braces and parentheses
- Unterminated strings
- Unused variables
- Undefined functions
- Lines too long

## Installation

Install directly from the VS Code Marketplace by searching for "NXC Syntax" or by using the Extension ID shown above.

Alternatively, download the `.vsix` file from releases and install via Extensions > Install from VSIX.

## Usage

Open any `.nxc` file in VS Code. The extension will:

- Apply syntax highlighting based on the TextMate grammar
- Provide diagnostics in the Problems panel for errors and warnings
- Offer completions and hover information where available
- Format your code using **Shift+Alt+F** or **Ctrl+Shift+I**

### Code Formatting

The extension includes a built-in code formatter that:
- Properly indents code blocks and control structures
- Formats operators with consistent spacing
- Aligns function parameters and arguments
- Handles preprocessor directives correctly
- Supports both spaces and tabs for indentation

**Keyboard Shortcuts:**
- **Shift+Alt+F** - Format entire document
- **Ctrl+Shift+I** - Format document (alternative)
- Right-click → "Format Document" in context menu

## Development

```bash
git clone https://github.com/enrell/nxc-syntax.git
cd nxc-syntax
bun install
bun run build
```

## Commands

```bash
bun run dev        # Development build
bun run build      # Generate VSIX package
bun run test       # Run tests
```

## Configuration

The extension provides the following configuration options:

```json
{
  "nxc.diagnostics.enabled": true,
  "nxc.diagnostics.maxLineLength": 120,
  "nxc.diagnostics.checkUnusedVariables": true,
  "nxc.completion.suggestBuiltins": true,
  "nxc.completion.parameterHints": true,
  "nxc.formatting.indentSize": 4,
  "nxc.formatting.useSpaces": true,
  "nxc.formatting.formatOnSave": false
}
```

## Troubleshooting

- If diagnostics don't appear, verify that the file language is set to `NXC` (bottom-right in VS Code).
- Use the command **NXC: Reparse Open Files** after changing configuration or the grammar.
- Check the Output panel (select "NXC" or the extension host) for runtime logs.

## Available Commands

- **NXC: Format Document** - Format the current NXC document
- **NXC: Rebuild Index** - Rebuild the symbol index
- **NXC: Reparse Open Files** - Reanalyze all open files
- **NXC: Clear All Diagnostics** - Clear all diagnostics

## Contributing & Support

Please report issues and feature requests on the repository's issue tracker:

https://github.com/enrell/nxc-syntax/issues

Contributions are welcome — fork the repo, create a branch, and open a pull request.

## Marketplace maintenance checklist (keeps extension listed)

This short checklist helps keep the extension healthy on the VS Code Marketplace:

- Keep `package.json` fields accurate: `name`, `version`, `publisher`, `engines.vscode` and `icon`.
- Provide a clear `README.md` and a repository link. Keep README up to date with features and configuration.
- Ship a valid license (`MIT` is present) and include an icon referenced by `package.json`.
- Maintain a changelog or releases so users see activity when you publish new versions.
- Respond to issues and fix critical bugs quickly; Marketplace listings consider active maintenance.
- Avoid bundling sensitive secrets, and ensure the extension follows Marketplace policies.

If you want, I can also add a `CHANGELOG.md`, a release template, or a GitHub Actions workflow to automatically publish releases.

## Changelog

See the repository Releases page for the release history.

## License

[MIT](./LICENSE)