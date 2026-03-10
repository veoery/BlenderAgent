---
name: blender-create
description: Create a new Blender scene inside an explicit managed workspace.
---

# Blender Create

Use this skill when the user wants a brand-new Blender scene or object.

Workflow:
1. Call `blender_workspace_init` first with an explicit `workspace` when the user provides one, otherwise create a new workspace.
2. Inspect requirements before writing code. If references are attached, combine this with `blender-with-reference` and incorporate them into planning.
3. If the user refers to "it", "this", the selected object, or the current view in the live Blender session, first use the injected live Blender context summary when it is present and clearly usable. Only call `blender_session_context` again when that summary is missing, stale, or too incomplete to resolve the target explicitly.
4. For each new user instruction, follow a ReAct-style loop with at most 5 iterations:
5. Author the canonical workspace script at `$workspace/script.py`. Use `write` for the first version and `edit` for later iterations.
6. Always edit based on the current global script instead of rewriting from scratch unless the prior script is clearly unsalvageable.
7. If the render perspective needs improvement and the agent is managing its own evaluation views, update or create the evaluation camera in `$workspace/script.py` before execution.
8. Run `blender_execute_python` with `script_path` pointing to `$workspace/script.py`.
<!-- 8. Inspect with `blender_scene_info` when object structure or scene state needs verification. -->
9. If the user is manually setting a viewport perspective, capture it with `blender_save_view`. Otherwise render from the agent-managed evaluation camera/view.
10. Render with `blender_render` after meaningful scene changes.
11. Critique the latest render against the user request and any references using this rubric:
   - Accuracy (0-2): Does the result match the request/reference?
   - Geometry & Proportions (0-2): Realistic dimensions, parts fit together?
   - Materials & Appearance (0-2): Correct colors, surface finish?
   - Completeness (0-2): All components present, nothing missing?
   - Quality (0-2): Clean geometry, proper shading, no artifacts?
   - View adequacy: Also judge whether the current render view is good enough to evaluate the scene. If framing, coverage, or perspective is weak, include creating or changing an agent-owned render view in the next action.
12. Call `blender_log_critique` after each critique to append the score, view adequacy judgment, issues, and next action to `$workspace/critique.log`.
13. If the total score is 8 or higher, present the result to the user and stop iterating.
14. If the total score is below 8, do the next iteration based on the critique, up to the 5-iteration cap.
15. Reuse the same explicit `workspace` across continuation turns.

Rules:
- Keep all Blender mutations inside the managed workspace.
- Prefer targeted iterations over full rewrites after the first pass.
- If a valid injected live context summary already resolves the target clearly, do not call `blender_session_context` again unless you need more detail or need to verify a possible mismatch.
- Older injected live Blender context summaries in message history are stale by default. If an authoritative current-turn live Blender state block is present, use that block as the only current UI truth and ignore earlier live-context mentions unless you explicitly refresh with `blender_session_context` after Blender changes during the turn.
- When the request depends on the live Blender selection or active object, state what target you resolved before changing it.
- Base every new iteration on the critique from the previous render instead of changing unrelated parts.
- Treat render perspective as part of the task. If the current view hides important shape, proportion, or material problems, create or change saved views before judging the result.
- Do not overwrite or repurpose user-created views or cameras unless the user explicitly asks. If you need a better evaluation angle, create a new agent-owned saved view/camera instead.
- If the user does not specify a render view, you may manage agent-owned evaluation views such as `agent_eval_main`, `agent_eval_wide`, or `agent_eval_detail`, and update them across iterations based on render results.
- If the user specifies a render view or camera, treat it as locked unless the user explicitly asks you to change it.
- Mention the workspace path in your response so follow-up turns can keep using it.
