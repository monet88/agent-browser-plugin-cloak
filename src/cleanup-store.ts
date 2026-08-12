import { execSync } from 'node:child_process';
import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

export interface CleanupRecord {
  sessionId: string;
  accountId: string;
  pid: number;
}

const CLEANUP_DIR = path.join(os.tmpdir(), 'agent-browser-plugin-cloak', 'sessions');

function recordPath(sessionId: string): string {
  const key = crypto.createHash('sha256').update(sessionId).digest('hex');
  return path.join(CLEANUP_DIR, `${key}.json`);
}

export function rememberCleanup(record: CleanupRecord): void {
  if (!Number.isInteger(record.pid) || record.pid <= 0) return;
  fs.mkdirSync(CLEANUP_DIR, { recursive: true });
  const target = recordPath(record.sessionId);
  const temp = `${target}.${process.pid}.tmp`;
  fs.writeFileSync(temp, JSON.stringify(record), { encoding: 'utf8', mode: 0o600 });
  fs.renameSync(temp, target);
}

function terminatePid(pid: number): void {
  if (!Number.isInteger(pid) || pid <= 0) return;
  try {
    if (process.platform === 'win32') {
      execSync(`taskkill /PID ${pid} /T /F`, {
        stdio: 'ignore',
        windowsHide: true,
        timeout: 5000,
      });
    } else {
      process.kill(pid, 'SIGTERM');
    }
  } catch {
    // The browser may already be gone; cleanup remains idempotent.
  }
}

export function cleanupBrowserSession(sessionId?: string, accountId?: string): boolean {
  if (!sessionId) return false;
  const target = recordPath(sessionId);
  if (!fs.existsSync(target)) return false;

  try {
    const record = JSON.parse(fs.readFileSync(target, 'utf8')) as CleanupRecord;
    if (record.sessionId !== sessionId) return false;
    if (accountId && record.accountId !== accountId) {
      throw new Error('Cleanup account ID does not match the recorded CloakBrowser session.');
    }
    terminatePid(record.pid);
    return true;
  } finally {
    try { fs.unlinkSync(target); } catch { /* already removed */ }
  }
}
