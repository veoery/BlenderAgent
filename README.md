# BlenderAgent

[![BlenderAgent demo preview](assets/BlenderAgent_0226_3_preview.gif)](assets/BlenderAgent_0226_3.mp4)

Click the preview to open the full video (`assets/BlenderAgent_0226_3.mp4`).

BlenderAgent is an AI workflow for Blender that turns natural-language requests into 3D scenes and iteratively improves results through visual feedback.

The system is built around a ReAct loop: reason about intent, act by generating/executing Blender Python, observe renders, then refine.

## Project Status

Current implementation:
- `CREATE` agent: implemented and usable

In progress:
- `EDIT`
- `ANALYSE`
- Other multi-mode Blender agents

## How BlenderAgent Works (ReAct Loop)

BlenderAgent runs the same cycle each iteration:

High-level loop:
1. Understand request and constraints.
2. Generate or update Blender Python script.
3. Execute script to update `.blend`.
4. Render output for visual verification.
5. Critique result against prompt (accuracy, geometry, materials, completeness, quality).
6. Iterate only on the gaps until acceptable quality.

Why this loop is used:
- Reduces hallucinated "one-shot perfect model" behavior.
- Keeps changes inspectable at each iteration.
- Lets users steer perspective and quality before finalizing.

## Mode Guide

BlenderAgent supports multiple operational modes. Not all are implemented yet in this repo.

| Mode | Typical input | What it does | Status |
|---|---|---|---|
| `CREATE` | Text prompt | Builds a brand-new scene from scratch, then iterates through execute + render + critique. | Implemented |
| `CREATE-WITH-REF` | Text + images | Creates a new scene while matching style/shape cues from reference images. | In progress |
| `EDIT` | `.blend` + text | Modifies an existing scene based on requested changes. | In progress |
| `EDIT-WITH-REF` | `.blend` + text + images | Edits an existing scene guided by both instructions and references. | In progress |
| `EDIT-TO-MATCH` | `.blend` + images | Edits an existing scene to resemble references even without text instructions. | In progress |
| `ANALYSE` | `.blend` (optional text question) | Inspects scene structure and renders views to answer analysis questions. | In progress |
| `ANALYSE-IMAGE` | Images | Describes and discusses provided images. | In progress |
| `COMPARE` | Multiple `.blend` files | Compares scenes side-by-side (structure and renders). | In progress |

### CREATE Mode (Current)

`CREATE` is the production mode available now.

It focuses on text-to-3D generation with:
- Workspace-first execution
- One persistent `model.blend` per session
- Iteration snapshots (`iteration_XX`) for scripts/logs/renders
- User-controlled view selection before render (save current Blender view, then render)

## Requirements

- Blender installed
- This repo checked out locally
- A runnable `pi`/BlenderAgent CLI command

Recommended Blender binary on macOS:

```bash
export BLENDER_PATH="/Applications/Blender.app/Contents/MacOS/Blender"
```

## Setup

From repo root:

```bash
npm install
npm run build
```

Install the subagent extension:

```bash
mkdir -p ~/.pi/agent/extensions/subagent
ln -sf "$(pwd)/packages/coding-agent/examples/extensions/subagent/index.ts" ~/.pi/agent/extensions/subagent/index.ts
ln -sf "$(pwd)/packages/coding-agent/examples/extensions/subagent/agents.ts" ~/.pi/agent/extensions/subagent/agents.ts
```

Point subagent spawning to a real executable command (not a shell alias):

```bash
export PI_SUBAGENT_COMMAND="$(pwd)/packages/coding-agent/dist/cli.js"
```

`CREATE` defaults to Anaconda Python unless overridden:

```bash
export CREATE_PYTHON_BIN="/opt/anaconda3/bin/python"
```

## How to Use CREATE

Start BlenderAgent (for example from this repo):

```bash
./pi-test.sh
```

Then prompt naturally, for example:

```text
Use CREATE to create a modern coffee table in Blender.
```

For continuation turns, keep workspace continuity explicit:

```text
Continue with workspace=outputs/20260226_123456
```

## Output Structure

Each run creates one workspace under `outputs/`.

```text
outputs/TIMESTAMP/
├── prompt.txt
├── critique.log
├── script.py
├── model.blend
├── blender.log
├── full_script.py
├── iteration_01/
│   ├── script.py
│   ├── blender.log
│   ├── full_script.py
│   └── renders/
│       └── render_current_view_camera.png
└── iteration_02/
    └── ...
```

Notes:
- A single `model.blend` is reused across iterations.
- `iteration_XX/` stores render/log/script snapshots.
- Blender backup versions (`.blend1`, `.blend2`, ...) are disabled for this workflow.

## Design Principles

- ReAct-first: render and critique drive refinements
- Workspace isolation: all artifacts stay inside one workspace
- Non-destructive flow: iterate through script updates and snapshots
- User-in-the-loop perspective control: render from saved current view

## License

MIT
