import bpy
import math

# Clear existing objects
bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete()

def create_material(name, diffuse_color, roughness=0.5, metallic=0.0):
    mat = bpy.data.materials.new(name=name)
    mat.use_nodes = True
    nodes = mat.node_tree.nodes
    bsdf = nodes.get("Principled BSDF")
    bsdf.inputs['Base Color'].default_value = diffuse_color
    bsdf.inputs['Roughness'].default_value = roughness
    bsdf.inputs['Metallic'].default_value = metallic
    return mat

# Materials
wood_mat = create_material("Wood", (0.3, 0.15, 0.05, 1.0), roughness=0.8)
metal_mat = create_material("Metal", (0.02, 0.02, 0.02, 1.0), roughness=0.2, metallic=1.0)

# 1. Create Table Top
# Dimensions: 1.2m x 0.6m x 0.04m
bpy.ops.mesh.primitive_cube_add(size=1)
table_top = bpy.context.active_object
table_top.name = "TableTop"
table_top.scale = (1.2, 0.6, 0.04)
table_top.location = (0, 0, 0.4) # Height of 40cm
bpy.ops.object.transform_apply(scale=True)
table_top.data.materials.append(wood_mat)

# Add Bevel Modifier
bevel_mod = table_top.modifiers.new(name="Bevel", type='BEVEL')
bevel_mod.width = 0.005
bevel_mod.segments = 3

# 2. Create Legs
leg_radius = 0.015
leg_height = 0.4
# Slightly tapered legs look more "modern"
leg_positions = [
    (0.5, 0.2),
    (-0.5, 0.2),
    (0.5, -0.2),
    (-0.5, -0.2)
]

for i, (x, y) in enumerate(leg_positions):
    # Leg body
    bpy.ops.mesh.primitive_cylinder_add(radius=leg_radius, depth=leg_height)
    leg = bpy.context.active_object
    leg.name = f"Leg_{i}"
    leg.location = (x, y, leg_height / 2)
    leg.data.materials.append(metal_mat)
    
    # Bevel legs
    leg_bevel = leg.modifiers.new(name="Bevel", type='BEVEL')
    leg_bevel.width = 0.002
    leg_bevel.segments = 2

# Save the blend file
bpy.ops.wm.save_as_mainfile(filepath=OUTPUT_BLEND_PATH)
