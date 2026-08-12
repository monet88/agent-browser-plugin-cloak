export interface CleanupRecord {
    sessionId: string;
    accountId: string;
    pid: number;
}
export declare function rememberCleanup(record: CleanupRecord): void;
export declare function cleanupBrowserSession(sessionId?: string, accountId?: string): boolean;
//# sourceMappingURL=cleanup-store.d.ts.map