# Quotamaxxing plugin for Claude Code

Sends your Claude Code and Codex usage limits to the Quotamaxxing app on your Mac, which syncs them to your iPhone through your own iCloud.

## Install

In Claude Code:

```
/plugin marketplace add BioBarE/quotamaxxing
/plugin install quotamaxxing@quotamaxxing
```

Then install Quotamaxxing on your Mac and iPhone, signed in to the same iCloud account. Run `/quota-sync` to send a reading right away.

## What it sends

Only the limit windows: their kind (5-hour, weekly), percent used and reset time. Nothing else.

- **Claude Code:** read from Claude Code itself after each turn. No model call, no extra usage.
- **Codex:** read from Codex's own `codex app-server` (`account/rateLimits/read`) every 15 minutes while Claude Code is open, if Codex is installed.

It never reads passwords, tokens, cookies or the Keychain, never calls the network, and writes no files. Readings go to the Mac app through its `agentquota://` link (`open -g`). The app checks every link strictly and ignores anything malformed.

All the code is in [`hooks/register.ts`](hooks/register.ts) (about 80 lines).

Quotamaxxing is an independent project, not affiliated with Anthropic or OpenAI.
