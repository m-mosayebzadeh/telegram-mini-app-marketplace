import { Fragment, useState, type ReactNode } from 'react'

/**
 * Emoji drawn as pictures rather than with the phone's own font.
 *
 * The same message then looks the same on every phone, and as good as
 * Telegram's (TECHNICAL_REQUIREMENTS.md 29.14): the pictures are Microsoft's
 * Fluent 3D set, built into public/emoji/ by scripts/build_emoji.py.
 *
 * Only the pictures actually on screen are fetched — the browser's own
 * lazy loading does that — so a conversation with three emoji costs three
 * small files, not the whole set.
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

/**
 * One emoji as a picture.
 *
 * Falls back to the plain character if there is no picture for it — a
 * brand-new emoji, a flag the set does not draw — so nothing ever shows as
 * a broken image.
 */
export function Emoji({ glyph, size = 22, className = '' }: { glyph: string; size?: number; className?: string }) {
  const [missing, setMissing] = useState(false)
  if (missing) return <span className={`cos-emoji-char ${className}`}>{glyph}</span>
  return (
    <img
      className={`cos-emoji-img ${className}`}
      src={emojiFile(glyph)}
      alt={glyph}
      width={size}
      height={size}
      loading="lazy"
      decoding="async"
      draggable={false}
      onError={() => setMissing(true)}
    />
  )
}

/**
 * An emoji and everything that clings to it: a variation selector, a skin
 * tone, and further emoji joined on with a zero-width joiner.
 *
 * Unicode property escapes rather than a list, so an emoji added to the
 * standard next year is still found; if the set has no picture for it,
 * Emoji above shows it as text.
 */
const EMOJI_RUN =
  /\p{Extended_Pictographic}(?:\u{FE0F}|\p{Emoji_Modifier})?(?:\u{200D}\p{Extended_Pictographic}(?:\u{FE0F}|\p{Emoji_Modifier})?)*/gu

/** Text with its emoji swapped for pictures. Plain text is left as text,
 *  so it can still be selected and copied exactly as written. */
export function EmojiText({ text, size = 22 }: { text: string; size?: number }): ReactNode {
  const parts: ReactNode[] = []
  let last = 0
  for (const match of text.matchAll(EMOJI_RUN)) {
    const at = match.index ?? 0
    if (at > last) parts.push(text.slice(last, at))
    parts.push(<Emoji key={at} glyph={match[0]} size={size} />)
    last = at + match[0].length
  }
  if (last === 0) return text
  if (last < text.length) parts.push(text.slice(last))
  return parts.map((part, index) => <Fragment key={index}>{part}</Fragment>)
}
