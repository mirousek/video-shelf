#!/usr/bin/env python3
"""Migrate data/outputs/ to the new per-project folder structure.

  1. Thumbnails:  outputs/thumb_*.jpg  ->  outputs/thumbs/thumb_*.jpg
  2. Old exports: outputs/*_final.*, outputs/*_0.*, etc.  ->  DELETED

Usage:
    python scripts/migrate_output_layout.py --dry-run   # preview
    python scripts/migrate_output_layout.py              # execute
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.config import settings


def migrate_thumbnails(outputs_dir: Path, *, dry_run: bool) -> int:
    thumbs_dir = outputs_dir / "thumbs"
    moved = 0
    for f in sorted(outputs_dir.glob("thumb_*.jpg")):
        dest = thumbs_dir / f.name
        if dry_run:
            print(f"  [DRY RUN] {f.name} -> thumbs/{f.name}")
        else:
            thumbs_dir.mkdir(parents=True, exist_ok=True)
            f.rename(dest)
            print(f"  {f.name} -> thumbs/{f.name}")
        moved += 1
    return moved


def delete_old_exports(outputs_dir: Path, *, dry_run: bool) -> int:
    deleted = 0
    for f in sorted(outputs_dir.iterdir()):
        if not f.is_file():
            continue
        if f.name.startswith("thumb_"):
            continue
        if dry_run:
            print(f"  [DRY RUN] DELETE {f.name}")
        else:
            f.unlink()
            print(f"  DELETE {f.name}")
        deleted += 1
    return deleted


def main():
    parser = argparse.ArgumentParser(description="Migrate outputs to per-project folders")
    parser.add_argument("--dry-run", action="store_true", help="Preview without changing files")
    args = parser.parse_args()

    outputs_dir = settings.output_dir
    if not outputs_dir.exists():
        print("No outputs directory found. Nothing to migrate.")
        return

    if args.dry_run:
        print("MODE: dry run (no changes)\n")

    print("=== Thumbnails ===")
    thumbs = migrate_thumbnails(outputs_dir, dry_run=args.dry_run)
    print(f"Moved: {thumbs}\n")

    print("=== Old exports ===")
    exports = delete_old_exports(outputs_dir, dry_run=args.dry_run)
    print(f"Deleted: {exports}\n")

    print("Done.")
    if args.dry_run:
        print("This was a dry run. Re-run without --dry-run to apply.")


if __name__ == "__main__":
    main()
