# CLI LLM Council

Terminal-based LLM council orchestration CLI that runs Claude Code for implementation and Codex for senior review.

## Architecture

- `src/cli.js` orchestrates the flow and terminal UX.
- `src/claude.js` invokes Claude Code CLI.
- `src/codex.js` invokes Codex CLI and builds the review prompt.
- `src/review.js` contains explicit review-decision logic.
- `src/runner.js` wraps child process execution with timeout handling.
- `src/format.js` standardizes terminal output formatting.

## How It Works

1. Claude Code runs first with the user command passed via stdin.
2. The `shouldReview()` rule set decides if Codex review is required.
3. If review is required, the tool captures a **baseline git status**, runs Claude, then computes the **delta** for this command only.
4. Codex receives the user command + Claude output + **latest change context** and must respond with:
   - `NO CHANGES REQUIRED`, or
   - `COMMENTS:` + `PATCH:` + `ENDPATCH` (unified diff).
5. If Codex provides a patch, it is applied to the working tree automatically.

## Authentication

- No API keys are requested.
- Claude Code authentication is expected to be present in its official CLI.
- Codex authentication is expected to be present in the OpenAI CLI/environment.
- If auth is missing, the CLI exits with a clear error message.

## Configuration

Environment variables:

- `CLAUDE_CMD` (default: `claude`)
- `CLAUDE_ARGS` (extra args for Claude Code CLI)
- `CLAUDE_TTY` (default: `0`) run Claude in a pseudo-TTY
- `CLAUDE_INTERACTIVE` (default: `0`) enable interactive Claude sessions (PTY mode)
- `CLAUDE_PRINT` (default: `0`) force Claude `--print` mode
- `CLAUDE_PERMISSION_MODE` set Claude `--permission-mode` (e.g. `acceptEdits`, `dontAsk`)
- `CLAUDE_PEXPECT` (default: `0`) run Claude via Python `pexpect` helper for true terminal I/O
- `CODEX_CMD` (default: `codex`)
- `CODEX_ARGS` (extra args for Codex CLI)
- `CODEX_TTY` (default: `0`) run Codex in a pseudo-TTY for CLIs that require a terminal
- `CODEX_SUBCOMMAND` (default: `exec`) run Codex non-interactively via subcommand
- `CODEX_SKIP_GIT_CHECK` (default: `1`) add `--skip-git-repo-check`
- `LLM_COUNCIL_TIMEOUT_MS` (optional timeout per step)

Use `CLAUDE_ARGS`/`CODEX_ARGS` if your CLI requires specific flags to read from stdin.

### Interactive Mode

Set `CLAUDE_PEXPECT=1` to run Claude through a real terminal session (recommended on Node 25+):

```bash
CLAUDE_PEXPECT=1 cli-llm-council "create a new file"
```

In interactive mode:
- Claude Code can prompt for permissions (y/n responses)
- All I/O flows naturally in real-time
- Terminal enters raw mode for character-by-character input

Requires Python + `pexpect`:

```bash
pip3 install pexpect
```
- Terminal resize events are handled automatically
- Output is streamed directly (not captured in blocks)

See [INTERACTIVE_MODE.md](INTERACTIVE_MODE.md) for detailed documentation.

## Local Run

```bash
npm install
node src/cli.js "implement a fibonacci function in python"
```

Interactive mode (like `codex` / `claude`):

```bash
npm link
cli-llm-council
```

Single command:

```bash
cli-llm-council "refactor src/cli.js to be cleaner"
```

## Extensibility

The command execution and review logic are in separate modules so you can add storage, history, or additional agents later without changing the core flow.
