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
    finally:
        for image in images:
            image.close()


if __name__ == "__main__":
    main()
