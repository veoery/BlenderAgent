import contextlib
import io
import json
import os
import shutil
import traceback

import bpy


BRIDGE_DIR = os.environ.get("VIBE_BLENDER_BRIDGE_DIR") or os.path.join(
    os.path.expanduser("~"),
    ".pi",
    "agent",
    "blender-bridge",
)
REQUESTS_DIR = os.path.join(BRIDGE_DIR, "requests")
RESPONSES_DIR = os.path.join(BRIDGE_DIR, "responses")
POLL_INTERVAL_SECONDS = 0.5


def ensure_bridge_dirs():
    os.makedirs(REQUESTS_DIR, exist_ok=True)
    os.makedirs(RESPONSES_DIR, exist_ok=True)


def write_response(request_id, payload):
    response_path = os.path.join(RESPONSES_DIR, f"{request_id}.json")
    with open(response_path, "w", encoding="utf-8") as handle:
        json.dump(payload, handle, indent=2)


def find_viewport_context():
    best = None

    for window in bpy.context.window_manager.windows:
        screen = window.screen
        if screen is None:
            continue

        for area in screen.areas:
            if area.type != "VIEW_3D":
                continue

            region = next((candidate for candidate in area.regions if candidate.type == "WINDOW"), None)
            space = area.spaces.active if area.spaces.active and area.spaces.active.type == "VIEW_3D" else None
            region_3d = getattr(space, "region_3d", None) if space else None
            if region is None or space is None or region_3d is None:
                continue

            area_size = int(area.width) * int(area.height)
            candidate = {
                "window": window,
                "screen": screen,
                "area": area,
                "region": region,
                "space": space,
                "region_3d": region_3d,
                "scene": window.scene if getattr(window, "scene", None) else bpy.context.scene,
                "area_size": area_size,
            }
            if best is None or candidate["area_size"] > best["area_size"]:
                best = candidate

    if best is None:
        raise RuntimeError("No live VIEW_3D viewport is open in Blender.")

    return best


def ensure_camera(scene, camera_object_name, camera_settings_name):
    camera_object = bpy.data.objects.get(camera_object_name)
    if camera_object is not None and camera_object.type != "CAMERA":
        raise RuntimeError(f'Object "{camera_object_name}" exists but is not a camera.')

    if camera_object is None:
        camera_data = bpy.data.cameras.new(camera_settings_name)
        camera_object = bpy.data.objects.new(camera_object_name, camera_data)
        scene.collection.objects.link(camera_object)
    else:
        camera_data = camera_object.data

    if not camera_object.users_collection:
        scene.collection.objects.link(camera_object)

    if camera_object.data and camera_object.data.name != camera_settings_name:
        camera_object.data.name = camera_settings_name

    return camera_object


def copy_camera_settings(target_camera, source_camera):
    target_data = target_camera.data
    source_data = source_camera.data

    target_data.type = source_data.type
    target_data.lens = float(source_data.lens)
    target_data.sensor_width = float(source_data.sensor_width)
    target_data.sensor_height = float(source_data.sensor_height)
    target_data.clip_start = float(source_data.clip_start)
    target_data.clip_end = float(source_data.clip_end)
    if hasattr(source_data, "ortho_scale"):
        target_data.ortho_scale = float(source_data.ortho_scale)


def align_camera_to_view(viewport, camera_object):
    space = viewport["space"]
    region_3d = viewport["region_3d"]
    scene = viewport["scene"]

    scene.camera = camera_object
    bpy.context.view_layer.objects.active = camera_object

    source_camera = getattr(space, "camera", None)
    if source_camera is not None and source_camera.type == "CAMERA":
        copy_camera_settings(camera_object, source_camera)

    camera_object.matrix_world = region_3d.view_matrix.inverted()

    if region_3d.view_perspective == "ORTHO":
        camera_object.data.type = "ORTHO"
        camera_object.data.ortho_scale = max(0.1, float(region_3d.view_distance) * 2.0)
    else:
        if camera_object.data.type != "PANO":
            camera_object.data.type = "PERSP"
        if source_camera is None and hasattr(space, "lens"):
            camera_object.data.lens = float(space.lens)

    bpy.context.view_layer.update()


