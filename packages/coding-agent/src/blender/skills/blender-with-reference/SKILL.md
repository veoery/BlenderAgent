---
name: blender-with-reference
description: Use attached reference images or style cues while planning Blender work.
---

# Blender With Reference

Use this skill when the user supplies reference images or asks to match a style or shape cue.

Workflow:
1. Combine this skill with `blender-create` or `blender-edit` depending on whether the scene is new or existing.
2. Extract the most important shape, composition, material, and lighting cues from the references.
3. Keep those cues visible in your plan while generating Blender Python.
4. If the user is framing a comparison manually or referring to the currently selected object or current view, inspect `blender_session_context` first so the target and viewpoint are explicit.
5. When viewpoint matters, either update the agent-managed evaluation camera in `$workspace/script.py` before execution or capture a user-set viewport with `blender_save_view`. Better view alignment makes critique and iteration much more reliable.
6. Render and compare the result against the references after significant changes.
7. When critiquing a create/edit iteration, include reference mismatch details in the `issues` you log to `blender_log_critique`, and use its `viewAdequacy` judgment to record when the current render view is too weak for a fair reference comparison.

Rules:
- Treat references as constraints for planning and evaluation.
- Do not claim exact visual matches without rendering and checking.
- Keep the same explicit `workspace` throughout the full iteration loop.
- Do not change user-created views or cameras just to match a reference. Create a new agent-owned saved view/camera when you need a better comparison angle.
- If the user does not specify a render view, you may manage agent-owned evaluation views and refine them across iterations so the render perspective better matches the reference or exposes important mismatches.
- If the user specifies a render view or camera, treat it as locked unless the user explicitly asks you to change it.
