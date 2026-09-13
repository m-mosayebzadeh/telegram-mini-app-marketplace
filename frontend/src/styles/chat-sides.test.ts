import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

// Resolved from the project root: vitest runs with the browser-ish
// import.meta.url, which is not a file: URL here.
const css = readFileSync(resolve('src/styles/components/chat-session.css'), 'utf8')

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
