const CODE_KEYWORDS = [
  'code', 'implement', 'fix', 'bug', 'refactor', 'optimize', 'performance',
  'test', 'unit test', 'integration test', 'build', 'compile', 'lint',
  'api', 'endpoint', 'function', 'class', 'module', 'package', 'script',
  'cli', 'config', 'deploy', 'migrate', 'database', 'sql', 'schema',
  'regex', 'algorithm', 'patch', 'diff', 'stack trace'
];

const FILE_HINTS = [
  '.', '/', '\\', '.js', '.ts', '.py', '.go', '.rs', '.java', '.cs', '.rb',
  '.php', '.cpp', '.c', '.h', '.html', '.css', '.json', '.yml', '.yaml',
  '.md', '.toml', '.sh'
];

export function shouldReview(command) {
  const text = command.toLowerCase();

  if (CODE_KEYWORDS.some((k) => text.includes(k))) return true;
  if (FILE_HINTS.some((k) => text.includes(k))) return true;

  return false;
}
