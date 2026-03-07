import { existsSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import { getBuiltInBlenderExtensionFactories, isVibeBlenderApp } from "../src/blender/extension.js";
import { getBundledBlenderSkillsDir } from "../src/blender/runtime.js";
import { createEventBus } from "../src/core/event-bus.js";
import { createExtensionRuntime, loadExtensionFromFactory } from "../src/core/extensions/loader.js";

describe("built-in blender extension", () => {
	afterEach(() => {
		delete process.env.BLENDER_PATH;
	});

	it("only activates for vibe-blender", () => {
		expect(isVibeBlenderApp("vibe-blender")).toBe(true);
		expect(isVibeBlenderApp("pi")).toBe(false);
		expect(getBuiltInBlenderExtensionFactories("pi")).toHaveLength(0);
		expect(getBuiltInBlenderExtensionFactories("vibe-blender")).toHaveLength(1);
	});

	it("registers Blender tools and workflow hooks", async () => {
		const [factory] = getBuiltInBlenderExtensionFactories("vibe-blender");
		const runtime = createExtensionRuntime();
		const extension = await loadExtensionFromFactory(factory, process.cwd(), createEventBus(), runtime, "<blender>");

		expect(extension.tools.has("blender_workspace_init")).toBe(true);
		expect(extension.tools.has("blender_execute_python")).toBe(true);
		expect(extension.tools.has("blender_scene_info")).toBe(true);
		expect(extension.tools.has("blender_save_view")).toBe(true);
		expect(extension.tools.has("blender_render")).toBe(true);
		expect(extension.handlers.has("before_agent_start")).toBe(true);
		expect(extension.handlers.has("resources_discover")).toBe(true);
	});

	it("ships bundled Blender skills", () => {
		const skillsDir = getBundledBlenderSkillsDir();
		expect(existsSync(skillsDir)).toBe(true);
		expect(existsSync(`${skillsDir}/create/SKILL.md`)).toBe(true);
		expect(existsSync(`${skillsDir}/edit/SKILL.md`)).toBe(true);
		expect(existsSync(`${skillsDir}/analyze/SKILL.md`)).toBe(true);
		expect(existsSync(`${skillsDir}/with-reference/SKILL.md`)).toBe(true);
	});
});
