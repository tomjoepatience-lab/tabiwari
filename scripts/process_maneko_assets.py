"""Prepare generated Maneko Town artwork for the web client.

The source sheets are intentionally kept outside the repository in Codex's
generated-images directory. Pass them explicitly so this script remains
reusable when the artwork is regenerated.
"""

from __future__ import annotations

import argparse
from pathlib import Path

from PIL import Image


def crop_equal_panels(source: Path, output_dir: Path, prefix: str, count: int = 5) -> None:
    image = Image.open(source).convert("RGB")
    for index in range(count):
        left = round(image.width * index / count)
        right = round(image.width * (index + 1) / count)
        # Trim the generator's thin divider lines without changing composition.
        inset = 2 if index > 0 else 0
        panel = image.crop((left + inset, 0, right - (2 if index < count - 1 else 0), image.height))
        panel.save(output_dir / f"{prefix}-{index}.webp", "WEBP", quality=86, method=6)


def chroma_distance(pixel: tuple[int, int, int]) -> int:
    red, green, blue = pixel
    return green - max(red, blue)


def crop_characters(source: Path, output_dir: Path, count: int = 5) -> None:
    sheet = Image.open(source).convert("RGB")
    for index in range(count):
        left = round(sheet.width * index / count)
        right = round(sheet.width * (index + 1) / count)
        panel = sheet.crop((left, 0, right, sheet.height)).convert("RGBA")
        pixels = panel.load()
        for y in range(panel.height):
            for x in range(panel.width):
                red, green, blue, _ = pixels[x, y]
                distance = chroma_distance((red, green, blue))
                if distance >= 70 and green >= 120:
                    alpha = 0
                elif distance >= 25 and green >= 90:
                    alpha = round(255 * (70 - distance) / 45)
                else:
                    alpha = 255
                if green > max(red, blue) + 8:
                    green = max(red, blue)
                pixels[x, y] = (red, green, blue, alpha)

        bbox = panel.getbbox()
        if bbox:
            panel = panel.crop(bbox)
        canvas = Image.new("RGBA", (520, 720), (0, 0, 0, 0))
        panel.thumbnail((480, 680), Image.Resampling.LANCZOS)
        x = (canvas.width - panel.width) // 2
        y = canvas.height - panel.height - 12
        canvas.alpha_composite(panel, (x, y))
        canvas.save(output_dir / f"maneko-stage-{index}.webp", "WEBP", quality=90, method=6)


