import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { SceneInfoOptions, SceneInfoResult, SceneInfoSelection } from "./types.js";
import { runBlenderJson } from "./utils.js";
import { getIterationPaths, loadWorkspaceManifest } from "./workspace.js";

function resolveSceneInfoSelection(options: SceneInfoOptions): SceneInfoSelection {
	const categories = options.categories;
	if (categories && categories.length > 0) {
		const selected = new Set(categories);
		return {
			includeObjects: selected.has("objects"),
			includeCollections: selected.has("collections"),
			includeMaterials: selected.has("materials"),
			includeCameras: selected.has("cameras"),
			includeCameraSettings: selected.has("cameraSettings"),
			includeLights: selected.has("lights"),
			includeViews: selected.has("views"),
			includeRenderSettings: selected.has("renderSettings"),
		};
	}

	const includeCameras = options.includeCameras ?? true;
	return {
		includeObjects: options.includeObjects ?? true,
		includeCollections: options.includeCollections ?? true,
		includeMaterials: options.includeMaterials ?? true,
		includeCameras,
		includeCameraSettings: options.includeCameraSettings ?? includeCameras,
		includeLights: options.includeLights ?? true,
		includeViews: true,
		includeRenderSettings: options.includeRenderSettings ?? true,
	};
}

function buildSceneInfoScript(): string {
	return `
import bpy
import json
import sys

payload = json.loads(sys.argv[sys.argv.index("--") + 1])

def maybe_vector(value):
    if value is None:
        return None
    return [float(component) for component in value]

scene = bpy.context.scene

result = {
    "activeCameraName": scene.camera.name if scene.camera else None,
    "objects": [],
    "collections": [],
    "materials": [],
    "cameras": [],
    "cameraSettings": [],
    "lights": [],
    "renderSettings": None,
}

if payload.get("includeObjects", True):
    for obj in bpy.data.objects:
        result["objects"].append({
            "name": obj.name,
            "type": obj.type,
            "location": maybe_vector(obj.location),
            "rotationEuler": maybe_vector(obj.rotation_euler),
            "scale": maybe_vector(obj.scale),
            "materialSlots": [slot.material.name for slot in obj.material_slots if slot.material],
        })

if payload.get("includeCollections", True):
    for collection in bpy.data.collections:
        result["collections"].append({
            "name": collection.name,
            "objectNames": [obj.name for obj in collection.objects],
        })

if payload.get("includeMaterials", True):
    for material in bpy.data.materials:
        result["materials"].append({
            "name": material.name,
            "useNodes": bool(material.use_nodes),
        })

if payload.get("includeCameras", True):
    for obj in bpy.data.objects:
        if obj.type != "CAMERA":
            continue
        result["cameras"].append({
            "name": obj.name,
            "cameraSettingsName": obj.data.name if obj.data else None,
            "location": maybe_vector(obj.location),
            "rotationEuler": maybe_vector(obj.rotation_euler),
            "scale": maybe_vector(obj.scale),
            "isSceneCamera": bool(scene.camera and scene.camera.name == obj.name),
        })

if payload.get("includeCameraSettings", True):
    for camera in bpy.data.cameras:
        result["cameraSettings"].append({
            "name": camera.name,
            "type": camera.type,
            "lens": float(camera.lens),
            "sensorWidth": float(camera.sensor_width),
            "sensorHeight": float(camera.sensor_height),
            "clipStart": float(camera.clip_start),
            "clipEnd": float(camera.clip_end),
            "orthoScale": float(getattr(camera, "ortho_scale", 0.0)),
        })

if payload.get("includeLights", True):
    for light in bpy.data.lights:
        result["lights"].append({
            "name": light.name,
            "type": light.type,
            "energy": float(light.energy),
        })

if payload.get("includeRenderSettings", True):
    result["renderSettings"] = {
        "engine": scene.render.engine,
        "resolutionX": int(scene.render.resolution_x),
        "resolutionY": int(scene.render.resolution_y),
        "resolutionPercentage": int(scene.render.resolution_percentage),
        "samples": int(getattr(scene.cycles, "samples", 0)),
        "camera": scene.camera.name if scene.camera else None,
    }

print("__PI_BLENDER_JSON_START__")
print(json.dumps(result))
print("__PI_BLENDER_JSON_END__")
`;
}

export async function getSceneInfoFromManifest(
	cwd: string,
	manifest: {
		workspacePath: string;
		blendPath: string;
	},
	options: Omit<SceneInfoOptions, "cwd" | "workspace">,
): Promise<SceneInfoResult> {
	const selection = resolveSceneInfoSelection({
		cwd,
		workspace: manifest.workspacePath,
		...options,
	});

	return await runBlenderJson<SceneInfoResult>({
		cwd,
		blendPath: manifest.blendPath,
		scriptSource: buildSceneInfoScript(),
		payload: {
			includeObjects: selection.includeObjects,
			includeCollections: selection.includeCollections,
			includeMaterials: selection.includeMaterials,
			includeCameras: selection.includeCameras,
			includeCameraSettings: selection.includeCameraSettings,
			includeLights: selection.includeLights,
			includeRenderSettings: selection.includeRenderSettings,
		},
		signal: options.signal,
		timeoutMs: 60_000,
	});
}

export async function blenderSceneInfo(options: SceneInfoOptions): Promise<SceneInfoResult> {
	const manifest = await loadWorkspaceManifest(options.cwd, options.workspace);
	const iteration = manifest.latestIteration > 0 ? manifest.latestIteration : 1;
	const { iterationDir } = getIterationPaths(manifest.workspacePath, iteration);
	await mkdir(iterationDir, { recursive: true });
	const result = await getSceneInfoFromManifest(options.cwd, manifest, options);
	const selection = resolveSceneInfoSelection(options);
	const sceneInfoResult: SceneInfoResult = {
		workspacePath: manifest.workspacePath,
		blendPath: manifest.blendPath,
		iteration,
		sceneInfoPath: join(iterationDir, "scene-info.json"),
		activeCameraName: result.activeCameraName,
		objects: result.objects,
		collections: result.collections,
		materials: result.materials,
		cameras: result.cameras,
		cameraSettings: result.cameraSettings,
		lights: result.lights,
		views: selection.includeViews ? Object.values(manifest.savedViews) : [],
		renderSettings: result.renderSettings,
	};
	await writeFile(sceneInfoResult.sceneInfoPath, JSON.stringify(sceneInfoResult, null, 2), "utf-8");
	return sceneInfoResult;
}
