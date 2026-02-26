import bpy
import math

# Clear scene
bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete()

def create_material(name, color, roughness=0.5, metallic=0.0):
    mat = bpy.data.materials.new(name=name)
    mat.use_nodes = True
    nodes = mat.node_tree.nodes
    bsdf = nodes.get("Principled BSDF")
    if bsdf:
        bsdf.inputs['Base Color'].default_value = color
        bsdf.inputs['Roughness'].default_value = roughness
        bsdf.inputs['Metallic'].default_value = metallic
    return mat

# Materials
wood_mat = create_material("Wood", (0.35, 0.2, 0.1, 1.0), roughness=0.6)
metal_mat = create_material("BlackMetal", (0.02, 0.02, 0.02, 1.0), roughness=0.1, metallic=1.0)

# Table Top
bpy.ops.mesh.primitive_cube_add(size=1, location=(0, 0, 0.375))
table_top = bpy.context.active_object
table_top.name = "TableTop"
table_top.scale = (1.2, 0.6, 0.05)
table_top.data.materials.append(wood_mat)
bpy.ops.object.transform_apply(scale=True)
# Add bevel
bevel = table_top.modifiers.new(name="Bevel", type='BEVEL')
bevel.width = 0.005
bevel.segments = 5

# Frame Leg
def create_frame_leg(x_pos):
    parts = []
    
    # Top bar
    bpy.ops.mesh.primitive_cube_add(size=1, location=(x_pos, 0, 0.34))
    t = bpy.context.active_object
    t.scale = (0.04, 0.6, 0.02)
    parts.append(t)
    
    # Bottom bar
    bpy.ops.mesh.primitive_cube_add(size=1, location=(x_pos, 0, 0.02))
    b = bpy.context.active_object
    b.scale = (0.04, 0.6, 0.02)
    parts.append(b)
    
    # Left vertical
    bpy.ops.mesh.primitive_cube_add(size=1, location=(x_pos, 0.29, 0.18))
    vL = bpy.context.active_object
    vL.scale = (0.04, 0.02, 0.34)
    parts.append(vL)
    
    # Right vertical
    bpy.ops.mesh.primitive_cube_add(size=1, location=(x_pos, -0.29, 0.18))
    vR = bpy.context.active_object
    vR.scale = (0.04, 0.02, 0.34)
    parts.append(vR)

    for p in parts:
        p.data.materials.append(metal_mat)
        # Apply scale for proper beveling
        bpy.ops.object.select_all(action='DESELECT')
        p.select_set(True)
        bpy.context.view_layer.objects.active = p
        bpy.ops.object.transform_apply(scale=True)
        # Bevel legs
        bv = p.modifiers.new(name="Bevel", type='BEVEL')
        bv.width = 0.002
        bv.segments = 3

create_frame_leg(0.45)
create_frame_leg(-0.45)

# Floor plane for shadow/context
bpy.ops.mesh.primitive_plane_add(size=10, location=(0, 0, 0))
floor = bpy.context.active_object
floor.name = "Floor"
floor_mat = create_material("FloorMat", (0.8, 0.8, 0.8, 1.0), roughness=1.0)
floor.data.materials.append(floor_mat)

# Save
import os
output_path = os.environ.get("OUTPUT_BLEND_PATH", "model.blend")
bpy.ops.wm.save_as_mainfile(filepath=output_path)
