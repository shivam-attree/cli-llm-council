import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runCommand, runCommandPty, runCommandPtyInteractive, runCommandInheritCapture } from './runner.js';

/**
 * Creates a temporary file path for capturing Claude output.
 * Used primarily with pexpect mode.
 * @returns {string} Path to a temporary capture file
 */
function createCapturePath() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'council-'));
  return path.join(tempDir, 'claude-capture.txt');
}

/**
 * Resolves the path to the pexpect helper script.
 * @returns {string} Absolute path to claude_pexpect.py
 */
function getPexpectHelperPath() {
  const scriptsDir = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    '..',
    'scripts'
  );
  return path.join(scriptsDir, 'claude_pexpect.py');
}

/**
 * Executes Claude Code via the Python pexpect wrapper.
 * This method allows better control over terminal I/O and is useful
 * for capturing output from interactive CLI tools.
 *
 * @param {Object} options - Execution options
 * @param {string} options.cmd - Claude CLI command path
 * @param {string[]} options.args - Arguments for Claude CLI
 * @param {string} options.userCommand - User's prompt/command for Claude
 * @param {number} options.timeoutMs - Timeout in milliseconds
 * @returns {Promise<Object>} Execution result with stdout, stderr, code
 */
async function runClaudeViaPexpect({ cmd, args = [], userCommand, timeoutMs }) {
  const capturePath = createCapturePath();
  const helperPath = getPexpectHelperPath();

  const env = {
    COUNCIL_PROMPT: userCommand,
    COUNCIL_CAPTURE_PATH: capturePath
  };

  return runCommandInheritCapture({
    cmd: 'python3',
    args: [helperPath, cmd, ...args],
    env,
    capturePath,
    timeoutMs
  });
}

/**
 * Selects the appropriate command runner based on execution mode.
 *
 * @param {Object} mode - Execution mode flags
 * @param {boolean} mode.interactive - Enable full interactive mode
 * @param {boolean} mode.usePty - Use pseudo-TTY for better terminal emulation
 * @returns {Function} The selected runner function
 */
function selectRunner({ interactive, usePty }) {
  if (interactive) {
    return runCommandPtyInteractive;
  }
  if (usePty) {
    return runCommandPty;
  }
  return runCommand;
}

/**
 * Executes Claude Code directly via standard runners.
 * Selects the appropriate runner based on interactive/PTY requirements.
 *
 * @param {Object} options - Execution options
 * @param {string} options.cmd - Claude CLI command path
 * @param {string[]} options.args - Arguments for Claude CLI
 * @param {string} options.userCommand - User's prompt/command for Claude
 * @param {number} options.timeoutMs - Timeout in milliseconds
 * @param {boolean} options.usePty - Use pseudo-TTY for terminal emulation
 * @param {boolean} options.interactive - Enable interactive mode
 * @returns {Promise<Object>} Execution result with stdout, stderr, code
 */
async function runClaudeDirect({ cmd, args, userCommand, timeoutMs, usePty, interactive }) {
  const runner = selectRunner({ interactive, usePty });

  return runner({
    cmd,
    args,
    input: userCommand,
    timeoutMs
  });
}

/**
 * Executes Claude Code with the specified configuration.
 * Supports multiple execution modes:
 * - Pexpect: Uses Python pexpect wrapper for advanced terminal control
 * - Interactive: Full interactive PTY mode with stdin/stdout forwarding
 * - PTY: Pseudo-TTY mode for better terminal emulation
 * - Standard: Basic pipe-based execution
 *
 * @param {Object} options - Execution options
 * @param {string} options.cmd - Claude CLI command path
 * @param {string[]} options.args - Arguments for Claude CLI
 * @param {string} options.userCommand - User's prompt/command for Claude
 * @param {number} [options.timeoutMs=0] - Timeout in milliseconds (0 = no timeout)
 * @param {boolean} [options.usePty=false] - Use pseudo-TTY for terminal emulation
 * @param {boolean} [options.interactive=false] - Enable full interactive mode
 * @param {boolean} [options.usePexpect=false] - Use Python pexpect wrapper
 * @returns {Promise<Object>} Execution result containing:
 *   - stdout: Standard output from Claude
 *   - stderr: Standard error output
 *   - code: Exit code (0 = success, >0 = error, 124 = timeout)
 *   - error: Error object if execution failed
 */
export async function runClaude(options) {
  const { usePexpect } = options;

  if (usePexpect) {
    return runClaudeViaPexpect(options);
  }

  return runClaudeDirect(options);
}
