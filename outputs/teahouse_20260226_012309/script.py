import bpy
import math

OUTPUT_BLEND_PATH = "outputs/teahouse_20260226_012309/model.blend"

# Clear scene
bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete()

def create_material(name, color, roughness=0.8):
    mat = bpy.data.materials.new(name=name)
    mat.use_nodes = True
    nodes = mat.node_tree.nodes
    bsdf = nodes.get("Principled BSDF")
    bsdf.inputs['Base Color'].default_value = color
    bsdf.inputs['Roughness'].default_value = roughness
    return mat

# Materials
wood_mat = create_material("Wood", (0.1, 0.05, 0.02, 1.0)) # Dark aged wood
plaster_mat = create_material("Plaster", (0.85, 0.8, 0.7, 1.0)) # Earthy off-white
paper_mat = create_material("Paper", (0.9, 0.9, 0.85, 1.0), 0.5) # Translucent rice paper
tatami_mat = create_material("Tatami", (0.6, 0.6, 0.4, 1.0)) # Woven straw

# Floor (4.5 Tatami Mats)
# Each tatami is roughly 0.9m x 1.8m
# 4.5 layout: 2 horizontal, 2 vertical, 0.5 central
floor_size = 2.7 # 3 * 0.9m
tatami_width = 0.9
tatami_length = 1.8
tatami_thick = 0.05

def add_tatami(name, pos, rot_z):
    bpy.ops.mesh.primitive_cube_add(size=1, location=pos)
    t = bpy.context.active_object
    t.name = name
    t.scale = (tatami_length, tatami_width, tatami_thick)
    t.rotation_euler[2] = math.radians(rot_z)
    t.data.materials.append(tatami_mat)
    # Add border (heri)
    bpy.ops.mesh.primitive_cube_add(size=1, location=pos)
    b = bpy.context.active_object
    b.name = name + "_Border"
    b.scale = (tatami_length + 0.01, tatami_width + 0.01, tatami_thick - 0.01)
    b.rotation_euler[2] = math.radians(rot_z)
    b.data.materials.append(wood_mat)

# Layout for 4.5 mats
add_tatami("Tatami_1", (-0.45, -0.9, 0), 0)
add_tatami("Tatami_2", (0.45, 0.9, 0), 0)
add_tatami("Tatami_3", (-0.9, 0.45, 0), 90)
add_tatami("Tatami_4", (0.9, -0.45, 0), 90)
# Half mat in center
bpy.ops.mesh.primitive_cube_add(size=1, location=(0, 0, 0))
half = bpy.context.active_object
half.scale = (0.9, 0.9, tatami_thick)
half.data.materials.append(tatami_mat)

# Frame and Walls
height = 2.2
thick = 0.08 # Thinner posts for wabi-sabi

def add_beam(name, pos, size, mat):
    bpy.ops.mesh.primitive_cube_add(size=1, location=pos)
    beam = bpy.context.active_object
    beam.name = name
    beam.scale = size
    beam.data.materials.append(mat)
    return beam

# Posts (Refined positions)
posts_pos = [
    (-1.35, -1.35, height/2), (1.35, -1.35, height/2),
    (1.35, 1.35, height/2), (-1.35, 1.35, height/2),
    (0.45, 1.35, height/2), (-1.35, 0.45, height/2)
]
for i, pos in enumerate(posts_pos):
    add_beam(f"Post_{i}", pos, (thick, thick, height), wood_mat)

# Horizontal Beams (Kamo-i)
add_beam("Beam_Top_Front", (0, -1.35, height), (2.7, thick, thick), wood_mat)
add_beam("Beam_Top_Back", (0, 1.35, height), (2.7, thick, thick), wood_mat)
add_beam("Beam_Top_Left", (-1.35, 0, height), (thick, 2.7, thick), wood_mat)
add_beam("Beam_Top_Right", (1.35, 0, height), (thick, 2.7, thick), wood_mat)

