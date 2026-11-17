import type { Register } from 'claude-code'

// Quotamaxxing plugin. Hands quota readings to the Quotamaxxing Mac app through its link
// (`open -g agentquota://ingest?d=...`); macOS starts the app in the background if needed.
// Sends ONLY window kind / used % / reset time. Never context, cost, ids, paths or prompts.
// No files, no network, no ports, no credentials: Claude's numbers come from the engine ($.session),
// Codex's from Codex's own app server, which handles its own login.
const LINK = 'agentquota://ingest?d='
const CODEX_EVERY_MS = 15 * 60 * 1000

async function hand($: any, provider: 'claude' | 'codex', windows: unknown[]): Promise<void> {
  // argv, no shell: the payload can never be read as a command
  const r = await $.process.run(['/usr/bin/open', '-g', LINK + encodeURIComponent(JSON.stringify({ v: 1, provider, windows }))],
    { timeoutMs: 10000 })
  if (r.exitCode !== 0) throw new Error('could not reach Quotamaxxing for Mac. Is it installed?')
}

const claudeWindows = (rl: readonly any[] | undefined) =>
  (Array.isArray(rl) ? rl : []).map(r => ({ kind: r?.kind, percentUsed: r?.percentUsed, resetsAt: r?.resetsAt ?? null }))

// `codex app-server` over stdio, one short run, read-only (account/rateLimits/read). The shell only keeps stdin
// open long enough for the reply: $.process.run closes stdin at once, and the server stops on end of input.
const CODEX_SH = 'export PATH="$HOME/.local/bin:/opt/homebrew/bin:/usr/local/bin:$PATH"; ' +
  'command -v codex >/dev/null 2>&1 || exit 3; { cat; sleep 8; } | codex app-server 2>/dev/null'
const CODEX_RPC = [
  { method: 'initialize', id: 0, params: { clientInfo: { name: 'agent_quota', title: null, version: '0.2' }, capabilities: null } },
  { method: 'initialized' },
  { method: 'account/rateLimits/read', id: 1 },
].map(m => JSON.stringify(m)).join('\n') + '\n'

/** Codex windows, [] when Codex answered nothing usable, null when Codex is not installed (send nothing). */
async function codexWindows($: any): Promise<unknown[] | null> {
  const r = await $.process.run(['/bin/sh', '-c', CODEX_SH], { stdin: CODEX_RPC, timeoutMs: 25000 })
  if (r.exitCode === 3) return null
  for (const line of String(r.stdout).split('\n')) {
    let m: any
    try { m = JSON.parse(line) } catch { continue }
    if (m?.id !== 1) continue
    const rl = m.result?.rateLimits
    // allowlist: accountId / planType / credits never leave this function
    return [rl?.primary, rl?.secondary].filter(w => w && typeof w === 'object')
      .map(w => ({ usedPercent: w.usedPercent, windowDurationMins: w.windowDurationMins, resetsAt: w.resetsAt ?? null }))
  }
  return []
}

async function sendCodex($: any): Promise<boolean> {
  const w = await codexWindows($)
  if (w === null) return false
  await hand($, 'codex', w)
  return true
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'quota-sync', description: 'Send current quota to Quotamaxxing now (no model call)' })
    // Codex numbers do not arrive by themselves: ask while Claude Code is open. Failures are silent by design.
    void sendCodex($).catch(() => {})
    $.clock.every(CODEX_EVERY_MS, () => { void sendCodex($).catch(() => {}) })
    return next(e)
  })

  // Manual send. The plain usage() call costs nothing and runs no inference.
  on('command.run', { command: 'quota-sync' }, async $ => {
    try {
      await hand($, 'claude', claudeWindows((await $.session.usage()).rateLimits))
      const codex = await sendCodex($)
      return { text: `quota-sync: sent Claude${codex ? ' and Codex' : ''} to Quotamaxxing` }
    } catch (err) { return { text: `quota-sync FAILED: ${String(err).slice(0, 200)}` } }
  })

  // Automatic: the engine raises this after a turn / when a plan window moves. Observe only.
  on('session.measure', async ($, e, next) => {
    const r = await next(e)
    // a plugin must never break the session: any failure here is swallowed
    try { if (e.changed?.includes('rateLimits')) await hand($, 'claude', claudeWindows(e.rateLimits)) } catch {}
    return r
  })
}
