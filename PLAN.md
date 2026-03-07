# BlenderAgent Migration Plan

## Goal

Turn this repo into a Blender-native agent product built around:

- one primary `vibe-blender` runtime
- Blender-specific tools that the model can call directly
- skills for reusable prompting and workflow guidance
- one managed workspace with a persistent `.blend` file and iteration artifacts

The model should decide among Blender tools directly. Skills should shape behavior. Subagents should not be the main architecture.

## Current state

This plan assumes the current repo state is:

- `vibe-blender` is the user-facing CLI and primary product surface
- Blender auto-launch exists, but Blender-native tools do not
- the root docs still describe mode ideas like `CREATE`, `EDIT`, and `ANALYZE`
- subagent usage is documented, but subagents are not the right long-term foundation
- extension tools are first-class runtime tools when loaded and active
- extension tools are visible to the model through tool definitions, but are not explicitly listed in the built-in system prompt text today

## Key decisions

### 1. Use skills for reusable prompt behavior

`CREATE`, `EDIT`, `ANALYZE`, and reference-guided flows should become skills or skill-like prompt assets, not separate agents or subprocess roles.

### 2. Use Blender-native tools, not subagents, as the main capability layer

The model should operate by calling Blender tools directly for scene mutation, inspection, render generation, and workspace management.

### 3. Build a Blender execution layer under the tools

The Blender execution layer is the shared runtime code that actually talks to Blender and the filesystem. Blender tools sit on top of it.

### 4. Start with extension-level Blender tools

Blender tools should first be implemented as extension tools and loaded for `vibe-blender`. That keeps the generic pi runtime clean while the design stabilizes.

### 5. Blender tools must be active by default in `vibe-blender`

When the user starts `vibe-blender`, all Blender extensions must be loaded and their tools active on the first turn. The model should not need a command or skill invocation just to gain access to them.

### 6. Keep generic coding tools available

The Blender workflow still needs generic tools such as `read`, `edit`, `write`, `grep`, `find`, `ls`, and `bash` for logs, manifests, generated scripts, and repo changes.

### 7. Use per-turn Blender prompt injection, not a new prompt asset type

Blender-specific runtime guidance should be injected by extensions on each turn through the existing extension prompt hook.

Rule:
- keep this injected guidance compact and behavioral
- do not restate full Blender tool schemas in prompt text
- rely on tool definitions for tool discovery and argument structure

### 8. Keep `workspace` explicit in Blender tool calls

Blender tools should require an explicit `workspace` parameter rather than relying on hidden session-side implicit workspace state.

### 9. Remove subagents from Blender-facing workflow and docs, but not from generic examples

Subagents should no longer appear as part of the default Blender architecture, docs, or recommended workflow.

Rule:
- remove Blender-facing subagent references from root docs and Blender workflow guidance
- do not delete the generic subagent example code unless a later cleanup explicitly asks for it

## Definitions

### Skills

Reusable prompting assets that teach the model how to approach a task. Skills should explain sequencing, priorities, iteration rules, and stopping conditions.

### Blender tools

Model-callable capabilities such as initializing a workspace, executing Blender Python, inspecting a scene, saving a view, and rendering.

### Blender execution layer

The implementation layer beneath the tools that resolves Blender configuration, runs Blender commands, manages workspaces, captures logs, applies timeouts, and normalizes errors.

### Workspace

A directory containing the active `.blend` file and all artifacts for one user task or continued task branch.

## Target architecture

### User-facing behavior

- user starts `vibe-blender`
- Blender auto-launch may happen as it does today
- all Blender extensions are already loaded and active
- Blender tools are already loaded and active
- Blender skills are available
- user asks for create, edit, analyze, or reference-guided work
- model selects Blender tools directly and iterates through execute, inspect, render, and critique

### Runtime layers

1. Skills
   Prompt-level guidance for create, edit, analyze, and reference-driven work.

2. Blender tools
   Thin model-facing interfaces with clear schemas and structured results.

