import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'

// Read from disk rather than imported: vitest hands a CSS import back
// as an empty string, which would make every assertion below pass for
// the wrong reason. Relative to the project root, where vitest runs.
const css = readFileSync('src/styles/components/chat-session.css', 'utf8')

/**
 * Which side a message bubble sits on is one of the very few things in
 * this product that is PHYSICAL rather than logical: yours on the right
 * and theirs on the left, in both languages.
 *
 * People read a conversation by which side it is on before they read a
 * word of it, and that habit comes from every messenger they already
 * use, not from the direction of the script. Written with logical
 * properties it mirrors under RTL, which puts your own messages on the
 * left where they read as the other person talking — a regression that
 * looks correct in code review and only shows up on a Persian screen.
 *
 * So this is asserted against the stylesheet itself: the next person to
 * "fix" the physical properties into logical ones finds out here rather
 * than from a screenshot.
 */
describe('message bubble sides', () => {
  it('flips the alignment back under RTL so yours stays on the right', () => {
    expect(css).toMatch(/\[dir='rtl'\]\s*\.cm-mine\s*\{\s*align-self:\s*flex-start/)
    expect(css).toMatch(/\[dir='rtl'\]\s*\.cm-theirs\s*\{\s*align-self:\s*flex-end/)
  })

  it('sets the tail corner physically, so it stays on the bubble own side', () => {
    expect(css).toContain('border-bottom-right-radius')
    expect(css).toContain('border-bottom-left-radius')
    // A logical corner would travel to the wrong side with the language.
    expect(css).not.toContain('border-end-end-radius')
    expect(css).not.toContain('border-end-start-radius')
  })
})

/**
 * The same rule, on the world's own conversation screen.
 *
 * It was broken there on its first version — written with logical sides,
 * so under Persian your own messages landed on the left — which is exactly
 * the mistake the rule above exists to stop. Hence the same guard, on the
 * stylesheet the new screen actually uses.
 */
const cosmos = readFileSync('src/styles/cosmos.css', 'utf8')

describe('message sides on the conversation screen', () => {
  it('puts yours on the right under a right-to-left language', () => {
    expect(cosmos).toMatch(/\[dir='rtl'\]\s*\.cos-bubble\.is-mine\s*\{\s*align-self:\s*flex-start/)
  })

  it('puts theirs on the left under a right-to-left language', () => {
    expect(cosmos).toMatch(/\[dir='rtl'\]\s*\.cos-bubble\s*\{\s*align-self:\s*flex-end/)
  })
})
