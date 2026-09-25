/**
 * The full list of emoji, grouped the way people look for them.
 *
 * Loaded only when somebody opens the full list (a dynamic import, so the
 * build puts it in its own file): the conversation screen should not carry
 * it on a weak connection for the one time in twenty it is wanted.
 *
 * A chosen set rather than every emoji Unicode defines. The full standard is
 * several thousand, many of them flags and near-duplicates nobody reaches
 * for in a conversation; this keeps the list short enough to scroll and the
 * file small. A phone's own keyboard still offers everything else while
 * writing.
 */

export interface EmojiGroup {
  /** Translation key for the group's heading. */
  key: string
  emoji: string[]
}

/**
 * Splits a run of emoji into single emoji.
 *
 * Written by hand rather than with the browser's Intl.Segmenter, which some
 * phone browsers still lack — there the whole list failed to load and the
 * panel stayed empty. The rules needed are few: a code point joins the one
 * before it when it is a variation selector (U+FE0F, which makes ❤ into ❤️),
 * a skin tone, a keycap mark, or when either side is a zero-width joiner
 * (U+200D, which builds ❤️‍🔥 out of ❤️ and 🔥).
 */
export function splitEmoji(line: string): string[] {
  const out: string[] = []
  let joinNext = false
  for (const point of line) {
    const code = point.codePointAt(0) ?? 0
    const attaches =
      code === 0xfe0f || code === 0x20e3 || code === 0x200d || (code >= 0x1f3fb && code <= 0x1f3ff)
    if (out.length > 0 && (attaches || joinNext)) {
      out[out.length - 1] += point
    } else if (point.trim() !== '') {
      out.push(point)
    }
    joinNext = code === 0x200d
  }
  return out
}

const split = splitEmoji

export const EMOJI_GROUPS: EmojiGroup[] = [
  {
    key: 'faces',
    emoji: split(
      '😀😃😄😁😆😅😂🤣🥲😊😇🙂🙃😉😌😍🥰😘😗😙😚😋😛😝😜🤪🤨🧐🤓😎🥸🤩🥳😏😒😞😔😟😕🙁☹️😣😖😫😩🥺😢😭😤😠😡🤬🤯😳🥵🥶😱😨😰😥😓🤗🤔🫣🤭🫢🤫🤥😶😐😑😬🫠🙄😯😦😧😮😲🥱😴🤤😪😵🫥🤐🥴🤢🤮🤧😷🤒🤕🤑🤠😈👿👹👺🤡💩👻💀👽🤖🎃😺😸😹😻😼😽🙀😿😾',
    ),
  },
  {
    key: 'hands',
    emoji: split(
      '👍👎👏🙌🫶👐🤲🤝🙏✌️🤞🫰🤟🤘👌🤌🤏👈👉👆👇☝️✋🤚🖐️🖖👋🤙💪🦾✍️🫡🤷🙆🙅🙋🤦💃🕺👀🧠🫀',
    ),
  },
  {
    key: 'hearts',
    emoji: split('❤️🧡💛💚💙💜🖤🤍🤎💔❤️‍🔥❤️‍🩹💕💞💓💗💖💘💝💟❣️💌💋🌹🥀'),
  },
  {
    key: 'nature',
    emoji: split(
      '🐶🐱🐭🐹🐰🦊🐻🐼🐨🐯🦁🐮🐷🐸🐵🙈🙉🙊🐔🐧🐦🦆🦉🦋🐝🐢🐍🐙🐬🐳🦈🐘🦒🦄🌸🌼🌻🌷🌱🌿🍀🍁🍂🌵🌴🌙⭐🌟✨⚡🔥🌈☀️🌤️☁️🌧️❄️☃️🌊💧',
    ),
  },
  {
    key: 'food',
    emoji: split(
      '🍎🍊🍋🍌🍉🍇🍓🫐🍒🍑🥭🍍🥥🥝🍅🥑🍆🥕🌽🌶️🥐🍞🧀🥚🍳🥞🍔🍟🍕🌭🥪🌮🌯🥗🍝🍜🍣🍤🍦🍩🍪🎂🍰🧁🍫🍬🍿☕🍵🧃🥤🧋🍺🍷🥂🍾',
    ),
  },
  {
    key: 'activity',
    emoji: split(
      '⚽🏀🏈⚾🎾🏐🏓🏸🥊⛳🎣🏊🚴🧘🏆🥇🎖️🎯🎮🎲🧩🎨🎭🎬🎤🎧🎸🎹🥁🎺🎻📚✈️🚗🚲🏖️⛰️🏕️🗺️🎉🎊🎁🎈🪅',
    ),
  },
  {
    key: 'things',
    emoji: split(
      '📱💻⌚📷🎥💡🔦🕯️📖✏️📌📎🔑🗝️🔒🎀💎💰💸⏰⌛🧸🪄🔮🧿💯✅❌❓❗‼️⁉️💤💥💢💫💬💭🗯️🆗🆒🆕🔝🔜',
    ),
  },
]
