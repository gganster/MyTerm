import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { fetchJson } from './agent-fetch'
import { isCodexTokenExpired, parseCodexPayload } from './usage-parse'
import type { QuotaWindows } from './usage-parse'
import { UsageError } from './usage-poller'

/**
 * Codex usage quota, read from the endpoint the Codex CLI itself calls.
 *
 * Same three rules as the Claude reader next door — the token never leaves
 * this file, failures are coarse codes, and nothing here can take the app
 * down — and one more that is specific to this endpoint: **the answer carries
 * the account's e-mail address and user id, and neither is returned.** Only
 * the two quota windows are lifted out of the body; everything else is dropped
 * where it was parsed, because what this returns crosses into the renderer.
 *
 * The alternative was reading the `rate_limits` object the CLI writes into its
 * session rollout files under `~/.codex/sessions/`. It needs no token and no
 * network, and it was rejected: the figure is only as fresh as the last turn
 * the user ran, so the bar would show a week-old percentage — or nothing at
 * all on a machine where `codex` is installed but idle, which is exactly the
 * machine this feature is for.
 */

const AUTH_FILE = join(homedir(), '.codex', 'auth.json')
const USAGE_URL = 'https://chatgpt.com/backend-api/codex/usage'

/**
 * The client identity the CLI sends.
 *
 * Same silent expiry date as the Claude reader's `CLIENT_VERSION`: if this bar
 * starts reporting a 4xx that survives a fresh `codex` login, suspect these
 * two constants before anything else.
 */
const CLIENT_VERSION = '0.154.0'
const ORIGINATOR = 'codex_cli_rs'

interface CodexTokens {
  access_token?: unknown
  account_id?: unknown
}

async function readCredentials(): Promise<{ token: string; accountId: string }> {
  let raw: string
  try {
    raw = await readFile(AUTH_FILE, 'utf8')
  } catch {
    throw new UsageError('no-credentials')
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new UsageError('credentials-parse')
  }

  const tokens = (parsed as { tokens?: CodexTokens } | null)?.tokens
  const token = tokens?.access_token
  if (typeof token !== 'string' || token.length === 0) throw new UsageError('no-token')
  if (isCodexTokenExpired(token, Date.now())) throw new UsageError('token-expired')
  // An API-key login has no ChatGPT account and no plan quota to report; the
  // header is sent empty rather than omitted, exactly as the CLI does.
  const accountId = typeof tokens?.account_id === 'string' ? tokens.account_id : ''
  return { token, accountId }
}

export async function fetchCodexWindows(): Promise<QuotaWindows> {
  const { token, accountId } = await readCredentials()
  const data = await fetchJson(USAGE_URL, {
    Authorization: `Bearer ${token}`,
    'chatgpt-account-id': accountId,
    Accept: 'application/json',
    'User-Agent': `codex-cli/${CLIENT_VERSION}`,
    originator: ORIGINATOR,
  })

  const windows = parseCodexPayload(data)
  if (!windows) throw new UsageError('shape')
  return windows
}
