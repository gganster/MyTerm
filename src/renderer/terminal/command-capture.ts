import type { Terminal } from '@xterm/xterm'

/**
 * "What is this pane actually running?", answered without unfolding it.
 *
 * A pane folded into the bottom bar shows its title and its last command on
 * hover, and the second half is not information anyone else already has: the
 * layout only knows the *autolaunch* command, which stops being the truth the
 * first time someone types into the pane.
 *
 * ## Why the buffer, and not the keystrokes
 *
 * Accumulating what the user types is the obvious implementation and it is
 * wrong twice over. Tab completion rewrites the line — `npm run d⇥` would be
 * recorded verbatim — and history recall sends `\x1b[A`, which carries none of
 * the command it brings back. Both are how people actually re-run a tunnel.
 *
 * So the command is read off the screen instead, where the shell has already
 * resolved completion and history. The only thing the keystrokes are used for
 * is the *column* the input starts at: the first key of a line arrives while
 * the cursor still sits just past the prompt, which is exactly the offset that
 * separates `PS C:\src>` from what the user wrote. No prompt-shape heuristic,
 * no per-shell table.
 *
 * ## Why the anchor is keyed on the row
 *
 * Not every chunk xterm reports is a keystroke: with focus reporting enabled a
 * terminal emits `\x1b[I` on its own, and the very first one arrives while the
 * pane is still empty — measured, and it is what made the first captured
 * command come out as `PS C:\…\mtc> echo bonjour-monde`, prompt included. An
 * anchor is therefore tied to the logical row it was taken on and is discarded
 * the moment the cursor is on a different line. Wrapping does not discard it,
 * because a continuation row belongs to the same logical line.
 *
 * ## Why it reads late
 *
 * The echo of a keystroke is a round trip through the pty. Reading the row the
 * instant `Enter` is pressed loses the last character of anything typed fast,
 * and loses a paste entirely — the pasted text has not been echoed yet. The row
 * is therefore read a few frames later, by *absolute* buffer index, which does
 * not move when the line scrolls up into the scrollback.
 */

/** Rows scanned around the cursor for one logical (possibly wrapped) line. */
const MAX_LOGICAL_ROWS = 6

/** Long enough for any command worth reading, short enough to keep in a store. */
const MAX_COMMAND_LENGTH = 512

/**
 * Box-drawing and block characters (U+2500–U+259F).
 *
 * A full-screen TUI that stays in the *normal* buffer — an agent CLI drawing
 * its own input box, most notably — puts its frame on the row the cursor is
 * on, and there is no offset that separates a frame from a command. A result
 * carrying one is rejected rather than shown as `│ > deploy … │`, which leaves
 * the pane's previous command standing: for a `claude` pane that is `claude`,
 * which is both true and useful.
 */
const FRAME_CHARACTERS = /[\u2500-\u259f]/

/** Submitting a line, and giving up on one: `Ctrl+C` runs nothing. */
const SUBMIT = /[\r\n]/
const ABANDON = '\x03'

/**
 * The terminal buffer, reduced to the two things this file asks of it.
 *
 * An interface rather than the xterm type so the line arithmetic — which is
 * where the mistakes live — can be tested against a handful of literal rows.
 */
export interface RowReader {
  /** Row text padded to the terminal width, or undefined past the end. */
  text: (row: number) => string | undefined
  /** Whether that row is the continuation of the row above it. */
  wrapped: (row: number) => boolean
}

export interface LogicalLine {
  /** Absolute index of the row the line starts on. */
  first: number
  /** Every row of the line, first one first, each padded to the width. */
  rows: string[]
}

/**
 * The whole logical line the given row belongs to.
 *
 * Walks backwards over continuation rows, then forwards over them: the cursor
 * is on the *last* row of something typed and on the *first* row of something
 * pasted, and both have to produce the whole line. Bounded, so a terminal that
 * marks everything as wrapped cannot turn this into a scrollback scan.
 */
export function logicalLine(reader: RowReader, row: number): LogicalLine {
  let first = row
  while (first > 0 && row - first < MAX_LOGICAL_ROWS - 1 && reader.wrapped(first)) first--

  let last = row
  while (last < first + MAX_LOGICAL_ROWS - 1 && reader.wrapped(last + 1)) last++

  const rows: string[] = []
  for (let index = first; index <= last; index++) rows.push(reader.text(index) ?? '')
  return { first, rows }
}

/**
 * Slices the command out of the rows of one logical line.
 *
 * Rows arrive padded to the terminal width, so `startColumn` indexes into the
 * concatenation exactly as it indexes into the first row.
 */
export function commandFromRows(rows: string[], startColumn: number): string | null {
  const command = rows.join('').slice(Math.max(startColumn, 0)).trim()
  if (!command) return null
  if (FRAME_CHARACTERS.test(command)) return null
  return command.slice(0, MAX_COMMAND_LENGTH)
}

export interface CommandCapture {
  /** Feed it every chunk xterm reports from the keyboard. */
  onData: (data: string) => void
  dispose: () => void
}

function readerFor(terminal: Terminal): RowReader {
  const buffer = terminal.buffer.active
  return {
    text: (row) => buffer.getLine(row)?.translateToString(false),
    wrapped: (row) => buffer.getLine(row)?.isWrapped ?? false,
  }
}

export function createCommandCapture(
  terminal: Terminal,
  onCommand: (command: string) => void,
): CommandCapture {
  /** Where the current line's input begins: its first row, and the prompt's end. */
  let anchor: { row: number; column: number } | null = null
  let pending: number | undefined
  let disposed = false

  const read = (row: number, column: number): void => {
    if (disposed) return
    const command = commandFromRows(logicalLine(readerFor(terminal), row).rows, column)
    if (command) onCommand(command)
  }

  return {
    onData: (data) => {
      const buffer = terminal.buffer.active
      // A full-screen application owns the alternate buffer, and the row under
      // its cursor is a line of a file, not a command. Nothing is captured
      // there — the pane keeps whatever it was last known to run.
      if (buffer.type === 'alternate') return

      const { first } = logicalLine(readerFor(terminal), buffer.baseY + buffer.cursorY)
      // Anchored before the chunk can be echoed: right now the cursor is where
      // the prompt ends, which is the one offset that cannot be guessed later.
      const current = anchor?.row === first ? anchor : { row: first, column: buffer.cursorX }
      anchor = current

      if (data.includes(ABANDON)) {
        anchor = null
        return
      }
      if (!SUBMIT.test(data)) return

      anchor = null

      // ~2 frames: long enough for the echo of a fast burst or a paste to land,
      // short enough that the row cannot have left a 5000-line scrollback.
      window.clearTimeout(pending)
      pending = window.setTimeout(() => read(current.row, current.column), 25)
    },
    dispose: () => {
      disposed = true
      window.clearTimeout(pending)
    },
  }
}
