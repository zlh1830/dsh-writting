import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

const clientPath = fileURLToPath(new URL('../packages/writing/lib/client.js', import.meta.url))
const expected = /^window\.__ModuleLoader__\.load\(\{\s*id:\s*"@local\/dsh-train-writing"/

let source
try {
  source = await readFile(clientPath, 'utf8')
} catch (error) {
  console.error(`missing client bundle: ${clientPath}`)
  throw error
}

if (!expected.test(source)) {
  console.error(`client bundle does not start with the expected factory banner:\n  expected: ${String(expected)}\n  actual:   ${source.slice(0, 160)}`)
  process.exit(1)
}

console.log(`client bundle ok: ${clientPath} (${source.length} bytes)`)
