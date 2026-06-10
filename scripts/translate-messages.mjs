// V1 translation pipeline: messages/en.json -> messages/{hi,kn,...}.json
// via Google Translate API v2.
//
// Per project_rootstalk_localisation_v1_path.md — V1 path. V2 will swap
// the translator backend for IndicTrans2 + glossary review.
//
// Usage:
//   1. Get a Google Cloud Translation API key:
//        https://console.cloud.google.com/apis/credentials
//      Enable the "Cloud Translation API" on the project first.
//   2. export GOOGLE_TRANSLATE_API_KEY=AIza...
//   3. node scripts/translate-messages.mjs
//
// Options (CLI flags):
//   --locales hi,kn,ta    Restrict to listed locales (default: all 12)
//   --dry-run             Print what would be translated, don't call the API
//
// Notes:
//   * Re-running OVERWRITES messages/{locale}.json — they're build outputs.
//     Edit messages/en.json, regenerate.
//   * Cost: Translation v2 charges $20 / 1M chars. The full sweep is
//     roughly 800 strings * 50 chars * 12 locales ≈ 0.5M chars ≈ $10.
//   * ICU placeholders ({name}, {count}) and "#" inside plural branches
//     are wrapped in <span translate="no">…</span> so Google preserves
//     them. The plural shell ({var, plural, one {…} other {…}}) stays
//     English; only the branch text gets translated.

