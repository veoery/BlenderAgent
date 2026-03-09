import { copyFile, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { requestLiveBlenderExecutePython } from "./bridge.js";
import type { ExecutePythonOptions, ExecutePythonResult } from "./types.js";
import { fileExists, normalizeUserPath } from "./utils.js";
import {
	ensureWorkspaceInitialized,
	ensureWorkspaceScriptExists,
	getIterationPaths,
	loadWorkspaceManifest,
	writeManifest,
} from "./workspace.js";

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
