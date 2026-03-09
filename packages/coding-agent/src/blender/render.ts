import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { requestLiveBlenderRender } from "./bridge.js";
import type { RenderOptions, RenderResult } from "./types.js";
import { getSavedViewCameraObjectName, normalizeRenderOutputName, runBlenderJson } from "./utils.js";
import { getIterationPaths, loadWorkspaceManifest, writeManifest } from "./workspace.js";

function buildRenderScript(): string {
	return `
import bpy
import json
import os
import sys

payload = json.loads(sys.argv[sys.argv.index("--") + 1])
scene = bpy.context.scene

camera_name = payload.get("cameraName")
if camera_name:
    camera_object = bpy.data.objects.get(camera_name)
    if camera_object is None:
        raise RuntimeError(f"Camera not found: {camera_name}")
    scene.camera = camera_object

if scene.camera is None:
    fallback = bpy.data.objects.get("Camera")
    if fallback is not None:
        scene.camera = fallback

if scene.camera is None:
    raise RuntimeError("No camera available for rendering")

resolution = payload.get("resolution") or {}
scene.render.resolution_x = int(resolution.get("x", scene.render.resolution_x))
scene.render.resolution_y = int(resolution.get("y", scene.render.resolution_y))
scene.render.resolution_percentage = int(resolution.get("percentage", scene.render.resolution_percentage))

samples = payload.get("samples")
if samples is not None and hasattr(scene, "cycles"):
    scene.cycles.samples = int(samples)

output_path = payload["outputPath"]
os.makedirs(os.path.dirname(output_path), exist_ok=True)
scene.render.image_settings.file_format = "PNG"
scene.render.filepath = output_path
bpy.ops.render.render(write_still=True)

print("__PI_BLENDER_JSON_START__")
print(json.dumps({
    "outputPath": output_path,
    "cameraName": scene.camera.name if scene.camera else None,
    "resolution": {
        "x": int(scene.render.resolution_x),
        "y": int(scene.render.resolution_y),
        "percentage": int(scene.render.resolution_percentage),
    },
}))
print("__PI_BLENDER_JSON_END__")
`;
}

export async function blenderRender(options: RenderOptions): Promise<RenderResult> {
	const manifest = await loadWorkspaceManifest(options.cwd, options.workspace);
	const iteration = manifest.latestIteration > 0 ? manifest.latestIteration : 1;
	const { iterationDir, rendersDir } = getIterationPaths(manifest.workspacePath, iteration);
	await mkdir(iterationDir, { recursive: true });
	await mkdir(rendersDir, { recursive: true });

	const view = options.view ?? "active-camera";
	const savedView = manifest.savedViews[view];
	let cameraName: string | undefined;
	if (savedView) {
		cameraName = getSavedViewCameraObjectName(savedView) ?? undefined;
	} else if (view !== "active-camera") {
		cameraName = view;
	}

	const outputName = normalizeRenderOutputName(options.outputName);
	const outputPath = join(rendersDir, outputName);
	const logPath = join(iterationDir, "render.log");
	const mode = options.mode ?? "material-preview";

	const renderPayload =
		mode === "material-preview"
			? await requestLiveBlenderRender({
					blendPath: manifest.blendPath,
					cameraName,
					outputPath,
					resolution: options.resolution,
					samples: options.samples,
					mode,
					signal: options.signal,
					timeoutMs: 180_000,
				})
			: await runBlenderJson<{
					outputPath: string;
					cameraName: string | null;
					resolution: { x: number; y: number; percentage: number };
				}>({
					cwd: options.cwd,
					blendPath: manifest.blendPath,
					scriptSource: buildRenderScript(),
					payload: {
						cameraName,
						outputPath,
						resolution: options.resolution,
						samples: options.samples,
					},
					signal: options.signal,
					timeoutMs: 180_000,
				});

	await writeFile(logPath, JSON.stringify(renderPayload, null, 2), "utf-8");

	manifest.renderOutputs.push({
		path: renderPayload.outputPath,
		view,
		iteration,
		createdAt: new Date().toISOString(),
	});
	await writeManifest(manifest);

	return {
		workspacePath: manifest.workspacePath,
		blendPath: manifest.blendPath,
		iteration,
		outputPath: renderPayload.outputPath,
		logPath,
		view,
		resolution: renderPayload.resolution,
		mode,
	};
}
