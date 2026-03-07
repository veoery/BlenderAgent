---
name: blender-create
description: Create a new Blender scene inside an explicit managed workspace.
---

# Blender Create

Use this skill when the user wants a brand-new Blender scene or object.

Workflow:
1. Call `blender_workspace_init` first with an explicit `workspace` when the user provides one, otherwise create a new workspace.
2. Inspect requirements before writing code. If references are attached, combine this with `blender-with-reference` and incorporate them into planning.
3. For each new user instruction, follow a ReAct-style loop with at most 5 iterations:
4. Author the canonical workspace script at `$workspace/script.py`. Use `write` for the first version and `edit` for later iterations.
5. Always edit based on the current global script instead of rewriting from scratch unless the prior script is clearly unsalvageable.
6. Run `blender_execute_python` with `script_path` pointing to `$workspace/script.py`.
7. Inspect with `blender_scene_info` when object structure or scene state needs verification.
8. Render with `blender_render` after meaningful scene changes.
9. Critique the latest render against the user request and any references using this rubric:
   - Accuracy (0-2): Does the result match the request/reference?
   - Geometry & Proportions (0-2): Realistic dimensions, parts fit together?
   - Materials & Appearance (0-2): Correct colors, surface finish?
   - Completeness (0-2): All components present, nothing missing?
   - Quality (0-2): Clean geometry, proper shading, no artifacts?
10. Call `blender_log_critique` after each critique to append the score, issues, and next action to `$workspace/critique.log`.
11. If the total score is 8 or higher, present the result to the user and stop iterating.
12. If the total score is below 8, do the next iteration based on the critique, up to the 5-iteration cap.
13. Reuse the same explicit `workspace` across continuation turns.

Rules:
- Keep all Blender mutations inside the managed workspace.
- Prefer targeted iterations over full rewrites after the first pass.
- Base every new iteration on the critique from the previous render instead of changing unrelated parts.
- Mention the workspace path in your response so follow-up turns can keep using it.
