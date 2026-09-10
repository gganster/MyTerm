import { describe, expect, it } from 'vitest'
import { isCodexTokenExpired, parseCodexPayload } from '../../src/main/services/usage-parse'

/**
 * The two decisions that turn Codex's answer into a pair of gauges.
 *
 * The mapping is the dangerous one. Codex names its windows `primary` and
 * `secondary`, and the order is *not* the meaning: the account this feature was
 * built against declares a single 7-day primary window and no secondary at all.
 * Read positionally, that weekly figure would be drawn and labelled as a
 * session — a number the user would read as five times worse than it is.
 *
 * The token check is dangerous in the other direction: it decides whether the
 * bar says "session expirée" instead of showing a quota, so every case it
 * cannot read has to fall on the side of "we do not know".
 */

const NOW = Date.parse('2026-09-10T10:00:00Z')

function payload(primary: unknown, secondary: unknown = null): unknown {
  return { rate_limit: { primary_window: primary, secondary_window: secondary } }
}

const FIVE_HOURS = 5 * 3600
const SEVEN_DAYS = 7 * 24 * 3600

describe('parseCodexPayload', () => {
  it('classe les fenêtres par durée déclarée, pas par position', () => {
    const parsed = parseCodexPayload(
      payload(
        { used_percent: 62, limit_window_seconds: SEVEN_DAYS, reset_at: 1789572178 },
        { used_percent: 4, limit_window_seconds: FIVE_HOURS, reset_at: 1789500000 },
      ),
    )
    expect(parsed).not.toBeNull()
    // La primaire est ici l'hebdomadaire : lue positionnellement, 62 % se
    // retrouverait sur la jauge « 5 h ».
    expect(parsed!.session.utilization).toBe(4)
    expect(parsed!.week.utilization).toBe(62)
  })

  it("garde la fenêtre unique d'un compte qui n'a pas de session", () => {
    const parsed = parseCodexPayload(
      payload({ used_percent: 18, limit_window_seconds: SEVEN_DAYS, reset_at: 1789572178 }),
    )
    expect(parsed).not.toBeNull()
    expect(parsed!.week).toMatchObject({ utilization: 18, windowSeconds: SEVEN_DAYS })
    // Pas zéro : la barre doit pouvoir omettre la jauge plutôt que d'en
    // dessiner une vide, ce qui se lirait comme « quota intact ».
    expect(parsed!.session.utilization).toBeNull()
  })

  it('convertit un reset en secondes epoch vers des millisecondes', () => {
    const parsed = parseCodexPayload(
      payload({ used_percent: 10, limit_window_seconds: FIVE_HOURS, reset_at: 1789572178 }),
    )
    expect(parsed!.session.resetsAt).toBe(1789572178 * 1000)
  })

  it('retombe sur la position quand la durée manque', () => {
    const parsed = parseCodexPayload(
      payload({ used_percent: 7, reset_at: 1789500000 }, { used_percent: 55, reset_at: 1789572178 }),
    )
    expect(parsed!.session.utilization).toBe(7)
    expect(parsed!.week.utilization).toBe(55)
  })

  it('rend null sur une charge utile vide ou méconnaissable', () => {
    expect(parseCodexPayload(null)).toBeNull()
    expect(parseCodexPayload({})).toBeNull()
    expect(parseCodexPayload(payload(null, null))).toBeNull()
    // Un 200 dont on ne sait rien tirer est un échec, pas un quota à zéro.
    expect(parseCodexPayload(payload({ used_percent: 'beaucoup' }))).toBeNull()
  })
})

describe('isCodexTokenExpired', () => {
  /** JWT non signé : seule la charge utile est lue, jamais vérifiée. */
  function token(claims: Record<string, unknown>): string {
    const body = Buffer.from(JSON.stringify(claims), 'utf8').toString('base64url')
    return `header.${body}.signature`
  }

  it('reconnaît un exp passé', () => {
    expect(isCodexTokenExpired(token({ exp: NOW / 1000 - 60 }), NOW)).toBe(true)
  })

  it('laisse passer un exp à venir', () => {
    expect(isCodexTokenExpired(token({ exp: NOW / 1000 + 3600 }), NOW)).toBe(false)
  })

  it("traite l'exp comme des secondes, pas des millisecondes", () => {
    // Comparé brut à une horloge en millisecondes, un exp valide se lirait en
    // 1970 et épinglerait un compte sain sur « session expirée ».
    expect(isCodexTokenExpired(token({ exp: NOW / 1000 + 1 }), NOW)).toBe(false)
  })

  it("ne conclut rien de ce qu'il ne sait pas lire", () => {
    expect(isCodexTokenExpired('pas-un-jwt', NOW)).toBe(false)
    expect(isCodexTokenExpired('a.!!!.c', NOW)).toBe(false)
    expect(isCodexTokenExpired(token({}), NOW)).toBe(false)
    expect(isCodexTokenExpired(token({ exp: 'bientôt' }), NOW)).toBe(false)
    expect(isCodexTokenExpired('', NOW)).toBe(false)
  })
})
