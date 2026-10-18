// Differential fixtures: runs the *Electron 0.5.0 code* on a corpus and records
// its answers, so the Rust port is checked against the original, not against a
// re-reading of it. Read-only on MyTerm(electron)/. Run with gen.mjs.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { LayoutSchema } from '@shared/schema/layout'
import { describeFailure, formatZodError } from '@shared/schema/format-error'
import {
  addPane,
  movePane,
  panesNeedingRestart,
  removePane,
  setProjectColor,
  updatePane,
} from '@shared/schema/layout-edit'
import { emptyIntents, mergePreferences } from '@shared/schema/preferences-merge'
import { PreferencesSchema } from '@shared/schema/preferences'
import { commandsHash } from '@shared/trust-hash'
import { palettes, projectChrome } from '../../../MyTerm(electron)/src/renderer/theme/palette'
import { serialiseJson } from '../../../MyTerm(electron)/src/main/util/atomic-write'
import { readLayout, resolvePanes } from '../../../MyTerm(electron)/src/main/services/workspace'
import { createHash } from 'node:crypto'
import { LOGO_ACCENT, rasterizeLogo } from '../../../MyTerm(electron)/src/main/util/logo-icon'
import { appUserModelId, windowAppUserModelId } from '../../../MyTerm(electron)/src/main/util/app-id'
import { listEditors, resolveEditorPath } from '../../../MyTerm(electron)/src/main/services/external-editor'
import { formatAge, formatCountdown, formatUtilization, formatWindowLabel, normaliseWindow, quotaTone, toEpochMs } from '@shared/quota'
import { cpuBusyPercent, formatGiB, memoryPercent } from '@shared/system-load'
import { isCodexTokenExpired, isTokenExpired, parseClaudePayload, parseCodexPayload } from '../../../MyTerm(electron)/src/main/services/usage-parse'
import { nextPollDelayMs, snapshotAfterFailure } from '../../../MyTerm(electron)/src/main/services/usage-poller'
import { resolveCwd } from '../../../MyTerm(electron)/src/main/util/resolve-cwd'

// Deterministic PRNG so the corpus is reproducible.
let seed = 0x9e3779b1
const rnd = () => {
  seed = (Math.imul(seed ^ (seed >>> 15), 0x2c1b3c6d) + 0x297a2d39) >>> 0
  return seed / 2 ** 32
}
const pick = <T>(a: readonly T[]): T => a[Math.floor(rnd() * a.length)]!
const int = (n: number) => Math.floor(rnd() * n)