def crop_pose_characters(source: Path, output_dir: Path) -> None:
    names = ("receipt", "walking", "family", "settings")
    sheet = Image.open(source).convert("RGB")
    for index, name in enumerate(names):
        left = round(sheet.width * index / len(names))
        right = round(sheet.width * (index + 1) / len(names))
        panel = sheet.crop((left, 0, right, sheet.height)).convert("RGBA")
        pixels = panel.load()
        for y in range(panel.height):
            for x in range(panel.width):
                red, green, blue, _ = pixels[x, y]
                distance = chroma_distance((red, green, blue))
                if distance >= 70 and green >= 120:
                    alpha = 0
                elif distance >= 25 and green >= 90:
                    alpha = round(255 * (70 - distance) / 45)
                else:
                    alpha = 255
                if green > max(red, blue) + 8:
                    green = max(red, blue)
                pixels[x, y] = (red, green, blue, alpha)
        bbox = panel.getbbox()
        if bbox:
            panel = panel.crop(bbox)
        canvas = Image.new("RGBA", (560, 720), (0, 0, 0, 0))
        panel.thumbnail((530, 690), Image.Resampling.LANCZOS)
        canvas.alpha_composite(panel, ((canvas.width - panel.width) // 2, canvas.height - panel.height - 10))
        canvas.save(output_dir / f"maneko-{name}.webp", "WEBP", quality=90, method=6)


def crop_tab_scenes(source: Path, output_dir: Path) -> None:
    names = ("record", "savings", "family", "settings")
    sheet = Image.open(source).convert("RGB")
    half_width = sheet.width // 2
    half_height = sheet.height // 2
    boxes = (
        (0, 0, half_width, half_height),
        (half_width, 0, sheet.width, half_height),
        (0, half_height, half_width, sheet.height),
        (half_width, half_height, sheet.width, sheet.height),
    )
    for name, box in zip(names, boxes):
        scene = sheet.crop(box)
        scene.save(output_dir / f"scene-{name}.webp", "WEBP", quality=88, method=6)


def crop_home_scenes(source: Path, output_dir: Path) -> None:
    sheet = Image.open(source).convert("RGB")
    cell_width = sheet.width // 2
    cell_height = sheet.height // 3
    for index in range(5):
        column = index % 2
        row = index // 2
        left = column * cell_width + (2 if column else 0)
        top = row * cell_height + (2 if row else 0)
        right = (column + 1) * cell_width - (2 if column == 0 else 0)
        bottom = (row + 1) * cell_height - (2 if row < 2 else 0)
        scene = sheet.crop((left, top, right, bottom))

        # The generator returns square panels, while the app canvas is close to
        # 9:19. Keep the full town composition in the upper half and extend only
        # the foreground road. Using CSS `cover` here would crop the buildings
        # that make each stage readable.
        scene = scene.resize((512, 512), Image.Resampling.LANCZOS)
        portrait = Image.new("RGB", (512, 1070))
        portrait.paste(scene, (0, 0))
        road = scene.crop((0, 300, 512, 512)).resize((512, 600), Image.Resampling.LANCZOS)
        portrait.paste(road, (0, 470))
        for y in range(42):
            source_row = scene.crop((0, 470 + y, 512, 471 + y))
            road_row = portrait.crop((0, 470 + y, 512, 471 + y))
            blend = Image.blend(source_row, road_row, y / 41)
            portrait.paste(blend, (0, 470 + y))
        portrait.save(output_dir / f"home-stage-{index}.webp", "WEBP", quality=89, method=6)


def crop_icon_sheet(source: Path, output_dir: Path) -> None:
    names = (
        "nav-town", "nav-record", "nav-savings", "nav-family", "nav-settings",
        "goal-bike", "goal-game", "goal-phone", "goal-shoes", "goal-travel",
    )
    sheet = Image.open(source).convert("RGB")
    cell_width = sheet.width // 5
    cell_height = sheet.height // 2
    for index, name in enumerate(names):
        column = index % 5
        row = index // 5
        panel = sheet.crop((
            column * cell_width,
            row * cell_height,
            (column + 1) * cell_width,
            (row + 1) * cell_height,
        )).convert("RGBA")
        pixels = panel.load()
        for y in range(panel.height):
            for x in range(panel.width):
                red, green, blue, _ = pixels[x, y]
                distance = chroma_distance((red, green, blue))
                if distance >= 70 and green >= 120:
                    alpha = 0
                elif distance >= 25 and green >= 90:
                    alpha = round(255 * (70 - distance) / 45)
                else:
                    alpha = 255
                if green > max(red, blue) + 8:
                    green = max(red, blue)
                pixels[x, y] = (red, green, blue, alpha)
        bbox = panel.getbbox()
        if bbox:
            panel = panel.crop(bbox)
        canvas = Image.new("RGBA", (256, 256), (0, 0, 0, 0))
        panel.thumbnail((224, 224), Image.Resampling.LANCZOS)
        canvas.alpha_composite(panel, ((canvas.width - panel.width) // 2, (canvas.height - panel.height) // 2))
        canvas.save(output_dir / f"{name}.webp", "WEBP", quality=92, method=6)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--town-sheet", type=Path, required=True)
    parser.add_argument("--character-sheet", type=Path, required=True)
    parser.add_argument("--journey", type=Path, required=True)
    parser.add_argument("--pose-sheet", type=Path)
    parser.add_argument("--scene-sheet", type=Path)
    parser.add_argument("--home-sheet", type=Path)
    parser.add_argument("--icon-sheet", type=Path)
    parser.add_argument("--output-dir", type=Path, required=True)
    args = parser.parse_args()

    args.output_dir.mkdir(parents=True, exist_ok=True)
    crop_equal_panels(args.town_sheet, args.output_dir, "stage")
    crop_characters(args.character_sheet, args.output_dir)
    if args.pose_sheet:
        crop_pose_characters(args.pose_sheet, args.output_dir)
    if args.scene_sheet:
        crop_tab_scenes(args.scene_sheet, args.output_dir)
    if args.home_sheet:
        crop_home_scenes(args.home_sheet, args.output_dir)
    if args.icon_sheet:
        crop_icon_sheet(args.icon_sheet, args.output_dir)

    journey = Image.open(args.journey).convert("RGB")
    journey.thumbnail((1024, 2048), Image.Resampling.LANCZOS)
    journey.save(args.output_dir / "journey-3d.webp", "WEBP", quality=88, method=6)


if __name__ == "__main__":
    main()
