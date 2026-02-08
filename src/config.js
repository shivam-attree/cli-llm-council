/**
 * Configuration module for CLI LLM Council.
 * Handles environment variable parsing and configuration building.
 *
 * This module provides:
 * - Environment variable parsing with type safety
 * - Tool-specific configuration builders
 * - Configuration validation
 *
 * Usage:
 *   import { getConfig } from './config.js';
 *
 *   const config = getConfig();
 *   const { cmd, args } = config.claude;
 */

// ============================================================================
// Constants
// ============================================================================

/**
 * Supported tools in the CLI LLM Council.
 */
export const SUPPORTED_TOOLS = {
  CLAUDE: 'claude',
  CODEX: 'codex'
};

/**
 * Environment variable names used for configuration.
 * Exported for testing and documentation purposes.
 */
export const ENV_VARS = {
  // Claude configuration
  CLAUDE_CMD: 'CLAUDE_CMD',
  CLAUDE_ARGS: 'CLAUDE_ARGS',
  CLAUDE_TTY: 'CLAUDE_TTY',
  CLAUDE_INTERACTIVE: 'CLAUDE_INTERACTIVE',
  CLAUDE_PRINT: 'CLAUDE_PRINT',
  CLAUDE_PERMISSION_MODE: 'CLAUDE_PERMISSION_MODE',
  CLAUDE_PEXPECT: 'CLAUDE_PEXPECT',

  // Codex configuration
  CODEX_CMD: 'CODEX_CMD',
  CODEX_ARGS: 'CODEX_ARGS',
  CODEX_TTY: 'CODEX_TTY',
  CODEX_SUBCOMMAND: 'CODEX_SUBCOMMAND',
  CODEX_SKIP_GIT_CHECK: 'CODEX_SKIP_GIT_CHECK',

  // Global configuration
  TIMEOUT_MS: 'LLM_COUNCIL_TIMEOUT_MS'
};

/**
 * Default values for configuration options.
 * Exported for testing and documentation purposes.
 */
export const DEFAULTS = {
  CLAUDE_CMD: 'claude',
  CODEX_CMD: 'codex',
  CODEX_SUBCOMMAND: 'exec',
  TIMEOUT_MS: 0,
  CODEX_SKIP_GIT_CHECK: true
};

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Splits a command-line argument string into an array, respecting quotes.
 * Handles both single and double quotes, and preserves escaped quotes.
 * @param {string} str - The argument string to split
 * @returns {string[]} Array of individual arguments
 * @example
 * splitArgs('--flag "value with spaces" --other')
 * // => ['--flag', 'value with spaces', '--other']
 * @example
 * splitArgs("--path '/tmp/my folder'")
 * // => ['--path', '/tmp/my folder']
 */
function splitArgs(str) {
  if (!str || typeof str !== 'string') return [];

  const args = [];
  let current = '';
  let quote = null;
  let escaped = false;

  for (const ch of str) {
    if (escaped) {
      current += ch;
      escaped = false;
    } else if (ch === '\\') {
      escaped = true;
    } else if (quote) {
      if (ch === quote) {
        quote = null;
      } else {
        current += ch;
      }
    } else if (ch === '"' || ch === "'") {
      quote = ch;
    } else if (ch === ' ' || ch === '\t') {
      if (current) {
        args.push(current);
        current = '';
      }
    } else {
      current += ch;
    }
  }

  if (current) args.push(current);
  if (quote) console.warn(`Warning: Unclosed quote in argument string: ${str}`);

  return args;
}

/**
 * Checks if an argument array contains any of the specified flags.
 * @param {string[]} args - Array of arguments
 * @param {string[]} flags - Flag names to check for
 * @returns {boolean} True if any flag is found
 */
function hasAnyFlag(args, flags) {
  return Array.isArray(args) && Array.isArray(flags) && flags.some(flag => args.includes(flag));
}

/**
 * Returns a new array with arguments added if none of the flags are present.
 * Pure function - does not mutate the input array.
 * @param {string[]} args - Array of arguments
 * @param {string[]} flags - Flags to check for
 * @param {string[]} toAdd - Arguments to add if flags not present
 * @returns {string[]} New array with arguments potentially added
 */
