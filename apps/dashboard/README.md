# Owner dashboard

Edit any balance value, apply it as a new version with a note, or roll back. A version applies to new matches
only: a match in progress finishes on the version it started with, and its record says which.

- `pnpm dashboard` from the repo root: the API on `DASHBOARD_PORT` (8081) and the UI on http://localhost:5180.
- Listens on 127.0.0.1 only. To listen anywhere else, set `DASHBOARD_TOKEN` and open the UI with `?token=...`.
- The Values tab edits every number in the record; the JSON tab is for adding or removing entries (an item, an
  ability, a wall). Both are checked with the same validation the game server runs before it will use a version.
- Rolling back applies a copy of the old version as a new one, so every match keeps pointing at the data it ran on.
