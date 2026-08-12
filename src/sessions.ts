import * as crypto from 'node:crypto';

export interface CloakSession {
  id: string;
  accountId: string;
  cdpUrl: string;
  webSocketDebuggerUrl?: string;
  fingerprintSeed: string;
  timezone?: string;
  locale?: string;
  proxy?: string;
  pid?: number;
  binaryMode?: 'bundled' | 'latest' | 'explicit';
  executablePath?: string;
  startedAt: number;
  status: 'active' | 'closed';
}

export function deriveFingerprintSeed(accountId?: string, seedInput?: string): string {
  if (seedInput && seedInput.trim().length > 0) {
    return seedInput.trim();
  }
  if (accountId && accountId.trim().length > 0) {
    const hash = crypto.createHash('sha256').update(accountId.trim()).digest('hex').substring(0, 16);
    return `seed-${accountId.trim()}-${hash}`;
  }
  return `seed-anon-${crypto.randomUUID().substring(0, 8)}`;
}

export class CloakSessionManager {
  private sessions = new Map<string, CloakSession>();

  public registerSession(session: CloakSession): CloakSession {
    this.sessions.set(session.id, session);
    // Also index by accountId for quick lookup
    this.sessions.set(`acc:${session.accountId}`, session);
    return session;
  }

  public getSession(idOrAccountId: string): CloakSession | undefined {
    if (this.sessions.has(idOrAccountId)) {
      return this.sessions.get(idOrAccountId);
    }
    if (this.sessions.has(`acc:${idOrAccountId}`)) {
      return this.sessions.get(`acc:${idOrAccountId}`);
    }
    return undefined;
  }

  public listSessions(status?: 'active' | 'closed'): CloakSession[] {
    const uniqueSessions = new Set<CloakSession>();
    for (const session of this.sessions.values()) {
      if (!status || session.status === status) {
        uniqueSessions.add(session);
      }
    }
    return Array.from(uniqueSessions);
  }

  public async closeSession(
    idOrAccountId: string,
    killProcessHandler?: (pid: number) => Promise<void>
  ): Promise<boolean> {
    const session = this.getSession(idOrAccountId);
    if (!session) {
      return false;
    }

    if (session.status === 'closed') {
      return true;
    }

    session.status = 'closed';

    if (session.pid && killProcessHandler) {
      try {
        await killProcessHandler(session.pid);
      } catch (err) {
        // Log or handle error during process termination gracefully
        console.warn(`Failed to kill process PID ${session.pid}:`, err);
      }
    }

    return true;
  }

  public async closeAll(killProcessHandler?: (pid: number) => Promise<void>): Promise<void> {
    const activeSessions = this.listSessions('active');
    for (const session of activeSessions) {
      await this.closeSession(session.id, killProcessHandler);
    }
  }

  public clear(): void {
    this.sessions.clear();
  }
}
