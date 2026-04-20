"""导出渲染：把路书的点和连线叠到任意底图上。

核心：用户给 >=3 个"控制点"（底图上的像素坐标 + 对应的经纬度），
解出一个 6 参数仿射变换 (lng,lat) -> (x,y)，
然后用这个变换投影所有地点和轨迹到底图像素坐标，Pillow 绘制。

若只有 2 个控制点，退化为相似变换（缩放+平移，不含旋转）。
"""
from __future__ import annotations
from io import BytesIO
from pathlib import Path
from typing import List, Tuple, Dict

import numpy as np
from PIL import Image, ImageDraw, ImageFont


FONT_CANDIDATES = [
    # (路径, index)  index 是 TTC 子字体索引，非 TTC 填 0
    ("/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc", 2),      # Noto Sans CJK SC
    ("/usr/share/fonts/opentype/noto/NotoSerifCJK-Regular.ttc", 2),
    ("/usr/share/fonts/noto/NotoSansCJK-Regular.ttc", 2),
    ("/System/Library/Fonts/PingFang.ttc", 0),
    ("/System/Library/Fonts/STHeiti Light.ttc", 0),
    ("/usr/share/fonts/truetype/wqy/wqy-microhei.ttc", 0),
    ("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf", 0),             # 兜底（中文会出豆腐，但英文 OK）
    ("/System/Library/Fonts/Helvetica.ttc", 0),
]


def _load_font(size: int) -> ImageFont.ImageFont:
    for path, index in FONT_CANDIDATES:
        if Path(path).exists():
            try:
                return ImageFont.truetype(path, size, index=index)
            except Exception:
                continue
    return ImageFont.load_default()


def solve_affine(control_points: List[Dict]) -> Tuple[np.ndarray, np.ndarray]:
    """
    control_points: [{"x": 像素x, "y": 像素y, "lng": 经度, "lat": 纬度}, ...]

    返回 (A, b) 使得 [x, y]^T = A @ [lng, lat]^T + b
    要求 len(control_points) >= 2（2 个点用相似变换退化，>=3 用最小二乘 6 参仿射）
    """
    n = len(control_points)
    if n < 2:
        raise ValueError("至少需要 2 个控制点")

    lngs = np.array([p["lng"] for p in control_points], dtype=float)
    lats = np.array([p["lat"] for p in control_points], dtype=float)
    xs = np.array([p["x"] for p in control_points], dtype=float)
    ys = np.array([p["y"] for p in control_points], dtype=float)

    if n == 2:
        # 相似变换：x = s*lng + tx, y = -s*lat + ty（北上，所以 lat 系数取负）
        # 这里只做各向同性的等比缩放，忽略旋转
        s_lng = (xs[1] - xs[0]) / (lngs[1] - lngs[0]) if lngs[1] != lngs[0] else 1.0
        s_lat = (ys[1] - ys[0]) / (lats[1] - lats[0]) if lats[1] != lats[0] else -1.0
        tx = xs[0] - s_lng * lngs[0]
        ty = ys[0] - s_lat * lats[0]
        A = np.array([[s_lng, 0.0], [0.0, s_lat]])
        b = np.array([tx, ty])
        return A, b

    # n >= 3：最小二乘解 [a b c; d e f]，使得 x = a*lng + b*lat + c, y = d*lng + e*lat + f
    M = np.column_stack([lngs, lats, np.ones(n)])  # n x 3
    # 解 x 分量
    coef_x, *_ = np.linalg.lstsq(M, xs, rcond=None)  # (a, b, c)
    coef_y, *_ = np.linalg.lstsq(M, ys, rcond=None)  # (d, e, f)
    A = np.array([[coef_x[0], coef_x[1]], [coef_y[0], coef_y[1]]])
    b = np.array([coef_x[2], coef_y[2]])
    return A, b


def project(A: np.ndarray, b: np.ndarray, lng: float, lat: float) -> Tuple[float, float]:
    v = A @ np.array([lng, lat]) + b
    return float(v[0]), float(v[1])


def render_overlay(
    image_path: str | Path,
    control_points: List[Dict],
    points: List[Dict],
    *,
    show_track: bool = True,
    point_color: Tuple[int, int, int] = (220, 38, 38),       # 朱红
    track_color: Tuple[int, int, int] = (30, 30, 30),        # 近黑
    label_color: Tuple[int, int, int] = (20, 20, 20),
    label_bg: Tuple[int, int, int, int] = (255, 255, 255, 230),
    point_radius: int = 9,
    track_width: int = 3,
    font_size: int = 22,
) -> bytes:
    """渲染并返回 PNG 字节。

    points: [{"lng": ..., "lat": ..., "title": ..., "order_index": ...}, ...]
    """
    A, b = solve_affine(control_points)

    base = Image.open(image_path).convert("RGBA")
    # 一个透明的叠加层，用于画线和点
    overlay = Image.new("RGBA", base.size, (0, 0, 0, 0))
    draw = ImageDraw.Draw(overlay)
    font = _load_font(font_size)
    small_font = _load_font(max(12, font_size - 6))

    sorted_points = sorted(points, key=lambda p: p.get("order_index", 0))
    xy_list: List[Tuple[float, float]] = [project(A, b, p["lng"], p["lat"]) for p in sorted_points]

    # 轨迹
    if show_track and len(xy_list) >= 2:
        draw.line(xy_list, fill=track_color + (220,), width=track_width, joint="curve")

    # 点
    for idx, ((x, y), p) in enumerate(zip(xy_list, sorted_points), start=1):
        # 外圈白色、内圈红色，像地图 pin 的简化款
        r = point_radius
        draw.ellipse((x - r - 2, y - r - 2, x + r + 2, y + r + 2), fill=(255, 255, 255, 255))
        draw.ellipse((x - r, y - r, x + r, y + r), fill=point_color + (255,))
        # 序号写在圆心
        num = str(idx)
        try:
            tw = draw.textlength(num, font=small_font)
        except AttributeError:
            tw, _ = small_font.getsize(num)
        th = small_font.size
        draw.text((x - tw / 2, y - th / 2 - 1), num, fill=(255, 255, 255, 255), font=small_font)

    # 标签：放在点右上方，白底黑字
    for (x, y), p in zip(xy_list, sorted_points):
        title = p.get("title") or ""
        if not title:
            continue
        try:
            tw = draw.textlength(title, font=font)
        except AttributeError:
            tw, _ = font.getsize(title)
        th = font.size
        pad = 6
        bx0 = x + point_radius + 6
        by0 = y - th - pad * 2 - 2
        bx1 = bx0 + tw + pad * 2
        by1 = by0 + th + pad * 2
        draw.rounded_rectangle((bx0, by0, bx1, by1), radius=4, fill=label_bg, outline=(0, 0, 0, 100), width=1)
        draw.text((bx0 + pad, by0 + pad - 2), title, fill=label_color + (255,), font=font)

    out = Image.alpha_composite(base, overlay)

    buf = BytesIO()
    out.convert("RGB").save(buf, format="PNG", optimize=True)
    return buf.getvalue()
