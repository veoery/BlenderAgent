---
name: blender-edit
description: Edit an existing Blender workspace or source blend with inspection before mutation.
---

# Blender Edit

Use this skill when the user wants to change an existing Blender scene.

Workflow:
1. Initialize or reopen the workspace with `blender_workspace_init`.
2. Call `blender_scene_info` before making changes unless the request is trivial and local.
3. If the user refers to "it", "this", the selected object, the active object, or the current view, inspect `blender_session_context` first so you resolve the live Blender target before editing code.
4. For each new user instruction, follow a ReAct-style loop with at most 5 iterations:
5. Edit the canonical workspace script at `$workspace/script.py` with the normal `edit` tool.
6. Always edit based on the current global script instead of drafting a disconnected replacement unless the current script is unusable.
7. If the render perspective needs improvement and the agent is managing its own evaluation views, update or create the evaluation camera in `$workspace/script.py` before execution.
8. Run `blender_execute_python` with `script_path` pointing to `$workspace/script.py`.
9. If the user is manually setting a viewport perspective, capture it with `blender_save_view`. Otherwise render from the agent-managed evaluation camera/view.
10. Render with `blender_render` after meaningful scene changes.
11. Critique the latest render against the user request and any references using this rubric:
   - Accuracy (0-2): Does the result match the request/reference?
   - Geometry & Proportions (0-2): Realistic dimensions, parts fit together?
   - Materials & Appearance (0-2): Correct colors, surface finish?
   - Completeness (0-2): All components present, nothing missing?
   - Quality (0-2): Clean geometry, proper shading, no artifacts?
   - View adequacy: Also judge whether the current render view is good enough to evaluate the edit. If important parts are hidden or the framing is weak, include creating or changing an agent-owned render view in the next action.
12. Call `blender_log_critique` after each critique to append the score, view adequacy judgment, issues, and next action to `$workspace/critique.log`.
13. If the total score is 8 or higher, present the result to the user and stop iterating.
14. If the total score is below 8, do the next iteration based on the critique, up to the 5-iteration cap.
15. Reuse the same explicit `workspace` across continuation turns.

Rules:
- Keep `workspace` explicit in every Blender tool call.
- Prefer small, reversible edits over rebuilding the whole scene.
- When the request is ambiguous, state which active or selected object you resolved before mutating it.
- Base each new iteration on the critique from the prior render.
- Treat camera/view management as part of the edit loop. If the current render angle is weak, save or update a better view before judging whether the Python edit worked.
- Do not modify user-created views or cameras unless the user explicitly asks. If the current views are insufficient, create a new agent-owned saved view/camera for evaluation.
- If the user does not specify a render view, you may manage agent-owned evaluation views such as `agent_eval_main`, `agent_eval_wide`, or `agent_eval_detail`, and update them when renders show poor framing or miss important parts of the scene.
- If the user specifies a render view or camera, treat it as locked unless the user explicitly asks you to change it.
- Explain what changed and what remains unchanged.
