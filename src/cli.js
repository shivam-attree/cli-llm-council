import readline from 'node:readline';
import { getConfig } from './config.js';
import { runClaude } from './claude.js';
import { runCodex } from './codex.js';
import { shouldReview } from './review.js';
import { printBlock, printHeading } from './format.js';
import { runCommand } from './runner.js';
import { captureBaseline, computeDelta, buildDeltaContext } from './git.js';
import { loadSummary, appendSummary } from './context.js';

const EXIT_COMMANDS = new Set(['exit', 'quit']);
const AUTH_KEYWORDS = ['auth', 'api key', 'unauthorized'];
const cmdPathCache = new Map();
const REVIEW_SKIPPED_MSG = 'No new file changes detected for this command.';
const SEPARATOR_WIDTH = 60;
const MAX_DISPLAYED_FILES = 20;

const TOOLS = {
  claude: {
    label: '🧠 Claude Code',
    phase: 'Implementation',
    authMessage: 'Claude Code authentication not found. Please login via the official CLI.',
    runner: runClaude,
    getOptions: (config, userCommand) => ({
      cmd: config.claude.cmd,
      args: config.claude.args,
      userCommand,
      timeoutMs: config.timeoutMs,
      usePty: config.claude.tty,
      interactive: config.claude.interactive,
      usePexpect: config.claude.pexpect
    })
  },
  codex: {
    label: '🔍 Codex',
    phase: 'Review',
    authMessage: 'Codex authentication not found. Please login via the OpenAI CLI.',
    runner: runCodex,
    getOptions: (config, userCommand, claudeOutput) => ({
      cmd: config.codex.cmd,
      args: config.codex.args,
      userCommand,
      claudeOutput,
      timeoutMs: config.timeoutMs,
      usePty: config.codex.tty,
      subcommand: config.codex.subcommand,
      interactive: false  // Codex review is not interactive
    })
  }
};

function usage() {
  return [
    'Usage:',
    '  cli-llm-council',
    '  cli-llm-council <command>',
    '',
    'Environment variables:',
    '  CLAUDE_CMD        CLI command for Claude Code (default: claude)',
    '  CLAUDE_ARGS       Extra args for Claude Code CLI',
    '  CLAUDE_TTY        Run Claude in a pseudo-TTY (default: 0)',
    '  CLAUDE_INTERACTIVE  Allow interactive Claude sessions (default: 0)',
    '  CLAUDE_PRINT      Force Claude --print mode (default: 0)',
    '  CLAUDE_PERMISSION_MODE  Set Claude --permission-mode value',
    '  CLAUDE_PEXPECT    Run Claude via python pexpect helper (default: 0)',
    '  CODEX_CMD         CLI command for Codex (default: codex)',
    '  CODEX_ARGS        Extra args for Codex CLI',
    '  CODEX_SUBCOMMAND  Codex non-interactive subcommand (default: exec)',
    '  CODEX_SKIP_GIT_CHECK  Add --skip-git-repo-check (default: 1)',
    '  LLM_COUNCIL_TIMEOUT_MS  Optional timeout for each step'
  ].join('\n');
}

async function resolveCommandPath(command) {
  if (command.includes('/')) return command;

  // Check cache first
  if (cmdPathCache.has(command)) {
    return cmdPathCache.get(command);
  }

  const result = await runCommand({ cmd: 'which', args: [command] });
  const path = result.code === 0 && result.stdout.trim() || null;

  // Cache the result (both successful and failed lookups)
  cmdPathCache.set(command, path);
  return path;
}

function hasAuthIssue(result) {
  const text = `${result.stderr || ''} ${result.stdout || ''}`.toLowerCase();
  return AUTH_KEYWORDS.some(keyword => text.includes(keyword));
}

function formatErrorDetails(toolName, result) {
  let details = `${toolName} failed.`;
  if (result.error) details += `\nError: ${result.error.message}`;
  const stderr = result.stderr?.trim();
  if (stderr) details += `\nStderr: ${stderr}`;
  details += `\nExit code: ${result.code}`;
  return details;
}

