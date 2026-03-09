import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { access, appendFile, copyFile, mkdir, mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { getBlenderAssetsDir, getBlenderBridgeDir } from "../config.js";
import { execCommand } from "../core/exec.js";

const DEFAULT_BLENDER_PATH = "/Applications/Blender.app/Contents/MacOS/Blender";
const MANIFEST_FILE = "blender-workspace.json";
const WORKSPACE_SCRIPT_FILE = "script.py";
const CRITIQUE_LOG_FILE = "critique.log";
const DEFAULT_RENDER_EXTENSION = ".png";
const LIVE_BRIDGE_TIMEOUT_MS = 30_000;
const LIVE_BRIDGE_INIT_TIMEOUT_MS = 5_000;
const LIVE_BRIDGE_POLL_MS = 200;

export interface BlenderSavedView {
	name: string;
	cameraObjectName: string;
	cameraSettingsName?: string;
	cameraName?: string;
	source: string;
	savedAt: string;
}

export interface BlenderRenderOutput {
	path: string;
	view: string;
	iteration: number;
	createdAt: string;
}

export interface BlenderWorkspaceManifest {
	version: 1 | 2;
	workspaceId: string;
	workspacePath: string;
	blendPath: string;
	manifestPath: string;
	createdAt: string;
	updatedAt: string;
	latestIteration: number;
	template: string;
	sourceBlendPath?: string;
	savedViews: Record<string, BlenderSavedView>;
	renderOutputs: BlenderRenderOutput[];
}

export interface WorkspaceInitOptions {
	cwd: string;
	workspace?: string;
	sourceBlend?: string;
	template?: string;
	continueExisting?: boolean;
	signal?: AbortSignal;
}

export interface WorkspaceInitResult {
	workspacePath: string;
	blendPath: string;
	manifestPath: string;
	iteration: number;
	created: boolean;
	openedInLiveBlender?: boolean;
	liveBlenderMessage?: string;
}

export interface ExecutePythonOptions {
	cwd: string;
	workspace: string;
	script_path: string;
	saveBefore?: boolean;
	saveAfter?: boolean;
	timeoutSeconds?: number;
	label?: string;
	signal?: AbortSignal;
}

export interface ExecutePythonResult {
	workspacePath: string;
	blendPath: string;
	manifestPath: string;
	iteration: number;
	sourceScriptPath: string;
	scriptPath: string;
	logPath: string;
	stdout: string;
	stderr: string;
	exitCode: number;
	changed: boolean;
}

export interface SceneInfoOptions {
	cwd: string;
	workspace: string;
	categories?: Array<
		"objects" | "collections" | "materials" | "cameras" | "cameraSettings" | "lights" | "views" | "renderSettings"
	>;
	includeObjects?: boolean;
	includeCollections?: boolean;
	includeMaterials?: boolean;
	includeCameras?: boolean;
	includeCameraSettings?: boolean;
	includeLights?: boolean;
	includeRenderSettings?: boolean;
	signal?: AbortSignal;
}

export interface SceneInfoResult {
	workspacePath: string;
	blendPath: string;
	iteration: number;
	sceneInfoPath: string;
	activeCameraName: string | null;
	objects: Array<Record<string, unknown>>;
	collections: Array<Record<string, unknown>>;
	materials: Array<Record<string, unknown>>;
	cameras: Array<Record<string, unknown>>;
	cameraSettings: Array<Record<string, unknown>>;
	lights: Array<Record<string, unknown>>;
	views: BlenderSavedView[];
	renderSettings: Record<string, unknown> | null;
}

interface SceneInfoSelection {
	includeObjects: boolean;
	includeCollections: boolean;
	includeMaterials: boolean;
	includeCameras: boolean;
	includeCameraSettings: boolean;
	includeLights: boolean;
	includeViews: boolean;
	includeRenderSettings: boolean;
}

export interface SaveViewOptions {
	cwd: string;
	workspace: string;
	name: string;
	source: string;
	camera_name?: string;
	signal?: AbortSignal;
}

export interface SaveViewResult {
	workspacePath: string;
	manifestPath: string;
	savedView: BlenderSavedView;
}

export interface RenderOptions {
	cwd: string;
	workspace: string;
	view?: string;
	resolution?: {
		x: number;
		y: number;
		percentage?: number;
	};
	samples?: number;
	outputName?: string;
	mode?: string;
	signal?: AbortSignal;
}

export interface RenderResult {
	workspacePath: string;
	blendPath: string;
	iteration: number;
	outputPath: string;
	logPath: string;
	view: string;
	resolution: { x: number; y: number; percentage: number };
	mode: string;
}

export interface CritiqueLogOptions {
	cwd: string;
	workspace: string;
	iteration?: number;
	accuracy: number;
	geometry: number;
	materials: number;
	completeness: number;
	quality: number;
	issues: string[];
	nextAction: string;
}

export interface CritiqueLogResult {
	workspacePath: string;
	critiqueLogPath: string;
	entry: {
		iteration: number;
		score: number;
		accuracy: number;
		geometry: number;
		materials: number;
		completeness: number;
		quality: number;
		issues: string[];
		nextAction: string;
		loggedAt: string;
		shouldPresent: boolean;
	};
}

interface BlenderRunResult {
	stdout: string;
	stderr: string;
	code: number;
}

interface RunBlenderJsonOptions {
	cwd: string;
	blendPath?: string;
	scriptSource: string;
	payload: Record<string, unknown>;
	timeoutMs?: number;
	signal?: AbortSignal;
}

function nowIso(): string {
	return new Date().toISOString();
}

function createWorkspaceId(): string {
	const now = new Date();
	const pad = (value: number) => String(value).padStart(2, "0");
	return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(
		now.getMinutes(),
	)}${pad(now.getSeconds())}`;
}

function resolveBlenderCommand(): string {
	const configured = process.env.BLENDER_PATH?.trim();
	if (configured) {
		return configured;
	}
	return existsSync(DEFAULT_BLENDER_PATH) ? DEFAULT_BLENDER_PATH : "blender";
}

function getManifestPath(workspacePath: string): string {
	return join(workspacePath, MANIFEST_FILE);
}

function getWorkspaceScriptPath(workspacePath: string): string {
	return join(workspacePath, WORKSPACE_SCRIPT_FILE);
}

function getWorkspaceCritiqueLogPath(workspacePath: string): string {
	return join(workspacePath, CRITIQUE_LOG_FILE);
}

function normalizeWorkspacePath(cwd: string, workspace?: string): string {
	if (!workspace || workspace.trim().length === 0) {
		return resolve(cwd, "outputs", createWorkspaceId());
	}
	if (isAbsolute(workspace)) {
		return workspace;
	}
	return resolve(cwd, workspace);
}

function normalizeUserPath(cwd: string, filePath: string): string {
	return isAbsolute(filePath) ? filePath : resolve(cwd, filePath);
}

async function fileExists(filePath: string): Promise<boolean> {
	try {
		await access(filePath);
		return true;
	} catch {
		return false;
	}
}

function getSavedViewCameraObjectName(savedView: BlenderSavedView): string | null {
	if (typeof savedView.cameraObjectName === "string" && savedView.cameraObjectName.length > 0) {
		return savedView.cameraObjectName;
	}
	return typeof savedView.cameraName === "string" && savedView.cameraName.length > 0 ? savedView.cameraName : null;
}

function normalizeSavedView(savedView: BlenderSavedView): BlenderSavedView {
	const cameraObjectName = getSavedViewCameraObjectName(savedView);
	if (!cameraObjectName) {
		throw new Error(`Saved view "${savedView.name}" does not reference a camera object.`);
	}
	return {
		name: savedView.name,
		cameraObjectName,
		cameraSettingsName: savedView.cameraSettingsName,
		cameraName: savedView.cameraName,
		source: savedView.source,
		savedAt: savedView.savedAt,
	};
}

async function readManifest(workspacePath: string): Promise<BlenderWorkspaceManifest | undefined> {
	const manifestPath = getManifestPath(workspacePath);
	if (!(await fileExists(manifestPath))) {
		return undefined;
	}
	const raw = await readFile(manifestPath, "utf-8");
	const parsed = JSON.parse(raw) as BlenderWorkspaceManifest;
	const savedViews = Object.fromEntries(
		Object.entries(parsed.savedViews ?? {}).map(([name, savedView]) => [name, normalizeSavedView(savedView)]),
	);
	return {
		...parsed,
		savedViews,
		renderOutputs: parsed.renderOutputs ?? [],
	};
}

async function writeManifest(manifest: BlenderWorkspaceManifest): Promise<void> {
	manifest.version = 2;
	manifest.updatedAt = nowIso();
	await writeFile(manifest.manifestPath, JSON.stringify(manifest, null, 2));
}

async function ensureWorkspaceScriptExists(workspacePath: string): Promise<string> {
	const scriptPath = getWorkspaceScriptPath(workspacePath);
	if (!(await fileExists(scriptPath))) {
		await writeFile(scriptPath, "", "utf-8");
	}
	return scriptPath;
}

async function ensureWorkspaceCritiqueLogExists(workspacePath: string): Promise<string> {
	const critiqueLogPath = getWorkspaceCritiqueLogPath(workspacePath);
	if (!(await fileExists(critiqueLogPath))) {
		await writeFile(critiqueLogPath, "", "utf-8");
	}
	return critiqueLogPath;
}

async function createBlankBlend(blendPath: string, cwd: string, signal?: AbortSignal): Promise<void> {
	const script = `
import bpy
import json
import sys

payload = json.loads(sys.argv[sys.argv.index("--") + 1])
bpy.ops.wm.save_as_mainfile(filepath=payload["blendPath"])
print("__PI_BLENDER_JSON_START__")
print(json.dumps({"blendPath": payload["blendPath"]}))
print("__PI_BLENDER_JSON_END__")
`;
	await runBlenderJson({
		cwd,
		scriptSource: script,
		payload: { blendPath },
		signal,
	});
}

async function ensureWorkspaceInitialized(options: WorkspaceInitOptions): Promise<WorkspaceInitResult> {
	const workspacePath = normalizeWorkspacePath(options.cwd, options.workspace);
	const manifestPath = getManifestPath(workspacePath);
	const blendPath = join(workspacePath, "model.blend");
	const template = options.template ?? "blank";

	await mkdir(workspacePath, { recursive: true });

	const existingManifest = await readManifest(workspacePath);
	if (existingManifest) {
		await ensureWorkspaceScriptExists(workspacePath);
		await ensureWorkspaceCritiqueLogExists(workspacePath);
		return {
			workspacePath,
			blendPath: existingManifest.blendPath,
			manifestPath,
			iteration: existingManifest.latestIteration,
			created: false,
		};
	}

	if (options.continueExisting) {
		throw new Error(`Workspace does not exist: ${workspacePath}`);
	}

	if (options.sourceBlend) {
		await copyFile(normalizeUserPath(options.cwd, options.sourceBlend), blendPath);
	} else {
		if (template !== "blank") {
			throw new Error(`Unsupported Blender template: ${template}`);
		}
		await createBlankBlend(blendPath, options.cwd, options.signal);
	}

	const manifest: BlenderWorkspaceManifest = {
		version: 2,
		workspaceId: createWorkspaceId(),
		workspacePath,
		blendPath,
		manifestPath,
		createdAt: nowIso(),
		updatedAt: nowIso(),
		latestIteration: 0,
		template,
		sourceBlendPath: options.sourceBlend ? normalizeUserPath(options.cwd, options.sourceBlend) : undefined,
		savedViews: {},
		renderOutputs: [],
	};
	await writeManifest(manifest);
	await ensureWorkspaceScriptExists(workspacePath);
	await ensureWorkspaceCritiqueLogExists(workspacePath);

	return {
		workspacePath,
		blendPath,
		manifestPath,
		iteration: 0,
		created: true,
	};
}

function getIterationPaths(
	workspacePath: string,
	iteration: number,
): {
	iterationDir: string;
	rendersDir: string;
} {
	const iterationDir = join(workspacePath, `iteration_${String(iteration).padStart(2, "0")}`);
	return {
		iterationDir,
		rendersDir: join(iterationDir, "renders"),
	};
}

async function writeJsonTempFile(prefix: string, contents: string): Promise<string> {
	const tempDir = await mkdtemp(join(tmpdir(), prefix));
	const filePath = join(tempDir, "script.py");
	await writeFile(filePath, contents, "utf-8");
	return filePath;
}

async function cleanupTempFile(filePath: string): Promise<void> {
	await rm(dirname(filePath), { recursive: true, force: true });
}

function getLiveBridgePaths(): {
	bridgeDir: string;
	requestsDir: string;
	responsesDir: string;
} {
	const bridgeDir = getBlenderBridgeDir();
	return {
		bridgeDir,
		requestsDir: join(bridgeDir, "requests"),
		responsesDir: join(bridgeDir, "responses"),
	};
}

async function delay(ms: number, signal?: AbortSignal): Promise<void> {
	if (signal?.aborted) {
		throw signal.reason instanceof Error ? signal.reason : new Error("Operation aborted.");
	}
	if (!signal) {
		await new Promise<void>((resolveDelay) => {
			setTimeout(resolveDelay, ms);
		});
		return;
	}
	const abortSignal = signal;

	await new Promise<void>((resolveDelay, rejectDelay) => {
		const timeout = setTimeout(() => {
			abortSignal.removeEventListener("abort", onAbort);
			resolveDelay();
		}, ms);

		function onAbort(): void {
			clearTimeout(timeout);
			abortSignal.removeEventListener("abort", onAbort);
			rejectDelay(abortSignal.reason instanceof Error ? abortSignal.reason : new Error("Operation aborted."));
		}

		abortSignal.addEventListener("abort", onAbort, { once: true });
	});
}

async function requestLiveBlenderBridge<T>(options: {
	payload: Record<string, unknown>;
	signal?: AbortSignal;
	timeoutMs?: number;
}): Promise<T> {
	const { requestsDir, responsesDir } = getLiveBridgePaths();
	await mkdir(requestsDir, { recursive: true });
	await mkdir(responsesDir, { recursive: true });

	const requestId = randomUUID();
	const requestPath = join(requestsDir, `${requestId}.json`);
	const responsePath = join(responsesDir, `${requestId}.json`);
	const tempRequestPath = join(requestsDir, `${requestId}.tmp`);
	await writeFile(
		tempRequestPath,
		JSON.stringify(
			{
				id: requestId,
				...options.payload,
			},
			null,
			2,
		),
		"utf-8",
	);
	await rename(tempRequestPath, requestPath);

	const deadline = Date.now() + (options.timeoutMs ?? LIVE_BRIDGE_TIMEOUT_MS);
	while (Date.now() < deadline) {
		if (await fileExists(responsePath)) {
			const responseRaw = await readFile(responsePath, "utf-8");
			await rm(responsePath, { force: true });
			const response = JSON.parse(responseRaw) as
				| { ok: true; result: T }
				| { ok: false; error?: string; traceback?: string };
			if (!response.ok) {
				const details = response.traceback ? `\n\n${response.traceback}` : "";
				throw new Error(`${response.error ?? "Live Blender bridge request failed."}${details}`);
			}
			return response.result;
		}
		await delay(LIVE_BRIDGE_POLL_MS, options.signal);
	}

	await rm(requestPath, { force: true });
	throw new Error(
		"Timed out waiting for the live Blender bridge. Keep Blender open with the vibe-blender bridge script loaded and the workspace .blend open in the UI.",
	);
}

async function requestLiveBlenderCapture(options: {
	blendPath: string;
	viewName: string;
	cameraObjectName: string;
	signal?: AbortSignal;
	timeoutMs?: number;
}): Promise<{ cameraObjectName: string; cameraSettingsName: string | null; activeCameraName: string | null }> {
	return await requestLiveBlenderBridge({
		payload: {
			type: "capture-view",
			blendPath: options.blendPath,
			viewName: options.viewName,
			cameraObjectName: options.cameraObjectName,
			cameraSettingsName: `${options.cameraObjectName}.settings`,
		},
		signal: options.signal,
		timeoutMs: options.timeoutMs,
	});
}

async function requestLiveBlenderExecutePython(options: {
	blendPath: string;
	workspacePath: string;
	iterationPath: string;
	userScriptPath: string;
	saveBeforePath?: string;
	saveAfter: boolean;
	label?: string;
	signal?: AbortSignal;
	timeoutMs?: number;
}): Promise<{ stdout: string; stderr: string; exitCode: number; changed: boolean }> {
	return await requestLiveBlenderBridge({
		payload: {
			type: "execute-python",
			blendPath: options.blendPath,
			workspacePath: options.workspacePath,
			iterationPath: options.iterationPath,
			userScriptPath: options.userScriptPath,
			saveBeforePath: options.saveBeforePath,
			saveAfter: options.saveAfter,
			label: options.label,
		},
		signal: options.signal,
		timeoutMs: options.timeoutMs,
	});
}

async function requestLiveBlenderOpenBlend(options: {
	blendPath: string;
	signal?: AbortSignal;
	timeoutMs?: number;
}): Promise<{ blendPath: string }> {
	return await requestLiveBlenderBridge({
		payload: {
			type: "open-blend",
			blendPath: options.blendPath,
		},
		signal: options.signal,
		timeoutMs: options.timeoutMs,
	});
}

async function requestLiveBlenderRender(options: {
	blendPath: string;
	cameraName?: string;
	outputPath: string;
	resolution?: {
		x: number;
		y: number;
		percentage?: number;
	};
	samples?: number;
	mode: string;
	signal?: AbortSignal;
	timeoutMs?: number;
}): Promise<{
	outputPath: string;
	cameraName: string | null;
	resolution: { x: number; y: number; percentage: number };
	mode: string;
}> {
	return await requestLiveBlenderBridge({
		payload: {
			type: "render",
			blendPath: options.blendPath,
			cameraName: options.cameraName,
			outputPath: options.outputPath,
			resolution: options.resolution,
			samples: options.samples,
			mode: options.mode,
		},
		signal: options.signal,
		timeoutMs: options.timeoutMs,
	});
}

function parseJsonBlock(stdout: string): unknown {
	const startMarker = "__PI_BLENDER_JSON_START__";
	const endMarker = "__PI_BLENDER_JSON_END__";
	const start = stdout.indexOf(startMarker);
	const end = stdout.indexOf(endMarker);
	if (start === -1 || end === -1 || end <= start) {
		throw new Error(`Failed to parse Blender JSON output.\n\n${stdout}`);
	}
	const payload = stdout.slice(start + startMarker.length, end).trim();
	return JSON.parse(payload);
}

async function runBlenderProcess(options: {
	cwd: string;
	blendPath?: string;
	scriptPath: string;
	payload: Record<string, unknown>;
	timeoutMs?: number;
	signal?: AbortSignal;
}): Promise<BlenderRunResult> {
	const blenderCommand = resolveBlenderCommand();
	const args = options.blendPath
		? ["--background", options.blendPath, "--python", options.scriptPath, "--", JSON.stringify(options.payload)]
		: ["--background", "--factory-startup", "--python", options.scriptPath, "--", JSON.stringify(options.payload)];

	const result = await execCommand(blenderCommand, args, options.cwd, {
		signal: options.signal,
		timeout: options.timeoutMs,
	});

	return {
		stdout: result.stdout,
		stderr: result.stderr,
		code: result.code,
	};
}

async function runBlenderJson<T>(options: RunBlenderJsonOptions): Promise<T> {
	const scriptPath = await writeJsonTempFile("vibe-blender-", options.scriptSource);
	try {
		const result = await runBlenderProcess({
			cwd: options.cwd,
			blendPath: options.blendPath,
			scriptPath,
			payload: options.payload,
			timeoutMs: options.timeoutMs,
			signal: options.signal,
		});
		if (result.code !== 0) {
			throw new Error(result.stderr.trim() || result.stdout.trim() || `Blender exited with code ${result.code}`);
		}
		return parseJsonBlock(result.stdout) as T;
	} finally {
		await cleanupTempFile(scriptPath);
	}
}

async function loadWorkspaceManifest(cwd: string, workspace: string): Promise<BlenderWorkspaceManifest> {
	const workspacePath = normalizeWorkspacePath(cwd, workspace);
	const manifest = await readManifest(workspacePath);
	if (!manifest) {
		throw new Error(`Workspace manifest not found: ${getManifestPath(workspacePath)}`);
	}
	return manifest;
}

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

async function getSceneInfoFromManifest(
	cwd: string,
	manifest: BlenderWorkspaceManifest,
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

function getStringRecordValue(record: Record<string, unknown>, key: string): string | null {
	const value = record[key];
	return typeof value === "string" ? value : null;
}

function normalizeRenderOutputName(name?: string): string {
	if (!name || name.trim().length === 0) {
		return `render${DEFAULT_RENDER_EXTENSION}`;
	}
	return name.endsWith(DEFAULT_RENDER_EXTENSION) ? name : `${name}${DEFAULT_RENDER_EXTENSION}`;
}

export function getBundledBlenderSkillsDir(): string {
	return join(getBlenderAssetsDir(), "skills");
}

export async function blenderWorkspaceInit(options: WorkspaceInitOptions): Promise<WorkspaceInitResult> {
	const result = await ensureWorkspaceInitialized(options);
	try {
		await requestLiveBlenderOpenBlend({
			blendPath: result.blendPath,
			signal: options.signal,
			timeoutMs: LIVE_BRIDGE_INIT_TIMEOUT_MS,
		});
		return {
			...result,
			openedInLiveBlender: true,
			liveBlenderMessage: "Opened workspace blend in the live Blender session.",
		};
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		return {
			...result,
			openedInLiveBlender: false,
			liveBlenderMessage: `Workspace created, but the live Blender session did not open it automatically: ${message}`,
		};
	}
}

export async function blenderExecutePython(options: ExecutePythonOptions): Promise<ExecutePythonResult> {
	const initResult = await ensureWorkspaceInitialized({
		cwd: options.cwd,
		workspace: options.workspace,
		continueExisting: true,
		signal: options.signal,
	});
	const manifest = await loadWorkspaceManifest(options.cwd, options.workspace);
	const iteration = manifest.latestIteration + 1;
	const { iterationDir } = getIterationPaths(manifest.workspacePath, iteration);
	await mkdir(iterationDir, { recursive: true });

	const workspaceScriptPath = await ensureWorkspaceScriptExists(manifest.workspacePath);
	const sourceScriptPath = normalizeUserPath(options.cwd, options.script_path);
	if (sourceScriptPath !== workspaceScriptPath) {
		throw new Error(
			`blender_execute_python expects script_path to point to the workspace root script: ${workspaceScriptPath}`,
		);
	}
	if (!(await fileExists(sourceScriptPath))) {
		throw new Error(`Blender script not found: ${sourceScriptPath}`);
	}
	const scriptPath = join(iterationDir, "script.py");
	const logPath = join(iterationDir, "blender.log");
	await copyFile(sourceScriptPath, scriptPath);

	const result = await requestLiveBlenderExecutePython({
		blendPath: manifest.blendPath,
		workspacePath: manifest.workspacePath,
		iterationPath: iterationDir,
		userScriptPath: scriptPath,
		saveBeforePath: options.saveBefore ? join(iterationDir, "model.before.blend") : undefined,
		saveAfter: options.saveAfter ?? true,
		label: options.label,
		timeoutMs: (options.timeoutSeconds ?? 120) * 1000,
		signal: options.signal,
	});

	await writeFile(logPath, `${result.stdout}${result.stderr}`, "utf-8");
	if (result.exitCode !== 0) {
		throw new Error(result.stderr.trim() || result.stdout.trim() || `Blender exited with code ${result.exitCode}`);
	}

	manifest.latestIteration = iteration;
	await writeManifest(manifest);

	return {
		workspacePath: initResult.workspacePath,
		blendPath: initResult.blendPath,
		manifestPath: initResult.manifestPath,
		iteration,
		sourceScriptPath,
		scriptPath,
		logPath,
		stdout: result.stdout,
		stderr: result.stderr,
		exitCode: result.exitCode,
		changed: result.changed,
	};
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

export async function blenderSaveView(options: SaveViewOptions): Promise<SaveViewResult> {
	const manifest = await loadWorkspaceManifest(options.cwd, options.workspace);
	let cameraObjectName: string | null = null;
	let cameraSettingsName: string | null = null;

	if (options.source === "active-camera") {
		const captureCameraName = options.camera_name?.trim() || options.name;
		const captureResult = await requestLiveBlenderCapture({
			blendPath: manifest.blendPath,
			viewName: options.name,
			cameraObjectName: captureCameraName,
			signal: options.signal,
		});
		cameraObjectName = captureResult.cameraObjectName;
		cameraSettingsName = captureResult.cameraSettingsName;
	} else {
		const sceneInfo = await getSceneInfoFromManifest(options.cwd, manifest, {
			includeObjects: false,
			includeCollections: false,
			includeMaterials: false,
			includeCameras: true,
			includeCameraSettings: false,
			includeLights: false,
			includeRenderSettings: false,
			signal: options.signal,
		});
		for (const camera of sceneInfo.cameras) {
			const candidate = getStringRecordValue(camera, "name");
			if (candidate && candidate === options.source) {
				cameraObjectName = candidate;
				cameraSettingsName = getStringRecordValue(camera, "cameraSettingsName");
				break;
			}
		}
	}

	if (!cameraObjectName) {
		throw new Error(`Unable to resolve view source "${options.source}" to a camera in ${manifest.blendPath}`);
	}

	const savedView: BlenderSavedView = {
		name: options.name,
		cameraObjectName,
		cameraSettingsName: cameraSettingsName ?? undefined,
		source: options.source,
		savedAt: nowIso(),
	};
	manifest.savedViews[options.name] = savedView;
	await writeManifest(manifest);

	return {
		workspacePath: manifest.workspacePath,
		manifestPath: manifest.manifestPath,
		savedView,
	};
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

	const renderOutput: BlenderRenderOutput = {
		path: renderPayload.outputPath,
		view,
		iteration,
		createdAt: nowIso(),
	};
	manifest.renderOutputs.push(renderOutput);
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

function validateCritiqueScore(name: string, value: number): void {
	if (!Number.isFinite(value) || value < 0 || value > 2) {
		throw new Error(`Critique score "${name}" must be a number between 0 and 2.`);
	}
}

export async function blenderLogCritique(options: CritiqueLogOptions): Promise<CritiqueLogResult> {
	validateCritiqueScore("accuracy", options.accuracy);
	validateCritiqueScore("geometry", options.geometry);
	validateCritiqueScore("materials", options.materials);
	validateCritiqueScore("completeness", options.completeness);
	validateCritiqueScore("quality", options.quality);

	const manifest = await loadWorkspaceManifest(options.cwd, options.workspace);
	const critiqueLogPath = await ensureWorkspaceCritiqueLogExists(manifest.workspacePath);
	const iteration = options.iteration ?? manifest.latestIteration;
	const score = options.accuracy + options.geometry + options.materials + options.completeness + options.quality;
	const loggedAt = nowIso();
	const shouldPresent = score >= 8;
	const entry = {
		iteration,
		score,
		accuracy: options.accuracy,
		geometry: options.geometry,
		materials: options.materials,
		completeness: options.completeness,
		quality: options.quality,
		issues: options.issues,
		nextAction: options.nextAction,
		loggedAt,
		shouldPresent,
	};

	const logBlock = [
		`[${loggedAt}] iteration_${String(iteration).padStart(2, "0")}`,
		`Score: ${score}/10`,
		`Accuracy: ${options.accuracy}/2`,
		`Geometry & Proportions: ${options.geometry}/2`,
		`Materials & Appearance: ${options.materials}/2`,
		`Completeness: ${options.completeness}/2`,
		`Quality: ${options.quality}/2`,
		"Issues:",
		...(options.issues.length > 0 ? options.issues.map((issue) => `- ${issue}`) : ["- none"]),
		`Next action: ${options.nextAction}`,
		shouldPresent ? "Decision: present to user" : "Decision: continue iterating",
		"",
	].join("\n");

	await appendFile(critiqueLogPath, logBlock, "utf-8");

	return {
		workspacePath: manifest.workspacePath,
		critiqueLogPath,
		entry,
	};
}
