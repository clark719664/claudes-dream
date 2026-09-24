"""
SkyStack material builder.

Unreal runs every Content/Python/init_unreal.py when the editor starts (with the Python
Editor Script Plugin enabled, which SkyStack.uproject does). This script builds the game's
materials as real assets under /Game/SkyStack, so the repo stays text-only while the game
still gets proper shaders:

  M_SkyBlock  Lacquered clear-coat block with glowing bevel seams (the tower).
  M_SkyGlow   Unlit additive glow driven by parameters (halos, the record ring).
  M_SkySpark  Unlit additive glow driven by per-instance data (sparks, stars).

It only rebuilds when MATERIAL_VERSION changes, so editor startup stays fast.
Commit the generated .uasset files so packaged builds and teammates get them.
"""

import unreal

ROOT = "/Game/SkyStack"
MATERIAL_VERSION = "3"
VERSION_TAG = "SkyStackMaterialVersion"

mel = unreal.MaterialEditingLibrary
eal = unreal.EditorAssetLibrary
asset_tools = unreal.AssetToolsHelpers.get_asset_tools()


def log(message):
    unreal.log("[SkyStack] " + message)


def get_or_create_material(name):
    """Returns (material, needs_build)."""
    path = f"{ROOT}/{name}"
    if eal.does_asset_exist(path):
        material = eal.load_asset(path)
        if eal.get_metadata_tag(material, VERSION_TAG) == MATERIAL_VERSION:
            return material, False
        mel.delete_all_material_expressions(material)
        return material, True
    material = asset_tools.create_asset(name, ROOT, unreal.Material, unreal.MaterialFactoryNew())
    return material, True


def finish(material):
    mel.layout_material_expressions(material)
    mel.recompile_material(material)
    eal.set_metadata_tag(material, VERSION_TAG, MATERIAL_VERSION)
    eal.save_loaded_asset(material)
    log(f"built {material.get_path_name()}")


def node(material, cls, x, y, **props):
    expression = mel.create_material_expression(material, cls, x, y)
    for key, value in props.items():
        expression.set_editor_property(key, value)
    return expression


def vector_param(material, name, default, x, y):
    return node(material, unreal.MaterialExpressionVectorParameter, x, y,
                parameter_name=name, default_value=unreal.LinearColor(*default))


def scalar_param(material, name, default, x, y):
    return node(material, unreal.MaterialExpressionScalarParameter, x, y,
                parameter_name=name, default_value=default)


def custom(material, x, y, code, inputs, output_type):
    expression = node(material, unreal.MaterialExpressionCustom, x, y, code=code, output_type=output_type)
    custom_inputs = []
    for input_name in inputs:
        custom_input = unreal.CustomInput()
        custom_input.set_editor_property("input_name", input_name)
        custom_inputs.append(custom_input)
    expression.set_editor_property("inputs", custom_inputs)
    return expression


def link(source, target, input_name, source_output=""):
    if not mel.connect_material_expressions(source, source_output, target, input_name):
        unreal.log_warning(f"[SkyStack] could not connect into input '{input_name}'")


