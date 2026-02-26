#!/usr/bin/env python3
"""
Render an existing .blend file with configurable camera views.
This is the ONLY rendering tool — always use this after executing a script.

Render modes:
  - default: 4-view orthographic grid (front/top/side/iso) + optional turntable GIF
  - cameras: Render from cameras in the .blend file (all or specific ones via --cameras)
  - current-view: Render from the saved 3D viewport perspective in the .blend file

The model should choose the mode based on context:
  - Use "default" for general-purpose inspection (newly created models, checking edits, analysis)
  - Use "cameras" when the scene has intentionally placed cameras (e.g. architectural renders,
    animation setups) and you want to see the scene from the artist's intended viewpoints
  - Use "current-view" when the user has set a specific viewport perspective and saved the file

Usage:
    # 4-view grid (default)
    python render_blend.py <blend_path> <output_dir>

    # 4-view grid + turntable GIF
    python render_blend.py <blend_path> <output_dir> --turntable

    # All scene cameras
    python render_blend.py <blend_path> <output_dir> --mode cameras

    # Specific cameras only
    python render_blend.py <blend_path> <output_dir> --mode cameras --cameras "Camera,Camera.001"

    # Saved current viewport perspective
    python render_blend.py <blend_path> <output_dir> --mode current-view

Environment Variables:
    BLENDER_PATH: Path to Blender executable (default: "blender")
"""

import sys
import json
import subprocess
import os
import argparse
from pathlib import Path
from datetime import datetime


def main():
    parser = argparse.ArgumentParser(description="Render an existing .blend file")
    parser.add_argument("blend_path", type=Path, help="Path to the .blend file")
    parser.add_argument("output_dir", type=Path, help="Output directory for renders")
    parser.add_argument(
        "--mode",
        choices=["default", "cameras", "current-view"],
        default="default",
        help="Render mode: default (4-view grid), cameras (scene cameras), current-view (saved viewport)",
    )
    parser.add_argument(
        "--cameras",
        type=str,
        default="",
        help="Comma-separated camera names for 'cameras' mode (renders all scene cameras if omitted)",
    )
    parser.add_argument(
        "--resolution",
        type=int,
        nargs=2,
        default=[512, 512],
        help="Render resolution (width height)",
    )
    parser.add_argument(
        "--samples",
        type=int,
        default=64,
        help="Cycles render samples",
    )
    parser.add_argument(
        "--turntable",
        action="store_true",
        default=False,
        help="Generate turntable GIF (default mode only)",
    )

    args = parser.parse_args()

    if not args.blend_path.exists():
        print(json.dumps({"status": "error", "message": f"Blend file not found: {args.blend_path}"}))
        sys.exit(1)

    # Create output directory
    args.output_dir.mkdir(parents=True, exist_ok=True)
    render_dir = args.output_dir / "renders"
    render_dir.mkdir(exist_ok=True)

    # Build render script based on mode
    if args.mode == "default":
        render_script = build_default_render_script(
            args.blend_path, render_dir, args.resolution, args.samples, args.turntable
        )
    elif args.mode == "cameras":
        camera_list = [c.strip() for c in args.cameras.split(",") if c.strip()]
        render_script = build_camera_render_script(
            args.blend_path, render_dir, camera_list, args.resolution, args.samples
        )
    elif args.mode == "current-view":
        render_script = build_current_view_render_script(
            args.blend_path, render_dir, args.resolution, args.samples
        )

    # Write and execute
    temp_script = args.output_dir / "render_script.py"
    temp_script.write_text(render_script)

    blender_path = os.environ.get("BLENDER_PATH", "blender")
    result = run_blender(blender_path, temp_script, args.output_dir / "blender.log")

    if not result.get("success"):
        print(json.dumps(result))
        sys.exit(1)

    # Post-process (grid + GIF)
    try:
        sys.path.insert(0, str(Path(__file__).parent))
        from renderer import RenderManager

        rm = RenderManager()

        grid_path = None
        gif_path = None

        if args.mode == "default":
            views = ["front", "top", "side", "iso"]
            view_paths = [render_dir / f"view_{v}.png" for v in views]
            existing_views = [p for p in view_paths if p.exists()]

            if len(existing_views) >= 4:
                grid_path = render_dir / "grid_4view.png"
                rm.create_grid_image(existing_views[:4], grid_path, labels=views)

            turntable_dir = render_dir / "turntable_frames"
            if turntable_dir.exists():
                gif_path = render_dir / "turntable.gif"
                rm.create_turntable_gif(turntable_dir, gif_path)

    except ImportError as e:
        grid_path = None
        gif_path = None
        print(f"[WARNING] Post-processing skipped: {e}", file=sys.stderr)

    # Collect render outputs
    renders = {}
    for f in sorted(render_dir.iterdir()):
        if f.suffix == ".png" and f.name != "grid_4view.png":
            renders[f.stem] = str(f)

    output = {
        "status": "success",
        "blend_file": str(args.blend_path),
        "renders": renders,
        "grid": str(grid_path) if grid_path and grid_path.exists() else None,
        "turntable": str(gif_path) if gif_path and gif_path.exists() else None,
        "output_dir": str(args.output_dir),
        "render_dir": str(render_dir),
    }

    print(json.dumps(output, indent=2))
    sys.exit(0)


