import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { getBlenderBridgeDir } from "../config.js";
import { delay, fileExists, LIVE_BRIDGE_POLL_MS, LIVE_BRIDGE_TIMEOUT_MS } from "./utils.js";

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

export async function requestLiveBlenderCapture(options: {
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

export async function requestLiveBlenderExecutePython(options: {
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

export async function requestLiveBlenderOpenBlend(options: {
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

export async function requestLiveBlenderRender(options: {
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

export async function requestLiveBlenderSessionContext(options?: {
	signal?: AbortSignal;
	timeoutMs?: number;
}): Promise<{
	blendPath: string | null;
	isSaved: boolean;
	isDirty: boolean;
	scene: {
		name: string | null;
		availableScenes: string[];
		frameCurrent: number | null;
		activeCameraName: string | null;
	};
	selection: {
		activeObject: { name: string; type: string } | null;
		selectedObjects: Array<{ name: string; type: string }>;
		selectedObjectCount: number;
	};
	mode: {
		mode: string | null;
		activeObjectType: string | null;
	};
	viewport: {
		hasViewport: boolean;
		areaSize: number | null;
		viewPerspective: string | null;
		shadingType: string | null;
		cameraName: string | null;
		isCameraView: boolean;
	};
}> {
	return await requestLiveBlenderBridge({
		payload: {
			type: "get-session-context",
		},
		signal: options?.signal,
		timeoutMs: options?.timeoutMs,
	});
}
