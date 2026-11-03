#!/usr/bin/env node
/**
 * Validate the private documentation index. The private tree is intentionally
 * absent from public clones/CI, so this check skips cleanly when it is missing.
 */
import { existsSync } from 'node:fs'
import { readdir, readFile } from 'node:fs/promises'
import { dirname, extname, join, relative, resolve } from 'node:path'

const root = resolve(process.cwd(), 'private', 'docs')
if (!existsSync(root)) {
  console.log('private docs absent; skipped')
  process.exit(0)
}

const indexPath = join(root, 'INDEX.md')
const handoffPath = join(root, 'HANDOFF.md')
const files = await walk(root)
const markdown = files.filter((file) => extname(file) === '.md')
const failures = []

for (const file of markdown) {
  const content = await readFile(file, 'utf8')
  const rel = relative(root, file).split('\\').join('/')
  if (rel !== 'INDEX.md' && rel !== 'HANDOFF.md') {
    if (!content.includes('文档索引')) failures.push(`${rel}: missing 文档索引 header`)
    const links = parseLinks(content)
    const linksToIndex = links.some((target) => resolveLink(file, target) === indexPath)
    if (!linksToIndex) failures.push(`${rel}: missing link to INDEX.md`)
  }
  for (const target of parseLinks(content)) {
    if (!target.toLowerCase().endsWith('.md') && !target.includes('.md#')) continue
    const resolved = resolveLink(file, target)
    if (!existsSync(resolved)) failures.push(`${rel}: broken link ${target}`)
  }
}

if (existsSync(indexPath)) {
  const index = await readFile(indexPath, 'utf8')
  for (const file of markdown) {
    const rel = relative(root, file).split('\\').join('/')
    if (rel === 'INDEX.md' || rel === 'HANDOFF.md') continue
    if (!index.includes(`](${rel}`)) failures.push(`INDEX.md: missing entry for ${rel}`)
  }
} else {
  failures.push('INDEX.md: missing')
}

if (!existsSync(handoffPath)) {
  failures.push('HANDOFF.md: missing')
} else {
  const handoff = await readFile(handoffPath, 'utf8')
  if (!/^## .*下一步/mu.test(handoff)) failures.push('HANDOFF.md: missing "## 下一步"')
  if (!handoff.includes('INDEX.md')) failures.push('HANDOFF.md: missing INDEX.md link')
  if (!handoff.includes('m2-plan.md')) failures.push('HANDOFF.md: missing current plan link')
  if (!handoff.includes('m2-acceptance.md')) failures.push('HANDOFF.md: missing current test link')
}

if (failures.length > 0) {
  console.error('doc index check failed:')
  for (const failure of failures) console.error(`  ${failure}`)
  process.exit(1)
}

console.log(`doc index ok: ${markdown.length} documents, ${markdown.length - 2} indexed`)

async function walk(dir) {
  const entries = await readdir(dir, { withFileTypes: true })
  const out = []
  for (const entry of entries) {
    const target = join(dir, entry.name)
    if (entry.isDirectory()) out.push(...(await walk(target)))
    else if (entry.isFile()) out.push(target)
  }
  return out
}

function parseLinks(content) {
  const links = []
  const matcher = /\[[^\]]*\]\(([^)]+)\)/gu
  let match
  while ((match = matcher.exec(content)) !== null) {
    let target = match[1].trim()
    if (target.startsWith('<') && target.endsWith('>')) target = target.slice(1, -1)
    target = target.replace(/\s+["'][^"']*["']$/u, '').split('#')[0]?.trim() ?? ''
    if (target.length === 0) continue
    if (/^[a-z]+:/iu.test(target) || target.startsWith('#')) continue
    try {
      target = decodeURIComponent(target)
    } catch {
      // Keep the raw target when it is not percent-encoded.
    }
    links.push(target)
  }
  return links
}

function resolveLink(fromFile, target) {
  return resolve(dirname(fromFile), target)
}