def build_default_render_script(blend_path, render_dir, resolution, samples, turntable):
    """Build a script that opens a .blend and renders 4 default views."""
    turntable_code = ""
    if turntable:
        turntable_code = f"""
    # Turntable
    turntable_dir = os.path.join(r"{render_dir}", "turntable_frames")
    os.makedirs(turntable_dir, exist_ok=True)
    render_turntable(cameras['iso'], turntable_dir, frames=12, resolution=({resolution[0]}, {resolution[1]}))
"""

    return f'''# Render script generated by render_blend.py - {datetime.now().isoformat()}
import bpy
import math
import os
import mathutils

# Open existing blend file
bpy.ops.wm.open_mainfile(filepath=r"{blend_path}")

def setup_camera(name, location, rotation, ortho=True, ortho_scale=5):
    cam_data = bpy.data.cameras.new(name=name)
    cam_data.type = 'ORTHO' if ortho else 'PERSP'
    if ortho:
        cam_data.ortho_scale = ortho_scale
    cam_obj = bpy.data.objects.new(name, cam_data)
    bpy.context.scene.collection.objects.link(cam_obj)
    cam_obj.location = location
    cam_obj.rotation_euler = rotation
    return cam_obj

def setup_lighting():
    # Only add lights if scene has none
    existing_lights = [obj for obj in bpy.context.scene.objects if obj.type == 'LIGHT']
    if existing_lights:
        return  # Scene already has lighting

    key_data = bpy.data.lights.new(name="KeyLight", type='SUN')
    key_data.energy = 3.0
    key_obj = bpy.data.objects.new("KeyLight", key_data)
    bpy.context.scene.collection.objects.link(key_obj)
    key_obj.rotation_euler = (math.radians(45), math.radians(30), 0)

    fill_data = bpy.data.lights.new(name="FillLight", type='SUN')
    fill_data.energy = 1.5
    fill_obj = bpy.data.objects.new("FillLight", fill_data)
    bpy.context.scene.collection.objects.link(fill_obj)
    fill_obj.rotation_euler = (math.radians(45), math.radians(-60), 0)

    rim_data = bpy.data.lights.new(name="RimLight", type='SUN')
    rim_data.energy = 2.0
    rim_obj = bpy.data.objects.new("RimLight", rim_data)
    bpy.context.scene.collection.objects.link(rim_obj)
    rim_obj.rotation_euler = (math.radians(-30), math.radians(180), 0)

def render_view(camera, filepath, resolution):
    scene = bpy.context.scene
    scene.camera = camera
    scene.render.resolution_x = resolution[0]
    scene.render.resolution_y = resolution[1]
    scene.render.filepath = filepath
    scene.render.image_settings.file_format = 'PNG'
    bpy.ops.render.render(write_still=True)

def render_turntable(camera, output_dir, frames=12, resolution=(512, 512)):
    scene = bpy.context.scene
    scene.camera = camera
    scene.render.resolution_x = resolution[0]
    scene.render.resolution_y = resolution[1]
    scene.render.image_settings.file_format = 'PNG'

    bpy.ops.object.empty_add(location=(0, 0, 0))
    pivot = bpy.context.active_object
    pivot.name = "TurntablePivot"
    camera.parent = pivot

    for i in range(frames):
        angle = (2 * math.pi * i) / frames
        pivot.rotation_euler = (0, 0, angle)
        bpy.context.view_layer.update()
        filepath = os.path.join(output_dir, f"turntable_{{i:03d}}.png")
        scene.render.filepath = filepath
        bpy.ops.render.render(write_still=True)

def run():
    output_dir = r"{render_dir}"
    os.makedirs(output_dir, exist_ok=True)

    # Render settings
    bpy.context.scene.render.engine = 'CYCLES'
    bpy.context.scene.cycles.samples = {samples}
    bpy.context.scene.cycles.use_denoising = True
    try:
        bpy.context.scene.cycles.device = 'GPU'
    except:
        bpy.context.scene.render.engine = 'BLENDER_EEVEE_NEXT'

    setup_lighting()

    # Calculate scene bounds
    min_coord = [float('inf')] * 3
    max_coord = [float('-inf')] * 3
    for obj in bpy.context.scene.objects:
        if obj.type == 'MESH':
            for corner in obj.bound_box:
                world_corner = obj.matrix_world @ mathutils.Vector(corner)
                for i in range(3):
                    min_coord[i] = min(min_coord[i], world_corner[i])
                    max_coord[i] = max(max_coord[i], world_corner[i])

    if min_coord[0] == float('inf'):
        min_coord = [-1, -1, -1]
        max_coord = [1, 1, 1]

    center = [(min_coord[i] + max_coord[i]) / 2 for i in range(3)]
    size = max(max_coord[i] - min_coord[i] for i in range(3))
    dist = size * 2
    ortho_scale = size * 1.5

    cameras = {{
        'front': setup_camera('CamFront', (center[0], -dist, center[2]), (math.radians(90), 0, 0), True, ortho_scale),
        'top': setup_camera('CamTop', (center[0], center[1], dist), (0, 0, 0), True, ortho_scale),
        'side': setup_camera('CamSide', (dist, center[1], center[2]), (math.radians(90), 0, math.radians(90)), True, ortho_scale),
        'iso': setup_camera('CamIso', (dist*0.7, -dist*0.7, dist*0.7), (math.radians(54.7), 0, math.radians(45)), False),
    }}

    for name, cam in cameras.items():
        filepath = os.path.join(output_dir, f"view_{{name}}.png")
        render_view(cam, filepath, ({resolution[0]}, {resolution[1]}))
{turntable_code}
    print("[RENDER COMPLETE]")

run()
'''


