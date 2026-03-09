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
		expect(extension.tools.has("blender_log_critique")).toBe(true);
		expect(extension.handlers.has("before_agent_start")).toBe(true);
		expect(extension.handlers.has("resources_discover")).toBe(true);
		expect(extension.tools.get("blender_workspace_init")?.definition.description).toContain("auto-open");
		expect(extension.tools.get("blender_execute_python")?.definition.description).toContain("live bridge-enabled");
		expect(extension.tools.get("blender_render")?.definition.description).toContain("material preview");
	});

	it("allows blender_scene_info to target one or more categories", async () => {
		const [factory] = getBuiltInBlenderExtensionFactories("vibe-blender");
		const runtime = createExtensionRuntime();
		const extension = await loadExtensionFromFactory(factory, process.cwd(), createEventBus(), runtime, "<blender>");
		const sceneInfoTool = extension.tools.get("blender_scene_info");
		expect(sceneInfoTool).toBeDefined();
		const properties = sceneInfoTool?.definition.parameters.properties as Record<string, unknown>;
		expect(properties.categories).toBeDefined();
		expect(JSON.stringify(properties.categories)).toContain("views");
		expect(JSON.stringify(properties.categories)).toContain("cameraSettings");
	});

	it("allows blender_save_view to capture the live UI view into a dedicated camera", async () => {
		const [factory] = getBuiltInBlenderExtensionFactories("vibe-blender");
		const runtime = createExtensionRuntime();
		const extension = await loadExtensionFromFactory(factory, process.cwd(), createEventBus(), runtime, "<blender>");
		const saveViewTool = extension.tools.get("blender_save_view");
		expect(saveViewTool).toBeDefined();
		const properties = saveViewTool?.definition.parameters.properties as Record<string, unknown>;
		expect(properties.camera_name).toBeDefined();
		expect(JSON.stringify(properties.source)).toContain("current Blender UI view");
	});

	it("ships bundled Blender skills", () => {
		const skillsDir = getBundledBlenderSkillsDir();
		expect(existsSync(skillsDir)).toBe(true);
		expect(existsSync(`${skillsDir}/blender-create/SKILL.md`)).toBe(true);
		expect(existsSync(`${skillsDir}/blender-edit/SKILL.md`)).toBe(true);
		expect(existsSync(`${skillsDir}/blender-analyze/SKILL.md`)).toBe(true);
		expect(existsSync(`${skillsDir}/blender-with-reference/SKILL.md`)).toBe(true);
	});
});
