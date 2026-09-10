import { describe, expect, it } from 'vitest'
import { commandFromRows, logicalLine } from '../../src/renderer/terminal/command-capture'
import type { RowReader } from '../../src/renderer/terminal/command-capture'

/**
 * The line arithmetic behind "what is this folded pane running".
 *
 * The keystroke plumbing needs a live xterm and a DOM, same reasoning as the
 * key chords. What is testable is everything that decides whether the hover
 * card reads well: which rows make up the line the cursor is on, and what is
 * left once the prompt is cut off.
 *
 * The prompt-stripping case is not hypothetical. Before the anchor was keyed
 * on the row, the first command of a session came out as
 * `PS C:\…\mtc> echo bonjour-monde` — the terminal emits a focus report of its
 * own before anything is typed, and the anchor taken on that empty screen
 * survived until the first Enter.
 */

/** Rows come out of xterm padded to the terminal width; reproduce that. */
function row(text: string, width = 40): string {
  return text.padEnd(width, ' ')
}

/** A buffer literal: text plus the wrap flag xterm sets on continuation rows. */
function reader(rows: { text: string; wrapped?: boolean }[], width = 40): RowReader {
  return {
    text: (index) => (rows[index] ? row(rows[index]!.text, width) : undefined),
    wrapped: (index) => rows[index]?.wrapped ?? false,
  }
}

describe('logicalLine', () => {
  it("s'arrête à la ligne du curseur quand rien n'est bouclé", () => {
    const buffer = reader([{ text: 'PowerShell 7.6.6' }, { text: 'PS C:\\src> npm run dev' }])
    const line = logicalLine(buffer, 1)
    expect(line.first).toBe(1)
    expect(line.rows).toHaveLength(1)
  })

  it('remonte les lignes de continuation : le curseur est sur la dernière après une frappe', () => {
    const buffer = reader([
      { text: 'PS C:\\src> cloudflared tunnel' },
      { text: ' run --url http', wrapped: true },
    ])
    expect(logicalLine(buffer, 1)).toMatchObject({ first: 0 })
    expect(logicalLine(buffer, 1).rows).toHaveLength(2)
  })

  it('redescend les lignes de continuation : le curseur est sur la première après un collage', () => {
    // Au moment d'Entrée, un collage n'a pas encore été écho : la suite de la
    // ligne apparaît sous le curseur, pas au-dessus.
    const buffer = reader([
      { text: 'PS C:\\src> pnpm dlx' },
      { text: ' create-something', wrapped: true },
    ])
    const line = logicalLine(buffer, 0)
    expect(line.first).toBe(0)
    expect(line.rows).toHaveLength(2)
  })

  it('borne la remontée : un buffer entièrement marqué comme bouclé ne devient pas un scan', () => {
    const buffer = reader(Array.from({ length: 50 }, () => ({ text: 'x', wrapped: true })))
    expect(logicalLine(buffer, 40).rows.length).toBeLessThanOrEqual(6)
  })
})

describe('commandFromRows', () => {
  it('coupe le prompt et rend la commande seule', () => {
    const prompt = 'PS C:\\src> '
    expect(commandFromRows([row(`${prompt}npm run dev`)], prompt.length)).toBe('npm run dev')
  })

  it('recolle une commande qui a bouclé sur plusieurs lignes', () => {
    // La colonne de départ n'indexe que la première ligne, d'où la
    // concaténation avant le découpage.
    const rows = [row('> cloudflared tunnel run --url http', 34), row('://localhost:3000', 34)]
    expect(commandFromRows(rows, 2)).toBe('cloudflared tunnel run --url http://localhost:3000')
  })

  it('rend null sur une ligne vide : Entrée sur un prompt nu ne lance rien', () => {
    expect(commandFromRows([row('PS C:\\src> ')], 11)).toBeNull()
  })

  it('rend null quand la colonne dépasse la ligne', () => {
    expect(commandFromRows([row('PS C:\\src> ')], 999)).toBeNull()
  })

  it('tolère une colonne négative plutôt que de casser le découpage', () => {
    expect(commandFromRows([row('claude')], -3)).toBe('claude')
  })

  it("refuse un cadre de TUI plutôt que d'afficher un morceau de décor", () => {
    // Un agent CLI qui dessine sa propre boîte de saisie laisse ses caractères
    // de filet sur la ligne du curseur ; aucune colonne ne sépare un cadre
    // d'une commande, donc on garde la commande précédente du pane.
    expect(commandFromRows([row('│ > déployer le tunnel        │')], 0)).toBeNull()
  })

  it('tronque une ligne absurde au lieu de la stocker entière', () => {
    const long = commandFromRows([row(`echo ${'x'.repeat(4000)}`, 4100)], 0)
    expect(long).not.toBeNull()
    expect(long!.length).toBe(512)
  })
})