def build_camera_render_script(blend_path, render_dir, camera_names, resolution, samples):
    """Build a script that renders from cameras in the .blend file."""
    if not camera_names:
        # Auto-discover all cameras
        camera_discovery = """
    camera_names = [obj.name for obj in bpy.data.objects if obj.type == 'CAMERA']
    if not camera_names:
        print("[ERROR] No cameras found in scene")
"""
    else:
        camera_discovery = f"    camera_names = {camera_names}\n"

    return f'''# Render script (scene cameras) - {datetime.now().isoformat()}
import bpy
import os

bpy.ops.wm.open_mainfile(filepath=r"{blend_path}")

def run():
    output_dir = r"{render_dir}"
    os.makedirs(output_dir, exist_ok=True)

    bpy.context.scene.render.engine = 'CYCLES'
    bpy.context.scene.cycles.samples = {samples}
    bpy.context.scene.cycles.use_denoising = True
    try:
        bpy.context.scene.cycles.device = 'GPU'
    except:
        bpy.context.scene.render.engine = 'BLENDER_EEVEE_NEXT'

    bpy.context.scene.render.resolution_x = {resolution[0]}
    bpy.context.scene.render.resolution_y = {resolution[1]}
    bpy.context.scene.render.image_settings.file_format = 'PNG'

{camera_discovery}
    for i, cam_name in enumerate(camera_names):
        if cam_name not in bpy.data.objects:
            print(f"[WARNING] Camera '{{cam_name}}' not found, skipping")
            continue
        camera = bpy.data.objects[cam_name]
        if camera.type != 'CAMERA':
            print(f"[WARNING] Object '{{cam_name}}' is not a camera, skipping")
            continue

        bpy.context.scene.camera = camera
        filepath = os.path.join(output_dir, f"render_{{cam_name}}.png")
        bpy.context.scene.render.filepath = filepath
        bpy.ops.render.render(write_still=True)
        print(f"[RENDER] {{cam_name}} -> {{filepath}}")

    print("[RENDER COMPLETE]")

run()
'''


