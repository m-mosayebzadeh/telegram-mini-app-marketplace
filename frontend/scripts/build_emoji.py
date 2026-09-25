"""
Builds the app's emoji from Microsoft's Fluent Emoji (MIT licence).

Why images at all: a phone draws emoji with its own font, so the same
message looks different on every phone, and on some it looks poor. Telegram
shows its own images instead, and the owner asked for that quality. Apple's
set, which Telegram uses, is not licensed to us; Fluent's 3D set is the
closest in feel and free to use (TECHNICAL_REQUIREMENTS.md 29.14).

What it does:
  1. reads the Fluent repository as downloaded (a zip) and Unicode's own
     emoji-test.txt, which gives the order and grouping people expect —
     Fluent's files come in no useful order;
  2. writes each emoji, in every skin tone Fluent draws, as a small WebP
     into frontend/public/emoji/, named by its code points;
  3. writes frontend/src/lib/emojiSet.ts, the grouped, ordered list the
     picker loads on demand.

Run it again only when updating the set:
    python frontend/scripts/build_emoji.py <fluentui-emoji.zip> <emoji-test.txt> [--data-only]
(--data-only rewrites the list without re-drawing the pictures)
(needs Pillow, which the backend's environment already has).

The source zip is not kept in the repository; only the small results are.
"""

from __future__ import annotations

import io
import json
import sys
import zipfile
from pathlib import Path

from PIL import Image

#: Drawn size. The picker shows emoji at about 32px and messages at about
#: 22px; 72px covers a phone's 2x–3x screen at those sizes while keeping a
#: file near 4 KB, which matters on a weak connection.
SIZE = 72
QUALITY = 80

FRONTEND = Path(__file__).resolve().parent.parent
OUT_DIR = FRONTEND / "public" / "emoji"
OUT_TS = FRONTEND / "src" / "lib" / "emojiSet.ts"

#: Unicode's group names, to the keys the app translates.
GROUPS = {
    "Smileys & Emotion": "smileys",
    "People & Body": "people",
    "Animals & Nature": "animals",
    "Food & Drink": "food",
    "Travel & Places": "travel",
    "Activities": "activities",
    "Objects": "objects",
    "Symbols": "symbols",
    "Flags": "flags",
}

#: Fluent's folder for each skin-tone modifier.
TONE_FOLDERS = {
    "1f3fb": "Light",
    "1f3fc": "Medium-Light",
    "1f3fd": "Medium",
    "1f3fe": "Medium-Dark",
    "1f3ff": "Dark",
}
TONES = set(TONE_FOLDERS)


def key_of(codepoints: list[str]) -> str:
    """The file name for an emoji: its code points, lower-case, joined with
    dashes, without the variation selector FE0F — which some sources write
    and others leave out for the same emoji. The app computes the same key
    from the text it shows (frontend/src/lib/emojiImage.ts)."""
    return "-".join(cp.lower() for cp in codepoints if cp.lower() != "fe0f")


def find_png(names: set[str], folder: str) -> str | None:
    """The 3D picture inside one asset folder (or one of its tone folders)."""
    prefix = folder.rstrip("/") + "/3D/"
    for name in names:
        if name.startswith(prefix) and name.endswith(".png") and name.count("/") == prefix.count("/"):
            return name
    return None


def main(zip_path: str, test_path: str) -> None:
    archive = zipfile.ZipFile(zip_path)
    names = set(archive.namelist())

    # key -> path of the PNG inside the zip
    pictures: dict[str, str] = {}
    # plain key -> the glyphs of its skin-tone versions, lightest first
    tone_versions: dict[str, list[str]] = {}

    for name in names:
        if not name.endswith("/metadata.json") or name.count("/") != 3:
            continue
        folder = name.rsplit("/", 1)[0]
        meta = json.loads(archive.read(name))
        base = key_of(meta["unicode"].split())

        plain = find_png(names, folder)
        if plain:
            pictures[base] = plain
            continue

        default = find_png(names, folder + "/Default")
        if default:
            pictures[base] = default
        for toned in meta.get("unicodeSkintones", []):
            points = toned.split()
            modifier = next((p for p in points if p.lower() in TONES), None)
            if modifier is None:
                continue
            picture = find_png(names, f"{folder}/{TONE_FOLDERS[modifier.lower()]}")
            if picture:
                pictures[key_of(points)] = picture
                tone_versions.setdefault(base, []).append("".join(chr(int(p, 16)) for p in points))

    # Unicode's order and groups, keeping only emoji Fluent actually draws,
    # and only the plain form of each (tones are offered from the plain one).
    groups: dict[str, list[str]] = {key: [] for key in GROUPS.values()}
    group = None
    for line in Path(test_path).read_text(encoding="utf-8").splitlines():
        if line.startswith("# group:"):
            group = GROUPS.get(line.split(":", 1)[1].strip())
            continue
        if group is None or "; fully-qualified" not in line:
            continue
        points = line.split(";", 1)[0].split()
        if any(p.lower() in TONES for p in points):
            continue
        key = key_of(points)
        if key in pictures:
            glyph = "".join(chr(int(p, 16)) for p in points)
            if glyph not in groups[group]:
                groups[group].append(glyph)

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    (OUT_DIR / "LICENSE").write_bytes(archive.read(next(n for n in names if n.endswith("/LICENSE"))))
    written = 0
    total_bytes = 0
    for key, source in sorted(pictures.items()) if "--data-only" not in sys.argv else []:
        image = Image.open(io.BytesIO(archive.read(source))).convert("RGBA")
        image = image.resize((SIZE, SIZE), Image.LANCZOS)
        target = OUT_DIR / f"{key}.webp"
        image.save(target, "WEBP", quality=QUALITY, method=6)
        written += 1
        total_bytes += target.stat().st_size

    # Keyed by the plain emoji exactly as the picker lists it (with FE0F
    # where Unicode writes it), so the picker can look its tones up.
    listed = {key_of([f"{ord(c):x}" for c in glyph]): glyph for items in groups.values() for glyph in items}
    tones = {
        listed[base]: sorted(versions, key=lambda g: [ord(c) for c in g])
        for base, versions in tone_versions.items()
        if base in listed
    }
    lines = [
        "// Generated by frontend/scripts/build_emoji.py from Microsoft's Fluent",
        "// Emoji (MIT) and Unicode's emoji-test.txt. Do not edit by hand.",
        "",
        "/** One group of the picker, in Unicode's own order. */",
        "export interface EmojiGroup {",
        "  /** Translation key for the group's heading. */",
        "  key: string",
        "  emoji: string[]",
        "}",
        "",
        "export const EMOJI_GROUPS: EmojiGroup[] = " + json.dumps(
            [{"key": key, "emoji": items} for key, items in groups.items() if items],
            ensure_ascii=False,
        ),
        "",
        "/** Skin-tone versions of the emoji that have them, lightest first,",
        " *  keyed by the plain emoji as the picker lists it. */",
        "export const TONES: Record<string, string[]> = " + json.dumps(tones, ensure_ascii=False),
        "",
    ]
    OUT_TS.write_text("\n".join(lines), encoding="utf-8", newline="\n")

    count = sum(len(items) for items in groups.values())
    print(f"{written} pictures, {total_bytes / 1024 / 1024:.1f} MB; {count} emoji in the picker, {len(tones)} with tones")


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