/**
 * Logs an error that occurred during tool execution.
 * Detects authentication issues and provides specific guidance.
 * @param {string} toolKey - The tool identifier ('claude' or 'codex')
 * @param {Object} result - The execution result containing error information
 */
function logToolError(toolKey, result) {
  const tool = TOOLS[toolKey];

  if (hasAuthIssue(result)) {
    console.error(tool.authMessage);
  }

  console.error(printBlock(
    `${tool.label} — ${tool.phase}`,
    formatErrorDetails(tool.label, result)
  ));
}

/**
 * Extracts the final output to display to the user.
 * Currently returns Claude's output as the final result.
 * @param {string} claudeOutput - Output from Claude Code execution
 * @returns {string} The trimmed Claude output
 */
function extractFinalOutput(claudeOutput) {
  return claudeOutput.trim();
}

async function executeTool(toolKey, config, toolOptions) {
  const tool = TOOLS[toolKey];
  const { cmd, interactive, suppressOutput, ...runnerOptions } = toolOptions;
  const cmdPath = await resolveCommandPath(cmd);

  if (!cmdPath) {
    console.error(printBlock(
      `${tool.label} — ${tool.phase}`,
      `${tool.label} command not found: ${cmd}`
    ));
    return null;
  }

  // For interactive mode, print a clear session start banner
  if (interactive) {
    console.log(`\n${'='.repeat(SEPARATOR_WIDTH)}`);
    console.log(`${tool.label} — ${tool.phase} [INTERACTIVE MODE]`);
    console.log(`You can now chat with ${tool.label}. Type your messages and press Enter.`);
    console.log(`The session will end when ${tool.label} completes or you exit.`);
    console.log(`${'='.repeat(SEPARATOR_WIDTH)}\n`);
  }

  const result = await tool.runner({ cmd: cmdPath, interactive, ...runnerOptions });

  if (result.code !== 0 || result.error) {
    logToolError(toolKey, result);
    return null;
  }

  const output = result.stdout.trim();

  if (interactive) {
    // In interactive mode, output was already streamed, just add a separator
    console.log(`\n${'='.repeat(SEPARATOR_WIDTH)}`);
    console.log(`[${tool.label} session ended - Full conversation captured]`);
    console.log(`${'='.repeat(SEPARATOR_WIDTH)}\n`);
  } else if (!suppressOutput) {
    // For non-interactive mode, print the captured output in a block
    console.log(printBlock(`${tool.label} — ${tool.phase}`, output));
  }

  return { result, output };
}

function runClaudePhase(userCommand, config, conversationSummary) {
  const claudeOptions = TOOLS.claude.getOptions(config, userCommand);
  claudeOptions.conversationSummary = conversationSummary;
  if (config.claude.pexpect) {
    claudeOptions.suppressOutput = true;
  }
  return executeTool('claude', config, claudeOptions);
}

const PATCH_START = 'PATCH:';
const PATCH_START_LEN = 6;
const PATCH_END = 'ENDPATCH';
const NO_CHANGES = 'NO CHANGES REQUIRED';

/**
 * Extracts a patch from Codex output between PATCH: and ENDPATCH markers.
 * @param {string} output - The output from Codex execution
 * @returns {string|null} The extracted patch text, or null if no patch found
 */
function extractCodexPatch(output) {
  const trimmed = output.trim();
  if (trimmed.toUpperCase() === NO_CHANGES) return null;
  const start = trimmed.indexOf(PATCH_START);
  if (start === -1) return null;
  const end = trimmed.indexOf(PATCH_END, start);
  if (end === -1) return null;
  return trimmed.slice(start + PATCH_START_LEN, end).trim();
}

