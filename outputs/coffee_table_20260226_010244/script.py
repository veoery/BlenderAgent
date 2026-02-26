import bpy
import math

# Clear scene
bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete()

def create_material(name, color, metallic=0.0, roughness=0.5):
    mat = bpy.data.materials.new(name=name)
    mat.use_nodes = True
    nodes = mat.node_tree.nodes
    bsdf = nodes.get("Principled BSDF")
    if bsdf:
        bsdf.inputs['Base Color'].default_value = color
        bsdf.inputs['Metallic'].default_value = metallic
        bsdf.inputs['Roughness'].default_value = roughness
    return mat

# Materials
wood_mat = create_material("Wood", (0.15, 0.08, 0.04, 1.0), metallic=0.0, roughness=0.8)
metal_mat = create_material("Metal", (0.02, 0.02, 0.02, 1.0), metallic=0.9, roughness=0.2)

# Dimensions
table_width = 1.2
table_depth = 0.6
table_height = 0.4
top_thickness = 0.04
leg_radius = 0.02

# Table Top
bpy.ops.mesh.primitive_cube_add(size=1.0)
table_top = bpy.context.active_object
table_top.name = "TableTop"
table_top.scale = (table_width / 2, table_depth / 2, top_thickness / 2)
table_top.location = (0, 0, table_height - top_thickness / 2)
table_top.data.materials.append(wood_mat)

# Add Bevel to top
bevel = table_top.modifiers.new(name="Bevel", type='BEVEL')
bevel.width = 0.01
bevel.segments = 5

# Table Legs
leg_positions = [
    (table_width/2 - 0.1, table_depth/2 - 0.1),
    (-table_width/2 + 0.1, table_depth/2 - 0.1),
    (table_width/2 - 0.1, -table_depth/2 + 0.1),
    (-table_width/2 + 0.1, -table_depth/2 + 0.1)
]

for i, pos in enumerate(leg_positions):
    bpy.ops.mesh.primitive_cylinder_add(radius=leg_radius, depth=table_height - top_thickness)
    leg = bpy.context.active_object
    leg.name = f"Leg_{i}"
    leg.location = (pos[0], pos[1], (table_height - top_thickness) / 2)
    leg.data.materials.append(metal_mat)
    
    # Slight angle for modern look
    angle = 0.05
    if pos[0] > 0:
        leg.rotation_euler[1] = angle
    else:
        leg.rotation_euler[1] = -angle
        
    if pos[1] > 0:
        leg.rotation_euler[0] = -angle
    else:
        leg.rotation_euler[0] = angle

# Save
try:
    save_path = OUTPUT_BLEND_PATH
except NameError:
    import os
    save_path = os.environ.get("OUTPUT_BLEND_PATH", "model.blend")
bpy.ops.wm.save_as_mainfile(filepath=save_path)
