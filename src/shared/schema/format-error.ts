import type { ZodError } from 'zod'
import { LAYOUT_VERSION } from './layout'

/**
 * Turns a validation failure into something a human can act on.
 *
 * A layout is hand-edited and committed, so the error message *is* the product
 * surface here: raw Zod output would tell the user nothing about which pane is
 * wrong. Every message names the offending field path.
 */
export function formatZodError(error: ZodError): string[] {
  return error.issues.map((issue) => {
    const path = issue.path.length > 0 ? issue.path.join('.') : '(racine)'
    return `${path} : ${issue.message}`
  })
}

/** Failure modes that are not schema violations but still need a clear message. */
export type LayoutReadFailure =
  | { kind: 'missing' }
  | { kind: 'empty' }
  | { kind: 'unreadable'; detail: string }
  | { kind: 'malformed-json'; detail: string }
  | { kind: 'future-version'; found: unknown }
  | { kind: 'legacy-fields'; field: string }
  | { kind: 'invalid'; problems: string[] }

export function describeFailure(failure: LayoutReadFailure): string {
  switch (failure.kind) {
    case 'missing':
      return 'aucun .myterm.json à la racine du projet'
    case 'empty':
      return 'le fichier .myterm.json est vide'
    case 'unreadable':
      return `impossible de lire .myterm.json : ${failure.detail}`
    case 'malformed-json':
      return `.myterm.json n'est pas du JSON valide : ${failure.detail}`
    case 'future-version':
      return `.myterm.json déclare la version ${String(failure.found)} : il a été créé par une version plus récente de MyTerm (cette version lit la ${LAYOUT_VERSION})`
    case 'legacy-fields':
      return (
        `.myterm.json déclare la version ${LAYOUT_VERSION} mais contient encore « ${failure.field} » : ` +
        "la disposition n'est plus décrite dans le fichier, l'ordre des panes suffit.\n" +
        '  · soit vous supprimez « grid » et les « col »/« row » — les panes seront alors affichés dans leur ordre de déclaration ;\n' +
        '  · soit vous remettez "version": 1 et MyTerm convertit le fichier lui-même, en respectant la disposition actuelle.'
      )
    case 'invalid':
      return `.myterm.json est invalide :\n${failure.problems.map((p) => `  · ${p}`).join('\n')}`
  }
}
