# Vibe Blender

Vibe Blender is an AI-assisted Blender workspace for creating, editing, and inspecting 3D scenes with natural language.

Instead of asking an assistant to only describe Blender steps, you can ask it to work directly in Blender: create objects, adjust materials, inspect the current scene, save camera views, render images, and continue improving the same `.blend` file across follow-up prompts.

[![Vibe Blender demo preview](assets/BlenderAgent_0226_3_preview.gif)](assets/BlenderAgent_0226_3.mp4)

## What You Can Do

- Create Blender scenes from text prompts
- Edit an existing scene in follow-up turns
- Use the current Blender selection or viewport as context
- Save named views and render from them later
- Keep each project in a persistent workspace with its own `model.blend`
- Review scene objects, cameras, lights, materials, and saved views

## Requirements

- macOS, Linux, or Windows with Node.js 20 or newer
- Blender installed locally
- An AI provider/API setup supported by the underlying pi coding-agent runtime

On macOS, you can point Vibe Blender at your Blender install with:

```bash
export BLENDER_PATH="/Applications/Blender.app/Contents/MacOS/Blender"
```

## Setup

Clone the repo and install dependencies:

```bash
npm install
```

Start Vibe Blender from the repo root:

```bash
./pi-test.sh
```

If the CLI is installed or linked on your machine, you can also run:

```bash
vibe-blender
```

## Example Prompts

Create a new scene:

```text
Use /skill:blender-create and build a modern walnut coffee table with brass legs.
```

Continue editing the same workspace:

```text
Use /skill:blender-edit with workspace=outputs/20260306_120000 and make the tabletop thicker.
```

Inspect what is in a scene:

```text
Use /skill:blender-analyze with workspace=outputs/20260306_120000 and summarize the objects, lights, cameras, and materials.
```

Render from the current Blender view:

```text
Use the current viewport, save it as hero-front, and render the workspace from that view.
```

## Workspaces

Vibe Blender keeps each project in a workspace under `outputs/`. A workspace contains the live `.blend` file, generated scripts, scene inspection data, logs, and renders.

Typical workspace:

```text
outputs/20260306_120000/
├── blender-workspace.json
├── model.blend
├── script.py
├── critique.log
└── iteration_01/
    ├── scene-info.json
    ├── script.py
    ├── blender.log
    └── renders/
        └── render.png
```

Use the same `workspace=...` path in follow-up prompts when you want to keep working on the same scene.

## Built-In Skills

Vibe Blender includes focused Blender workflows:

- `/skill:blender-create` for new scenes
- `/skill:blender-edit` for changing an existing workspace
- `/skill:blender-analyze` for scene review and inspection
- `/skill:blender-with-reference` for work guided by reference material

You can mention these skills directly in your prompt when you want a specific workflow.

## Tips

- Keep one workspace per idea or asset.
- Render after meaningful visual changes so you can review the result.
- Refer to saved views by name when you want repeatable renders.
- Mention selected objects or the current viewport when you want Vibe Blender to use live Blender context.
- Keep prompts concrete: describe the shape, materials, style, scale, and camera angle you want.

## Project Status

This project is currently source-first. The public entry point is this repository, and the main user workflow is running Vibe Blender locally with Blender installed.

The code is built on the pi TypeScript monorepo and includes reusable packages for AI providers, the coding-agent runtime, terminal UI, web UI, and supporting tools. Those internals are available for contributors, but users only need the setup and usage steps above.

## License

MIT