function addArgsIfMissing(args, flags, toAdd) {
  return hasAnyFlag(args, flags) ? args : [...args, ...toAdd];
}

// ============================================================================
// Environment Variable Parsers
// ============================================================================

/**
 * Parses an environment variable as a boolean.
 * Values of '1' are true, undefined uses defaultValue, all others are false.
 * @param {string} envVarName - Environment variable name
 * @param {boolean} defaultValue - Default value if not set
 * @returns {boolean} Parsed boolean value
 */
function parseBooleanEnv(envVarName, defaultValue = false) {
  const value = process.env[envVarName];
  if (value === undefined) return defaultValue;
  return value === '1';
}

/**
 * Parses an environment variable as a non-negative number.
 * @param {string} envVarName - Environment variable name
 * @param {number} defaultValue - Default value if not set or invalid
 * @returns {number} Parsed number value (>= 0)
 */
function parseNumberEnv(envVarName, defaultValue = 0) {
  const value = process.env[envVarName];
  if (!value) return defaultValue;

  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : defaultValue;
}

/**
 * Gets a string environment variable with a default fallback.
 * @param {string} envVarName - Environment variable name
 * @param {string} defaultValue - Default value if not set
 * @returns {string} The environment variable value or default
 */
function getStringEnv(envVarName, defaultValue = '') {
  return process.env[envVarName] || defaultValue;
}

/**
 * Validates that an environment variable contains a valid value if set.
 * @param {string} envVarName - Environment variable name
 * @param {(value: string) => boolean} validator - Validation function that returns boolean
 * @param {string} errorMsg - Error message if validation fails
 * @throws {Error} If validation fails
 */
function validateEnvVar(envVarName, validator, errorMsg) {
  const value = process.env[envVarName];
  if (value && !validator(value)) {
    throw new Error(`${envVarName}: ${errorMsg}`);
  }
}

// ============================================================================
// Configuration Builders
// ============================================================================

/**
 * Applies conditional arguments to Claude configuration.
 * @param {string[]} args - Base arguments
 * @param {boolean} printMode - Whether print mode is enabled
 * @param {boolean} pexpect - Whether pexpect mode is enabled
 * @param {string} permissionMode - Permission mode setting
 * @returns {string[]} Arguments with conditionals applied
 */
function applyClaudeConditionalArgs(args, printMode, pexpect, permissionMode) {
  let result = args;

  if (printMode || pexpect) {
    result = addArgsIfMissing(result, ['-p', '--print'], ['-p']);
  }

  if (permissionMode) {
    result = addArgsIfMissing(result, ['--permission-mode'], ['--permission-mode', permissionMode]);
  }

  return result;
}

/**
 * Builds Claude-specific configuration from environment variables.
 * @returns {Object} Claude configuration with cmd, args, tty, interactive, print, pexpect, permissionMode
 */
function buildClaudeConfig() {
  const cmd = getStringEnv(ENV_VARS.CLAUDE_CMD, DEFAULTS.CLAUDE_CMD);
  const baseArgs = splitArgs(getStringEnv(ENV_VARS.CLAUDE_ARGS));
  const tty = parseBooleanEnv(ENV_VARS.CLAUDE_TTY);
  const interactive = parseBooleanEnv(ENV_VARS.CLAUDE_INTERACTIVE);
  const print = parseBooleanEnv(ENV_VARS.CLAUDE_PRINT);
  const pexpect = parseBooleanEnv(ENV_VARS.CLAUDE_PEXPECT);
  const permissionMode = getStringEnv(ENV_VARS.CLAUDE_PERMISSION_MODE);

  const args = applyClaudeConditionalArgs(baseArgs, print, pexpect, permissionMode);

  return { cmd, args, tty, interactive, print, pexpect, permissionMode };
}

/**
 * Applies conditional arguments to Codex configuration.
 * @param {string[]} args - Base arguments
 * @param {boolean} skipGitCheck - Whether to skip git repo check
 * @returns {string[]} Arguments with conditionals applied
 */
