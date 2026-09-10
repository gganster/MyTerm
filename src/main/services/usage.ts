import { QUOTA_PROVIDERS } from '@shared/quota'
import type { QuotaProvider } from '@shared/quota'
import type { UsageByProvider } from '@shared/ipc-contract'
import { fetchClaudeWindows } from './usage-claude'
import { fetchCodexWindows } from './usage-codex'
import { createUsagePoller, unavailable } from './usage-poller'
import type { UsagePoller, WindowsFetcher } from './usage-poller'

/**
 * Both agents' quota, polled independently and reported together.
 *
 * Independently matters: the two endpoints belong to different vendors and
 * fail for different reasons, so each poller carries its own failure count and
 * its own backoff. A Codex outage must not slow the Claude bar down, and a
 * machine with only one of the two CLIs installed must show the one it has
 * rather than nothing.
 *
 * Together matters too: one push carries both snapshots, so the renderer has
 * no merge to do and cannot miss whichever provider polled before it mounted.
 */

const FETCHERS: Record<QuotaProvider, WindowsFetcher> = {
  claude: fetchClaudeWindows,
  codex: fetchCodexWindows,
}

let pollers: Record<QuotaProvider, UsagePoller> | null = null

function emptySnapshots(): UsageByProvider {
  const now = Date.now()
  return {
    claude: unavailable('pending', now),
    codex: unavailable('pending', now),
  }
}

/** The last snapshot of each provider, for a renderer that mounted between two pushes. */
export function getUsage(): UsageByProvider {
  if (!pollers) return emptySnapshots()
  return { claude: pollers.claude.latest(), codex: pollers.codex.latest() }
}

/**
 * Starts polling every provider. `onUpdate` is called on every completed poll,
 * success or not, so the bar can move to "indisponible" when a session goes
 * away — and it is handed *both* snapshots, not the one that just changed.
 */
export function initUsagePolling(onUpdate: (usage: UsageByProvider) => void): void {
  if (pollers) return
  pollers = {
    claude: createUsagePoller(FETCHERS.claude),
    codex: createUsagePoller(FETCHERS.codex),
  }
  for (const provider of QUOTA_PROVIDERS) {
    pollers[provider].start(() => onUpdate(getUsage()))
  }
}

export function disposeUsagePolling(): void {
  if (!pollers) return
  for (const provider of QUOTA_PROVIDERS) pollers[provider].stop()
  pollers = null
}
