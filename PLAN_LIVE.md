# Blender Live Session Context Plan

## Goal

Add a live Blender session context layer so `vibe-blender` can reason about what the user is currently doing inside Blender, not just what is saved in the workspace files.

This should make interactions like these possible:

- the user selects an object and says "update it to be more rounded"
- the user changes the viewport and says "render from here"
- the user enters Edit Mode and says "fix this part"
- the agent understands the current `.blend`, active scene, active object, selection, mode, and viewport well enough to resolve ambiguous references safely

The target is Blender-native "IDE context":

- current open `.blend`
- current workspace match
- current scene
- current mode
- active object
- selected objects
- current `VIEW_3D`
- current camera / viewport state
- dirty state

The system should use this context to improve target resolution and workflow guidance without introducing hidden, surprising mutations.

## Why this is needed

The current Blender tools mostly operate on explicit `workspace` state and managed workspace artifacts. That is good for reproducibility, but it is not enough for highly interactive Blender use.

Today, the agent does not directly know:

- what object the user currently selected
- which object is active
- whether the user is in Object Mode or Edit Mode
- which viewport the user is looking through
- whether the open Blender file matches the requested workspace
- whether the user has unsaved manual changes

Without this context, requests like "change this", "make this thicker", or "render what I'm looking at" remain weaker than IDE-style code agents that can inspect editor focus, current file, selection, and cursor state.

## High-level design

Add a new concept: `Blender live session context`.

This context should come from the live Blender bridge, not from background `.blend` inspection.

Architecture:

1. `live-bridge.py`
   Read live session state directly from the open Blender UI process.

2. Blender runtime modules
   Request, normalize, cache, and validate live session state.

3. Model-facing interface
   Expose the context through one or both of:
   - a dedicated tool such as `blender_session_context`
   - compact automatic prompt injection for `vibe-blender`

4. Skills and workflow policy
   Teach the agent when to use live context for ambiguous references and how to resolve targets safely.

## Core principles

### 1. Live context is descriptive first

The first job of the feature is inspection and disambiguation, not mutation.

It should let the agent answer:

- what file is open?
- what is selected?
- what is active?
- what mode is the user in?
- what viewport is the user using?

before deciding what to change.

### 2. Live context should not replace explicit `workspace`

Blender tools should still keep `workspace` explicit for managed workspace operations.

Rule:

- use live session context to resolve intent
- still use explicit `workspace` for actual tool calls and artifact management

### 3. Ambiguous user references must resolve conservatively

If the user says "update it", the agent should not guess recklessly.

Preferred resolution order:

1. explicit object or view named by the user
2. active object
3. single selected object
4. selected objects as a group if the request clearly applies to a set
5. ask for clarification when multiple candidates remain

### 4. User-driven UI state is real context, but not silent authority

The agent may use live session context, but it should say what it resolved.

Example:

- "I found active object `Handle` and will apply the change there."
- "There are three selected objects, so I need clarification before editing."

### 5. Live context must not silently override user work

The system must respect:

- unsaved manual changes
- user-selected objects and views
- user-created cameras and saved views
- current Blender mode

## Minimum useful live context

This is the first-pass context surface.

### File and workspace context

- open `.blend` file path
- whether the file is saved or untitled
- dirty / unsaved state
- whether the open file matches a managed workspace `model.blend`
- matched workspace path if available

### Scene context

- active scene name
- available scene names
- current frame
- active render camera object name

### Selection context

- active object name
- active object type
- selected object names
- selected object types
- selected object count

### Mode context

- current mode
  - `OBJECT`
  - `EDIT_MESH`
  - `SCULPT`
  - `POSE`
  - etc.
- active object mode compatibility

### Viewport context

- whether any `VIEW_3D` area is available
- which `VIEW_3D` is being used as the primary live context source
- viewport perspective type
  - user perspective
  - camera view
  - orthographic
- viewport shading mode
  - wireframe
  - solid
  - material preview
  - rendered
- current viewport transform summary when relevant
- current view camera if the viewport is in camera view

## Useful later context

These should be deferred until the base version is stable:

- selected vertices / edges / faces in edit mode
- active collection
- selected collections
- active material slot
- selected material or node editor targets
- active modifier
- active constraint
- current world / render engine
- timeline range and playback state
- sculpt brush / paint tool state
- multiple window / multiple `VIEW_3D` selection policy beyond the current largest-view heuristic

## Proposed tool and runtime surface

### New tool: `blender_session_context`

Purpose:

- inspect the current live Blender UI session
- resolve active file, selection, mode, scene, and viewport state
- provide structured context for ambiguous user requests

Suggested inputs:

- `workspace` optional
  - when provided, verify whether the live session matches that workspace
- `include`
  - optional subset such as `["file", "selection", "mode", "viewport"]`

Suggested outputs:

- `blendPath`
- `workspacePath` if matched
- `matchesWorkspace`
- `isDirty`
- `scene`
- `activeObject`
- `selectedObjects`
- `mode`
- `viewport`
- `warnings`

### New bridge request: `get-session-context`

Purpose:

- gather live Blender UI state directly from the current process

Expected source of truth:

- `bpy.context`
- active window
- active screen
- active scene
- selected objects
- active object
- current mode
- best `VIEW_3D` area / region

### Optional later tool: `blender_resolve_target`

Purpose:

- map phrases like "it", "this", or "selected object" to a concrete target

This should probably not exist in phase 1.
The model can usually do this once it has `blender_session_context`.

## Prompt integration strategy

### Phase 1

Use `blender_session_context` as an explicit tool.

This keeps the behavior transparent and easy to debug.

### Phase 2

Add compact live context injection to the per-turn Blender prompt when a bridge-enabled Blender session exists.

