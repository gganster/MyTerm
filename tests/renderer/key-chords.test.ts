import { describe, expect, it } from 'vitest'
import {
  isCopyChord,
  isNewlineChord,
  NEWLINE_SEQUENCE,
} from '../../src/renderer/terminal/key-chords'
import type { KeyChord } from '../../src/renderer/terminal/key-chords'

/**
 * These two predicates decide who owns a keystroke, and both failure directions
 * are silent. Claim too much and a key the shell needed never arrives; claim too
 * little and the chord does nothing, which is the bug they were written for.
 *
 * So the negative cases matter more than the positive ones here: most of this
 * file is about everything that must still reach the pane untouched.
 */

function chord(patch: Partial<KeyChord> & { key: string }): KeyChord {
  return { ctrlKey: false, shiftKey: false, altKey: false, metaKey: false, ...patch }
}

describe('isCopyChord — Ctrl+Shift+C', () => {
  it('reconnaît la combinaison', () => {
    expect(isCopyChord(chord({ key: 'C', ctrlKey: true, shiftKey: true }))).toBe(true)
  })

  it('accepte la touche en minuscule', () => {
    // Selon la disposition et l'état de CapsLock, `key` peut arriver en 'c'.
    expect(isCopyChord(chord({ key: 'c', ctrlKey: true, shiftKey: true }))).toBe(true)
  })

  it('laisse Ctrl+C au processus : c’est SIGINT', () => {
    // La raison d'être du Shift. Voler Ctrl+C rendrait impossible d'interrompre
    // ce qui tourne dans le pane.
    expect(isCopyChord(chord({ key: 'c', ctrlKey: true }))).toBe(false)
  })

  it('ignore Shift+C seul, qui est juste une majuscule', () => {
    expect(isCopyChord(chord({ key: 'C', shiftKey: true }))).toBe(false)
  })

  it('ignore les combinaisons enrichies d’Alt ou de Meta', () => {
    expect(isCopyChord(chord({ key: 'C', ctrlKey: true, shiftKey: true, altKey: true }))).toBe(false)
    expect(isCopyChord(chord({ key: 'C', ctrlKey: true, shiftKey: true, metaKey: true }))).toBe(
      false,
    )
  })

  it('ne prend aucune autre lettre', () => {
    for (const key of ['v', 'z', 'a', 'x']) {
      expect(isCopyChord(chord({ key, ctrlKey: true, shiftKey: true })), key).toBe(false)
    }
  })
})

describe('isNewlineChord — Ctrl+Entrée', () => {
  it('reconnaît la combinaison', () => {
    expect(isNewlineChord(chord({ key: 'Enter', ctrlKey: true }))).toBe(true)
  })

  it('laisse Entrée seule déclencher l’exécution', () => {
    // Tout l'inverse serait pire que le bug : plus rien ne s'exécuterait.
    expect(isNewlineChord(chord({ key: 'Enter' }))).toBe(false)
  })

  it('laisse Maj+Entrée tranquille', () => {
    // Non demandé, et changer son comportement surprendrait un shell où
    // Maj+Entrée vaut Entrée aujourd'hui.
    expect(isNewlineChord(chord({ key: 'Enter', shiftKey: true }))).toBe(false)
  })

  it('accepte Ctrl+Maj+Entrée', () => {
    expect(isNewlineChord(chord({ key: 'Enter', ctrlKey: true, shiftKey: true }))).toBe(true)
  })

  it('rend Ctrl+Alt+Entrée au pane', () => {
    // AltGr se présente comme Ctrl+Alt sur les dispositions européennes : le
    // capturer volerait des caractères à la saisie.
    expect(isNewlineChord(chord({ key: 'Enter', ctrlKey: true, altKey: true }))).toBe(false)
  })

  it('ne prend pas les autres touches', () => {
    for (const key of ['NumpadEnter', 'Escape', 'Tab', 'j']) {
      expect(isNewlineChord(chord({ key, ctrlKey: true })), key).toBe(false)
    }
  })
})

describe('la séquence envoyée', () => {
  it('est un saut de ligne nu, celui que Ctrl+J envoie déjà', () => {
    // Claude Code documente Ctrl+J comme le raccourci multiligne qui marche
    // dans tous les terminaux sans configuration ; c'est exactement cet octet.
    expect(NEWLINE_SEQUENCE).toBe('\n')
  })

  it('n’est pas un retour chariot', () => {
    // `\r` est ce qu'envoie Entrée : le renvoyer reproduirait le bug à
    // l'identique, en donnant l'impression que le raccourci fonctionne.
    expect(NEWLINE_SEQUENCE).not.toBe('\r')
    expect(NEWLINE_SEQUENCE).not.toContain('\r')
  })
})
