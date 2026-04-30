# Vibe Blender

Vibe Blender is an AI-assisted Blender workspace for creating, editing, and inspecting 3D scenes with natural language. It embeds live Blender context into the agent workflow, including the open scene, selected objects, viewport, saved views, cameras, lights, materials, renders, and workspace files.

Instead of asking an assistant to only describe Blender steps, you can ask it to work directly in Blender: create objects, adjust materials, inspect the current scene, save camera views, render images, and continue improving the same `.blend` file across follow-up prompts.

Vibe Blender is based on the [pi monorepo](https://github.com/badlogic/pi-mono).

<video src="assets/demo.mp4" controls width="100%"></video>

[Watch the demo](assets/demo.mp4)


## What You Can Do

- Create Blender scenes from text prompts
- Edit an existing scene in follow-up turns
- Use the current Blender selection or viewport as context
- Ask for context-aware edits like "make the selected chair match this room" or "render from my current view"
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

## Installation

For normal CLI use, install Vibe Blender from npm:

```bash
npm install -g vibe-blender
```

Then start it from any project folder:

```bash
vibe-blender
```

To check that the CLI is installed:

```bash
vibe-blender --help
vibe-blender --version
```

## Development

```bash
npm install          # Install all dependencies
npm run build        # Build all packages
npm run check        # Lint, format, and type check
./test.sh            # Run tests
./pi-test.sh         # Run from source
```

After changing TypeScript under `packages/coding-agent/src`, run `npm run build` before testing the installed CLI. The CLI runs compiled files from `dist/`, not the `.ts` source files directly.

## Example Prompts

Create a new scene:

```text
Use /skill:blender-create and build a modern walnut coffee table with brass legs.
```

Continue editing the same workspace:

```text
Use /skill:blender-edit with workspace=outputs/<task_name> and make the tabletop thicker.
```

```text
# Select some objects in Blender first then prompt the agent:
Remove the seleted objects.
```

Inspect what is in a scene:

```text
Use /skill:blender-analyze with workspace=outputs/<task_name>> and summarize the objects, lights, cameras, and materials.
```

Render from the current Blender view:

```text
Use the current viewport, save it as hero-front, and render the workspace from that view.
```

## Workspaces

Vibe Blender keeps each project in a workspace under `outputs/`. A workspace contains the live `.blend` file, generated scripts, scene inspection data, logs, and renders.

Typical workspace:

```text
outputs/<task_name>/
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

This project is available as the `vibe-blender` npm CLI package. The public user workflow is installing the CLI, running it locally, and letting it control a local Blender installation.

The code is built on the pi TypeScript monorepo and includes reusable packages for AI providers, the coding-agent runtime, terminal UI, web UI, and supporting tools. Those internals are available for contributors, but users only need the setup and usage steps above.

## License

MIT