// ---------- A. readLayout over raw text ----------
const valid = {
  version: 2,
  name: 'demo',
  color: 'blue',
  theme: 'dark',
  defaults: { shell: 'cmd', cwd: 'sub' },
  panes: [
    { id: 'claude-1', title: 'Claude', command: 'claude', color: 'red', collapsed: true },
    { id: 'web', title: 'frontend', cwd: 'frontend', shell: 'bash', command: 'npm run dev' },
    { id: 'free' },
  ],
}
const v1 = {
  version: 1,
  name: 'demo',
  grid: { cols: 2, rows: 2 },
  panes: [
    { id: 'd', col: 1, row: 1 },
    { id: 'a', col: 0, row: 0 },
    { id: 'c', col: 0, row: 1 },
    { id: 'b', col: 1, row: 0, command: 'x', extra: 1 },
  ],
}
const junk: unknown[] = [
  null, true, false, 0, 1, 2, 3, -1, 1.5, 'x', '', 'pwsh', [], [1], {}, { id: 'z' }, { id: '' }, { id: 3 },
  ['a'], { shell: 'zsh' }, { cwd: 3 }, 'red', 'turquoise', '#ff0000', 'oui', 25,
]
function clone<T>(x: T): T {
  return JSON.parse(JSON.stringify(x))
}
function mutate(base: any): any {
  const o = clone(base)
  const n = 1 + int(3)
  for (let i = 0; i < n; i++) {
    const target =
      rnd() < 0.5 && Array.isArray(o.panes) && o.panes.length && typeof o.panes[0] === 'object'
        ? pick(o.panes)
        : o
    if (target === null || typeof target !== 'object') continue
    const keys = ['version', 'name', 'color', 'theme', 'defaults', 'panes', 'id', 'title', 'cwd', 'shell', 'command', 'collapsed', 'col', 'row', 'grid', 'extra']
    const k = pick(keys)
    if (rnd() < 0.2) delete target[k]
    else
      target[k] =
        rnd() < 0.15 && k === 'panes'
          ? Array.from({ length: int(30) }, (_, j) => ({ id: `p${j % 26}` }))
          : pick(junk)
  }
  return o
}
const texts: string[] = []
const add = (v: unknown) => texts.push(typeof v === 'string' ? v : JSON.stringify(v))
add(valid)
add(v1)
add({ ...valid, version: 3 })
add({ ...valid, version: 2.0 })
add({ ...valid, panes: [] })
texts.push('', '   \n', '\ufeff' + JSON.stringify(valid), '\ufeff' + JSON.stringify(v1), '{', 'nul', '[1,2', '{"version":2,}')
texts.push(JSON.stringify(valid, null, 2), '  ' + JSON.stringify(valid) + '\n\n')
texts.push('{"version":2,"panes":[{"id":"a","id":"b"}]}', '{"version":2,"panes":[{"id":"a"}],"version":2}')
texts.push('{"version":2,"panes":[{"id":"é\\u0000"}]}', '{"version":2,"panes":[{"id":"a","title":"\\ud800"}]}')
for (const n of [24, 25, 30]) add({ version: 2, panes: Array.from({ length: n }, (_, j) => ({ id: `p${j}` })) })
add({ version: 2, panes: Array.from({ length: 30 }, (_, j) => ({ id: `p${j % 26}` })) })
add({ version: 2, panes: [{ id: 'a' }, { id: 'a' }, { id: 'a' }, { id: '' }, { id: 3 }] })
add({ version: 2, panes: [{ id: 'a', color: 'x', shell: 'q', title: 4 }, 3, { id: 'a' }] })
for (let i = 0; i < 600; i++) add(mutate(pick([valid, v1, { version: 2, panes: [{ id: 'a' }] }])))
for (const j of junk) add(j)
for (const j of junk) add({ version: 2, panes: [j] })
for (const j of junk)
  add({
    version: 2,
    panes: [
      {
        id: 'a',
        ...(typeof j === 'object' && j ? j : { title: j, cwd: j, shell: j, command: j, color: j, collapsed: j }),
      },
    ],
  })

const dir = mkdtempSync(join(tmpdir(), 'myterm-fx-'))
const layoutCases: unknown[] = []
for (const text of texts) {
  writeFileSync(join(dir, '.myterm.json'), text, 'utf8')
  const r = await readLayout(dir)
  layoutCases.push(
    r.ok
      ? { text, ok: true, json: serialiseJson(r.layout) }
      : {
          text,
          ok: false,
          kind: r.failure.kind,
          message: r.failure.kind === 'malformed-json' ? null : describeFailure(r.failure),
        },
  )
}
rmSync(dir, { recursive: true, force: true })

