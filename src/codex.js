import { runCommand, runCommandPty } from './runner.js';

export function buildCodexPrompt({ userCommand, claudeOutput, changeContext = '' }) {
  return [
    'You are Codex acting as a senior reviewer.',
    'Review the Claude output for correctness, edge cases, performance, and safety.',
    'Focus ONLY on the provided change context from the latest command.',
    'If no changes are required, output exactly: NO CHANGES REQUIRED',
    'If changes are required, output in this format:',
    'COMMENTS:',
    '<short explanation of issues and rationale>',
    '',
    'PATCH:',
    '<standard unified diff that applies cleanly to the current working tree>',
    'ENDPATCH',
    '',
    'CRITICAL PATCH FORMAT REQUIREMENTS:',
    '1. Start with: diff --git a/filename b/filename',
    '2. Follow with: --- a/filename',
    '3. Then: +++ b/filename',
    '4. REQUIRED: Each hunk MUST start with a valid hunk header with line numbers:',
    '   @@ -<old_start>,<old_count> +<new_start>,<new_count> @@',
    '   Example: @@ -10,5 +10,6 @@',
    '   NEVER use just @@ without line numbers - this is INVALID',
    '5. After the hunk header, include context lines (prefix with space), removed lines (prefix with -), and added lines (prefix with +)',
    '6. REQUIRED: End the patch with exactly: ENDPATCH',
    '7. Do NOT wrap the diff in code fences',
    '8. Do NOT include "*** Begin Patch" or "*** End Patch" markers',
    '',
    'Example of VALID patch format:',
    'diff --git a/file.py b/file.py',
    '--- a/file.py',
    '+++ b/file.py',
    '@@ -10,5 +10,6 @@',
    ' def example():',
    '-    old_line()',
    '+    new_line()',
    '+    another_line()',
    '     return True',
    '',
    'ENDPATCH',
    '',
    'User command:',
    userCommand,
    '',
    'Claude output:',
    claudeOutput,
    '',
    'Change context (latest command only):',
    changeContext
  ].join('\n');
}

const CODEX_SUBCOMMANDS = new Set(['exec', 'review']);

function withSubcommand(args, subcommand) {
  if (!subcommand) return args;
  if (args.length > 0 && CODEX_SUBCOMMANDS.has(args[0])) return args;
  if (CODEX_SUBCOMMANDS.has(subcommand)) return [subcommand, ...args];
  return args;
}

export async function runCodex({ cmd, args, userCommand, claudeOutput, changeContext, timeoutMs, usePty, subcommand }) {
  const prompt = buildCodexPrompt({ userCommand, claudeOutput, changeContext });
  const runner = usePty ? runCommandPty : runCommand;
  const finalArgs = withSubcommand(args, subcommand);
  return runner({
    cmd,
    args: finalArgs,
    input: prompt,
    timeoutMs
  });
}
