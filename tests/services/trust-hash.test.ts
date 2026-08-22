import { describe, expect, it } from 'vitest'
import { commandsHash, commandsOf, stripCommands } from '@shared/trust-hash'
import type { CommandBearingPane } from '@shared/trust-hash'

const panes: CommandBearingPane[] = [
  { id: 'web', title: 'frontend', cwd: 'C:\\proj\\frontend', shell: 'pwsh', command: 'npm run dev' },
  { id: 'api', title: 'backend', cwd: 'C:\\proj\\backend', shell: 'pwsh', command: 'npm run dev' },
  { id: 'free', title: 'scratch', cwd: 'C:\\proj', shell: 'pwsh' },
]

describe('commandsHash', () => {
  it('est stable quel que soit l’ordre des panes dans le fichier', () => {
    expect(commandsHash(panes)).toBe(commandsHash([...panes].reverse()))
  })

  it('ne change pas quand seul le titre change', () => {
    const renamed = panes.map((pane) =>
      pane.id === 'web' ? { ...pane, title: 'tout autre chose' } : pane,
    )
    expect(commandsHash(renamed)).toBe(commandsHash(panes))
  })

  it('change quand une commande change', () => {
    const edited = panes.map((pane) =>
      pane.id === 'web' ? { ...pane, command: 'npm run build' } : pane,
    )
    expect(commandsHash(edited)).not.toBe(commandsHash(panes))
  })

  it('change quand un cwd change', () => {
    const moved = panes.map((pane) =>
      pane.id === 'web' ? { ...pane, cwd: 'C:\\proj\\autre' } : pane,
    )
    expect(commandsHash(moved)).not.toBe(commandsHash(panes))
  })

  it('change quand un shell change', () => {
    const reshelled = panes.map((pane) => (pane.id === 'web' ? { ...pane, shell: 'cmd' } : pane))
    expect(commandsHash(reshelled)).not.toBe(commandsHash(panes))
  })

  it('ignore la casse des chemins comme le fait Windows', () => {
    const shouted = panes.map((pane) => ({ ...pane, cwd: pane.cwd.toUpperCase() }))
    expect(commandsHash(shouted)).toBe(commandsHash(panes))
  })

  it('ignore les panes sans commande', () => {
    expect(commandsHash(panes)).toBe(commandsHash(panes.filter((pane) => pane.command)))
  })
})

describe('commandsOf', () => {
  it('ne retient que les panes qui exécutent quelque chose', () => {
    const subjects = commandsOf(panes)
    expect(subjects).toHaveLength(2)
    expect(subjects.every((subject) => subject.command.length > 0)).toBe(true)
  })

  it('conserve le cwd, qui est l’information qui fonde la décision', () => {
    expect(commandsOf(panes).map((subject) => subject.cwd)).toContain('C:\\proj\\frontend')
  })
})

describe('stripCommands', () => {
  it('retire toute commande — le mode « ouvrir sans exécuter »', () => {
    const stripped = stripCommands(panes)
    expect(stripped.every((pane) => pane.command === undefined)).toBe(true)
    expect(stripped).toHaveLength(panes.length)
  })

  it('laisse le reste du pane intact', () => {
    expect(stripCommands(panes)[0]).toMatchObject({ id: 'web', cwd: 'C:\\proj\\frontend' })
  })
})
