"""32柱の「まことの御姿」: 溶媒分子を moleditpy の CPK(空間充填)表示で描き、霊的な姿に加工する。

moleditpy(MoleditPy 4.11)の 3D 表示と同じ設定で描く:
  元素色 = moleditpy.utils.constants.CPK_COLORS、原子半径 = RDKit の vdW 半径 × cpk_atom_scale(1.0)、
  球の分割 32、smooth_shading、specular 0.2 / specular_power 20、cameralight 強さ 1.2。
GUI は開かず、PyVista(moleditpy の描画エンジン)で画面外に描く。

加工: 視点を変えた2つの御姿を、ぼかした「揺らぎ」として後ろに重ね、主の御姿のまわりに光暈を置き、
夜空の地に星屑を散らす(「見る場所や見る者によって姿を変える」まことの御姿を表す)。

使い方: python render.py [slug ...]   (system Python。moleditpy・rdkit・pyvista が入っている環境)
出力: true_forms/<コード>_<slug>.png(1200×1754)
"""
import colorsys
import sys
from pathlib import Path

import numpy as np
import pyvista as pv
from PIL import Image, ImageChops, ImageDraw, ImageFilter
from rdkit import Chem
from rdkit.Chem import AllChem

from moleditpy.utils.constants import CPK_COLORS, pt

HERE = Path(__file__).parent
W, H = 1200, 1754

# (コード, slug, SMILES)
MOLS = [
    ("11111", "ethanol", "CCO"), ("11110", "acetone", "CC(C)=O"), ("11101", "thf", "C1CCOC1"),
    ("11100", "dme", "COCCOC"), ("11011", "tbutanol", "CC(C)(C)O"), ("11010", "1propanol", "CCCO"),
    ("11001", "ipa", "CC(C)O"), ("11000", "diethylamine", "CCNCC"),
    ("10111", "hfip", "OC(C(F)(F)F)C(F)(F)F"), ("10110", "dcm", "ClCCl"),
    ("10101", "tfa", "OC(=O)C(F)(F)F"), ("10100", "chloroform", "ClC(Cl)Cl"), ("10011", "methanol", "CO"),
    ("10010", "hexane", "CCCCCC"), ("10001", "ethyl_acetate", "CCOC(C)=O"), ("10000", "diethyl_ether", "CCOCC"),
    ("01111", "pgme", "COCC(C)O"), ("01110", "butoxyethanol", "CCCCOCCO"), ("01101", "pyridine", "c1ccncc1"),
    ("01100", "dioxane", "C1COCCO1"), ("01011", "acetic_acid", "CC(=O)O"), ("01010", "dpm", "COCC(C)OCC(C)O"),
    ("01001", "morpholine", "C1COCCN1"), ("01000", "diglyme", "COCCOCCOC"), ("00111", "dmso", "CS(C)=O"),
    ("00110", "toluene", "Cc1ccccc1"), ("00101", "dmf", "CN(C)C=O"), ("00100", "tetralin", "C1CCc2ccccc2C1"),
    ("00011", "ethylene_glycol", "OCCO"), ("00010", "water", "O"), ("00001", "formic_acid", "OC=O"),
    ("00000", "cumene", "CC(C)c1ccccc1"),
]


def embed(smiles, seed):
    mol = Chem.AddHs(Chem.MolFromSmiles(smiles))
    params = AllChem.ETKDGv3()
    params.randomSeed = seed
    AllChem.EmbedMolecule(mol, params)
    AllChem.MMFFOptimizeMolecule(mol)
    return mol


def render_cpk(mol, rot, size):
    """moleditpy の CPK 表示と同じ設定で、透明背景の RGBA 画像を返す。rot = (x, y, z) 回転角(度)。"""
    conf = mol.GetConformer()
    pos = np.array([list(conf.GetAtomPosition(i)) for i in range(mol.GetNumAtoms())])
    pos -= pos.mean(axis=0)
    sym = [a.GetSymbol() for a in mol.GetAtoms()]
    col = np.array([CPK_COLORS.get(s, CPK_COLORS["DEFAULT"]).getRgb()[:3] for s in sym], dtype=np.uint8)
    rad = np.array([pt.GetRvdw(pt.GetAtomicNumber(s)) * 1.0 for s in sym])

    src = pv.PolyData(pos)
    src["colors"] = col
    src["radii"] = rad
    glyphs = src.glyph(scale="radii", geom=pv.Sphere(radius=1.0, theta_resolution=32, phi_resolution=32), orient=False)
    glyphs = glyphs.rotate_x(rot[0], inplace=False).rotate_y(rot[1], inplace=False).rotate_z(rot[2], inplace=False)

    pl = pv.Plotter(off_screen=True, window_size=size, lighting="none")
    pl.add_light(pv.Light(position=(1, 1, 2), light_type="cameralight", intensity=1.2))
    pl.add_mesh(glyphs, scalars="colors", rgb=True, smooth_shading=True, specular=0.2, specular_power=20)
    pl.set_background("black")
    pl.camera_position = "xy"
    pl.reset_camera()
    pl.camera.zoom(1.0)
    img = pl.screenshot(transparent_background=True, return_img=True)
    pl.close()
    return Image.fromarray(img, "RGBA")