// ---------- B. layout edits ----------
const bases = [
  LayoutSchema.parse(valid),
  LayoutSchema.parse({ version: 2, panes: [{ id: 'a', cwd: 'frontend', command: 'npm run dev' }, { id: 'b' }] }),
  LayoutSchema.parse({ version: 2, panes: [{ id: 'only' }] }),
  LayoutSchema.parse({ version: 2, panes: Array.from({ length: 24 }, (_, i) => ({ id: `p${i}` })) }),
  LayoutSchema.parse({ version: 2, panes: [{ id: 'pane-2' }, { id: 'pane-3' }] }),
]
const ids = ['a', 'b', 'only', 'web', 'free', 'p3', 'pane-2', 'nope', '', 'claude-1']
const colors = ['red', 'orange', 'yellow', 'green', 'cyan', 'blue', 'purple', 'pink']
const editCases: unknown[] = []
const res = (r: any) => (r.ok ? { ok: true, json: serialiseJson(r.layout) } : { ok: false, message: r.message })
for (let i = 0; i < 500; i++) {
  const bi = int(bases.length)
  const base = bases[bi]!
  const kind = pick(['add', 'remove', 'move', 'update', 'color'] as const)
  const id = pick(ids)
  if (kind === 'add') editCases.push({ base: bi, op: 'add', result: res(addPane(base)) })
  else if (kind === 'remove') editCases.push({ base: bi, op: 'remove', id, result: res(removePane(base, id)) })
  else if (kind === 'move') {
    const d = pick(['up', 'down'] as const)
    editCases.push({ base: bi, op: 'move', id, dir: d, result: res(movePane(base, id, d)) })
  } else if (kind === 'color') {
    const c = rnd() < 0.3 ? undefined : pick(colors)
    editCases.push({ base: bi, op: 'color', color: c ?? null, result: res(setProjectColor(base, c as any)) })
  } else {
    // patch values: concrete value, or null = `undefined` (clears an optional field)
    const patch: Record<string, unknown> = {}
    const fields: [string, () => unknown][] = [
      ['id', () => pick(ids)],
      ['title', () => pick(['', 'T', 'é'])],
      ['cwd', () => pick(['.', 'x', 'a/b', ''])],
      ['shell', () => pick(['pwsh', 'cmd', 'bash', 'powershell'])],
      ['command', () => pick(['', 'npm run build', 'claude'])],
      ['color', () => pick(colors)],
      ['collapsed', () => pick([true, false])],
    ]
    for (const [k, f] of fields)
      if (rnd() < 0.3) patch[k] = ['shell', 'command', 'color', 'collapsed'].includes(k) && rnd() < 0.3 ? null : f()
    const real = Object.fromEntries(Object.entries(patch).map(([k, v]) => [k, v === null ? undefined : v]))
    editCases.push({ base: bi, op: 'update', id, patch, result: res(updatePane(base, id, real as any)) })
  }
}
// panesNeedingRestart: `b` is derived from `a` by an edit, so both sides are full layouts.
const restartCases: unknown[] = []
for (let i = 0; i < 200; i++) {
  const a = pick(bases)
  let b = pick(bases)
  if (rnd() < 0.7) {
    const r = updatePane(a, pick(ids), {
      cwd: pick(['.', 'z']),
      shell: pick([undefined, 'cmd', 'pwsh']) as any,
      command: pick([undefined, 'q']),
    })
    if (r.ok) b = r.layout
  }
  restartCases.push({ a: serialiseJson(a), b: serialiseJson(b), result: panesNeedingRestart(a, b) })
}
const basesOut = bases.map((b) => serialiseJson(b))

// ---------- C. trust hash (on resolved panes) ----------
const shells = ['pwsh', 'cmd', 'bash', 'powershell']
const idPool = ['a', 'B', 'b', 'claude-1', 'claude_1', 'claude-2', 'Web', 'web', 'api', 'é', 'e', 'z', 'Z', '1', '10', '2', 'a b', 'a-b', 'ab', 'a_b', 'a.b', 'A', 'a\u0001', '\u0001a', 'ß', 'ss', '日本', 'x/y', 'x\\y']
const cwdPool = ['C:\\proj', 'C:\\Proj\\', 'c:\\proj\\Frontend', 'C:\\proj\\é', 'C:\\proj\\', 'D:/x/', 'C:\\a\\\\', '']
const cmdPool = ['npm run dev', 'claude', 'a "q" \\ b', 'tab\there', 'nl\nx', 'é😀', '\u2028', '\u0001', 'x']
const trustCases: unknown[] = []
for (let i = 0; i < 400; i++) {
  const n = 1 + int(6)
  const used = new Set<string>()
  const panes = [] as any[]
  for (let j = 0; j < n; j++) {
    const id = pick(idPool)
    if (used.has(id)) continue
    used.add(id)
    const p: any = { id, title: 't', cwd: pick(cwdPool), shell: pick(shells) }
    if (rnd() < 0.75) p.command = pick(cmdPool)
    if (rnd() < 0.1) p.command = ''
    panes.push(p)
  }
  trustCases.push({ panes, hash: commandsHash(panes) })
}
// string-compare pairs, to pin the collation
const cmpPairs: unknown[] = []
const alpha = ['a', 'A', 'b', 'B', '-', '_', ' ', '1', '9', '.', 'é', '\u0001', 'z', 'Z', '/', '\t', ':', 'ß']
for (let i = 0; i < 2000; i++) {
  const mk = () => Array.from({ length: int(5) }, () => pick(alpha)).join('')
  const a = mk()
  const b = mk()
  cmpPairs.push({ a, b, r: Math.sign(a.localeCompare(b)) })
}

