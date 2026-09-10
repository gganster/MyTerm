import { net } from 'electron'
import { UsageError } from './usage-poller'

/**
 * The one HTTP call both quota readers make, and the reason it is not `fetch`.
 *
 * Electron's main process ships two clients. The global `fetch` is Node's
 * undici; `net.fetch` goes through Chromium's network stack. They are not
 * interchangeable here, and the difference was found the hard way: against
 * `chatgpt.com`, undici is answered with a `403` and an HTML bot-mitigation
 * page (`cf-mitigated: challenge`) where `net.fetch` gets its JSON, on the same
 * machine, with byte-identical headers, seconds apart. The mitigation is
 * fingerprinting the client's TLS handshake, which no header can talk it out
 * of. Anthropic does not do this, but both readers go through here anyway:
 * one client is one thing to reason about, and Chromium's brings the system
 * proxy configuration with it, which undici ignores.
 *
 * Failures come out as coarse `UsageError` codes, never as exception text — a
 * rejected request can quote the URL back, and this value ends up in a
 * renderer that logs (ARCHI § Sécurité).
 */

const FETCH_TIMEOUT_MS = 10_000

export async function fetchJson(url: string, headers: Record<string, string>): Promise<unknown> {
  let response: Response
  try {
    response = await net.fetch(url, {
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      // The app's session has never visited either vendor, so there is nothing
      // to send — said explicitly so that stays true if it ever does.
      credentials: 'omit',
      headers,
    })
  } catch {
    // Offline, DNS, proxy, timeout — all one story for the user.
    throw new UsageError('network')
  }

  if (!response.ok) throw new UsageError(`http-${response.status}`)

  try {
    return await response.json()
  } catch {
    // A challenge page is valid HTTP with an HTML body; it lands here when it
    // arrives with a 200, which is why this is a failure and not an empty quota.
    throw new UsageError('parse')
  }
}
