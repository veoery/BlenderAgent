#!/usr/bin/env node
/**
 * CLI entry point for the refactored coding agent.
 * Uses main.ts with AgentSession and new mode modules.
 *
 * Test with: npx tsx src/cli-new.ts [args...]
 */
import { spawn } from "child_process";
import { APP_NAME, ENV_BLENDER_BRIDGE_DIR, getBlenderBridgeDir, getBundledBlenderBridgePath } from "./config.js";
import { main } from "./main.js";

const DEFAULT_BLENDER_PATH = "/Applications/Blender.app/Contents/MacOS/Blender";
const PACKAGE_COMMANDS = new Set(["install", "remove", "update", "list", "config"]);

function isTruthy(value: string | undefined): boolean {
	if (!value) return false;
	const normalized = value.trim().toLowerCase();
	return normalized === "1" || normalized === "true" || normalized === "yes" || normalized === "on";
}

function shouldLaunchBlender(args: string[], noBlenderFlag: boolean): boolean {
	if (APP_NAME !== "vibe-blender") return false;
	if (process.env.NODE_ENV === "test") return false;
	if (noBlenderFlag) return false;
	if (isTruthy(process.env.VIBE_BLENDER_NO_BLENDER)) return false;

	const firstArg = args[0];
	if (firstArg && PACKAGE_COMMANDS.has(firstArg)) return false;

	for (let i = 0; i < args.length; i++) {
		const arg = args[i];
		if (
			arg === "--help" ||
			arg === "-h" ||
			arg === "--version" ||
			arg === "-v" ||
			arg === "--list-models" ||
			arg === "--export" ||
			arg === "--print" ||
			arg === "-p"
		) {
			return false;
		}
		if (arg === "--mode" && i + 1 < args.length) {
			const mode = args[i + 1];
			if (mode === "json" || mode === "rpc") return false;
		}
	}

	return true;
}

function launchBlender(): void {
	const blenderPath = process.env.BLENDER_PATH || DEFAULT_BLENDER_PATH;
	const bridgeScriptPath = getBundledBlenderBridgePath();
	const bridgeDir = getBlenderBridgeDir();
	try {
		const child = spawn(blenderPath, ["--python", bridgeScriptPath], {
			detached: true,
			env: {
				...process.env,
				[ENV_BLENDER_BRIDGE_DIR]: bridgeDir,
			},
			stdio: "ignore",
		});
		child.unref();
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		console.error(`[vibe-blender] warning: failed to launch Blender from "${blenderPath}": ${message}`);
	}
}

const rawArgs = process.argv.slice(2);
const noBlenderFlag = rawArgs.includes("--no-blender");
const args = rawArgs.filter((arg) => arg !== "--no-blender");
if (noBlenderFlag) {
	process.env.VIBE_BLENDER_NO_BLENDER = "1";
}
if (shouldLaunchBlender(args, noBlenderFlag)) {
	launchBlender();
}

process.title = APP_NAME;

main(args);
