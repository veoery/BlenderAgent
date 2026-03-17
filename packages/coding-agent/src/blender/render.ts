import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { requestLiveBlenderRender } from "./bridge.js";
import type {
	BlenderRenderEngine,
	BlenderRenderMethod,
	BlenderRenderViewSource,
	BlenderViewportShading,
	RenderOptions,
	RenderResult,
} from "./types.js";
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

render_engine = payload.get("renderEngine")
if render_engine:
    scene.render.engine = render_engine

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

interface NormalizedRenderConfig {
	renderMethod: BlenderRenderMethod;
	viewSource: BlenderRenderViewSource;
	viewportShading: BlenderViewportShading | null;
	renderEngine: BlenderRenderEngine | null;
}

function normalizeRenderConfig(options: RenderOptions): NormalizedRenderConfig {
	const renderMethod = options.renderMethod ?? "live";
	const viewSource = options.viewSource ?? "camera";

	if (renderMethod === "live") {
		if (options.renderEngine) {
			throw new Error('renderEngine is only valid when renderMethod is "background".');
		}

		const normalized: NormalizedRenderConfig = {
			renderMethod,
			viewSource,
			viewportShading: options.viewportShading ?? "material-preview",
			renderEngine: null,
		};
		return normalized;
	}

	if (options.viewportShading) {
		throw new Error('viewportShading is only valid when renderMethod is "live".');
	}
	if (viewSource === "current-view") {
		throw new Error('viewSource="current-view" is only supported when renderMethod is "live".');
	}

	const normalized: NormalizedRenderConfig = {
		renderMethod,
		viewSource: "camera",
		viewportShading: null,
		renderEngine: options.renderEngine ?? null,
	};
	return normalized;
}

function mapBackgroundRenderEngine(engine: BlenderRenderEngine | null): string | undefined {
	switch (engine) {
		case "eevee":
			return "BLENDER_EEVEE_NEXT";
		case "cycles":
			return "CYCLES";
		case "workbench":
			return "BLENDER_WORKBENCH";
		default:
			return undefined;
	}
}

export async function blenderRender(options: RenderOptions): Promise<RenderResult> {
	const manifest = await loadWorkspaceManifest(options.cwd, options.workspace);
	const iteration = manifest.latestIteration > 0 ? manifest.latestIteration : 1;
	const { iterationDir, rendersDir } = getIterationPaths(manifest.workspacePath, iteration);
	await mkdir(iterationDir, { recursive: true });
	await mkdir(rendersDir, { recursive: true });

	const outputName = normalizeRenderOutputName(options.outputName);
	const outputPath = join(rendersDir, outputName);
	const logPath = join(iterationDir, "render.log");
	const normalizedConfig = normalizeRenderConfig(options);
	const view = normalizedConfig.viewSource === "current-view" ? "current-view" : (options.view ?? "active-camera");

	if (normalizedConfig.viewSource === "current-view" && options.view) {
		throw new Error('Do not provide view when viewSource is "current-view".');
	}

	let cameraName: string | undefined;
	if (normalizedConfig.viewSource === "camera") {
		const savedView = manifest.savedViews[view];
		if (savedView) {
			cameraName = getSavedViewCameraObjectName(savedView) ?? undefined;
		} else if (view !== "active-camera") {
			cameraName = view;
		}
	}

	const renderPayload =
		normalizedConfig.renderMethod === "live"
			? await requestLiveBlenderRender({
					blendPath: manifest.blendPath,
					cameraName,
					outputPath,
					resolution: options.resolution,
					samples: options.samples,
					viewSource: normalizedConfig.viewSource,
					viewportShading: normalizedConfig.viewportShading ?? "material-preview",
					signal: options.signal,
					timeoutMs: 360_000,
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
						renderEngine: mapBackgroundRenderEngine(normalizedConfig.renderEngine),
						outputPath,
						resolution: options.resolution,
						samples: options.samples,
					},
					signal: options.signal,
					timeoutMs: 360_000,
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
		outputName,
		view,
		cameraName: renderPayload.cameraName,
		resolution: renderPayload.resolution,
		samples: options.samples ?? null,
		renderMethod: normalizedConfig.renderMethod,
		viewSource: normalizedConfig.viewSource,
		viewportShading: normalizedConfig.viewportShading,
		renderEngine: normalizedConfig.renderEngine,
	};
}
