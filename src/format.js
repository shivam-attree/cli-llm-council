export function section(title) {
  const line = "\u2500".repeat(24);
  return `${line}\n${title}\n${line}`;
}

export function printBlock(title, body) {
  const safeBody = body && body.trim().length > 0 ? body.trim() : "(no output)";
  return `${section(title)}\n${safeBody}`;
}

export function printHeading(label, value) {
  return `\u25B6 ${label}:\n${value}`;
}
