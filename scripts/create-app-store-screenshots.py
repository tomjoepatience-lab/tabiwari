from __future__ import annotations

from pathlib import Path
from PIL import Image, ImageDraw, ImageFilter, ImageFont


ROOT = Path(__file__).resolve().parents[1]
STORE = ROOT / "app-store"
SOURCE = STORE / "screenshots" / "source"
BACKGROUND = STORE / "assets" / "promo-town-bg.png"
ICON = ROOT / "expo" / "assets" / "icon.png"

FONT_BOLD = Path(r"C:\Windows\Fonts\YuGothB.ttc")
FONT_MEDIUM = Path(r"C:\Windows\Fonts\YuGothM.ttc")

SLIDES = [
    ("01-town.png", "マネコと育てる\n新しい家計簿", "記録するほど、街とマネコが変わっていく"),
    ("02-record.png", "支出は、迷わず\nすぐ記録", "レシート読取と自動分類で入力をもっと手軽に"),
    ("03-savings.png", "貯金がつづく\n目標のある毎日", "少しずつ貯めて、次の街へ"),
    ("04-report.png", "使い方が見える\nやさしいレポート", "ジャンル・月次・カレンダー・地図で振り返り"),
    ("05-journey.png", "貯めた分だけ\nマネコが旅する", "道を進みながら、世界が少しずつ変化"),
    ("06-settings.png", "ひとりでも家族でも\n自分らしく使える", "プロフィール・通知・表示をすっきり設定"),
]

PORTRAIT_SOURCES = {"01-town.png", "05-journey.png"}
WIDE_DETAILS = {
    "02-record.png": ("maneko-receipt.webp", "レシートから読み取って、自動で分類"),
    "03-savings.png": ("maneko-stage-2.webp", "目標までの進み具合が、ひと目でわかる"),
    "04-report.png": ("maneko-3d.webp", "使った割合も、カレンダーも、地図も"),
    "06-settings.png": ("maneko-settings.webp", "必要な設定だけを、すっきり整理"),
}


def font(path: Path, size: int) -> ImageFont.FreeTypeFont:
    return ImageFont.truetype(str(path), size=size, index=0)


def cover(image: Image.Image, size: tuple[int, int]) -> Image.Image:
    target_w, target_h = size
    scale = max(target_w / image.width, target_h / image.height)
    resized = image.resize(
        (round(image.width * scale), round(image.height * scale)),
        Image.Resampling.LANCZOS,
    )
    left = (resized.width - target_w) // 2
    top = (resized.height - target_h) // 2
    return resized.crop((left, top, left + target_w, top + target_h))


def crop_app(source: Image.Image) -> Image.Image:
    """Browser capture is 1280×720; the rendered app occupies the centered 340px."""
    if source.width == 1280 and source.height == 720:
        return source.crop((470, 0, 810, 720))
    # Fallback for future captures: keep the centered portrait region.
    width = min(source.width, round(source.height * 0.4722))
    left = (source.width - width) // 2
    return source.crop((left, 0, left + width, source.height))


