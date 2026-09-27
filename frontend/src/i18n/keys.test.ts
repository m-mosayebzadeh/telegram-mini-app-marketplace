import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, it, expect } from 'vitest'
import fa from './locales/fa.json'
import en from './locales/en.json'

/**
 * Every sentence the code asks for exists, in every language.
 *
 * A key the code asks for but the files do not have is shown to people as
 * the raw key — an English identifier in the middle of the screen. That
 * happened: the top-up error message was asked for for months and never
 * written. This reads every literal t('…') call in the source and checks
 * it against both files, so the next one is caught here instead.
 *
 * Only literal keys can be checked; keys built at run time (with a
 * template) are covered by the tests of the screens that build them.
 */

type Tree = { [key: string]: string | Tree }

function has(tree: Tree, key: string): boolean {
  let node: string | Tree = tree
  for (const part of key.split('.')) {
    if (typeof node !== 'object') return false
    if (part in node) {
      node = node[part]
      continue
    }
    // A plural is stored as name_one, name_other.
    return Object.keys(node).some((k) => k.startsWith(`${part}_`))
  }
  return true
}

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) return sources(path)
    return /\.(ts|tsx)$/.test(entry.name) && !/\.test\./.test(entry.name) ? [path] : []
  })
}

const used = new Map<string, string>()
for (const file of sources(join(__dirname, '..'))) {
  for (const match of readFileSync(file, 'utf8').matchAll(/\bt\(\s*'([A-Za-z0-9_]+(?:\.[A-Za-z0-9_]+)+)'/g)) {
    used.set(match[1], file)
  }
}

describe('the words the code asks for', () => {
  it('finds some to check', () => {
    expect(used.size).toBeGreaterThan(100)
  })

  it.each([
    ['Persian', fa as Tree],
    ['English', en as Tree],
  ])('are all written in %s', (_, tree) => {
    const missing = [...used].filter(([key]) => !has(tree, key)).map(([key, file]) => `${key} (${file})`)
    expect(missing).toEqual([])
  })
})
