# NXC Syntax

VS Code extension with support for the NXC (Not eXactly C) language for LEGO Mindstorms.

## Features

- **Syntax highlighting** for `.nxc` files
- **Real-time error detection**
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

Install directly from the VS Code Marketplace by searching for "NXC Syntax".

Alternatively, download the `.vsix` file from releases and install via Extensions > Install from VSIX.

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

```json
{
  "nxc.diagnostics.enabled": true,
  "nxc.diagnostics.maxLineLength": 120,
  "nxc.diagnostics.checkUnusedVariables": true
}
```

## Available Commands

- **NXC: Rebuild Index** - Rebuild the symbol index
- **NXC: Reparse Open Files** - Reanalyze all open files
- **NXC: Clear All Diagnostics** - Clear all diagnostics

## License

MIT