def build_block():
    material, needs_build = get_or_create_material("M_SkyBlock")
    if not needs_build:
        return
    material.set_editor_property("shading_model", unreal.MaterialShadingModel.MSM_CLEAR_COAT)

    color = vector_param(material, "Color", (0.8, 0.45, 0.9, 1.0), -900, -300)
    size = vector_param(material, "Size", (100.0, 100.0, 100.0, 0.0), -900, 0)
    edge_width = scalar_param(material, "EdgeWidth", 3.5, -900, 150)
    edge_glow = scalar_param(material, "EdgeGlow", 1.2, -900, 250)
    glow = scalar_param(material, "Glow", 0.0, -900, 350)
    roughness = scalar_param(material, "Roughness", 0.32, -900, 450)
    clear_coat = scalar_param(material, "ClearCoat", 1.0, -900, 550)
    clear_coat_roughness = scalar_param(material, "ClearCoatRoughness", 0.06, -900, 650)

    world_position = node(material, unreal.MaterialExpressionWorldPosition, -1300, 0)
    local_position = node(material, unreal.MaterialExpressionTransformPosition, -1100, 0,
                          transform_source_type=unreal.MaterialPositionTransformSource.TRANSFORMPOSSOURCE_WORLD,
                          transform_type=unreal.MaterialPositionTransformSource.TRANSFORMPOSSOURCE_LOCAL)
    link(world_position, local_position, "Input")

    # Distance (in world units) from this pixel to the nearest edge of the scaled box,
    # turned into a soft glowing seam. Works for any block size via the Size parameter.
    edge = custom(material, -600, 0, "\n".join([
        "float3 D = (50.0 - abs(P)) * S / 100.0;",
        "float E = min(min(max(D.x, D.y), max(D.y, D.z)), max(D.x, D.z));",
        "float M = saturate(1.0 - E / max(W, 0.001));",
        "return M * M;",
    ]), ["P", "S", "W"], unreal.CustomMaterialOutputType.CMOT_FLOAT1)
    link(local_position, edge, "P")
    link(size, edge, "S")
    link(edge_width, edge, "W")

    emissive = custom(material, -300, -150, "return C * (M * EG + G);",
                      ["C", "M", "EG", "G"], unreal.CustomMaterialOutputType.CMOT_FLOAT3)
    link(color, emissive, "C")
    link(edge, emissive, "M")
    link(edge_glow, emissive, "EG")
    link(glow, emissive, "G")

    # Seams are slightly glossier than the faces.
    rough = custom(material, -300, 300, "return lerp(R, R * 0.4, M);",
                   ["R", "M"], unreal.CustomMaterialOutputType.CMOT_FLOAT1)
    link(roughness, rough, "R")
    link(edge, rough, "M")

    mel.connect_material_property(color, "", unreal.MaterialProperty.MP_BASE_COLOR)
    mel.connect_material_property(emissive, "", unreal.MaterialProperty.MP_EMISSIVE_COLOR)
    mel.connect_material_property(rough, "", unreal.MaterialProperty.MP_ROUGHNESS)
    mel.connect_material_property(clear_coat, "", unreal.MaterialProperty.MP_CUSTOM_DATA0)
    mel.connect_material_property(clear_coat_roughness, "", unreal.MaterialProperty.MP_CUSTOM_DATA1)
    finish(material)


def build_glow():
    material, needs_build = get_or_create_material("M_SkyGlow")
    if not needs_build:
        return
    material.set_editor_property("blend_mode", unreal.BlendMode.BLEND_ADDITIVE)
    material.set_editor_property("shading_model", unreal.MaterialShadingModel.MSM_UNLIT)
    material.set_editor_property("two_sided", True)

    color = vector_param(material, "Color", (1.0, 1.0, 1.0, 1.0), -700, -100)
    intensity = scalar_param(material, "Intensity", 6.0, -700, 50)
    opacity = scalar_param(material, "Opacity", 1.0, -700, 150)
    out = custom(material, -350, 0, "return C * I * saturate(A);",
                 ["C", "I", "A"], unreal.CustomMaterialOutputType.CMOT_FLOAT3)
    link(color, out, "C")
    link(intensity, out, "I")
    link(opacity, out, "A")
    mel.connect_material_property(out, "", unreal.MaterialProperty.MP_EMISSIVE_COLOR)
    finish(material)


def build_spark():
    material, needs_build = get_or_create_material("M_SkySpark")
    if not needs_build:
        return
    material.set_editor_property("blend_mode", unreal.BlendMode.BLEND_ADDITIVE)
    material.set_editor_property("shading_model", unreal.MaterialShadingModel.MSM_UNLIT)
    material.set_editor_property("two_sided", True)
    material.set_editor_property("used_with_instanced_static_meshes", True)

    channels = []
    for index in range(4):
        channels.append(node(material, unreal.MaterialExpressionPerInstanceCustomData, -700, -200 + index * 110,
                             data_index=index))
    intensity = scalar_param(material, "Intensity", 8.0, -700, 260)
    fade = scalar_param(material, "Fade", 1.0, -700, 360)
    out = custom(material, -350, 0, "return float3(R, G, B) * saturate(A) * I * F;",
                 ["R", "G", "B", "A", "I", "F"], unreal.CustomMaterialOutputType.CMOT_FLOAT3)
    for channel, input_name in zip(channels, ("R", "G", "B", "A")):
        link(channel, out, input_name)
    link(intensity, out, "I")
    link(fade, out, "F")
    mel.connect_material_property(out, "", unreal.MaterialProperty.MP_EMISSIVE_COLOR)
    finish(material)


def main():
    if not eal.does_directory_exist(ROOT):
        eal.make_directory(ROOT)
    for build in (build_block, build_glow, build_spark):
        try:
            build()
        except Exception as error:  # keep the editor starting even if one material fails
            unreal.log_error(f"[SkyStack] {build.__name__} failed: {error}")


main()
