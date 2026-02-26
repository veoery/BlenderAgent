# Changelog

## [Unreleased]

### Added
- Added `CREATE` subagent (`.pi/agents/CREATE.md`) for text-to-3D scene generation with iterative execute/render workflow.
- Added workspace continuation protocol via `workspace=<path>` for follow-up runs to keep iteration state stable across subagent restarts.
- Added `current-view` render mode in `.pi/agents/CREATE/render_blend.py` to render from the saved Blender viewport perspective.
- Added live-preview handoff in `.pi/agents/CREATE/execute_blender.py` to open generated `model.blend` in an already running Blender app.

### Changed
- CREATE workflow now keeps a single `model.blend` in the workspace root across all iterations.
- Iteration folders remain for script/log/render snapshots (`iteration_XX/...`) instead of per-iteration `.blend` copies.
- CREATE defaults Python execution to Anaconda via `CREATE_PYTHON_BIN` fallback (`/opt/anaconda3/bin/python`).
- Rendering flow now pauses after execute and asks the user to set/save perspective before running `--mode current-view`.

### Fixed
- Disabled Blender save backups during execute (`save_version = 0`) to avoid `.blend1/.blend2/...` clutter.
- Improved current-view camera selection by choosing the largest saved `VIEW_3D` area instead of the first match.
- Improved current-view brightness robustness by enforcing minimum ambient world strength and exposure floor during render.
