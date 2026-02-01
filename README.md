# Codex Ping

VSCode extension that automatically pings Codex API when rate limits reset.

## Why

This extension automatically restarts rate limits by pinging Codex at the exact moment when cooldowns expire. This allows you to always fully utilize Codex limits, ensuring maximum usage efficiency without manual intervention.

## How it works

The extension:
1. Checks current rate limits every minute
2. Calculates exact reset times for both primary (5-hour) and secondary (weekly) limits
3. Schedules ping requests to execute exactly when limits reset
4. Automatically sends a ping to Codex API at the moment of reset
5. Continues monitoring for the next reset

This ensures you always have up-to-date rate limit information immediately after a reset occurs.

## Prerequisites

- Codex authentication (`codex login`)
- Authentication stored in `~/.codex/auth.json`

## License

MIT
