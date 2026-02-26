# Modern Coffee Table script - Iteration 2

# 1. Clear scene
bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete()

# 2. Create Floor
bpy.ops.mesh.primitive_plane_add(size=10, location=(0, 0, 0))
floor = bpy.context.active_object
floor.name = "Floor"
floor_mat = bpy.data.materials.new(name="FloorMat")
floor_mat.use_nodes = True
floor_mat.node_tree.nodes.get("Principled BSDF").inputs["Base Color"].default_value = (0.1, 0.1, 0.1, 1.0)
floor.data.materials.append(floor_mat)

# 3. Create Table Top
# We want 1.2m x 0.8m x 0.05m.
# Cube size=1.0 has dimensions 1x1x1.
bpy.ops.mesh.primitive_cube_add(size=1.0, location=(0, 0, 0.4 + 0.025))
top = bpy.context.active_object
top.name = "TableTop"
top.scale = (1.2, 0.8, 0.05)
bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)

# Add bevel to top
bevel_mod = top.modifiers.new(name="Bevel", type='BEVEL')
bevel_mod.width = 0.01
bevel_mod.segments = 5

# 4. Create Legs
leg_width = 0.04
leg_height = 0.4
# Inset from edge: 1.2/2 - 0.05 = 0.55. 0.8/2 - 0.05 = 0.35.
leg_offset_x = 0.5
leg_offset_y = 0.3

positions = [
    (leg_offset_x, leg_offset_y),
    (leg_offset_x, -leg_offset_y),
    (-leg_offset_x, leg_offset_y),
    (-leg_offset_x, -leg_offset_y)
]

legs = []
for i, pos in enumerate(positions):
    bpy.ops.mesh.primitive_cube_add(size=1.0, location=(pos[0], pos[1], leg_height/2))
    leg = bpy.context.active_object
    leg.name = f"Leg_{i+1}"
    leg.scale = (leg_width, leg_width, leg_height)
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    legs.append(leg)

# 5. Materials
# Wood Material (Improved)
wood_mat = bpy.data.materials.new(name="WalnutWood")
wood_mat.use_nodes = True
bsdf = wood_mat.node_tree.nodes.get("Principled BSDF")
bsdf.inputs["Base Color"].default_value = (0.15, 0.08, 0.04, 1.0) # Dark brown
bsdf.inputs["Roughness"].default_value = 0.2
top.data.materials.append(wood_mat)

# Metal Material
metal_mat = bpy.data.materials.new(name="MatteBlackMetal")
metal_mat.use_nodes = True
bsdf_metal = metal_mat.node_tree.nodes.get("Principled BSDF")
bsdf_metal.inputs["Base Color"].default_value = (0.01, 0.01, 0.01, 1.0)
bsdf_metal.inputs["Metallic"].default_value = 1.0
bsdf_metal.inputs["Roughness"].default_value = 0.3
for leg in legs:
    leg.data.materials.append(metal_mat)

# 6. Save
bpy.ops.wm.save_as_mainfile(filepath=OUTPUT_BLEND_PATH)
