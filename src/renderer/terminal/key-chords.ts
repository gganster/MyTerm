/**
 * The two keystrokes MyTerm takes away from the shell, as pure predicates.
 *
 * Split out of the key handlers on purpose: deciding who owns a keystroke is
 * exactly the kind of rule that breaks silently — a wrong answer here either
 * swallows a key the shell needed or sends a stray byte into a live session —
 * and neither handler can be tested without a DOM. Same reasoning as
 * trust-hash (ARCHI § Tests).
 *
 * Everything not named here still belongs to whatever runs in the pane.
 */

/** The parts of a KeyboardEvent these decisions actually read. */
export interface KeyChord {
  ctrlKey: boolean
  shiftKey: boolean
  altKey?: boolean
  metaKey?: boolean
  key: string
}

/**
 * Ctrl+Shift+C — copy the selection.
 *
 * It cannot be Ctrl+C, which is SIGINT and belongs to the running process; that
 * is why every terminal emulator puts copy behind the Shift variant. Nothing
 * was listening for it before: xterm sends nothing at all for Ctrl+Shift+letter
 * (measured), so this takes no byte away from the shell.
 */
export function isCopyChord(event: KeyChord): boolean {
  if (!event.ctrlKey || !event.shiftKey) return false
  if (event.altKey || event.metaKey) return false
  // `key` is already case-folded by Shift, so both 'C' and 'c' can arrive
  // depending on the layout and on CapsLock.
  return event.key.toLowerCase() === 'c'
}

/**
 * Ctrl+Enter — a newline, not a submit.
 *
 * A terminal cannot tell these apart on its own: the wire protocol has no
 * modifier bits for Enter, so xterm sends `\r` for Enter, Ctrl+Enter and
 * Shift+Enter alike (measured). Which is precisely the complaint — the chord
 * exists on the keyboard and means nothing on the way out.
 *
 * Modifiers are checked strictly rather than ignored, so Ctrl+Alt+Enter and
 * anything else a keyboard layout composes still reaches the pane untouched.
 */
export function isNewlineChord(event: KeyChord): boolean {
  if (!event.ctrlKey) return false
  if (event.altKey || event.metaKey) return false
  return event.key === 'Enter'
}

/**
 * What Ctrl+Enter puts on the wire: a line feed, the byte Ctrl+J already sends.
 *
 * Not an invention and not a guess. Claude Code documents Ctrl+J as the one
 * multiline shortcut that works in every terminal with no setup, where
 * Shift+Enter needs a terminal that speaks the extended-keys protocol. Since a
 * pane's whole purpose is to run an agent CLI (PRD), the chord is wired to the
 * sequence that CLI already understands rather than to a new one it would have
 * to be taught.
 *
 * It also survives the panes that are not agents: `\n` is a literal line feed,
 * so a shell that has nothing bound to it inserts one or ignores it — never the
 * accidental execution that sending `\r` would cause.
 */
export const NEWLINE_SEQUENCE = '\n'