Example compact summary:

- Open blend: `.../model.blend`
- Workspace match: yes
- Scene: `Scene`
- Mode: `OBJECT`
- Active object: `TableTop`
- Selected objects: `TableTop`, `Leg_A`
- Viewport: `User Perspective`, `Material Preview`

Rules:

- keep this summary compact
- do not dump full scene info into the prompt
- prefer tool calls for full detail

## Target resolution policy

This is the most important behavior rule for user trust.

### Supported reference patterns

- "it"
- "this"
- "selected object"
- "current object"
- "active object"
- "what I'm looking at"
- "current view"

### Resolution policy

For edit requests:

1. If the user names an object explicitly, use that object.
2. Else if the user says active object, use the active object.
3. Else if exactly one object is selected, treat that as `it`.
4. Else if multiple objects are selected:
   - use the full selection only if the request clearly applies to all selected objects
   - otherwise ask for clarification
5. If nothing is selected, fall back to prior explicit context or ask.

For view/render requests:

1. If the user names a saved view or camera, use that.
2. Else if the user says current view / from here, use live viewport context.
3. Else if the user says active camera, use `scene.camera`.

### Safety rule

Always state the resolved target before mutating when the request is ambiguous.

## Interaction with existing tools

### `blender_execute_python`

Live session context should inform what the script changes, but `blender_execute_python` should still operate against the managed workspace script and live Blender session.

Likely effect:

- the skill may call `blender_session_context` before editing `$workspace/script.py`
- the resulting script can target the active or selected object explicitly

### `blender_save_view`

Live session context should help distinguish:

- current viewport
- active camera
- saved view

This is directly useful for "render from here" workflows.

### `blender_scene_info`

`blender_scene_info` remains file / scene inspection.
It should not be overloaded with transient UI/session context.

Rule:

- `blender_scene_info` = structured scene state
- `blender_session_context` = transient live UI state

## Bridge implementation details

The live bridge must learn how to capture more than execute/render/save-view operations.

### New bridge responsibilities

- detect open file path and dirty state
- inspect active scene
- inspect active object and selection
- inspect current mode
- locate the primary `VIEW_3D`
- summarize current viewport state
- return consistent structured JSON

### Likely Blender APIs involved

- `bpy.data.filepath`
- `bpy.data.is_dirty`
- `bpy.context.scene`
- `bpy.context.view_layer.objects.active`
- `bpy.context.selected_objects`
- `bpy.context.mode`
- `window_manager.windows`
- `screen.areas`
- `area.spaces.active`
- `region_3d`

### Multi-window / multi-viewport rule

Keep the current heuristic initially:

- choose the largest visible `VIEW_3D`

Later improvement:

- track most recently interacted `VIEW_3D`
- or allow explicit viewport targeting

## Runtime implementation details

Add a dedicated runtime module, likely:

- `packages/coding-agent/src/blender/session-context.ts`

Responsibilities:

- send `get-session-context` to the live bridge
- normalize bridge payloads
- match live file path to managed workspace paths
- provide warnings for dirty mismatches or missing viewports
- export the public `blenderSessionContext(...)` function

The runtime should keep this separate from:

- `scene-info.ts`
- `execute.ts`
- `render.ts`

because the concept is live session state, not file inspection or scene mutation.

## Skill updates required

The Blender skills should be updated so the agent knows when to rely on live context.

### `blender-edit`

Add guidance:

- when the user refers to "it", "this", or "selected object", inspect live session context first
- resolve active object vs selected objects conservatively
- state the resolved target before editing

### `blender-create`

Add guidance:

- when the user adjusts the viewport or selection manually, use live session context to align evaluation and follow-up edits

### `blender-with-reference`

Add guidance:

- use live viewport context when the user is manually framing reference comparisons

## Documentation changes required

### Root README

Document:

- that `vibe-blender` can inspect live Blender selection and viewport state
- that this only works in the bridge-enabled Blender session
- how ambiguous references like "it" are resolved

### Tool docs

Document:

- `blender_session_context`
- live session vs saved scene inspection
- what context is transient versus persisted

## Delivery phases

### Phase 1: contract

- define the `blender_session_context` result schema
- define bridge payload shape
- define target resolution policy
- define dirty / mismatch warning rules

### Phase 2: bridge support

- implement `get-session-context` in `live-bridge.py`
- capture file, scene, selection, mode, and viewport state
- handle no-window / no-viewport edge cases

### Phase 3: runtime and tool

- add `session-context.ts`
- add `blenderSessionContext(...)`
- register `blender_session_context` in `extension.ts`
- add tests for tool registration and schema

### Phase 4: skills and prompt policy

- update Blender skills for ambiguous target resolution
- optionally add compact live-context prompt injection

### Phase 5: UX hardening

- add warnings for dirty unrelated files
- add mismatch warnings when live Blender is not on the requested workspace
- improve multi-viewport selection policy if needed

## Acceptance criteria

This feature is successful when:

- the agent can inspect the current live Blender file, scene, selection, mode, and viewport
- the agent can resolve "it" to the active or selected object when the context is unambiguous
- the agent does not silently guess when multiple targets are possible
- the agent can distinguish current live viewport from active render camera
- the agent can tell whether the live Blender session matches the requested workspace
- docs clearly explain transient live context versus persisted workspace state

## Non-goals for the first pass

Do not attempt all of these in phase 1:

- full edit-mode mesh element editing context
- node editor context
- sculpt / paint deep tool context
- automatic background sync of every Blender event into the prompt
- implicit workspace removal

The first pass should focus on file, selection, mode, and viewport context because that is enough to unlock the highest-value "update it" and "render from here" workflows.
