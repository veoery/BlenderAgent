---
name: CREATE
description: Legacy note for the old Blender CREATE subagent workflow.
tools: read
---

# Legacy CREATE Note

This file is kept as historical reference only.

The active Blender workflow in this repo is no longer subagent-first. Use `vibe-blender` with the built-in Blender tools and Blender skills instead:

- `blender_workspace_init`
- `blender_execute_python`
- `blender_scene_info`
- `blender_save_view`
- `blender_render`
- `/skill:create`
- `/skill:edit`
- `/skill:analyze`
- `/skill:with-reference`

Current rules:

- keep `workspace` explicit in Blender tool calls
- reuse the same workspace across follow-up turns
- inspect before mutating when editing existing scenes
- render after meaningful changes

If you are reading this file because of older CREATE workflow notes, treat them as archived implementation history rather than the current project architecture.