// ---------- D. preference merge ----------
const pathPool = ['C:\\A', 'c:\\a', 'C:\\A\\', 'C:\\B', 'C:\\b\\', 'C:\\Proj\\x', 'D:\\z', 'C:\\é', '/home/P', '/home/p']
const dates = ['2026-01-01T00:00:00Z', '2026-06-01T00:00:00.123Z', '2026-06-01T00:00:00Z', '2026-12-31T23:59:59.999Z', '2025-01-01T00:00:00.000Z', 'x', '']
const mkPrefs = (): any => ({
  version: 1,
  theme: pick(['light', 'dark', 'system']),
  recentProjects: Array.from({ length: int(18) }, () => ({
    path: pick(pathPool),
    name: 'n',
    lastOpenedAt: pick(dates),
    ...(rnd() < 0.2 ? { missing: true } : {}),
  })),
  trustedProjects: Array.from({ length: int(5) }, () => ({ path: pick(pathPool), commandsHash: pick(['h1', 'h2', 'h3']) })),
  window: {
    width: 480 + int(900),
    height: 320 + int(500),
    maximized: rnd() < 0.5,
    ...(rnd() < 0.4 ? { x: int(100) - 20, y: int(100) } : {}),
  },
})
const mergeCases: unknown[] = []
for (let i = 0; i < 600; i++) {
  const platform = pick(['win32', 'linux'])
  const disk = mkPrefs()
  const ours = mkPrefs()
  if (rnd() < 0.15)
    disk.trustedProjects = Array.from({ length: 200 }, (_, k) => ({ path: `C:\\T${k}`, commandsHash: `h${k}` }))
  if (rnd() < 0.2)
    disk.recentProjects = Array.from({ length: 15 }, (_, k) => ({
      path: `C:\\R${k}`,
      name: 'n',
      lastOpenedAt: `2026-01-${String(k + 1).padStart(2, '0')}T00:00:00Z`,
    }))
  const key = (p: string) => {
    const t = p.replace(/[\\/]+$/, '')
    return platform === 'win32' ? t.toLowerCase() : t
  }
  const it = emptyIntents()
  for (const k of ['theme', 'window'] as const) if (rnd() < 0.4) it.dirtyKeys.add(k)
  const rem: any[] = []
  const tr: any[] = []
  for (let k = int(3); k > 0; k--) {
    const e = { path: pick(pathPool), name: 'n', lastOpenedAt: pick(dates) }
    it.remembered.set(key(e.path), e)
    rem.push([key(e.path), e])
  }
  for (let k = int(3); k > 0; k--) {
    const e = { path: pick(pathPool), commandsHash: pick(['n1', 'n2']) }
    it.trusted.set(key(e.path), e)
    tr.push([key(e.path), e])
  }
  for (let k = int(3); k > 0; k--) it.forgotten.add(key(pick(pathPool)))
  for (let k = int(3); k > 0; k--) it.revoked.add(key(pick(pathPool)))
  const merged = mergePreferences(disk, ours, it, platform)
  mergeCases.push({
    platform,
    disk,
    ours,
    intents: {
      dirtyKeys: [...it.dirtyKeys],
      remembered: [...it.remembered],
      forgotten: [...it.forgotten],
      trusted: [...it.trusted],
      revoked: [...it.revoked],
    },
    merged: JSON.parse(JSON.stringify(merged)),
  })
}

// preferences validation (zod messages)
const prefInputs: unknown[] = [
  { version: 1 }, { version: 2 }, {}, null, [], 'x', { version: 1, theme: 'blue' },
  { version: 1, recentProjects: [{ path: '', name: 1 }] },
  { version: 1, trustedProjects: 'x' },
  { version: 1, window: { width: 100, height: 10.5, maximized: 'y' } },
  { version: 1, window: { x: 1.5 } },
  { version: 1, window: { width: 1 }, recentProjects: [{ path: 'C:\\x', name: 'n', lastOpenedAt: 'd', missing: true, extra: 1 }], extra: 2 },
  { version: 1, window: { width: 1e300 } }, { version: 1, window: { width: 9007199254740993 } }, { version: 1, window: { width: 'x', height: null } },
  { version: 1, window: { width: 480, height: 320, x: 1e21 } }, { version: 1, window: null }, { version: 1, recentProjects: [null, 3, []] },
  { version: 1, window: { width: 800.0, height: 600 } }, { version: 1, window: { x: -0 } },
  { version: 1, theme: 'dark', window: { width: 800, height: 600, x: -5, y: 3, maximized: true }, trustedProjects: [{ path: 'p', commandsHash: 'h' }] },
]
const prefCases = prefInputs.map((input) => {
  const r = PreferencesSchema.safeParse(input)
  return {
    input,
    ok: r.success,
    ...(r.success ? { data: JSON.parse(JSON.stringify(r.data)) } : { problems: formatZodError(r.error) }),
  }
})

