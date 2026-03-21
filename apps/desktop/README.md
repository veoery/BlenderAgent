# BlenderAgent Desktop

Minimal Tauri + React desktop shell for the BlenderAgent repository.

Current scope:
- Send a prompt to the local BlenderAgent CLI
- Display the returned output in a simple desktop UI
- Keep the BlenderAgent runtime in the existing repo instead of re-implementing it

## Prerequisites

- Node.js 20+
- Rust toolchain (`rustup`, `cargo`, `rustc`)
- Xcode Command Line Tools on macOS
- BlenderAgent repo dependencies installed

## Install

From the repo root:

```bash
cd apps/desktop
npm install
```

## Run

```bash
cd apps/desktop
npm run tauri dev
```

The app calls the repo's `pi-test.sh` script in non-interactive mode:

```bash
./pi-test.sh --no-session --print "<prompt>"
```

## Notes

- This first version is intentionally simple: request/response only, no streaming yet.
- The default repo path is inferred from the app's location inside this repository.
- For Blender workflows, set your normal environment variables before launching Tauri, for example:

```bash
export BLENDER_PATH="/Applications/Blender.app/Contents/MacOS/Blender"
export PI_SUBAGENT_COMMAND="$(pwd)/packages/coding-agent/dist/cli.js"
export CREATE_PYTHON_BIN="/opt/anaconda3/bin/python"
```