def ensure_requested_blend_open(request):
    requested_blend_path = os.path.abspath(request["blendPath"])
    if not os.path.exists(requested_blend_path):
        raise RuntimeError(f'Workspace blend file does not exist: "{requested_blend_path}".')

    current_blend_path = os.path.abspath(bpy.data.filepath) if bpy.data.filepath else ""
    if current_blend_path == requested_blend_path:
        return requested_blend_path

    if bpy.data.is_dirty:
        current_label = current_blend_path or "the current unsaved Blender scene"
        raise RuntimeError(
            f'Blender has unsaved changes in {current_label}. Save or discard them before vibe-blender can switch to "{requested_blend_path}".'
        )

    bpy.ops.wm.open_mainfile(filepath=requested_blend_path)
    loaded_blend_path = os.path.abspath(bpy.data.filepath) if bpy.data.filepath else ""
    if loaded_blend_path != requested_blend_path:
        raise RuntimeError(
            f'Failed to open requested workspace blend "{requested_blend_path}". Blender is still showing "{loaded_blend_path or "an unsaved scene"}".'
        )

    return requested_blend_path


def handle_open_blend(request):
    requested_blend_path = ensure_requested_blend_open(request)
    return {
        "blendPath": requested_blend_path,
    }


def handle_capture_view(request):
    ensure_requested_blend_open(request)

    viewport = find_viewport_context()
    scene = viewport["scene"]
    camera_object_name = request["cameraObjectName"]
    camera_settings_name = request.get("cameraSettingsName") or f"{camera_object_name}.settings"
    camera_object = ensure_camera(scene, camera_object_name, camera_settings_name)

    with bpy.context.temp_override(
        window=viewport["window"],
        screen=viewport["screen"],
        area=viewport["area"],
        region=viewport["region"],
        space_data=viewport["space"],
        scene=scene,
    ):
        align_camera_to_view(viewport, camera_object)

    scene.camera = camera_object
    bpy.ops.wm.save_mainfile()

    return {
        "viewName": request["viewName"],
        "cameraObjectName": camera_object.name,
        "cameraSettingsName": camera_object.data.name if camera_object.data else None,
        "activeCameraName": scene.camera.name if scene.camera else None,
        "blendPath": bpy.data.filepath,
    }


def handle_execute_python(request):
    requested_blend_path = ensure_requested_blend_open(request)
    save_before_path = request.get("saveBeforePath")
    if save_before_path:
        bpy.ops.wm.save_mainfile()
        os.makedirs(os.path.dirname(save_before_path), exist_ok=True)
        shutil.copyfile(requested_blend_path, save_before_path)

    globals_dict = {
        "__name__": "__main__",
        "OUTPUT_BLEND_PATH": requested_blend_path,
        "WORKSPACE_PATH": request["workspacePath"],
        "ITERATION_PATH": request["iterationPath"],
    }
    stdout_buffer = io.StringIO()
    stderr_buffer = io.StringIO()
    exit_code = 0

    previous_cwd = os.getcwd()
    workspace_path = request.get("workspacePath")
    if workspace_path:
        os.chdir(workspace_path)

    with contextlib.redirect_stdout(stdout_buffer), contextlib.redirect_stderr(stderr_buffer):
        try:
            with open(request["userScriptPath"], "r", encoding="utf-8") as handle:
                code = handle.read()
            exec(compile(code, request["userScriptPath"], "exec"), globals_dict)
            if request.get("saveAfter", True):
                bpy.ops.wm.save_mainfile()
        except Exception:
            exit_code = 1
            traceback.print_exc()
        finally:
            os.chdir(previous_cwd)

    return {
        "stdout": stdout_buffer.getvalue(),
        "stderr": stderr_buffer.getvalue(),
        "exitCode": exit_code,
        "changed": exit_code == 0,
    }


def handle_request(request):
    request_type = request.get("type")
    if request_type == "open-blend":
        return handle_open_blend(request)
    if request_type == "capture-view":
        return handle_capture_view(request)
    if request_type == "execute-python":
        return handle_execute_python(request)
    raise RuntimeError(f"Unsupported Blender bridge request type: {request_type}")


def process_request_file(request_path):
    request_id = os.path.splitext(os.path.basename(request_path))[0]

    try:
        with open(request_path, "r", encoding="utf-8") as handle:
            request = json.load(handle)
        result = handle_request(request)
        write_response(request_id, {"ok": True, "result": result})
    except Exception as error:
        write_response(
            request_id,
            {
                "ok": False,
                "error": str(error),
                "traceback": traceback.format_exc(),
            },
        )
    finally:
        try:
            os.remove(request_path)
        except OSError:
            pass


def poll_requests():
    ensure_bridge_dirs()

    for file_name in sorted(os.listdir(REQUESTS_DIR)):
        if not file_name.endswith(".json"):
            continue
        process_request_file(os.path.join(REQUESTS_DIR, file_name))

    return POLL_INTERVAL_SECONDS


ensure_bridge_dirs()
if not bpy.app.timers.is_registered(poll_requests):
    bpy.app.timers.register(poll_requests, first_interval=POLL_INTERVAL_SECONDS, persistent=True)
