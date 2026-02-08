import fs from 'node:fs';
import path from 'node:path';
import { runCommand } from './runner.js';

function parseStatus(output) {
  const map = new Map();
  const lines = output.split('\n').filter(Boolean);
  for (const line of lines) {
    if (line.length < 4) continue;
    const status = line.slice(0, 2);
    const file = line.slice(3).trim();
    if (file) map.set(file, status);
  }
  return map;
}

async function git(args) {
  return runCommand({ cmd: 'git', args });
}

async function getRepoRoot() {
  const result = await git(['rev-parse', '--show-toplevel']);
  if (result.code !== 0) return null;
  const root = result.stdout.trim();
  return root || null;
}

function fileMeta(fullPath) {
  try {
    const stat = fs.statSync(fullPath);
    return { mtimeMs: stat.mtimeMs, size: stat.size };
  } catch {
    return null;
  }
}

export async function captureBaseline() {
  const root = await getRepoRoot();
  if (!root) {
    return captureFilesystemBaseline(process.cwd());
  }

  const statusResult = await git(['status', '--porcelain']);
  if (statusResult.code !== 0) return null;

  const statusMap = parseStatus(statusResult.stdout);
  const metaMap = new Map();

  for (const [file, status] of statusMap.entries()) {
    if (status.trim().length === 0) continue;
    const fullPath = path.join(root, file);
    const meta = fileMeta(fullPath);
    if (meta) metaMap.set(file, meta);
  }

  return { root, statusMap, metaMap, mode: 'git' };
}

export async function computeDelta(baseline) {
  if (!baseline) return { root: null, files: [] };
  if (baseline.mode === 'fs') {
    const delta = await computeFilesystemDelta(baseline);
    return { ...delta, mode: 'fs' };
  }
  const { root, statusMap: baseStatus, metaMap: baseMeta } = baseline;

  const statusResult = await git(['status', '--porcelain']);
  if (statusResult.code !== 0) return { root, files: [] };

  const currentStatus = parseStatus(statusResult.stdout);
  const files = new Set([...baseStatus.keys(), ...currentStatus.keys()]);
  const changed = [];

  for (const file of files) {
    const before = baseStatus.get(file);
    const after = currentStatus.get(file);

    if (!before && after) {
      changed.push(file);
      continue;
    }

    if (before && !after) {
      changed.push(file);
      continue;
    }

    if (before && after && before !== after) {
      changed.push(file);
      continue;
    }

    if (before && after && before === after) {
      const base = baseMeta.get(file);
      if (base) {
        const meta = fileMeta(path.join(root, file));
        if (!meta || meta.mtimeMs !== base.mtimeMs || meta.size !== base.size) {
          changed.push(file);
        }
      }
    }
  }

  return { root, files: changed.sort(), mode: 'git' };
}

export async function buildDeltaContext(root, files) {
  if (!root || files.length === 0) {
    return { context: '', preview: '' };
  }

  const diffResult = await git(['diff', '--no-color', '--', ...files]);
  const diff = diffResult.code === 0 ? diffResult.stdout.trim() : '';

  const untracked = [];
  for (const file of files) {
    const fullPath = path.join(root, file);
    if (fs.existsSync(fullPath)) {
      // If file is untracked or binary, include full contents for context.
      const text = fs.readFileSync(fullPath, 'utf-8');
      if (text && text.trim().length > 0) {
        untracked.push({ file, content: text });
      }
    }
  }

  let context = '';
  if (diff) {
    context += 'DIFF:\n' + diff + '\n';
  }
  if (untracked.length > 0) {
    context += '\nFILES:\n';
    for (const entry of untracked) {
      context += `--- ${entry.file} ---\n${entry.content}\n`; 
    }
  }
  const preview = diff
    ? diff.split('\n').slice(0, 120).join('\n')
    : '';

  return { context: context.trim(), preview };
}

async function captureFilesystemBaseline(root) {
  const fileList = await listFiles(root);
  const metaMap = new Map();
  for (const file of fileList) {
    const meta = fileMeta(path.join(root, file));
    if (meta) metaMap.set(file, meta);
  }
  return { root, metaMap, mode: 'fs' };
}

async function computeFilesystemDelta(baseline) {
  const { root, metaMap: baseMeta } = baseline;
  const fileList = await listFiles(root);
  const currentMeta = new Map();
  for (const file of fileList) {
    const meta = fileMeta(path.join(root, file));
    if (meta) currentMeta.set(file, meta);
  }

  const files = new Set([...baseMeta.keys(), ...currentMeta.keys()]);
  const changed = [];
  for (const file of files) {
    const before = baseMeta.get(file);
    const after = currentMeta.get(file);
    if (!before || !after) {
      changed.push(file);
      continue;
    }
    if (before.mtimeMs !== after.mtimeMs || before.size !== after.size) {
      changed.push(file);
    }
  }

  return { root, files: changed.sort() };
}

async function listFiles(root) {
  const rgResult = await runCommand({
    cmd: 'rg',
    args: ['--files', '-g', '!.git/*', '-g', '!node_modules/*']
  });
  if (rgResult.code === 0) {
    return rgResult.stdout.split('\n').filter(Boolean);
  }

  const findResult = await runCommand({
    cmd: 'find',
    args: [root, '-type', 'f', '-not', '-path', '*/.git/*', '-not', '-path', '*/node_modules/*']
  });
  if (findResult.code !== 0) return [];
  return findResult.stdout
    .split('\n')
    .filter(Boolean)
    .map((file) => file.startsWith(root) ? file.slice(root.length + 1) : file);
}
