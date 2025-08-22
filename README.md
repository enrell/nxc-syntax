# NXC Syntax

Syntax highlighting support for the Not eXactly C (NXC) language used with LEGO Mindstorms.

## Features
- Highlights keywords, types, numbers, strings, comments
- Recognises common motor, sensor, display, task, timing, and sound API calls
- Output (OUT_A, OUT_B, etc.) and input (IN_1..IN_4) constants

## Install / Test (Development)
1. Open this `nxc-syntax` folder in VS Code.
2. Press F5 to launch the Extension Development Host.
3. Open any `.nxc` file to see the highlighting.

## Packaging
Install `vsce` once:
```
npm install -g @vscode/vsce
```
Package:
```
vsce package
```
Then install the produced `.vsix` via the Extensions view (three dots > Install from VSIX...).

## TODO / Ideas
- Add more built‑in functions / constants
- Add snippets for common patterns
- Add symbol outline support via a language server (future)

## License
MIT
