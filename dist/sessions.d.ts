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
export declare function deriveFingerprintSeed(accountId?: string, seedInput?: string): string;
export declare class CloakSessionManager {
    private sessions;
    registerSession(session: CloakSession): CloakSession;
    getSession(idOrAccountId: string): CloakSession | undefined;
    listSessions(status?: 'active' | 'closed'): CloakSession[];
    closeSession(idOrAccountId: string, killProcessHandler?: (pid: number) => Promise<void>): Promise<boolean>;
    closeAll(killProcessHandler?: (pid: number) => Promise<void>): Promise<void>;
    clear(): void;
}
//# sourceMappingURL=sessions.d.ts.map