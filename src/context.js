import fs from 'node:fs';
import path from 'node:path';

const CONTEXT_DIR = 'context';
const SUMMARY_FILE = 'summary.txt';
const DEFAULT_MAX_CHARS = 4000;

function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

export function ensureContextStorage(rootDir = process.cwd()) {
  const dir = path.join(rootDir, CONTEXT_DIR);
  ensureDir(dir);
  const file = path.join(dir, SUMMARY_FILE);
  if (!fs.existsSync(file)) {
    fs.writeFileSync(file, '', 'utf-8');
  }
  return file;
}

export function loadSummary(rootDir = process.cwd()) {
  const file = ensureContextStorage(rootDir);
  const maxChars = Number(process.env.CONTEXT_MAX_CHARS || DEFAULT_MAX_CHARS);
  const data = fs.readFileSync(file, 'utf-8');
  if (!data) return '';
  if (!Number.isFinite(maxChars) || maxChars <= 0) return data;
  return data.length > maxChars ? data.slice(-maxChars) : data;
}

export function appendSummary({ rootDir = process.cwd(), question, answer }) {
  const file = ensureContextStorage(rootDir);
  const timestamp = new Date().toISOString();
  const entry = [
    `### ${timestamp}`,
    `Q: ${question.trim()}`,
    `A: ${answer.trim()}`,
    ''
  ].join('\n');
  fs.appendFileSync(file, entry, 'utf-8');
}
