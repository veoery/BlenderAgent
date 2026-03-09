import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { requestLiveBlenderOpenBlend } from "./bridge.js";
import type { BlenderWorkspaceManifest, WorkspaceInitOptions, WorkspaceInitResult } from "./types.js";
import {
	CRITIQUE_LOG_FILE,
	createWorkspaceId,
	fileExists,
	LIVE_BRIDGE_INIT_TIMEOUT_MS,
	MANIFEST_FILE,
	normalizeSavedView,
	normalizeUserPath,
	normalizeWorkspacePath,
	nowIso,
	runBlenderJson,
	WORKSPACE_SCRIPT_FILE,
} from "./utils.js";

export function getManifestPath(workspacePath: string): string {
	return join(workspacePath, MANIFEST_FILE);
}

export function getWorkspaceScriptPath(workspacePath: string): string {
	return join(workspacePath, WORKSPACE_SCRIPT_FILE);
}

export function getWorkspaceCritiqueLogPath(workspacePath: string): string {
	return join(workspacePath, CRITIQUE_LOG_FILE);
}

export async function readManifest(workspacePath: string): Promise<BlenderWorkspaceManifest | undefined> {
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

export async function writeManifest(manifest: BlenderWorkspaceManifest): Promise<void> {
	manifest.version = 2;
	manifest.updatedAt = nowIso();
	await writeFile(manifest.manifestPath, JSON.stringify(manifest, null, 2));
}

export async function ensureWorkspaceScriptExists(workspacePath: string): Promise<string> {
	const scriptPath = getWorkspaceScriptPath(workspacePath);
	if (!(await fileExists(scriptPath))) {
		await writeFile(scriptPath, "", "utf-8");
	}
	return scriptPath;
}

export async function ensureWorkspaceCritiqueLogExists(workspacePath: string): Promise<string> {
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

export async function ensureWorkspaceInitialized(options: WorkspaceInitOptions): Promise<WorkspaceInitResult> {
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

export function getIterationPaths(
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

export async function loadWorkspaceManifest(cwd: string, workspace: string): Promise<BlenderWorkspaceManifest> {
	const workspacePath = normalizeWorkspacePath(cwd, workspace);
	const manifest = await readManifest(workspacePath);
	if (!manifest) {
		throw new Error(`Workspace manifest not found: ${getManifestPath(workspacePath)}`);
	}
	return manifest;
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