def build_current_view_render_script(blend_path, render_dir, resolution, samples):
    """Build a script that aligns camera to saved viewport and renders camera output."""
    return f'''# Render script (current saved viewport) - {datetime.now().isoformat()}
import bpy
import math
import os

bpy.ops.wm.open_mainfile(filepath=r"{blend_path}")

def iter_screen_candidates():
    seen = set()

    # 1) Prefer the screen saved as active on each window manager window.
    for wm in bpy.data.window_managers:
        for window in wm.windows:
            screen = getattr(window, "screen", None)
            if screen and screen.name not in seen:
                seen.add(screen.name)
                yield (screen, "window-active")

    # 2) Then context screen/workspace (if available in background context).
    ctx_screen = getattr(bpy.context, "screen", None)
    if ctx_screen and ctx_screen.name not in seen:
        seen.add(ctx_screen.name)
        yield (ctx_screen, "context-screen")

    ctx_workspace = getattr(bpy.context, "workspace", None)
    if ctx_workspace:
        for screen in ctx_workspace.screens:
            if screen and screen.name not in seen:
                seen.add(screen.name)
                yield (screen, "context-workspace")

    # 3) Finally, scan all remaining screens as fallback.
    for screen in bpy.data.screens:
        if screen and screen.name not in seen:
            seen.add(screen.name)
            yield (screen, "fallback-any")

def find_saved_viewport():
    for screen, source in iter_screen_candidates():
        for area in screen.areas:
            if area.type != 'VIEW_3D':
                continue
            area_size = max(1, area.width) * max(1, area.height)
            for space in area.spaces:
                if space.type == 'VIEW_3D' and space.region_3d:
                    return (space, space.region_3d, screen.name, area_size, source)
    return None

def setup_lighting():
    scene = bpy.context.scene
    # Add fallback lights only when nothing renderable exists.
    existing_lights = [obj for obj in scene.objects if obj.type == 'LIGHT' and not obj.hide_render]
    if not existing_lights:
        key_data = bpy.data.lights.new(name="KeyLight", type='SUN')
        key_data.energy = 3.0
        key_obj = bpy.data.objects.new("KeyLight", key_data)
        scene.collection.objects.link(key_obj)
        key_obj.rotation_euler = (math.radians(45), math.radians(30), 0)

        fill_data = bpy.data.lights.new(name="FillLight", type='SUN')
        fill_data.energy = 1.5
        fill_obj = bpy.data.objects.new("FillLight", fill_data)
        scene.collection.objects.link(fill_obj)
        fill_obj.rotation_euler = (math.radians(45), math.radians(-60), 0)

        rim_data = bpy.data.lights.new(name="RimLight", type='SUN')
        rim_data.energy = 2.0
        rim_obj = bpy.data.objects.new("RimLight", rim_data)
        scene.collection.objects.link(rim_obj)
        rim_obj.rotation_euler = (math.radians(-30), math.radians(180), 0)

    # Keep renders readable even if viewport was in Solid/Studio lighting.
    world = scene.world
    if world is None:
        world = bpy.data.worlds.new("World")
        scene.world = world
    world.use_nodes = True
    bg = world.node_tree.nodes.get("Background")
    if bg:
        strength = float(bg.inputs["Strength"].default_value)
        bg.inputs["Strength"].default_value = max(strength, 0.8)
    scene.view_settings.exposure = max(float(scene.view_settings.exposure), 0.8)

def run():
    output_dir = r"{render_dir}"
    os.makedirs(output_dir, exist_ok=True)

    scene = bpy.context.scene
    scene.render.engine = 'CYCLES'
    scene.cycles.samples = {samples}
    scene.cycles.use_denoising = True
    try:
        scene.cycles.device = 'GPU'
    except:
        scene.render.engine = 'BLENDER_EEVEE_NEXT'

    setup_lighting()

    scene.render.resolution_x = {resolution[0]}
    scene.render.resolution_y = {resolution[1]}
    scene.render.image_settings.file_format = 'PNG'

    viewport = find_saved_viewport()
    if not viewport:
        raise RuntimeError(
            "No saved VIEW_3D perspective found in the .blend file. "
            "Set the view in Blender, save the file, then retry."
        )
    space, region_3d, screen_name, area_size, source = viewport

    if region_3d.view_perspective == 'CAMERA' and space.camera and space.camera.type == 'CAMERA':
        camera = space.camera
    else:
        if scene.camera and scene.camera.type == 'CAMERA':
            camera = scene.camera
        else:
            cam_data = bpy.data.cameras.new(name="CurrentViewCameraData")
            camera = bpy.data.objects.new("CurrentViewCamera", cam_data)
            scene.collection.objects.link(camera)

    # Equivalent to "Align Active Camera to View": camera transform follows saved RegionView3D view matrix.
    camera.matrix_world = region_3d.view_matrix.inverted()

    if region_3d.view_perspective == 'ORTHO':
        camera.data.type = 'ORTHO'
        camera.data.ortho_scale = max(0.1, float(region_3d.view_distance) * 2.0)
    else:
        camera.data.type = 'PERSP'
        if hasattr(space, 'lens'):
            camera.data.lens = space.lens

    scene.camera = camera
    filepath = os.path.join(output_dir, "render_current_view_camera.png")
    scene.render.filepath = filepath
    bpy.ops.render.render(write_still=True)
    print("[CAMERA_ALIGNED] screen=" + str(screen_name) + " source=" + str(source) + " area_size=" + str(area_size) + " perspective=" + str(region_3d.view_perspective))
    print("[RENDER] current_view_camera -> " + filepath)
    print("[RENDER COMPLETE]")

run()
'''


