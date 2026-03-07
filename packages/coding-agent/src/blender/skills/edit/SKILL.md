---
name: edit
description: Edit an existing Blender workspace or source blend with inspection before mutation.
---

# Edit

Use this skill when the user wants to change an existing Blender scene.

Workflow:
1. Initialize or reopen the workspace with `blender_workspace_init`.
2. Call `blender_scene_info` before making changes unless the request is trivial and local.
3. Generate targeted Blender Python that changes only the requested parts.
4. Execute with `blender_execute_python`.
5. Render with `blender_render` when the user needs visual confirmation.

Rules:
- Keep `workspace` explicit in every Blender tool call.
- Prefer small, reversible edits over rebuilding the whole scene.
- Explain what changed and what remains unchanged.
