---
name: open-agentlens
description: Open an Agentforce agent's trace in the AgentLens web app (agent graph, state machine, step inspector). Use when the user says "open AgentLens", "open in AgentLens", "visualize in AgentLens", "show this in AgentLens", "visualize the trace/session/conversation", or asks to see what an agent did after an `sf agent preview` session. Picks the right trace from the Salesforce CLI's session logs in the DX project.
allowed-tools: Bash(node:*)
---

# Open in AgentLens

AgentLens has no log directory of its own. It visualizes **one planner trace** (one agent reply) at a time. The Salesforce CLI writes those traces inside the user's DX project:

```
<project>/.sfdx/agents/<AgentApiName>/sessions/<sessionId>/
  metadata.json, turn-index.json, transcript.jsonl   <- bookkeeping, NOT traces
  traces/<planId>.json                               <- one per agent reply; this is what opens
```

Copies saved with `sf agent preview --output-dir` land in `<dir>/<Agent>/session_<sessionId>/` (default `temp/agent-preview`). Older CLIs wrote `.sfdx/agents/<Agent>.agent/traces/<sessionId>-<planId>.json`. The script reads all three layouts. Don't pick files by hand.

## How to open

The script is `scripts/open-agentlens.mjs`, inside this skill's own folder (the folder that holds this SKILL.md). It needs Node 18+. Run it from the DX project directory (any subdirectory works), using the script's absolute path:

```bash
node <skill-folder>/scripts/open-agentlens.mjs [path] [--agent <name>] [--session <id>] [--turn <n|last>] [--plan <planId>]
```

Run it as one bare `node` command. Don't chain `; echo $?`, `&&`, or `cd`, because only `node` is pre-approved, and a failure's exit code and message show up on their own.

It picks a trace, builds a self-contained AgentLens page with that trace preloaded, opens it in the default browser, and prints JSON with `selected` (agent, sessionId, turn, of, userMessage, topic, file), `page`, and `warnings`.

## Picking the right logs

Choose arguments from the strongest evidence you have, in this order:

1. **A session from this conversation.** If you ran `sf agent preview end` earlier, pass its `tracesPath` as `path`. If you only have the session ID from `preview start`/`send`, pass `--session <id>`. Don't let it fall back to "most recent", because another session may have finished since.
2. **The user named a trace file.** Pass that file as `path`.
3. **The user named an agent.** Pass `--agent <name>`. Case-insensitive, and a unique substring is enough.
4. **The user means a particular exchange** ("the one where I asked about refunds", "the second question"). First run with `--list` (optionally add `--agent`), match on `userMessage`, then open it with `--session` and `--turn`.
5. **Nothing specific.** Run with no filters. The script takes the most recently active agent's newest session that has a viewable trace, and its last non-empty turn.

The script already handles these cases. Don't work around them:
- It skips sessions with no trace yet (greeting only) and empty `{}` traces, and adds a warning.
- If filters match nothing, or a name or prefix is ambiguous, it exits with code 2 and a message listing what exists. Relay that message, or use `--list` to resolve it. Don't guess a different agent.

## After it runs

Tell the user what opened: agent, which turn of how many, and the user message for that turn. Also pass on any `warnings`, for example that a different agent or session was picked by default, or that the newest session had no trace. Mention that other turns can be opened with `--turn`.

If `opened` is false, the browser could not be launched. Give the user the `page` path to open themselves.

If there are no traces at all, say so, and suggest running a preview first. For example, for an Agent Script bundle:

```bash
sf agent preview start --authoring-bundle <Bundle> --simulate-actions --json   # returns sessionId
sf agent preview send --authoring-bundle <Bundle> --session-id <id> -u "<utterance>" --json
sf agent preview end --authoring-bundle <Bundle> --session-id <id> --json      # returns tracesPath
```

## Options reference

- `--list` prints all sessions and their turns as JSON. It opens nothing.
- `--no-open` builds the page without launching a browser.
- `--app <index.html>` uses a specific AgentLens build. Without it the script uses `$AGENTLENS_HTML`, then the AgentLens repo checkout the skill sits in (if any), then a copy cached from GitHub that refreshes daily.
- `--out <file>` sets where the page is written. By default it goes to `$TMPDIR/agentlens/`.