// ---------- E. resolveCwd (Windows semantics) ----------
const roots = ['C:\\Users\\dev\\proj', 'C:\\Proj\\', 'c:\\proj', 'D:\\', '\\\\srv\\share\\p', 'C:\\a b\\c']
const cwds = ['.', '', 'frontend', 'a/b', 'a\\b', '../x', '../../Windows', 'C:\\Windows', 'c:\\users\\dev\\proj\\sub', 'C:\\Users\\dev\\proj2', 'frontend/../../other', 'a/./b/../c', '/abs', '\\abs', 'D:rel', '\\\\srv\\share\\p\\q', '\\\\srv\\share\\other', 'C:\\Proj\\x', 'sub\\', 'é/ü', '..', '...', 'a/..', 'C:\\proj']
const cwdCases: unknown[] = []
for (const root of roots)
  for (const cwd of cwds) {
    try {
      cwdCases.push({ root, cwd, ok: true, path: resolveCwd(root, cwd) })
    } catch (e: any) {
      cwdCases.push({ root, cwd, ok: false, message: e.message })
    }
  }

// resolvePanes on a real directory tree
const rdir = mkdtempSync(join(tmpdir(), 'myterm-rp-'))
mkdirSync(join(rdir, 'frontend'))
mkdirSync(join(rdir, 'a', 'b'), { recursive: true })
const rel = (s: string) => s.split(rdir).join('<ROOT>')
const deepRel = (x: any): any =>
  typeof x === 'string' ? rel(x) : Array.isArray(x) ? x.map(deepRel) : x && typeof x === 'object' ? Object.fromEntries(Object.entries(x).map(([k, v]) => [k, deepRel(v)])) : x
const rpLayouts = [
  { version: 2, name: 'r', panes: [{ id: 'a', command: 'x' }, { id: 'f', cwd: 'frontend', shell: 'cmd', command: 'y', title: 'F' }, { id: 'ghost', cwd: 'nope' }, { id: 'out', cwd: '../..', command: 'z' }, { id: 'abs', cwd: join(rdir, 'a', 'b') }] },
  { version: 2, defaults: { shell: 'bash', cwd: 'frontend' }, panes: [{ id: 'd' }, { id: 'e', cwd: '' }] },
]
const resolveCases = rpLayouts.map((l) => {
  const layout = LayoutSchema.parse(l)
  const o = resolvePanes(rdir, layout)
  return {
    layout: deepRel(l),
    panes: o.panes.map((p) => ({ ...p, cwd: rel(p.cwd) })),
    warnings: o.warnings.map((w) => ({ ...w, message: rel(w.message) })),
    hash: commandsHash(o.panes),
  }
})
rmSync(rdir, { recursive: true, force: true })

const paletteCases = Object.entries(palettes).map(([name, p]) => ({ name, ansi: p.ansi, chrome: p.chrome, paneBorder: p.paneBorder }))

const colorsOrNone = [undefined, 'red', 'orange', 'yellow', 'green', 'cyan', 'blue', 'purple', 'pink'] as const
const chromeCases = (['light', 'dark'] as const).flatMap((theme) => colorsOrNone.map((color) => ({ theme, color: color ?? null, chrome: projectChrome(theme, color) })))
const logoCases = [LOGO_ACCENT, palettes.dark.paneBorder.red, palettes.dark.paneBorder.purple].flatMap((accent) =>
  [16, 20, 64, 256].map((size) => ({ accent, size, sha: createHash('sha256').update(rasterizeLogo(size, accent)).digest('hex') })),
)
const appIdCases = colorsOrNone.flatMap((color) => [true, false].map((packaged) => ({ color: color ?? null, packaged, id: windowAppUserModelId(appUserModelId(packaged), color) })))
const winEnv = { LOCALAPPDATA: 'C:\L', ProgramFiles: 'C:\P', 'ProgramFiles(x86)': 'C:\X' }
const present = [[], ['C:\L\Programs\Microsoft VS Code\Code.exe'], ['C:\P\Microsoft VS Code\Code.exe', 'C:\X\Microsoft VS Code\Code.exe'], ['C:\X\Microsoft VS Code\Code.exe', 'C:\P\Antigravity IDE\Antigravity IDE.exe'], ['C:\L\Programs\Antigravity\Antigravity.exe']]
const editorCases = present.map((files) => {
  const exists = (path: string): boolean => files.includes(path)
  return { files, env: winEnv, list: listEditors(winEnv, exists), vscode: resolveEditorPath('vscode', winEnv, exists), antigravity: resolveEditorPath('antigravity', winEnv, exists) }
})

