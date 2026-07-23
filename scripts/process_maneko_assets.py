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


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--town-sheet", type=Path, required=True)
    parser.add_argument("--character-sheet", type=Path, required=True)
    parser.add_argument("--journey", type=Path, required=True)
    parser.add_argument("--output-dir", type=Path, required=True)
    args = parser.parse_args()

    args.output_dir.mkdir(parents=True, exist_ok=True)
    crop_equal_panels(args.town_sheet, args.output_dir, "stage")
    crop_characters(args.character_sheet, args.output_dir)

    journey = Image.open(args.journey).convert("RGB")
    journey.thumbnail((1024, 2048), Image.Resampling.LANCZOS)
    journey.save(args.output_dir / "journey-3d.webp", "WEBP", quality=88, method=6)


if __name__ == "__main__":
    main()