function validateUnifiedDiff(patchText) {
  const lines = patchText.split('\n');
  const hasHunks = lines.some((line) => line.startsWith('@@'));
  if (!hasHunks) {
    return { ok: false, error: 'No hunk headers (@@) found in patch. Codex must include proper hunk headers with line numbers like: @@ -10,5 +10,6 @@' };
  }

  const hunkHeaderRegex = /^@@ -\d+(,\d+)? \+\d+(,\d+)? @@/;
  const invalidHunks = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.startsWith('@@')) {
      if (!hunkHeaderRegex.test(line)) {
        invalidHunks.push({ line: line, lineNumber: i + 1 });
      }
    }
  }

  if (invalidHunks.length > 0) {
    const details = invalidHunks.map(h => `  Line ${h.lineNumber}: "${h.line}"`).join('\n');
    return {
      ok: false,
      error: `Invalid hunk header(s) found. Each hunk must start with: @@ -<old_start>,<old_count> +<new_start>,<new_count> @@\n${details}\n\nCodex must provide proper line numbers in hunk headers!`
    };
  }

  return { ok: true };
}

/**
 * Applies a patch to the working tree using git apply.
 * Creates a temporary patch file and ensures cleanup even on errors.
 * @param {string} patchText - The patch content to apply
 * @returns {Promise<Object>} The result of the git apply command
 */