def rounded_screen(
    screen: Image.Image,
    target_width: int,
    radius: int,
    border: int,
) -> Image.Image:
    target_height = round(target_width * screen.height / screen.width)
    scaled = screen.resize((target_width, target_height), Image.Resampling.LANCZOS)
    mask = Image.new("L", scaled.size, 0)
    ImageDraw.Draw(mask).rounded_rectangle(
        (0, 0, scaled.width - 1, scaled.height - 1),
        radius=radius,
        fill=255,
    )
    framed = Image.new(
        "RGBA",
        (scaled.width + border * 2, scaled.height + border * 2),
        (0, 0, 0, 0),
    )
    frame_draw = ImageDraw.Draw(framed)
    frame_draw.rounded_rectangle(
        (0, 0, framed.width - 1, framed.height - 1),
        radius=radius + border,
        fill=(255, 253, 247, 255),
        outline=(255, 255, 255, 255),
        width=max(2, border // 4),
    )
    framed.paste(scaled, (border, border), mask)
    return framed


def rounded_panel(image: Image.Image, size: tuple[int, int], radius: int) -> Image.Image:
    panel = cover(image, size)
    mask = Image.new("L", size, 0)
    ImageDraw.Draw(mask).rounded_rectangle(
        (0, 0, size[0] - 1, size[1] - 1), radius=radius, fill=255
    )
    result = Image.new("RGBA", (size[0] + 14, size[1] + 14), (0, 0, 0, 0))
    ImageDraw.Draw(result).rounded_rectangle(
        (0, 0, result.width - 1, result.height - 1),
        radius=radius + 7,
        fill=(255, 253, 247, 255),
        outline=(255, 255, 255, 255),
        width=4,
    )
    result.paste(panel, (7, 7), mask)
    return result


def draw_badge(canvas: Image.Image, scale: float) -> None:
    draw = ImageDraw.Draw(canvas)
    icon_size = round(68 * scale)
    x = round(70 * scale)
    y = round(68 * scale)
    pad_x = round(22 * scale)
    badge_h = round(98 * scale)
    badge_w = round(370 * scale)
    draw.rounded_rectangle(
        (x, y, x + badge_w, y + badge_h),
        radius=round(49 * scale),
        fill=(255, 253, 247, 232),
        outline=(255, 255, 255, 245),
        width=max(2, round(2 * scale)),
    )
    app_icon = Image.open(ICON).convert("RGB").resize(
        (icon_size, icon_size), Image.Resampling.LANCZOS
    )
    icon_mask = Image.new("L", (icon_size, icon_size), 0)
    ImageDraw.Draw(icon_mask).rounded_rectangle(
        (0, 0, icon_size - 1, icon_size - 1),
        radius=round(17 * scale),
        fill=255,
    )
    canvas.paste(
        app_icon,
        (x + pad_x, y + (badge_h - icon_size) // 2),
        icon_mask,
    )
    draw.text(
        (x + pad_x + icon_size + round(16 * scale), y + round(25 * scale)),
        "マネコ家計簿",
        font=font(FONT_BOLD, round(25 * scale)),
        fill=(84, 55, 31),
    )
    draw.text(
        (x + pad_x + icon_size + round(16 * scale), y + round(57 * scale)),
        "MANEKO",
        font=font(FONT_BOLD, round(13 * scale)),
        fill=(178, 112, 24),
    )


def compose(
    output_size: tuple[int, int],
    screen_file: str,
    title: str,
    subtitle: str,
    output_path: Path,
) -> None:
    width, height = output_size
    scale = width / 1242
    is_ipad = width > 1500
    base = cover(Image.open(BACKGROUND).convert("RGB"), output_size)

    # Keep the headline legible while retaining the generated town texture.
    veil = Image.new("RGBA", output_size, (255, 248, 231, 0))
    veil_draw = ImageDraw.Draw(veil)
    veil_draw.rectangle(
        (0, 0, width, round(760 * scale)),
        fill=(255, 250, 238, 170),
    )
    base = Image.alpha_composite(base.convert("RGBA"), veil)
    draw = ImageDraw.Draw(base)

    draw_badge(base, scale)
    title_x = 120 if is_ipad else round(72 * scale)
    title_y = 290 if is_ipad else round(205 * scale)
    title_size = 112 if is_ipad else round(80 * scale)
    draw.multiline_text(
        (title_x, title_y),
        title,
        font=font(FONT_BOLD, title_size),
        fill=(78, 48, 25),
        spacing=18 if is_ipad else round(12 * scale),
    )
    subtitle_y = 590 if is_ipad else round(435 * scale)
    draw.text(
        (title_x, subtitle_y),
        subtitle,
        font=font(FONT_MEDIUM, 40 if is_ipad else round(29 * scale)),
        fill=(130, 91, 52),
    )

    source_image = Image.open(SOURCE / screen_file).convert("RGB")
    if screen_file in PORTRAIT_SOURCES:
        raw_screen = crop_app(source_image)
        phone_width = 900 if is_ipad else 890
        device = rounded_screen(
            raw_screen,
            target_width=phone_width,
            radius=85 if is_ipad else round(58 * scale),
            border=24 if is_ipad else round(16 * scale),
        )
        device_x = (width - device.width) // 2
        device_y = 720 if is_ipad else round(650 * scale)
        shadow = Image.new("RGBA", output_size, (0, 0, 0, 0))
        shadow_draw = ImageDraw.Draw(shadow)
        shadow_draw.rounded_rectangle(
            (
                device_x + round(18 * scale),
                device_y + round(28 * scale),
                device_x + device.width + round(18 * scale),
                device_y + device.height + round(28 * scale),
            ),
            radius=round(76 * scale),
            fill=(67, 38, 15, 105),
        )
        shadow = shadow.filter(ImageFilter.GaussianBlur(round(34 * scale)))
        base = Image.alpha_composite(base, shadow)
        base.alpha_composite(device, (device_x, device_y))
    else:
        panel_size = (1780, 1000) if is_ipad else (1100, 619)
        panel = rounded_panel(
            source_image,
            panel_size,
            radius=54 if is_ipad else 38,
        )
        panel_x = (width - panel.width) // 2
        panel_y = 750 if is_ipad else 650
        shadow = Image.new("RGBA", output_size, (0, 0, 0, 0))
        ImageDraw.Draw(shadow).rounded_rectangle(
            (
                panel_x + 18,
                panel_y + 28,
                panel_x + panel.width + 18,
                panel_y + panel.height + 28,
            ),
            radius=70 if is_ipad else 50,
            fill=(67, 38, 15, 100),
        )
        shadow = shadow.filter(ImageFilter.GaussianBlur(34 if is_ipad else 24))
        base = Image.alpha_composite(base, shadow)
        base.alpha_composite(panel, (panel_x, panel_y))

        mascot_name, callout = WIDE_DETAILS[screen_file]
        mascot = Image.open(
            ROOT / "public" / "assets" / "kids" / mascot_name
        ).convert("RGBA")
        mascot.thumbnail(
            (650, 880) if is_ipad else (430, 630),
            Image.Resampling.LANCZOS,
        )
        mascot_x = width - mascot.width - (150 if is_ipad else 40)
        mascot_y = height - mascot.height - (40 if is_ipad else 15)
        base.alpha_composite(mascot, (mascot_x, mascot_y))

        callout_w = 1120 if is_ipad else 760
        callout_h = 150 if is_ipad else 104
        callout_x = 120 if is_ipad else 58
        callout_y = height - callout_h - (160 if is_ipad else 105)
        callout_layer = Image.new("RGBA", output_size, (0, 0, 0, 0))
        callout_draw = ImageDraw.Draw(callout_layer)
        callout_draw.rounded_rectangle(
            (
                callout_x,
                callout_y,
                callout_x + callout_w,
                callout_y + callout_h,
            ),
            radius=callout_h // 2,
            fill=(255, 253, 247, 238),
            outline=(255, 255, 255, 255),
            width=3,
        )
        callout_draw.text(
            (callout_x + (55 if is_ipad else 34), callout_y + (43 if is_ipad else 31)),
            callout,
            font=font(FONT_BOLD, 42 if is_ipad else 26),
            fill=(106, 70, 37),
        )
        base = Image.alpha_composite(base, callout_layer)

    # App Store screenshots must not contain alpha.
    output_path.parent.mkdir(parents=True, exist_ok=True)
    base.convert("RGB").save(output_path, "PNG", optimize=True)


def main() -> None:
    targets = [
        ((1242, 2688), STORE / "screenshots" / "iphone-6.5"),
        ((2064, 2752), STORE / "screenshots" / "ipad-13"),
    ]
    for size, directory in targets:
        for index, (screen_file, title, subtitle) in enumerate(SLIDES, start=1):
            compose(
                size,
                screen_file,
                title,
                subtitle,
                directory / f"{index:02d}.png",
            )
    print("Created 12 App Store screenshots.")


if __name__ == "__main__":
    main()
