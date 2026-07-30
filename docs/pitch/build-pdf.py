#!/usr/bin/env python3
"""Assemble artifact-tool slide renders into a reviewer-friendly PDF."""

from __future__ import annotations

import argparse
import re
from pathlib import Path

from PIL import Image


def slide_number(path: Path) -> int:
    match = re.fullmatch(r"slide-(\d+)\.png", path.name)
    if match is None:
        raise ValueError(f"Unexpected slide render name: {path.name}")
    return int(match.group(1))


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input-dir", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--montage-output", type=Path)
    args = parser.parse_args()

    slide_paths = sorted(
        args.input_dir.glob("slide-*.png"),
        key=slide_number,
    )
    if not slide_paths:
        raise SystemExit(f"No slide renders found in {args.input_dir}")

    args.output.parent.mkdir(parents=True, exist_ok=True)
    images = [Image.open(slide).convert("RGB") for slide in slide_paths]
    try:
        first, *rest = images
        first.save(
            args.output,
            "PDF",
            save_all=True,
            append_images=rest,
            resolution=120.0,
            quality=95,
        )
        if args.montage_output is not None:
            columns = 2
            thumb_width = 640
            thumb_height = 360
            rows = (len(images) + columns - 1) // columns
            montage = Image.new(
                "RGB",
                (columns * thumb_width, rows * thumb_height),
                "#E5E7E5",
            )
            for index, image in enumerate(images):
                thumbnail = image.resize(
                    (thumb_width, thumb_height),
                    Image.Resampling.LANCZOS,
                )
                montage.paste(
                    thumbnail,
                    ((index % columns) * thumb_width, (index // columns) * thumb_height),
                )
            args.montage_output.parent.mkdir(parents=True, exist_ok=True)
            montage.save(args.montage_output, "WEBP", quality=92, method=6)
            montage.close()
    finally:
        for image in images:
            image.close()


if __name__ == "__main__":
    main()