async function applyCodexPatch(patchText, useGitApply, debugPatch) {
  const { writeFileSync, unlinkSync } = await import('node:fs');
  const tempPath = `codex-patch-${Date.now()}.diff`;

  try {
    let normalized = patchText.replace(/\r\n/g, '\n');
    // If Codex emits a minimal unified diff without diff --git headers,
    // add a diff --git line and a/ b/ prefixes to help git apply.
    const lines = normalized.split('\n');
    if (lines[0]?.startsWith('--- ') && lines[1]?.startsWith('+++ ')) {
      const rawOld = lines[0].slice(4).trim();
      const rawNew = lines[1].slice(4).trim();
      const oldPath = rawOld.replace(/^a\//, '').replace(/^b\//, '');
      const newPath = rawNew.replace(/^a\//, '').replace(/^b\//, '');
      if (!normalized.includes('diff --git')) {
        const header = `diff --git a/${oldPath} b/${newPath}`;
        lines.unshift(header);
      }
      lines[1] = `--- a/${oldPath}`;
      lines[2] = `+++ b/${newPath}`;
      normalized = lines.join('\n');
    }
    // Ensure we have a recognizable diff header for patch tool.
    if (!normalized.includes('--- ') && !normalized.includes('diff --git')) {
      return { code: 1, stderr: 'Patch text did not include a diff header', stdout: '', error: null };
    }

    if (debugPatch) {
      console.log(printBlock('🪲 Codex Patch Debug (original)', patchText));
      console.log(printBlock('🪲 Codex Patch Debug (normalized)', normalized));
    }

    const validation = validateUnifiedDiff(normalized);
    if (!validation.ok) {
      console.error(printBlock('❌ Patch Validation Failed', validation.error));
      return { code: 1, stderr: validation.error, stdout: '', error: null };
    }

    if (debugPatch) {
      console.log(printBlock('✅ Patch Validation Passed', 'Patch format is valid'));
    }

    writeFileSync(tempPath, normalized, 'utf-8');

    const PATCH_TIMEOUT = 30000; // 30 seconds timeout for patch commands

    if (useGitApply) {
      if (debugPatch) {
        console.log('🔧 Attempting: git apply --whitespace=nowarn');
      }
      let result = await runCommand({ cmd: 'git', args: ['apply', '--whitespace=nowarn', tempPath], timeoutMs: PATCH_TIMEOUT });
      if (result.code !== 0) {
        if (debugPatch) {
          console.log(`   Failed: ${result.stderr || result.stdout}`);
          console.log('🔧 Attempting: git apply --whitespace=nowarn --unidiff-zero');
        }
        result = await runCommand({ cmd: 'git', args: ['apply', '--whitespace=nowarn', '--unidiff-zero', tempPath], timeoutMs: PATCH_TIMEOUT });
      }
      if (result.code !== 0) {
        if (debugPatch) {
          console.log(`   Failed: ${result.stderr || result.stdout}`);
          console.log('🔧 Attempting: git apply with --directory and --unsafe-paths');
        }
        // Fallback: apply from repo root (handles a/ and b/ prefixes)
        result = await runCommand({
          cmd: 'git',
          args: ['apply', '--whitespace=nowarn', '--directory=.', '--unsafe-paths', tempPath],
          timeoutMs: PATCH_TIMEOUT
        });
      }
      if (result.code === 0) {
        if (debugPatch) {
          console.log('   ✅ Success!');
        }
        return result;
      }
      if (debugPatch) {
        console.log(`   Failed: ${result.stderr || result.stdout}`);
      }
    }

    // Final fallback: system patch with multiple strategies
    if (debugPatch) {
      console.log('🔧 Attempting: patch -p0 -u --batch');
    }
    let result = await runCommand({ cmd: 'patch', args: ['-p0', '-u', '--batch', '-i', tempPath], timeoutMs: PATCH_TIMEOUT });

    if (result.code !== 0) {
      if (debugPatch) {
        console.log(`   Failed: ${result.stderr || result.stdout}`);
        console.log('🔧 Attempting: patch -p1 -u --batch');
      }
      result = await runCommand({ cmd: 'patch', args: ['-p1', '-u', '--batch', '-i', tempPath], timeoutMs: PATCH_TIMEOUT });
    }

    if (result.code !== 0) {
      if (debugPatch) {
        console.log(`   Failed: ${result.stderr || result.stdout}`);
        console.log('🔧 Attempting: patch -p0 --fuzz=3 --batch');
      }
      // Try with fuzz factor to be more lenient about line ranges
      result = await runCommand({ cmd: 'patch', args: ['-p0', '--fuzz=3', '--batch', '-i', tempPath], timeoutMs: PATCH_TIMEOUT });
    }

    if (debugPatch && result.code === 0) {
      console.log('   ✅ Success!');
    } else if (debugPatch) {
      console.log(`   Failed: ${result.stderr || result.stdout}`);
    }
    return result;
  } finally {
    try {
      unlinkSync(tempPath);
    } catch {
      // Ignore cleanup errors
    }
  }
}

async function runCodexPhase(userCommand, config, claudeResult, changeContext, conversationSummary) {
  console.log(`\n${TOOLS.codex.label} will now review this output\n`);

  const codexOptions = TOOLS.codex.getOptions(config, userCommand, claudeResult.stdout);
  codexOptions.changeContext = changeContext;
  codexOptions.conversationSummary = conversationSummary;
  return executeTool('codex', config, codexOptions);
}

async function handleCommand(userCommand, config) {
  console.log(printHeading('User Command', userCommand));

  const baseline = await captureBaseline();
  const conversationSummary = loadSummary();

  const claudeExecution = await runClaudePhase(userCommand, config, conversationSummary);
  if (!claudeExecution) return;

  const { result: claudeResult, output: claudeOutput } = claudeExecution;

  // In interactive mode, inform the user that the conversation was captured
  if (config.claude.interactive) {
    console.log('✓ Interactive session complete. Transcript saved.');
  }

  if (!shouldReview(userCommand)) {
    if (!config.claude.interactive) {
      const finalMessage = config.claude.pexpect
        ? 'See Claude output above.'
        : claudeOutput;
      console.log(printBlock('✅ Final Output', finalMessage));
      appendSummary({ question: userCommand, answer: claudeOutput });
    } else {
      console.log('\n✅ Task complete. No review needed for this command.');
      appendSummary({ question: userCommand, answer: claudeOutput });
    }
    return;
  }

  const delta = await computeDelta(baseline);
  if (!delta.root || delta.files.length === 0) {
    console.log(printBlock('ℹ️ Review Skipped', REVIEW_SKIPPED_MSG));
    const finalMessage = config.claude.pexpect
      ? 'See Claude output above.'
      : claudeOutput;
    console.log(printBlock('✅ Final Output', finalMessage));
    appendSummary({ question: userCommand, answer: claudeOutput });
    return;
  }

  const fileList = delta.files.slice(0, MAX_DISPLAYED_FILES).map((file) => `- ${file}`).join('\n');
  const moreCount = delta.files.length > MAX_DISPLAYED_FILES ? `\n...and ${delta.files.length - MAX_DISPLAYED_FILES} more` : '';
  console.log(printBlock('📄 Files Changed (Latest Command)', `${fileList}${moreCount}`));

  const { context: changeContext, preview } = await buildDeltaContext(delta.root, delta.files);
  if (preview) {
    console.log(printBlock('🧾 Diff Preview Sent To Codex', preview));
  }
  const codexExecution = await runCodexPhase(userCommand, config, claudeResult, changeContext, conversationSummary);
  if (!codexExecution) return;

  const debugPatch = process.env.CODEX_DEBUG_PATCH === '1';
  const patch = extractCodexPatch(codexExecution.output);

  if (!patch) {
    if (debugPatch) {
      const hasNoChanges = codexExecution.output.trim().toUpperCase() === NO_CHANGES;
      if (hasNoChanges) {
        console.log(printBlock('ℹ️ Codex Patch Extraction', 'Codex reported: NO CHANGES REQUIRED'));
      } else {
        const hasPatchStart = codexExecution.output.includes(PATCH_START);
        const hasPatchEnd = codexExecution.output.includes(PATCH_END);
        console.log(printBlock('⚠️ Codex Patch Extraction Failed',
          `Could not extract patch from Codex output.\n` +
          `Has "PATCH:" marker: ${hasPatchStart}\n` +
          `Has "ENDPATCH" marker: ${hasPatchEnd}\n\n` +
          `Codex must include both markers around the patch content.`
        ));
      }
    }
  } else {
    const useGitApply = delta.root && delta.root.length > 0 && delta.mode === 'git';
    const applyResult = await applyCodexPatch(patch, useGitApply, debugPatch);
    if (applyResult.code !== 0) {
      console.error(printBlock('🔧 Codex Apply', `Failed to apply patch.\n${applyResult.stderr || applyResult.stdout}`));
    } else {
      console.log(printBlock('🔧 Codex Apply', 'Applied patch to working tree.'));
    }
  }

  const finalOutput = extractFinalOutput(claudeOutput);
  const finalMessage = config.claude.pexpect
    ? 'See Claude output above.'
    : finalOutput;
  console.log(printBlock('✅ Final Output', finalMessage));
  appendSummary({ question: userCommand, answer: finalOutput });
}

function createInteractiveSession(config) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: 'cli-llm-council> '
  });

  const handleLine = async (line) => {
    const trimmed = line.trim();

    if (!trimmed) {
      rl.prompt();
      return;
    }

    if (EXIT_COMMANDS.has(trimmed)) {
      rl.close();
      return;
    }

    await handleCommand(trimmed, config);
    rl.prompt();
  };

  rl.on('line', handleLine);
  rl.on('close', () => process.exit(0));

  return rl;
}

async function runInteractive(config) {
  console.log('╔════════════════════════════════════════════════════════╗');
  console.log('║          CLI LLM Council - Interactive Mode            ║');
  console.log('╚════════════════════════════════════════════════════════╝');
  console.log('');
  console.log('Enter commands to orchestrate Claude Code with Codex review.');

  if (config.claude.interactive) {
    console.log('');
    console.log('🌟 INTERACTIVE MODE ENABLED 🌟');
    console.log('Each command will start an interactive Claude session where you');
    console.log('can have a full conversation before the output is reviewed.');
  }

  console.log('');
  console.log('Type "exit" or "quit" to leave.');
  console.log('');

  const rl = createInteractiveSession(config);
  rl.prompt();
}

async function main() {
  const args = process.argv.slice(2);
  const config = getConfig();

  if (args.length === 0) {
    await runInteractive(config);
    return;
  }

  const userCommand = args.join(' ');
  if (userCommand === '--help' || userCommand === '-h') {
    console.log(usage());
    process.exit(0);
  }

  await handleCommand(userCommand, config);
}

main().catch((err) => {
  console.error(`Unexpected error: ${err.message}`);
  process.exit(1);
});
