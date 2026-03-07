---
name: analyze
description: Inspect and render Blender workspaces without mutating them unless the user explicitly asks for changes.
---

# Analyze

Use this skill when the user wants to understand an existing Blender scene.

Workflow:
1. Reopen the workspace with `blender_workspace_init` if needed.
2. Use `blender_scene_info` for structural inspection.
3. Use `blender_render` for visual inspection when an image would help answer the question.

Rules:
- Prefer inspection and rendering over mutation.
- Do not call `blender_execute_python` unless the user explicitly asks you to change the scene.
- Keep the response grounded in the inspected scene metadata and renders.