function applyCodexConditionalArgs(args, skipGitCheck) {
  return skipGitCheck
    ? addArgsIfMissing(args, ['--skip-git-repo-check'], ['--skip-git-repo-check'])
    : args;
}

/**
 * Builds Codex-specific configuration from environment variables.
 * @returns {Object} Codex configuration with cmd, args, tty, subcommand, skipGitCheck
 */
function buildCodexConfig() {
  const cmd = getStringEnv(ENV_VARS.CODEX_CMD, DEFAULTS.CODEX_CMD);
  const baseArgs = splitArgs(getStringEnv(ENV_VARS.CODEX_ARGS));
  const tty = parseBooleanEnv(ENV_VARS.CODEX_TTY);
  const subcommand = getStringEnv(ENV_VARS.CODEX_SUBCOMMAND, DEFAULTS.CODEX_SUBCOMMAND);
  const skipGitCheck = parseBooleanEnv(ENV_VARS.CODEX_SKIP_GIT_CHECK, DEFAULTS.CODEX_SKIP_GIT_CHECK);

  const args = applyCodexConditionalArgs(baseArgs, skipGitCheck);

  return { cmd, args, tty, subcommand, skipGitCheck };
}

/**
 * Validates tool-specific configuration.
 * @param {string} toolName - Name of the tool for error messages
 * @param {Object} config - Tool configuration to validate
 * @param {string} config.cmd - Command to execute
 * @param {string[]} config.args - Command arguments
 * @param {boolean} config.tty - TTY mode flag
 * @throws {Error} If configuration is invalid
 */
function validateToolConfig(toolName, config) {
  const errors = [];

  if (!config.cmd || typeof config.cmd !== 'string') {
    errors.push('command must be a non-empty string');
  }

  if (!Array.isArray(config.args)) {
    errors.push('args must be an array');
  } else if (config.args.some(arg => typeof arg !== 'string')) {
    errors.push('all args must be strings');
  }

  if (typeof config.tty !== 'boolean') {
    errors.push('tty must be a boolean');
  }

  if (errors.length) {
    throw new Error(`${toolName} configuration invalid: ${errors.join(', ')}`);
  }
}

/**
 * Generates a human-readable summary of the current configuration.
 * Useful for debugging and logging purposes.
 * @param {Object} config - The configuration object to summarize
 * @returns {string} A formatted string describing the configuration
 */
export function summarizeConfig(config) {
  const lines = [
    'Configuration Summary:',
    '',
    'Claude:',
    `  Command: ${config.claude.cmd}`,
    `  Args: [${config.claude.args.join(', ')}]`,
    `  TTY: ${config.claude.tty}`,
    `  Interactive: ${config.claude.interactive}`,
    `  Print Mode: ${config.claude.print}`,
    `  Pexpect: ${config.claude.pexpect}`,
    `  Permission Mode: ${config.claude.permissionMode || '(not set)'}`,
    '',
    'Codex:',
    `  Command: ${config.codex.cmd}`,
    `  Args: [${config.codex.args.join(', ')}]`,
    `  TTY: ${config.codex.tty}`,
    `  Subcommand: ${config.codex.subcommand}`,
    `  Skip Git Check: ${config.codex.skipGitCheck}`,
    '',
    'Global:',
    `  Timeout: ${config.timeoutMs}ms`
  ];
  return lines.join('\n');
}

/**
 * Retrieves and builds the complete configuration from environment variables.
 * @typedef {Object} Config
 * @property {Object} claude - Claude tool configuration
 * @property {Object} codex - Codex tool configuration
 * @property {number} timeoutMs - Timeout in milliseconds
 *
 * @returns {Config} Complete configuration object with Claude and Codex settings
 * @throws {Error} If any configuration is invalid
 * @example
 * const config = getConfig();
 * const { cmd, args } = config.claude;
 */
export function getConfig() {
  const claude = buildClaudeConfig();
  const codex = buildCodexConfig();
  const timeoutMs = parseNumberEnv(ENV_VARS.TIMEOUT_MS, DEFAULTS.TIMEOUT_MS);

  validateToolConfig('Claude', claude);
  validateToolConfig('Codex', codex);

  return { claude, codex, timeoutMs };
}
