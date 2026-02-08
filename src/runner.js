import { spawn } from 'node:child_process';
import fs from 'node:fs';

export function runCommand({ cmd, args = [], input = '', timeoutMs = 0 }) {
  return new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    let timedOut = false;

    const child = spawn(cmd, args, { stdio: 'pipe' });

    const timer = timeoutMs > 0
      ? setTimeout(() => {
          timedOut = true;
          child.kill('SIGKILL');
        }, timeoutMs)
      : null;

    child.stdout.on('data', (chunk) => { stdout += chunk.toString(); });
    child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });

    child.on('error', (error) => {
      if (timer) clearTimeout(timer);
      resolve({ stdout, stderr, code: 1, error });
    });

    child.on('close', (code) => {
      if (timer) clearTimeout(timer);
      resolve({ stdout, stderr, code: timedOut ? 124 : code ?? 0, error: null });
    });

    if (input && input.length > 0) {
      child.stdin.write(input);
    }
    child.stdin.end();
  });
}

export async function runCommandPty({ cmd, args = [], input = '', timeoutMs = 0 }) {
  let spawnPty;
  try {
    ({ spawn: spawnPty } = await import('node-pty'));
  } catch (error) {
    return {
      stdout: '',
      stderr: 'node-pty is required for TTY mode. Run: npm install',
      code: 1,
      error
    };
  }

  return new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    let timedOut = false;

    let ptyProcess;
    let timer = null;

    if (timeoutMs > 0) {
      timer = setTimeout(() => {
        timedOut = true;
        if (ptyProcess) ptyProcess.kill();
      }, timeoutMs);
    }

    try {
      ptyProcess = spawnPty(cmd, args, {
        name: 'xterm-color',
        cols: 120,
        rows: 30,
        cwd: process.cwd(),
        env: process.env
      });
    } catch (error) {
      if (timer) clearTimeout(timer);
      runCommandTtyScript({ cmd, args, input, timeoutMs })
        .then(resolve)
        .catch((inner) => resolve({
          stdout: '',
          stderr: inner?.message || error.message,
          code: 1,
          error: inner || error
        }));
      return;
    }

    ptyProcess.onData((data) => {
      stdout += data;
    });

    ptyProcess.onExit(({ exitCode }) => {
      if (timer) clearTimeout(timer);
      resolve({ stdout, stderr, code: timedOut ? 124 : exitCode, error: null });
    });

    if (input && input.length > 0) {
      ptyProcess.write(input);
      if (!input.endsWith('\n')) {
        ptyProcess.write('\n');
      }
      // Signal EOF for CLIs that expect it on a tty.
      ptyProcess.write('\x04');
    }
  });
}

export async function runCommandPtyInteractive({ cmd, args = [], input = '', timeoutMs = 0 }) {
  let spawnPty;
  try {
    ({ spawn: spawnPty } = await import('node-pty'));
  } catch (error) {
    return {
      stdout: '',
      stderr: 'node-pty is required for TTY mode. Run: npm install',
      code: 1,
      error
    };
  }

  return new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    let ptyProcess;
    let wasRaw = false;
    let stdinListener = null;

    const timer = timeoutMs > 0
      ? setTimeout(() => {
          timedOut = true;
          cleanup();
          if (ptyProcess) ptyProcess.kill();
        }, timeoutMs)
      : null;

    const cleanup = () => {
      if (timer) clearTimeout(timer);
      if (stdinListener && process.stdin) {
        process.stdin.off('data', stdinListener);
      }
      if (process.stdin.isTTY) {
        process.stdin.setRawMode(Boolean(wasRaw));
      }
    };

    try {
      // Get terminal dimensions from current process if available
      const cols = process.stdout.columns || 120;
      const rows = process.stdout.rows || 30;

      ptyProcess = spawnPty(cmd, args, {
        name: 'xterm-256color',
        cols,
        rows,
        cwd: process.cwd(),
        env: process.env
      });
    } catch (error) {
      cleanup();
      resolve({ stdout, stderr: error.message, code: 1, error });
      return;
    }

    // Handle PTY output - stream to stdout and capture
    ptyProcess.onData((data) => {
      stdout += data;
      process.stdout.write(data);
    });

    // Handle stdin - forward all input to PTY
    stdinListener = (data) => {
      if (ptyProcess) {
        ptyProcess.write(data.toString());
      }
    };

    // Set up raw mode for true interactive experience
    if (process.stdin.isTTY) {
      wasRaw = process.stdin.isRaw;
      process.stdin.setRawMode(true);
    }

    // Resume stdin to start reading
    if (process.stdin.isPaused()) {
      process.stdin.resume();
    }

    process.stdin.on('data', stdinListener);

    // Handle resize events
    if (process.stdout.isTTY) {
      const onResize = () => {
        if (ptyProcess && process.stdout.columns && process.stdout.rows) {
          ptyProcess.resize(process.stdout.columns, process.stdout.rows);
        }
      };
      process.stdout.on('resize', onResize);

      // Clean up resize listener on exit
      ptyProcess.onExit(({ exitCode }) => {
        process.stdout.off('resize', onResize);
        cleanup();
        resolve({ stdout, stderr, code: timedOut ? 124 : exitCode, error: null });
      });
    } else {
      ptyProcess.onExit(({ exitCode }) => {
        cleanup();
        resolve({ stdout, stderr, code: timedOut ? 124 : exitCode, error: null });
      });
    }

    // Send initial input if provided
    if (input && input.length > 0) {
      ptyProcess.write(input);
      if (!input.endsWith('\n')) {
        ptyProcess.write('\n');
      }
    }
  });
}

export function runCommandInheritCapture({ cmd, args = [], env = {}, capturePath, timeoutMs = 0 }) {
  return new Promise((resolve) => {
    let stderr = '';
    let timedOut = false;

    const child = spawn(cmd, args, {
      stdio: ['inherit', 'inherit', 'pipe'],
      env: { ...process.env, ...env }
    });

    const timer = timeoutMs > 0
      ? setTimeout(() => {
          timedOut = true;
          child.kill('SIGKILL');
        }, timeoutMs)
      : null;

    child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });

    child.on('error', (error) => {
      if (timer) clearTimeout(timer);
      resolve({ stdout: '', stderr, code: 1, error });
    });

    child.on('close', (code) => {
      if (timer) clearTimeout(timer);
      let stdout = '';
      if (capturePath && fs.existsSync(capturePath)) {
        stdout = fs.readFileSync(capturePath, 'utf-8');
      }
      resolve({ stdout, stderr, code: timedOut ? 124 : code ?? 0, error: null });
    });
  });
}

export function runCommandTtyScript({ cmd, args = [], input = '', timeoutMs = 0 }) {
  return new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    let timedOut = false;

    const scriptArgs = ['-q', '/dev/null', cmd, ...args];
    const child = spawn('/usr/bin/script', scriptArgs, { stdio: 'pipe' });

    const timer = timeoutMs > 0
      ? setTimeout(() => {
          timedOut = true;
          child.kill('SIGKILL');
        }, timeoutMs)
      : null;

    child.stdout.on('data', (chunk) => { stdout += chunk.toString(); });
    child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });

    child.on('error', (error) => {
      if (timer) clearTimeout(timer);
      resolve({ stdout, stderr, code: 1, error });
    });

    child.on('close', (code) => {
      if (timer) clearTimeout(timer);
      resolve({ stdout, stderr, code: timedOut ? 124 : code ?? 0, error: null });
    });

    if (input && input.length > 0) {
      child.stdin.write(input);
    }
    child.stdin.end();
  });
}
