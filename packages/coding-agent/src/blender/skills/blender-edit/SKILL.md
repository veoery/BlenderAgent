---
name: blender-edit
description: Edit an existing Blender workspace or source blend with inspection before mutation.
---

# Blender Edit

Use this skill when the user wants to change an existing Blender scene.

Workflow:
1. Initialize or reopen the workspace with `blender_workspace_init`.
2. Call `blender_scene_info` before making changes unless the request is trivial and local.
3. For each new user instruction, follow a ReAct-style loop with at most 5 iterations:
4. Edit the canonical workspace script at `$workspace/script.py` with the normal `edit` tool.
5. Always edit based on the current global script instead of drafting a disconnected replacement unless the current script is unusable.
6. Run `blender_execute_python` with `script_path` pointing to `$workspace/script.py`.
7. Render with `blender_render` after meaningful scene changes.
8. Critique the latest render against the user request and any references using this rubric:
   - Accuracy (0-2): Does the result match the request/reference?
   - Geometry & Proportions (0-2): Realistic dimensions, parts fit together?
   - Materials & Appearance (0-2): Correct colors, surface finish?
   - Completeness (0-2): All components present, nothing missing?
   - Quality (0-2): Clean geometry, proper shading, no artifacts?
9. Call `blender_log_critique` after each critique to append the score, issues, and next action to `$workspace/critique.log`.
10. If the total score is 8 or higher, present the result to the user and stop iterating.
11. If the total score is below 8, do the next iteration based on the critique, up to the 5-iteration cap.

Rules:
- Keep `workspace` explicit in every Blender tool call.
- Prefer small, reversible edits over rebuilding the whole scene.
- Base each new iteration on the critique from the prior render.
- Explain what changed and what remains unchanged.
