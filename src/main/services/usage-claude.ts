import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { fetchJson } from './agent-fetch'
import { isTokenExpired, parseClaudePayload } from './usage-parse'
import type { QuotaWindows } from './usage-parse'
import { UsageError } from './usage-poller'

/**
 * Claude usage quota, read from the same OAuth endpoint that `/usage` shows.
 *
 * Three rules, shared with the Codex reader next door:
 *
 * 1. **The token never leaves this file.** It is read from the Claude Code
 *    credentials file, put in one `Authorization` header, and dropped. Nothing
 *    derived from the file — not its content, not its absolute path — is ever
 *    logged or returned, because what this returns crosses the IPC boundary
 *    into the renderer (ARCHI § Sécurité).
 * 2. **Failures are coarse codes**, never exception messages. Node puts the
 *    full path in an `ENOENT` message, and a rejected request can quote a URL
 *    with query parameters. Both would end up in the renderer.
 * 3. **Failures are silent and non-fatal.** No credentials, no network, an
 *    expired token: the status bar shows "—" and the app carries on. This is an
 *    ambient indicator, not a feature anyone is blocked on.
 *
 * Only the live endpoint is consulted. `claude-usage-overlay` additionally
 * falls back to that user's personal statusline cache files; those paths exist
 * on exactly one machine, so here they would be dead code for every other user.
 */

const CREDENTIALS_FILE = join(homedir(), '.claude', '.credentials.json')
const USAGE_URL = 'https://api.anthropic.com/api/oauth/usage'

/**
 * The header Claude Code sends; the endpoint is version-gated on it.
 *
 * A silent expiry date on this feature: the day the gate moves past this
 * string, the bar becomes a permanent `http-4xx` with nothing pointing at the
 * cause. If the status bar starts reporting a 4xx that outlives a token
 * refresh, suspect this constant before anything else.
 */
const CLIENT_VERSION = '2.1.201'

interface OAuthCredentials {
  accessToken?: unknown
  expiresAt?: unknown
}

async function readAccessToken(): Promise<string> {
  let raw: string
  try {
    raw = await readFile(CREDENTIALS_FILE, 'utf8')
  } catch {
    // Deliberately not `error.code`: ENOENT and EACCES are the same story for
    // the user ("no Claude Code session here") and the message carries the path.
    throw new UsageError('no-credentials')
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new UsageError('credentials-parse')
  }

  const oauth = (parsed as { claudeAiOauth?: OAuthCredentials } | null)?.claudeAiOauth
  const token = oauth?.accessToken
  if (typeof token !== 'string' || token.length === 0) throw new UsageError('no-token')
  // Claude Code refreshes the token on its next run; nothing for us to do but say so.
  if (isTokenExpired(oauth?.expiresAt, Date.now())) throw new UsageError('token-expired')
  return token
}

export async function fetchClaudeWindows(): Promise<QuotaWindows> {
  const token = await readAccessToken()
  const data = await fetchJson(USAGE_URL, {
    Authorization: `Bearer ${token}`,
    'anthropic-beta': 'oauth-2025-04-20',
    Accept: 'application/json',
    'User-Agent': `claude-code/${CLIENT_VERSION}`,
  })

  const windows = parseClaudePayload(data)
  if (!windows) throw new UsageError('shape')
  return windows
}
