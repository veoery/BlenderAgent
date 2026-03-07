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
4. Render and compare the result against the references after significant changes.
5. When critiquing a create/edit iteration, include reference mismatch details in the `issues` you log to `blender_log_critique`.

Rules:
- Treat references as constraints for planning and evaluation.
- Do not claim exact visual matches without rendering and checking.
- Keep the same explicit `workspace` throughout the full iteration loop.