def run_blender(blender_path, script_path, log_path):
    """Execute Blender with timeout protection."""
    cmd = [str(blender_path), "--background", "--python", str(script_path)]
    try:
        result = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            timeout=180,
            env={**os.environ, "PYTHONDONTWRITEBYTECODE": "1"},
        )
        with open(log_path, "w") as f:
            f.write("=== STDOUT ===\n")
            f.write(result.stdout)
            f.write("\n=== STDERR ===\n")
            f.write(result.stderr)

        if result.returncode != 0:
            return {
                "status": "error",
                "message": f"Blender exited with code {result.returncode}",
                "error": result.stderr[-1000:] if result.stderr else "Unknown error",
                "log_path": str(log_path),
            }
        if "Traceback" in result.stderr or "Error:" in result.stderr:
            return {
                "status": "error",
                "message": "Blender script had errors",
                "error": extract_error(result.stderr),
                "log_path": str(log_path),
            }
        return {"success": True}
    except subprocess.TimeoutExpired:
        return {"status": "error", "message": "Blender execution timed out after 180s"}
    except FileNotFoundError:
        return {"status": "error", "message": f"Blender executable not found: {blender_path}"}


def extract_error(stderr):
    lines = stderr.strip().split("\n")
    for i, line in enumerate(lines):
        if line.startswith("Traceback"):
            return "\n".join(lines[i : min(i + 15, len(lines))])
    return "\n".join(lines[-15:])


if __name__ == "__main__":
    main()
