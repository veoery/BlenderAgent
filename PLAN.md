# BlenderAgent Plan

## High-Level Goal

Turn this repo from a Blender-branded fork of pi with subagent-oriented mode concepts into a Blender-native agent workflow with:

- one primary agent runtime
- foundational Blender tools for scene mutation, inspection, rendering, and workspace management
- skills for reusable prompt patterns such as create, edit, analyze, and reference-guided iteration
- a persistent workspace model built around one active `.blend` file plus iteration artifacts

The target architecture is capability-first, not subagent-first: the model should choose among Blender tools directly, while skills provide lightweight reusable behavior and prompting.

## Action Plan

### Phase 1: Define the product boundary

1. Decide that subagents are no longer a core workflow concept.
   Brief: keep the existing subagent example available only as an example or remove Blender documentation references to it.

2. Reframe `CREATE`, `EDIT`, `ANALYZE`, and reference-driven flows as skills, not separate agents.
   Brief: these should become prompt-level behavior templates that steer tool usage rather than process-level orchestration.

3. Keep a single managed Blender workspace per task/session.
   Brief: standardize around one persistent `model.blend`, iteration folders, render outputs, logs, and prompt history.

### Phase 2: Specify the foundational Blender tool surface

4. Introduce `blender_workspace_init`.
   Brief: create or reopen a managed workspace, initialize directory structure, choose template or source `.blend`, and return canonical paths.

5. Introduce `blender_execute_python`.
   Brief: run Blender Python against the current workspace in a controlled way, save script/log artifacts, and return structured execution results.

6. Introduce `blender_scene_info`.
   Brief: inspect the active scene and return normalized JSON-like data for objects, collections, materials, cameras, lights, render settings, and scene statistics.

7. Introduce `blender_save_view`.
   Brief: capture the current Blender viewport or camera framing into workspace state so later renders can reuse user-approved views.

8. Introduce `blender_render`.
   Brief: render a named view or current saved view, write output into the workspace, and return image paths plus render metadata.

9. Keep convenience tools out of the first core surface.
   Brief: defer tools like object-specific mutation helpers, asset import/export, reference comparison, and critique helpers until the primitive workflow is stable.

### Phase 3: Build the Blender execution layer

10. Add a Blender runtime helper module behind the tools.
    Brief: centralize Blender command invocation, environment resolution, workspace path handling, timeout behavior, log capture, and error normalization.

11. Standardize Blender binary and Python execution configuration.
    Brief: use `BLENDER_PATH` for Blender, define any Blender-specific env vars in one place, and avoid mode-specific env like `CREATE_PYTHON_BIN`.

12. Define a stable workspace manifest format.
    Brief: store machine-readable workspace metadata such as active blend file, saved views, iteration count, render outputs, and optional source assets.

13. Implement iteration artifact conventions.
    Brief: every execution/render cycle should produce consistent script, log, and output paths so both tools and the model can reason about state reliably.

### Phase 4: Add Blender tools as extension-level capabilities first

14. Implement the first Blender tools as extension tools, not built-in core tools.
    Brief: this reduces coupling, keeps iteration fast, and fits the repo’s extension-first design.

15. Give each Blender tool explicit TypeBox schemas and structured result details.
    Brief: avoid vague tool names or loosely typed payloads; the model should receive predictable parameters and machine-readable responses.

16. Add custom tool renderers for Blender operations.
    Brief: show concise summaries for execution, render outputs, workspace paths, and failures so the interactive UI stays understandable.

17. Make Blender tools default-loaded for the Blender-flavored CLI.
    Brief: `vibe-blender` should feel Blender-native without forcing those tools into generic `pi`.

### Phase 5: Rework prompting and skills

18. Write a Blender-specific system prompt appendix.
    Brief: describe the workspace model, preferred tool sequencing, safety expectations, and when to inspect versus mutate versus render.

19. Create reusable skills for `create`, `edit`, `analyze`, and `with-reference`.
    Brief: each skill should define intent recognition, recommended tool order, iteration strategy, and stopping criteria.

20. Add narrower workflow skills later if needed.
    Brief: examples include `material-pass`, `lighting-pass`, `scene-cleanup`, `match-camera`, and `render-debug`.

21. Remove mode-heavy wording from product documentation.
    Brief: present modes as behaviors or skills, not as subagent identities.

### Phase 6: Wire tool availability into the runtime cleanly

22. Decide how `vibe-blender` loads Blender tools by default.
    Brief: prefer a Blender extension package or built-in extension registration path rather than hardcoding Blender tools into generic base tools immediately.

23. Keep generic core tools available alongside Blender tools.
    Brief: `read`, `edit`, `write`, `grep`, `find`, `ls`, and `bash` still matter for inspecting workspace files, logs, and generated scripts.

24. Update system-prompt tool descriptions to reflect the active Blender toolset.
    Brief: if Blender tools are present by default, the prompt should teach the model when and why to use them.

25. Make tool naming unambiguous.
    Brief: use names like `blender_execute_python` rather than generic names like `execute` to avoid collisions with bash or other execution concepts.

### Phase 7: Replace the old workflow assumptions in docs and UX

26. Update the root `README.md` to explain the new architecture.
    Brief: describe the agent as one runtime with Blender tools and skills, not a collection of subagents for modes.

27. Document workspace structure and iteration semantics.
    Brief: users should understand what files are created, how continuation works, and how renders/logs/scripts are stored.

28. Document skill usage examples instead of subagent installation.
    Brief: replace symlink-based subagent setup with Blender-tool and skill setup instructions.

29. Clarify the difference between generic pi and BlenderAgent behavior.
    Brief: explain what `vibe-blender` adds on top of the base coding agent runtime.

### Phase 8: Validation and hardening

30. Add tests for workspace initialization and path handling.
    Brief: verify deterministic workspace creation, manifest updates, and continuation behavior.

31. Add tests for Blender tool parameter validation and result shaping.
    Brief: tool contracts should fail cleanly on invalid inputs and produce stable structured outputs on success.

32. Add tests for prompt/runtime wiring.
    Brief: ensure the Blender CLI loads the right tools and skills, and the system prompt reflects the active tool surface.

33. Add failure-path coverage.
    Brief: verify behavior when Blender is missing, a script fails, render output is absent, timeouts occur, or workspace metadata is corrupt.

34. Run `npm run check` after code changes and fix all reported issues.
    Brief: keep the repo aligned with existing project rules before any merge or further iteration.

## Recommended implementation order

1. Define the workspace manifest and execution helper layer.
2. Implement `blender_workspace_init`, `blender_execute_python`, `blender_scene_info`, `blender_save_view`, and `blender_render` as extension tools.
3. Add Blender-specific system prompt guidance.
4. Add `create`, `edit`, `analyze`, and `with-reference` skills.
5. Update `vibe-blender` startup/loading so those tools and skills are available by default.
6. Rewrite the root documentation around the new workflow.
7. Add tests and harden failure cases.

## Core vs extension recommendation

### Keep extension-level first

- Blender workspace management tools
- Blender execution and render tools
- Blender-specific renderers for tool output
- Blender workflow commands and UX helpers
- Blender skills and prompt assets

Reason: these pieces are product-specific, likely to evolve quickly, and should not destabilize the generic pi runtime while the interface is still changing.

### Consider promoting to core later only if they stabilize

- workspace initialization contract
- Blender execution contract
- scene inspection contract
- saved-view contract
- render contract

Reason: these are the only Blender concepts that look fundamental enough to become durable primitives if this fork becomes a long-lived distinct product.
