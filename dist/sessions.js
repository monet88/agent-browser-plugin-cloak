import * as crypto from 'node:crypto';
export function deriveFingerprintSeed(accountId, seedInput) {
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
    sessions = new Map();
    registerSession(session) {
        this.sessions.set(session.id, session);
        // Also index by accountId for quick lookup
        this.sessions.set(`acc:${session.accountId}`, session);
        return session;
    }
    getSession(idOrAccountId) {
        if (this.sessions.has(idOrAccountId)) {
            return this.sessions.get(idOrAccountId);
        }
        if (this.sessions.has(`acc:${idOrAccountId}`)) {
            return this.sessions.get(`acc:${idOrAccountId}`);
        }
        return undefined;
    }
    listSessions(status) {
        const uniqueSessions = new Set();
        for (const session of this.sessions.values()) {
            if (!status || session.status === status) {
                uniqueSessions.add(session);
            }
        }
        return Array.from(uniqueSessions);
    }
    async closeSession(idOrAccountId, killProcessHandler) {
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
            }
            catch (err) {
                // Log or handle error during process termination gracefully
                console.warn(`Failed to kill process PID ${session.pid}:`, err);
            }
        }
        return true;
    }
    async closeAll(killProcessHandler) {
        const activeSessions = this.listSessions('active');
        for (const session of activeSessions) {
            await this.closeSession(session.id, killProcessHandler);
        }
    }
    clear() {
        this.sessions.clear();
    }
}
//# sourceMappingURL=sessions.js.map