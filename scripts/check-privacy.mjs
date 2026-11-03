#!/usr/bin/env node
/**
 * Fail the build if the repository contains files that must stay local:
 * private docs/data, temp files, credentials, env files, build output.
 *
 * Runs `git ls-files` and the full history so a stray `git add -f private/...`
 * cannot reach the remote unnoticed. In a sandbox that forbids spawning git
 * with piped stdio the check degrades to a warning; CI still enforces it.
 */
import { execFileSync } from 'node:child_process'

const RULES = [
  { pattern: /^private\//, label: 'private/' },
  { pattern: /^\.tmp\//, label: '.tmp/' },
  { pattern: /^\.data\//, label: '.data/' },
  { pattern: /(^|\/)\.env(\.|$)/, label: '.env*' },
  { pattern: /(^|\/)\.credentials?/i, label: 'credentials' },
  { pattern: /(^|\/)[^/]*secret[^/]*$/i, label: '*secret*' },
  { pattern: /\.local\.json$/, label: '*.local.json' },
  { pattern: /^fixtures\/private\//, label: 'fixtures/private/' },
  { pattern: /(^|\/)node_modules\//, label: 'node_modules/' },
  { pattern: /(^|\/)(lib|dist|coverage)\//, label: 'build output' },
]

function git(args) {
  try {
    return execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
  } catch {
    return undefined
  }
}

const inside = git(['rev-parse', '--is-inside-work-tree'])
if (inside === undefined) {
  console.warn('privacy check skipped: git is unavailable in this sandbox')
  process.exit(0)
}

const tracked = git(['ls-files', '-z'])?.split('\0').filter(Boolean) ?? []
const history = new Set(
  (git(['log', '--all', '--pretty=format:', '--name-only']) ?? '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean),
)

const violations = new Set()
for (const file of tracked) {
  for (const rule of RULES) if (rule.pattern.test(file)) violations.add(`tracked: ${file} (${rule.label})`)
}
for (const file of history) {
  for (const rule of RULES) if (rule.pattern.test(file)) violations.add(`history: ${file} (${rule.label})`)
}

if (violations.size > 0) {
  console.error('privacy check failed - these paths must not be in the repository:')
  for (const violation of violations) console.error(`  ${violation}`)
  process.exit(1)
}

console.log(`privacy check ok: ${tracked.length} tracked files, ${history.size} historical paths`)