def fit(img, box, scale):
    """透明部分を切り詰め、box 内に scale の割合で収まるよう拡大縮小する。"""
    bbox = img.getbbox()
    img = img.crop(bbox)
    r = min(box[0] * scale / img.width, box[1] * scale / img.height)
    return img.resize((max(1, int(img.width * r)), max(1, int(img.height * r))), Image.LANCZOS)


def pad(img, n):
    out = Image.new("RGBA", (img.width + 2 * n, img.height + 2 * n))
    out.alpha_composite(img, (n, n))
    return out


def paste_center(base, img, dx=0, dy=0):
    base.alpha_composite(img, ((base.width - img.width) // 2 + dx, (base.height - img.height) // 2 + dy))


def tint(img, rgb, amount):
    """RGBA 画像の色を rgb に寄せる(アルファはそのまま)。"""
    solid = Image.new("RGBA", img.size, rgb + (255,))
    mixed = Image.blend(img, solid, amount)
    mixed.putalpha(img.getchannel("A"))
    return mixed


def compose(code, slug, smiles):
    rng = np.random.default_rng(int(code, 2) + 7)
    hue = int(code, 2) / 32
    deep = tuple(int(c * 255) for c in colorsys.hls_to_rgb(hue, 0.08, 0.55))
    mid = tuple(int(c * 255) for c in colorsys.hls_to_rgb(hue, 0.22, 0.6))
    glow = tuple(int(c * 255) for c in colorsys.hls_to_rgb(hue, 0.7, 0.9))

    # 地: 中央がほのかに明るい夜空
    yy, xx = np.mgrid[0:H, 0:W]
    d = np.sqrt(((xx - W / 2) / (W * 0.62)) ** 2 + ((yy - H * 0.47) / (H * 0.55)) ** 2).clip(0, 1)[..., None]
    bg = (np.array(mid) * (1 - d) + np.array(deep) * d).astype(np.uint8)
    base = Image.fromarray(bg, "RGB").convert("RGBA")
    # 星屑
    stars = Image.new("RGBA", (W, H))
    dr = ImageDraw.Draw(stars)
    for _ in range(260):
        x, y, r = rng.uniform(0, W), rng.uniform(0, H), rng.choice([0.8, 1.2, 1.8, 2.6], p=[.55, .3, .12, .03])
        a = int(rng.uniform(60, 220))
        dr.ellipse([x - r, y - r, x + r, y + r], fill=(255, 250, 240, a))
    base.alpha_composite(stars.filter(ImageFilter.GaussianBlur(0.6)))

    mol = embed(smiles, int(code, 2) + 11)
    box = (W, H)
    main = fit(render_cpk(mol, (20, 30, 0), (1400, 1400)), box, 0.62)

    # 揺らぎ: 視点を変えた御姿を、大きく・ぼかして・色を寄せて後ろへ
    for rot, sc, blur, alpha, off in [((70, 150, 40), 0.78, 10, 0.34, (-W // 7, -H // 9)),
                                      ((-50, 250, 110), 0.72, 14, 0.28, (W // 7, H // 10)),
                                      ((140, 60, -70), 0.66, 20, 0.22, (W // 9, -H // 6)),
                                      ((-110, -30, 160), 0.60, 26, 0.18, (-W // 8, H // 6))]:
        g = fit(render_cpk(mol, rot, (1000, 1000)), box, sc)
        g = tint(g, glow, 0.6)
        g = pad(g, blur * 4).filter(ImageFilter.GaussianBlur(blur))  # 余白を足してからぼかす(四角い境目を出さない)
        g.putalpha(g.getchannel("A").point(lambda v: int(v * alpha)))
        paste_center(base, g, *off)

    # 光暈: 主の御姿の輪郭をぼかした光
    halo = Image.new("RGBA", main.size, glow + (0,))
    halo.putalpha(main.getchannel("A"))
    hp = 160
    halo_big = Image.new("RGBA", (main.width + hp * 2, main.height + hp * 2))
    halo_big.alpha_composite(halo, (hp, hp))
    halo_big = halo_big.filter(ImageFilter.GaussianBlur(48))
    halo_big.putalpha(halo_big.getchannel("A").point(lambda v: int(v * 0.85)))
    paste_center(base, halo_big)

    # 主の御姿(縁をわずかに光に溶かす)
    edge = pad(main, 12).filter(ImageFilter.GaussianBlur(3))
    edge = tint(edge, glow, 0.6)
    paste_center(base, edge)
    paste_center(base, main)

    # 周縁を暗く
    vig = Image.fromarray((255 * (1 - (d[..., 0] ** 2.2) * 0.55)).astype(np.uint8), "L")
    out = ImageChops.multiply(base.convert("RGB"), Image.merge("RGB", [vig] * 3))
    path = HERE / f"{code}_{slug}.png"
    out.save(path)
    return path


if __name__ == "__main__":
    targets = set(sys.argv[1:])
    for code, slug, smi in MOLS:
        if targets and slug not in targets:
            continue
        print(compose(code, slug, smi).name, flush=True)
