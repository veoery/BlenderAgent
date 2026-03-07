---
name: create
description: Create a new Blender scene inside an explicit managed workspace.
---

# Create

Use this skill when the user wants a brand-new Blender scene or object.

Workflow:
1. Call `blender_workspace_init` first with an explicit `workspace` when the user provides one, otherwise create a new workspace.
2. Inspect requirements before writing code. If references are attached, incorporate them into planning.
3. Generate Blender Python and run it with `blender_execute_python`.
4. Inspect with `blender_scene_info` when object structure or scene state needs verification.
5. Render with `blender_render` after meaningful scene changes.
6. Reuse the same explicit `workspace` across continuation turns.

Rules:
- Keep all Blender mutations inside the managed workspace.
- Prefer targeted iterations over full rewrites after the first pass.
- Mention the workspace path in your response so follow-up turns can keep using it.
