// Bundles gen.ts (+ the Electron sources it imports) and runs it. Output: tests/fixtures/*.json
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, join, resolve } from 'node:path'
import { mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'

const here = dirname(fileURLToPath(import.meta.url))
const electron = resolve(here, '../../../MyTerm(electron)')
const outfile = join(tmpdir(), 'myterm-fixtures-gen.mjs')
const target = resolve(here, '../../tests/fixtures')
mkdirSync(target, { recursive: true })
// The Electron checkout is read-only reference and may have no node_modules: `FIXTURE_DEPS` points at
// a folder holding zod and esbuild (the versions of its package-lock).
const deps = process.env.FIXTURE_DEPS ? resolve(process.env.FIXTURE_DEPS, 'node_modules') : join(electron, 'node_modules')
process.env.NODE_PATH = deps
execFileSync(
  join(deps, '@esbuild/win32-x64/esbuild.exe'),
  [
    join(here, 'gen.ts'),
    '--bundle',
    '--platform=node',
    '--format=esm',
    `--outfile=${outfile}`,
    `--alias:@shared=${join(electron, 'src/shared')}`,
    '--log-level=warning',
  ],
  { stdio: 'inherit' },
)
// From C:\ on purpose: the cwd cases resolve rooted paths against the process's drive, and the Rust test pins the same one.
execFileSync(process.execPath, [outfile, target], { stdio: 'inherit', cwd: 'C:\\' })
