import bpy
import math

# Clear existing objects
bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete()

def create_material(name, color, metallic=0.0, roughness=0.5):
    mat = bpy.data.materials.new(name=name)
    mat.use_nodes = True
    nodes = mat.node_tree.nodes
    bsdf = nodes.get("Principled BSDF")
    bsdf.inputs['Base Color'].default_value = color
    bsdf.inputs['Metallic'].default_value = metallic
    bsdf.inputs['Roughness'].default_value = roughness
    return mat

# Materials
wood_mat = create_material("Wood", (0.15, 0.08, 0.05, 1.0), 0.0, 0.4)
metal_mat = create_material("Metal", (0.02, 0.02, 0.02, 1.0), 1.0, 0.2)

# Tabletop
bpy.ops.mesh.primitive_cube_add(size=1, location=(0, 0, 0.4))
tabletop = bpy.context.active_object
tabletop.name = "Tabletop"
tabletop.scale = (1.2, 0.6, 0.04)
tabletop.data.materials.append(wood_mat)

# Add bevel to tabletop for better lighting
bpy.ops.object.modifier_add(type='BEVEL')
tabletop.modifiers["Bevel"].width = 0.005
tabletop.modifiers["Bevel"].segments = 3
bpy.ops.object.shade_smooth()

# Legs
leg_radius = 0.015
leg_height = 0.4
leg_positions = [
    (1.0, 0.5),
    (-1.0, 0.5),
    (1.0, -0.5),
    (-1.0, -0.5)
]

for i, pos in enumerate(leg_positions):
    # Position legs slightly inwards from corners
    x, y = pos[0]*0.5, pos[1]*0.5
    bpy.ops.mesh.primitive_cylinder_add(radius=leg_radius, depth=leg_height, location=(x, y, leg_height/2))
    leg = bpy.context.active_object
    leg.name = f"Leg_{i}"
    leg.data.materials.append(metal_mat)
    bpy.ops.object.shade_smooth()

# Finalize
OUTPUT_BLEND_PATH = "outputs/coffee_table_20260226_003552/model.blend"
bpy.ops.wm.save_as_mainfile(filepath=OUTPUT_BLEND_PATH)