const NOW = 1_762_000_000_000
const rawValues: unknown[] = [null, 0, 12, 12.4, 12.5, 99.5, 100, 130, -5, -0.5, '', '  ', '42', ' 42.6 ', '1e2', 'abc', true, false, [], {}, 'Infinity']
const quotaDates: unknown[] = [null, '2025-11-04T04:59:59.943648+00:00', '2025-11-04T04:59:59Z', '2025-11-04T06:59:59+02:00', '2025-11-04T04:59:59.5-0130', '2025-11-04', '2025-11', '2025', 'not a date', 1_762_232_399, 1_762_232_399_000, 999_999_999_999, true, {}, '2025-13-04T00:00:00Z']
const secs: unknown[] = [undefined, 18000, 604800, 0, -1, '18000', 3600.5]
const normaliseCases = rawValues.flatMap((u) => quotaDates.slice(0, 6).map((r) => ({ u, r, seconds: null, win: normaliseWindow(u, r) }))).concat(
  secs.map((sec) => ({ u: 50, r: '2025-11-04T04:59:59Z', seconds: sec ?? null, win: normaliseWindow(50, '2025-11-04T04:59:59Z', sec) })),
)
const epochCases = quotaDates.map((value) => ({ value, ms: toEpochMs(value) }))
const countdownCases = [null, NOW - 1, NOW, NOW + 30_000, NOW + 59_999, NOW + 60_000, NOW + 3_599_000, NOW + 3_600_000, NOW + 5 * 3_600_000 + 7 * 60_000, NOW + 86_399_000, NOW + 86_400_000, NOW + 3 * 86_400_000 + 5 * 3_600_000].map((resetsAt) => ({ resetsAt, now: NOW, text: formatCountdown(resetsAt, NOW) }))
const toneCases = [null, 0, 74, 75, 89, 90, 100].map((u) => ({ u, tone: quotaTone(u), text: formatUtilization(u) }))
const ageCases = [0, 500, 1000, 59_400, 59_500, 60_000, 3_599_000, 3_600_000, 7_300_000, -5000].map((d) => ({ d, text: formatAge(NOW - d, NOW) }))
const labelCases = [undefined, 0, -5, 3600, 17_999, 18_000, 172_799, 172_800, 604_800, 86_400 * 31].map((w) => ({ w: w ?? null, text: formatWindowLabel(w) }))
const t = (user: number, sys: number, idle: number) => ({ user, nice: 0, sys, idle, irq: 0 })
const cpuSamples: [any, any][] = [
  [null, [t(1, 1, 1)]],
  [[], [t(1, 1, 1)]],
  [[t(100, 50, 850)], [t(150, 70, 880)]],
  [[t(100, 50, 850)], [t(100, 50, 850)]],
  [[t(100, 50, 850)], [t(90, 40, 800)]],
  [[t(0, 0, 0), t(0, 0, 0)], [t(10, 0, 90), t(50, 0, 50)]],
  [[t(0, 0, 0), t(0, 0, 0)], [t(10, 0, 90)]],
  [[t(0, 0, 0)], [t(1, 0, 2)]],
]
const loadCases = {
  cpu: cpuSamples.map(([previous, current]) => ({ previous, current, percent: cpuBusyPercent(previous, current) })),
  memory: [[0, 0], [1, 2], [8, 16], [3, 7], [5, 3], [1, -1]].map(([used, total]) => ({ used, total, percent: memoryPercent(used!, total!) })),
  gib: [0, 1, 1_073_741_824, 17_179_869_184, 8_589_934_592 * 1.5, 12_345_678_901, -1].map((bytes) => ({ bytes, text: formatGiB(bytes) })),
}
const claudePayloads: unknown[] = [null, {}, 'x', { five_hour: { utilization: 12, resets_at: '2025-11-04T04:59:59.943648+00:00' } }, { seven_day: { utilization: '40', resets_at: 1_762_232_399 } }, { five_hour: { utilization: null }, seven_day: { utilization: '' } }, { five_hour: null, seven_day: { utilization: 100.4, resets_at: 'x' } }, { five_hour: { utilization: 5 }, seven_day: { utilization: 6 } }]
const codexWin = (used: unknown, seconds: unknown, reset: unknown = 1_762_232_399) => ({ used_percent: used, limit_window_seconds: seconds, reset_at: reset })
const codexPayloads: unknown[] = [null, {}, { rate_limit: {} }, { rate_limit: { primary_window: codexWin(40, 604_800) } }, { rate_limit: { primary_window: codexWin(10, 18_000), secondary_window: codexWin(40, 604_800) } }, { rate_limit: { primary_window: codexWin(40, 604_800), secondary_window: codexWin(10, 18_000) } }, { rate_limit: { primary_window: codexWin(10, null), secondary_window: codexWin(40, null) } }, { rate_limit: { primary_window: codexWin(null, 18_000) } }, { rate_limit: { primary_window: codexWin(7, 86_400), secondary_window: codexWin(8, 86_401) } }, { rate_limit: { primary_window: 5, secondary_window: codexWin(9, 3600) } }, { rate_limit: { primary_window: { used_percent: 50 } } }]
const payloadCases = { claude: claudePayloads.map((data) => ({ data, windows: parseClaudePayload(data) })), codex: codexPayloads.map((data) => ({ data, windows: parseCodexPayload(data) })) }
const b64 = (o: unknown): string => Buffer.from(JSON.stringify(o)).toString('base64url')
const tokenCases = {
  claude: [null, 1, NOW - 1, NOW, NOW + 1, 1_761_999_999, 9_999_999_999, '2025-11-04T04:59:59Z', '2030-01-01T00:00:00Z', 'x', true].map((expiresAt) => ({ expiresAt, expired: isTokenExpired(expiresAt, NOW) })),
  codex: ['', 'nope', 'a.b', 'a..c', `h.${b64({ exp: 1 })}.s`, `h.${b64({ exp: 9_999_999_999 })}.s`, `h.${b64({ exp: NOW / 1000 })}.s`, `h.${b64({ exp: NOW / 1000 - 1 })}.s`, `h.${b64({ exp: '5' })}.s`, `h.${b64({})}.s`, `h.${b64([1])}.s`, 'h.%%%.s', `h.${b64({ exp: 1 })}=.s`].map((token) => ({ token, expired: isCodexTokenExpired(token, NOW) })),
}
const errors: (string | undefined)[] = [undefined, 'network', 'http-403', 'http-408', 'http-429', 'http-500', 'http-503', 'http-5xx', 'http-404', 'parse', 'shape', 'no-credentials', 'token-expired']
const delayCases = errors.flatMap((error) => [0, 1, 2, 3, 5, 8, 12].map((failures) => ({ failures, error: error ?? null, ms: nextPollDelayMs(failures, error) })))
const good = { ok: true, stale: false, fetchedAt: NOW - 120_000, session: { utilization: 12, resetsAt: NOW + 1000 }, week: { utilization: null, resetsAt: null } }
const failureCases = [null, good, { ...good, fetchedAt: NOW - 899_999 }, { ...good, fetchedAt: NOW - 900_000 }, { ...good, fetchedAt: NOW - 2_000_000 }, { ...good, stale: true, error: 'network' }].flatMap((lastGood) =>
  ['network', 'http-403'].map((code) => ({ lastGood, code, now: NOW, snapshot: snapshotAfterFailure(lastGood as any, code, NOW) })),
)
const quotaCases = { now: NOW, normaliseCases, epochCases, countdownCases, toneCases, ageCases, labelCases, loadCases, payloadCases, tokenCases, delayCases, failureCases }

const out = { quotaCases: [quotaCases], chromeCases, logoCases, appIdCases, editorCases, paletteCases, layoutCases, editCases, restartCases, basesOut, trustCases, cmpPairs, mergeCases, prefCases, cwdCases, resolveCases }
const target = process.argv[2]!
for (const [k, v] of Object.entries(out)) writeFileSync(join(target, `${k}.json`), JSON.stringify(v))
console.log(Object.entries(out).map(([k, v]) => `${k}:${(v as any[]).length}`).join(' '))
