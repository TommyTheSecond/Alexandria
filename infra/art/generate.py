"""ASCII hero art for the reader (A6 T3), in the style of typewriter art.

A public-domain engraving goes in; characters from a public-domain banned book come out.
Dark pixels take the next letter of the book text, mid tones take ':' or '.', light pixels
become spaces. Output is deterministic.

    python infra/art/generate.py            # writes assets/art/hero-{100,72,40}.txt
"""
import argparse
from itertools import cycle
from pathlib import Path

from PIL import Image, ImageOps

ROOT = Path(__file__).resolve().parents[2]
ART = ROOT / "assets" / "art"
WIDTHS = (100, 72, 40)

DARK = 100  # below this (after equalizing): a letter from the book
MID = 150   # below this: ':' (darker half) or '.'; above: space


def rows_for(cols: int, width: int, height: int) -> int:
    """Characters are about twice as tall as wide, so halve the row count."""
    return max(1, round(cols * height / width * 0.5))


def render(image: Image.Image, text: str, cols: int) -> list[str]:
    letters = [c for c in text if c.isalpha()]
    if not letters:
        raise ValueError("text has no letters")
    rows = rows_for(cols, image.width, image.height)
    # Equalize so a fixed share of cells become letters, dots and spaces, whatever the engraving's tones.
    gray = ImageOps.equalize(image.convert("L").resize((cols, rows), Image.Resampling.LANCZOS))
    pixels = list(gray.getdata())
    next_letter = cycle(letters).__next__

    lines = []
    for r in range(rows):
        line = []
        for v in pixels[r * cols:(r + 1) * cols]:
            if v < DARK:
                line.append(next_letter())
            elif v < MID:
                line.append(":" if v < (DARK + MID) // 2 else ".")
            else:
                line.append(" ")
        lines.append("".join(line))
    return lines


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--image", type=Path, default=ART / "source" / "Ancientlibraryalex.jpg")
    parser.add_argument("--text", type=Path, default=ART / "source" / "leaves-of-grass-1855.txt")
    parser.add_argument("--out", type=Path, default=ART)
    args = parser.parse_args()

    image = Image.open(args.image)
    text = args.text.read_text(encoding="utf-8")
    for cols in WIDTHS:
        out = args.out / f"hero-{cols}.txt"
        out.write_text("\n".join(render(image, text, cols)) + "\n", encoding="utf-8")
        print(f"wrote {out.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
