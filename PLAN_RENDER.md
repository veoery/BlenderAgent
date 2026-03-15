# Blender Render API Plan

## Goal

Replace the current overloaded `mode` field in `blender_render` with a clearer API that separates:

- how the render is executed
- what kind of render is requested
- where the view comes from
- which engine or viewport shading mode should be used

This should make the tool easier for the model to use correctly and easier to extend without ambiguous combinations.

## Why change the current API

The current API mixes several different concepts into one `mode` string:

- `material-preview` currently means:
  - live Blender UI execution
  - viewport OpenGL render
  - material preview viewport shading
  - camera-based framing
- `still` currently means:
  - background Blender execution
  - final scene render
  - scene render engine path

That hides important rules:

- viewport shading modes are live-viewport concepts
- final scene render is a different operator than viewport render
- live render can still be camera-based or current-view-based
- background render should be engine-based, not shading-mode-based

## Proposed public API

### `renderMethod`

How the render is executed:

- `live`
- `background`

Default:

- `live`

Reason:

- keeps the current vibe-blender workflow centered on the live Blender session
- still allows explicit background renders when the user wants final engine output

### `viewSource`

How the framing is chosen:

- `camera`
- `current-view`

Default:

- `camera`

Important rule:

- For `live`, default to `camera` unless the user explicitly asks to use the current viewport view
- This prevents accidental render drift when the user has moved the viewport for inspection only

Compatibility:

- Existing `view` remains the camera-or-saved-view selector
- `viewSource="camera"` uses `view`
- `viewSource="current-view"` ignores camera selection and renders the raw current viewport

### `viewportShading`

Only valid when `renderMethod="live"`.

Allowed values:

- `wireframe`
- `solid`
- `material-preview`
- `rendered`

Default for live:

- `material-preview`

Notes:

- `solid` corresponds to Workbench-style viewport shading
- `material-preview` corresponds to viewport material preview shading
- `rendered` means the viewport uses the scene render engine interactively

### `renderEngine`

Only valid when `renderMethod="background"`.

Allowed values:

- `eevee`
- `cycles`
- `workbench`

Default for background:

- keep the scene’s current engine unless an override is explicitly requested

Reason:

- background render should be modeled as an engine choice, not as a viewport shading mode

## Valid combinations

### Live

Supported:

- `renderMethod="live"` + `viewSource="camera"` + any `viewportShading`
- `renderMethod="live"` + `viewSource="current-view"` + any `viewportShading`

Behavior:

- disable viewport overlays before rendering, then restore them afterward
- this avoids grid, axis, empties, and other overlay clutter in saved images

Default behavior:

- `renderMethod="live"`
- `viewSource="camera"`
- `viewportShading="material-preview"`

This preserves current vibe-blender expectations while making `current-view` explicit.

### Background

Supported:

- `renderMethod="background"` + `renderEngine` optional

Behavior:

- normal final scene render path with `bpy.ops.render.render(write_still=True)`
- camera-based only

Invalid:

- `viewportShading` with `background`
- `viewSource="current-view"` with `background`

## Implementation changes

### 1. Types

Update `packages/coding-agent/src/blender/types.ts`:

- add literal unions:
  - `BlenderRenderMethod`
  - `BlenderRenderViewSource`
  - `BlenderViewportShading`
  - `BlenderRenderEngine`
- extend `RenderOptions` and `RenderResult`

### 2. Tool schema and description

Update `packages/coding-agent/src/blender/extension.ts`:

- replace the current `blender_render` parameter docs with the new structure
- make the description very explicit about:
  - `live` vs `background`
  - `camera` default for live
  - `current-view` only when explicitly requested
  - `viewportShading` being live-only
  - `renderEngine` being background-only
  - overlays being disabled for live viewport renders

### 3. Runtime render resolution

Update `packages/coding-agent/src/blender/render.ts`:

- validate combinations
- branch by `renderMethod`
- for `live`:
  - send `viewSource`
  - send `viewportShading`
  - send `cameraName` only when `viewSource="camera"`
- for `background`:
  - optionally override `scene.render.engine`
  - reject `current-view`

### 4. Bridge request contract

Update `packages/coding-agent/src/blender/bridge.ts`:

- extend `requestLiveBlenderRender` payload with:
  - `viewSource`
  - `viewportShading`
- keep `cameraName` optional

### 5. Live Blender implementation

Update `packages/coding-agent/src/blender/live-bridge.py`:

- support viewport shading mapping:
  - `wireframe` -> `WIREFRAME`
  - `solid` -> `SOLID`
  - `material-preview` -> `MATERIAL`
  - `rendered` -> `RENDERED`
- disable overlays before viewport render, restore afterward
- if `viewSource="camera"`:
  - resolve camera and force camera view, similar to current behavior
- if `viewSource="current-view"`:
  - do not force camera view
  - render the current raw viewport view

### 6. Background render implementation

Update the background render script in `render.ts`:

- optionally set `scene.render.engine` from `renderEngine`
- keep camera-based render path

## Docs and tests

### Tests

Update `packages/coding-agent/test/blender-extension.test.ts`:

- assert new `blender_render` fields are present

### Docs

Update:

- `README.md`
- `packages/coding-agent/CHANGELOG.md`

Document:

- new render API
- live defaults
- current-view explicitness
- overlay disabling for live viewport renders
- background engine selection

## Acceptance criteria

The change is complete when:

- `blender_render` has a general API centered on `renderMethod`
- live render defaults to camera-based behavior
- raw current-view live render is available explicitly
- live viewport renders disable overlays
- background render uses engine selection rather than viewport shading concepts
- tool description clearly explains the rules to the model
- `npm run check` passes