3. Blender execution layer
   Shared operational foundation for process execution, path handling, workspace state, artifact writing, and error normalization.

4. Blender process and filesystem
   Blender binary, `.blend` files, renders, logs, manifests, and generated scripts.

## Required first-pass tool surface

These tools are the minimum Blender-native foundation.

### `blender_workspace_init`

Purpose:
- create or reopen a managed workspace
- establish canonical workspace paths
- choose blank template or source `.blend`

Suggested inputs:
- `workspace`
- `sourceBlend`
- `template`
- `continueExisting`

Suggested outputs:
- `workspacePath`
- `blendPath`
- `manifestPath`
- `iteration`
- `created`

### `blender_execute_python`

Purpose:
- run Blender Python against the current workspace
- mutate or inspect the scene in a controlled way

Suggested inputs:
- `workspace`
- `script`
- `saveBefore`
- `saveAfter`
- `timeoutSeconds`
- `label`

Suggested outputs:
- `blendPath`
- `scriptPath`
- `logPath`
- `stdout`
- `stderr`
- `exitCode`
- `changed`

Rule:
- do not name this tool `execute`; keep it Blender-scoped and explicit

### `blender_scene_info`

Purpose:
- inspect scene state in structured form for planning and verification

Suggested inputs:
- `workspace`
- `includeObjects`
- `includeCollections`
- `includeMaterials`
- `includeCameras`
- `includeLights`
- `includeRenderSettings`

Suggested outputs:
- structured scene summary
- object names and metadata
- material names
- camera/light info
- render settings

### `blender_save_view`

Purpose:
- capture a current view or named view for later rendering

Suggested inputs:
- `workspace`
- `name`
- `source`

Suggested outputs:
- saved view name
- saved view metadata

### `blender_render`

Purpose:
- render one or more views for visual feedback

Suggested inputs:
- `workspace`
- `view`
- `resolution`
- `samples`
- `outputName`
- `mode`

Suggested outputs:
- rendered image path or paths
- render log path
- resolution and render metadata

## Deferred tools

These should stay out of the initial foundation unless implementation proves they are essential:

- object-specific manipulation helpers
- asset import/export helpers
- render critique helpers
- reference comparison helpers
- destructive cleanup helpers
- domain-specific shortcuts like material-only or lighting-only mutation tools

These can be added later as extension-level convenience tools after the base workflow stabilizes.

## Blender execution layer responsibilities

The Blender execution layer must centralize:

- `BLENDER_PATH` resolution
- Blender process launching
- background versus interactive invocation rules
- script file generation and cleanup policy
- workspace path resolution
- manifest loading and updates
- iteration numbering
- stdout and stderr capture
- log file writing
- timeout handling
- structured error normalization
- render output path generation
- continuation behavior for existing workspaces

It should be the only place that knows the low-level details of how Blender is invoked.

## Workspace contract

The workspace model should be explicit and durable.

### Required artifacts

- `model.blend`
- workspace manifest file
- prompt history or seed prompt file
- per-iteration script files
- per-iteration Blender logs
- render output files

### Required behaviors

- one persistent `.blend` file per workspace
- deterministic iteration directory naming
- explicit continuation support
- stable paths that the model can reason about indirectly through tool results
- enough metadata for future recovery or resume

### Manifest should track

- workspace id
- active blend path
- latest iteration number
- saved views
- render outputs
- source assets or source blend path
- timestamps
- optional labels for iteration steps

## Prompting and skills plan

### Blender system prompt additions

The Blender-specific prompt layer should explain:

- the workspace concept
- that Blender tools are the preferred path for Blender work
- when to inspect before mutating
- when to render after mutation
- how to use saved views
- how to avoid redundant renders
- how to continue work in an existing workspace

### Initial skills

- `create`
  Build a new scene from scratch, then inspect and render iteratively.

- `edit`
  Modify an existing workspace or `.blend` using inspection before targeted mutation.

- `analyze`
  Prefer inspection and rendering over mutation unless the user explicitly requests changes.

- `with-reference`
  Incorporate supplied images or style targets into planning and evaluation.

