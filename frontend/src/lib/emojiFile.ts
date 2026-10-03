/**
 * Where the picture for an emoji lives.
 *
 * Kept apart from emojiImage.tsx so that file exports only the component: the
 * development server can then swap the component in place on every save
 * instead of reloading the whole app.
 */

/** The picture's file for an emoji: its code points in hex, joined with
 *  dashes, without FE0F. Must match key_of() in scripts/build_emoji.py. */
export function emojiFile(glyph: string): string {
  const points: string[] = []
  for (const char of glyph) {
    const code = char.codePointAt(0) ?? 0
    if (code !== 0xfe0f) points.push(code.toString(16))
  }
  return `/emoji/${points.join('-')}.webp`
}