import { readFile, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ALL_TARGETS = ['hi', 'ta', 'te', 'kn', 'ml', 'mr', 'gu', 'pa', 'or', 'bn', 'as', 'ur']
const BATCH_SIZE = 100
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const EN_PATH = join(ROOT, 'messages', 'en.json')

// ---- CLI -------------------------------------------------------------

const argv = process.argv.slice(2)
const flag = (name) => {
  const i = argv.indexOf(name)
  return i === -1 ? undefined : argv[i + 1]
}
const localesArg = flag('--locales')
const dryRun = argv.includes('--dry-run')
const TARGETS = localesArg ? localesArg.split(',').map(s => s.trim()).filter(Boolean) : ALL_TARGETS
for (const t of TARGETS) {
  if (!ALL_TARGETS.includes(t)) {
    console.error(`Unknown locale: ${t} (allowed: ${ALL_TARGETS.join(', ')})`)
    process.exit(1)
  }
}

const KEY = process.env.GOOGLE_TRANSLATE_API_KEY
if (!KEY && !dryRun) {
  console.error('Missing GOOGLE_TRANSLATE_API_KEY. Either set it or pass --dry-run.')
  process.exit(1)
}

// ---- ICU parsing -----------------------------------------------------

// Find top-level {var, plural, …} blocks in `s`. Returns [{start, end, varName, body}, …]
// where end is the index just past the closing brace and body is the text after the
// "plural," keyword up to the matching close.
function findPluralBlocks(s) {
  const blocks = []
  let i = 0
  while (i < s.length) {
    const open = s.indexOf('{', i)
    if (open === -1) break
    let depth = 1
    let j = open + 1
    while (j < s.length && depth > 0) {
      if (s[j] === '{') depth++
      else if (s[j] === '}') depth--
      j++
    }
    if (depth !== 0) break
    const inner = s.slice(open + 1, j - 1)
    const m = inner.match(/^\s*([a-zA-Z_]\w*)\s*,\s*plural\s*,([\s\S]*)$/)
    if (m) blocks.push({ start: open, end: j, varName: m[1], body: m[2] })
    i = j
  }
  return blocks
}

// Split a plural body (the part after "plural,") into branches.
// Each branch is `keyword {content}` (e.g. `one {1 item}`).
function parsePluralBranches(body) {
  const branches = []
  let i = 0
  while (i < body.length) {
    while (i < body.length && /\s/.test(body[i])) i++
    if (i >= body.length) break
    let k = i
    while (k < body.length && !/\s/.test(body[k]) && body[k] !== '{') k++
    const keyword = body.slice(i, k)
    i = k
    while (i < body.length && /\s/.test(body[i])) i++
    if (body[i] !== '{') break
    const open = i
    let depth = 1
    let j = i + 1
    while (j < body.length && depth > 0) {
      if (body[j] === '{') depth++
      else if (body[j] === '}') depth--
      j++
    }
    branches.push({ keyword, content: body.slice(open + 1, j - 1) })
    i = j
  }
  return branches
}

// ---- Placeholder protection -----------------------------------------

// Wrap ICU placeholders, the "#" plural-count token, and URLs so Google's
// HTML mode preserves them verbatim.
const PROTECT_RE = /\{[a-zA-Z_]\w*\}|#|https?:\/\/\S+/g

function protect(s) {
  return s.replace(PROTECT_RE, m => `<span translate="no">${m}</span>`)
}

function unprotect(s) {
  return s
    .replace(/<span translate="no">([^<]+)<\/span>/g, '$1')
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
}

// ---- Leaf extraction -------------------------------------------------

// A "leaf" is a string we send to Google as-is. Plural blocks are split
// into branches (each branch's inner text is its own leaf); the shell
// stays English.
function collectLeaves(s, set) {
  if (!s || !s.trim()) return
  const plurals = findPluralBlocks(s)
  if (plurals.length === 0) {
    set.add(s)
    return
  }
  let cursor = 0
  for (const block of plurals) {
    if (block.start > cursor) collectLeaves(s.slice(cursor, block.start), set)
    for (const br of parsePluralBranches(block.body)) {
      collectLeaves(br.content, set)
    }
    cursor = block.end
  }
  if (cursor < s.length) collectLeaves(s.slice(cursor), set)
}

function walkLeaves(node, set) {
  if (typeof node === 'string') collectLeaves(node, set)
  else if (Array.isArray(node)) node.forEach(n => walkLeaves(n, set))
  else if (node && typeof node === 'object') Object.values(node).forEach(v => walkLeaves(v, set))
}

// ---- Reassembly ------------------------------------------------------

function reassemble(s, dict) {
  if (!s) return s
  if (!s.trim()) return s
  const plurals = findPluralBlocks(s)
  if (plurals.length === 0) {
    return dict.get(s) ?? s
  }
  let out = ''
  let cursor = 0
  for (const block of plurals) {
    if (block.start > cursor) out += reassemble(s.slice(cursor, block.start), dict)
    const branches = parsePluralBranches(block.body)
    const tr = branches.map(br => `${br.keyword} {${reassemble(br.content, dict)}}`)
    out += `{${block.varName}, plural, ${tr.join(' ')}}`
    cursor = block.end
  }
  if (cursor < s.length) out += reassemble(s.slice(cursor), dict)
  return out
}

function transformTree(node, dict) {
  if (typeof node === 'string') return reassemble(node, dict)
  if (Array.isArray(node)) return node.map(n => transformTree(n, dict))
  if (node && typeof node === 'object') {
    const out = {}
    for (const [k, v] of Object.entries(node)) out[k] = transformTree(v, dict)
    return out
  }
  return node
}

// ---- Google Translate v2 --------------------------------------------

async function translateBatch(strings, target) {
  const dict = new Map()
  for (let i = 0; i < strings.length; i += BATCH_SIZE) {
    const chunk = strings.slice(i, i + BATCH_SIZE)
    const protectedChunk = chunk.map(protect)
    const res = await fetch(`https://translation.googleapis.com/language/translate/v2?key=${KEY}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        q: protectedChunk,
        target,
        source: 'en',
        format: 'html',
      }),
    })
    if (!res.ok) {
      const body = await res.text()
      throw new Error(`Translate ${target} failed (${res.status}): ${body.slice(0, 400)}`)
    }
    const j = await res.json()
    j.data.translations.forEach((t, k) => {
      dict.set(chunk[k], unprotect(t.translatedText))
    })
    await new Promise(r => setTimeout(r, 80))
    process.stdout.write('.')
  }
  return dict
}

// ---- Main ------------------------------------------------------------

const en = JSON.parse(await readFile(EN_PATH, 'utf8'))
const leaves = new Set()
walkLeaves(en, leaves)
const leafArr = [...leaves]
console.log(`Source: ${EN_PATH}`)
console.log(`Unique leaf strings: ${leafArr.length}`)
console.log(`Targets: ${TARGETS.join(', ')}`)
if (dryRun) {
  console.log('--dry-run set; not calling the API. First 10 leaves:')
  for (const s of leafArr.slice(0, 10)) console.log(`  ${JSON.stringify(s)}`)
  process.exit(0)
}

for (const target of TARGETS) {
  const t0 = Date.now()
  process.stdout.write(`${target} `)
  const dict = await translateBatch(leafArr, target)
  const translated = transformTree(en, dict)
  const outPath = join(ROOT, 'messages', `${target}.json`)
  await writeFile(outPath, JSON.stringify(translated, null, 2) + '\n', 'utf8')
  console.log(` ${Math.round((Date.now() - t0) / 1000)}s -> messages/${target}.json`)
}
console.log('Done.')