### Later skills

- `material-pass`
- `lighting-pass`
- `scene-cleanup`
- `camera-match`
- `render-debug`

## Runtime integration requirements

### `vibe-blender` startup

`vibe-blender` must:

- load all Blender extensions automatically
- make Blender tools active by default
- inject Blender runtime guidance each turn through extension prompt hooks
- keep generic coding tools available

### Tool visibility requirements

- Blender extension tools must be active before the first prompt
- tool definitions must reach the model through the normal tool payload
- the Blender prompt layer should still explain when to use them because activation alone is not enough for good behavior

### System prompt requirements

The built-in system prompt currently emphasizes core tools only. The migration must ensure Blender guidance is injected when `vibe-blender` runs, even if Blender tools remain extension-level.

Rule:
- use per-turn extension prompt injection for the Blender prompt layer
- keep the injected Blender block short and focused on workflow policy

## Documentation changes required

### Root README

Rewrite the root documentation around:

- one-agent Blender-native workflow
- skills instead of mode/subagent orchestration
- workspace structure
- continuation flow
- Blender tool behavior

### Remove or downgrade subagent references

- do not describe subagents as the main Blender architecture
- remove Blender-facing subagent setup and workflow references from root docs
- if generic subagent examples remain elsewhere, label them as optional example material only

### Add setup docs

Document:

- Blender binary configuration
- `vibe-blender` startup behavior
- default Blender tool availability
- skills usage
- workspace layout

## Code areas likely to change

This is the expected implementation surface.

### Existing files likely to change

- `packages/coding-agent/src/cli.ts`
- `packages/coding-agent/src/core/agent-session.ts`
- `packages/coding-agent/src/core/system-prompt.ts`
- `README.md`

### New code likely needed

- Blender extension entrypoint
- Blender tool definitions
- Blender execution-layer helpers
- workspace manifest utilities
- Blender prompt/skill assets
- tests for tool activation, workspace behavior, and error cases

## Delivery phases

### Phase 1: architecture and contracts

- finalize workspace contract
- finalize first-pass tool surface
- finalize execution-layer responsibilities
- decide exact startup-loading path for all Blender extensions in `vibe-blender`
- define the compact per-turn Blender prompt injection contract

### Phase 2: execution layer

- implement shared Blender runtime helpers
- implement manifest read/write logic
- implement iteration artifact conventions

### Phase 3: Blender tools

- add the five foundation tools as extension tools
- add structured results and custom renderers
- verify tools are active by default in `vibe-blender`
- verify `workspace` remains explicit in all Blender tool schemas

### Phase 4: prompting and skills

- add Blender system prompt layer via per-turn extension prompt injection
- add `create`, `edit`, `analyze`, and `with-reference` skills
- ensure prompt guidance matches the actual tool surface

### Phase 5: docs and UX

- rewrite root docs
- remove Blender-facing subagent framing
- document workspace and continuation behavior

### Phase 6: tests and hardening

- add activation tests
- add workspace and manifest tests
- add tool validation tests
- add Blender-missing and timeout failure tests
- run `npm run check`

## Acceptance criteria

The migration is complete when all of the following are true:

- starting `vibe-blender` makes Blender tools active on the first turn
- starting `vibe-blender` loads all Blender extensions on the first turn
- the model can use Blender tools without manual activation
- Blender work is organized around one managed workspace with a persistent `.blend`
- Blender tool calls keep `workspace` explicit
- `CREATE`, `EDIT`, and `ANALYZE` behavior is provided through skills or equivalent prompt assets, not subagents
- the root docs no longer describe subagents as the primary Blender workflow
- the Blender prompt layer explains how and when to use Blender tools
- tests cover activation, workspace flow, and failure paths

## Promotion rule for later

Only consider promoting Blender concepts into core after the extension-level design stabilizes. Candidates for later promotion are:

- workspace initialization contract
- Blender execution contract
- scene inspection contract
- saved-view contract
- render contract

Everything else should remain extension-level unless there is a strong product reason to generalize it.
