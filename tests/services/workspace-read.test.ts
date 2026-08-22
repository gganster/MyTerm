import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { LAYOUT_VERSION } from '@shared/schema/layout'
import { describeFailure } from '@shared/schema/format-error'
import { readLayout } from '../../src/main/services/workspace'

/**
 * readLayout is the only place the v1 -> v2 migration is wired in, and the
 * wiring is one line. Testing `migrateLayout` alone would leave that line free
 * to disappear with the suite still green.
 *
 * The module touches the filesystem but not Electron, so it runs against a real
 * temp directory rather than a mock.
 */

let projectRoot: string

beforeEach(() => {
  projectRoot = mkdtempSync(join(tmpdir(), 'myterm-read-'))
})

afterEach(() => {
  rmSync(projectRoot, { recursive: true, force: true })
})

function write(contents: string): void {
  writeFileSync(join(projectRoot, '.myterm.json'), contents, 'utf8')
}

const V1 = JSON.stringify({
  version: 1,
  name: 'demo',
  grid: { cols: 2, rows: 2 },
  panes: [
    { id: 'd', col: 1, row: 1 },
    { id: 'a', col: 0, row: 0 },
    { id: 'c', col: 0, row: 1 },
    { id: 'b', col: 1, row: 0, command: 'npm run dev' },
  ],
})

describe('readLayout', () => {
  it('migre un fichier v1 sur disque et le rend dans le sens de lecture', async () => {
    write(V1)
    const result = await readLayout(projectRoot)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.layout.version).toBe(LAYOUT_VERSION)
    expect(result.layout.panes.map((pane) => pane.id)).toEqual(['a', 'b', 'c', 'd'])
    expect(result.layout.panes[1]).toMatchObject({ command: 'npm run dev' })
    expect(result.layout).not.toHaveProperty('grid')
  })

  it('migre aussi un fichier v1 précédé d’un BOM', async () => {
    write('﻿' + V1)
    const result = await readLayout(projectRoot)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.layout.panes.map((pane) => pane.id)).toEqual(['a', 'b', 'c', 'd'])
  })

  it('lit un fichier déjà en v2 sans y toucher', async () => {
    write(JSON.stringify({ version: LAYOUT_VERSION, panes: [{ id: 'b' }, { id: 'a' }] }))
    const result = await readLayout(projectRoot)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.layout.panes.map((pane) => pane.id)).toEqual(['b', 'a'])
  })

  it('refuse un v2 qui a gardé sa grille, en expliquant les deux issues', async () => {
    // The obvious half-migration: bump the number, leave the coordinates.
    write(JSON.stringify({ version: LAYOUT_VERSION, grid: { cols: 2, rows: 1 }, panes: [{ id: 'a' }] }))
    const result = await readLayout(projectRoot)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.failure.kind).toBe('legacy-fields')
    const message = describeFailure(result.failure)
    expect(message).toContain('grid')
    expect(message).toContain('"version": 1')
  })

  it('refuse un v2 dont un pane a gardé ses coordonnées, en nommant le pane', async () => {
    write(
      JSON.stringify({ version: LAYOUT_VERSION, panes: [{ id: 'a' }, { id: 'b', col: 1, row: 0 }] }),
    )
    const result = await readLayout(projectRoot)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.failure).toEqual({ kind: 'legacy-fields', field: 'panes.1.col' })
  })

  it('refuse une version plus récente que celle qu’il sait lire', async () => {
    write(JSON.stringify({ version: LAYOUT_VERSION + 1, panes: [{ id: 'a' }] }))
    const result = await readLayout(projectRoot)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.failure.kind).toBe('future-version')
  })

  it('signale un fichier absent plutôt que de le créer', async () => {
    const result = await readLayout(projectRoot)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.failure.kind).toBe('missing')
  })

  it('signale un v1 invalide avec le chemin du champ fautif', async () => {
    write(JSON.stringify({ version: 1, grid: { cols: 1, rows: 1 }, panes: [{ id: '', col: 0, row: 0 }] }))
    const result = await readLayout(projectRoot)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.failure.kind).toBe('invalid')
    if (result.failure.kind !== 'invalid') return
    expect(result.failure.problems.join('\n')).toContain('panes.0.id')
  })

  it('ne réécrit jamais le fichier qu’il vient de lire', async () => {
    write(V1)
    await readLayout(projectRoot)
    const { readFileSync } = await import('node:fs')
    expect(readFileSync(join(projectRoot, '.myterm.json'), 'utf8')).toBe(V1)
  })
})
