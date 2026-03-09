import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { access, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";
import { getBlenderAssetsDir } from "../config.js";
import { execCommand } from "../core/exec.js";
import type { BlenderRunResult, BlenderSavedView, RunBlenderJsonOptions } from "./types.js";

const DEFAULT_BLENDER_PATH = "/Applications/Blender.app/Contents/MacOS/Blender";
export const MANIFEST_FILE = "blender-workspace.json";
export const WORKSPACE_SCRIPT_FILE = "script.py";
export const CRITIQUE_LOG_FILE = "critique.log";
export const DEFAULT_RENDER_EXTENSION = ".png";
export const LIVE_BRIDGE_TIMEOUT_MS = 30_000;
export const LIVE_BRIDGE_INIT_TIMEOUT_MS = 5_000;
export const LIVE_BRIDGE_POLL_MS = 200;

export function nowIso(): string {
	return new Date().toISOString();
}

export function createWorkspaceId(): string {
	const now = new Date();
	const pad = (value: number) => String(value).padStart(2, "0");
	return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(
		now.getMinutes(),
	)}${pad(now.getSeconds())}`;
}

export function resolveBlenderCommand(): string {
	const configured = process.env.BLENDER_PATH?.trim();
	if (configured) {
		return configured;
	}
	return existsSync(DEFAULT_BLENDER_PATH) ? DEFAULT_BLENDER_PATH : "blender";
}

export function normalizeWorkspacePath(cwd: string, workspace?: string): string {
	if (!workspace || workspace.trim().length === 0) {
		return resolve(cwd, "outputs", createWorkspaceId());
	}
	if (isAbsolute(workspace)) {
		return workspace;
	}
	return resolve(cwd, workspace);
}

export function normalizeUserPath(cwd: string, filePath: string): string {
	return isAbsolute(filePath) ? filePath : resolve(cwd, filePath);
}

export async function fileExists(filePath: string): Promise<boolean> {
	try {
		await access(filePath);
		return true;
	} catch {
		return false;
	}
}

export function getSavedViewCameraObjectName(savedView: BlenderSavedView): string | null {
	if (typeof savedView.cameraObjectName === "string" && savedView.cameraObjectName.length > 0) {
		return savedView.cameraObjectName;
	}
	return typeof savedView.cameraName === "string" && savedView.cameraName.length > 0 ? savedView.cameraName : null;
}

export function normalizeSavedView(savedView: BlenderSavedView): BlenderSavedView {
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

export async function writeJsonTempFile(prefix: string, contents: string): Promise<string> {
	const filePath = join(tmpdir(), `${prefix}${randomUUID()}.py`);
	await writeFile(filePath, contents, "utf-8");
	return filePath;
}

export async function cleanupTempFile(filePath: string): Promise<void> {
	await rm(filePath, { force: true });
}

export function parseJsonBlock(stdout: string): unknown {
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

export async function runBlenderProcess(options: {
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

export async function runBlenderJson<T>(options: RunBlenderJsonOptions): Promise<T> {
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

export async function delay(ms: number, signal?: AbortSignal): Promise<void> {
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

export function getStringRecordValue(record: Record<string, unknown>, key: string): string | null {
	const value = record[key];
	return typeof value === "string" ? value : null;
}

export function normalizeRenderOutputName(name?: string): string {
	if (!name || name.trim().length === 0) {
		return `render${DEFAULT_RENDER_EXTENSION}`;
	}
	return name.endsWith(DEFAULT_RENDER_EXTENSION) ? name : `${name}${DEFAULT_RENDER_EXTENSION}`;
}

export function getBundledBlenderSkillsDir(): string {
	return join(getBlenderAssetsDir(), "skills");
}