# Walls (Back, Left, Right, Front)
# Back wall (with Tokonoma)
add_beam("Wall_Back_Left", (-0.45, 1.35, height/2), (1.8, 0.04, height), plaster_mat)
# Tokonoma (recessed area)
add_beam("Tokonoma_Back", (0.9, 1.5, height/2), (0.9, 0.04, height), plaster_mat)
add_beam("Tokonoma_Side", (0.45, 1.425, height/2), (0.04, 0.15, height), plaster_mat)
add_beam("Tokonoma_Floor", (0.9, 1.35, 0.1), (0.9, 0.1, 0.2), wood_mat)

# Left wall
add_beam("Wall_Left", (-1.35, 0, height/2), (0.04, 2.7, height), plaster_mat)

# Right wall (with Nijiriguchi)
# Lower part
add_beam("Wall_Right_Lower", (1.35, 0, 0.3), (0.04, 2.7, 0.6), plaster_mat)
# Upper part
add_beam("Wall_Right_Upper", (1.35, 0, 1.6), (0.04, 2.7, 1.2), plaster_mat)
# Side parts for Nijiriguchi
add_beam("Wall_Right_Side1", (1.35, -1.0, 0.95), (0.04, 0.7, 0.7), plaster_mat)
add_beam("Wall_Right_Side2", (1.35, 1.0, 0.95), (0.04, 0.7, 0.7), plaster_mat)

# Nijiriguchi Door (small sliding)
add_beam("Nijiriguchi_Frame", (1.37, 0, 0.33), (0.02, 0.66, 0.66), wood_mat)
add_beam("Nijiriguchi_Door", (1.38, 0, 0.33), (0.01, 0.6, 0.6), paper_mat)

# Front Wall (Shoji screens)
# Simple Kumiko (grid) for Shoji
def add_shoji(name, pos):
    frame_w = 1.3
    frame_h = height
    # Frame
    add_beam(name + "_Frame", (pos[0], pos[1], pos[2]), (frame_w, 0.02, frame_h), wood_mat)
    # Paper
    add_beam(name + "_Paper", (pos[0], pos[1] + 0.01, pos[2]), (frame_w - 0.04, 0.005, frame_h - 0.04), paper_mat)
    # Kumiko (grid)
    for i in range(1, 4): # Horizontal
        add_beam(name + f"_H_{i}", (pos[0], pos[1] + 0.012, (frame_h/4)*i), (frame_w, 0.01, 0.01), wood_mat)
    for i in range(1, 3): # Vertical
        add_beam(name + f"_V_{i}", (pos[0] - frame_w/2 + (frame_w/3)*i, pos[1] + 0.012, frame_h/2), (0.01, 0.01, frame_h), wood_mat)

add_shoji("Shoji_Left", (-0.675, -1.33, height/2))
add_shoji("Shoji_Right", (0.675, -1.33, height/2))

# Roof (Slightly more complex)
# Main roof slab
bpy.ops.mesh.primitive_cube_add(size=1, location=(0, 0, height + 0.2))
roof = bpy.context.active_object
roof.scale = (3.2, 3.2, 0.1)
roof.rotation_euler[0] = math.radians(5) # Slight tilt
roof.data.materials.append(wood_mat)


# Exterior Ground
bpy.ops.mesh.primitive_plane_add(size=10, location=(0, 0, -0.01))
ground = bpy.context.active_object
ground.name = "Ground"
moss_mat = create_material("Moss", (0.1, 0.2, 0.05, 1.0))
ground.data.materials.append(moss_mat)

# Stepping Stones (Tobishi)
def add_stone(pos, size):
    bpy.ops.mesh.primitive_uv_sphere_add(radius=1, location=pos)
    stone = bpy.context.active_object
    stone.scale = (size, size * 0.8, size * 0.2)
    stone.data.materials.append(wood_mat) # Use wood mat as placeholder or dark stone

add_stone((2.0, 0, 0), 0.3)
add_stone((2.5, -0.5, 0), 0.25)
add_stone((3.0, -1.0, 0), 0.35)

# Tokonoma Scroll (Kakejiku)
add_beam("Scroll_Backing", (0.9, 1.48, height*0.6), (0.4, 0.01, 1.0), wood_mat)
add_beam("Scroll_Paper", (0.9, 1.475, height*0.6), (0.35, 0.005, 0.9), paper_mat)

# Final Save
bpy.ops.wm.save_as_mainfile(filepath=OUTPUT_BLEND_PATH)
