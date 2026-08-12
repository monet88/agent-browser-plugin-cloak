/**
 * CloakBrowser provider for agent-browser plugin.
 *
 * Uses the `cloakbrowser` npm SDK for binary resolution and stealth args,
 * then spawns Chrome as an independent process with --remote-debugging-port.
 *
 * Key design: Chrome must survive the plugin process's exit because
 * agent-browser spawns the plugin, reads the CDP URL, then the plugin exits.
 * On Windows, Chrome is launched through PowerShell Start-Process. Explicit
 * headed launches also create a breakaway delayed-focus watcher via cmd/start.
 */
import { CloakSession, CloakSessionManager } from './sessions.js';
export interface CloakProviderOptions {
    accountId?: string;
    fingerprintSeed?: string;
    timezone?: string;
    locale?: string;
    proxy?: string;
    host?: string;
    port?: number;
    /** Binary selection mode. Defaults to bundled (the keyless/free build shipped by the wrapper). */
    binaryMode?: 'bundled' | 'latest' | 'explicit';
    /** Path to CloakBrowser chrome binary. Required for explicit mode unless set by env. */
    executablePath?: string;
    autoStart?: boolean;
    startTimeoutMs?: number;
    extraArgs?: string[];
    /** Path to user data dir for the Chrome profile. Auto-generated per session if omitted. */
    userDataDir?: string;
    headless?: boolean;
}
export declare function resolveBundledCloakBinary(cacheRoot: string, major?: string): string | undefined;
/**
 * Resolve the CloakBrowser binary without accidentally upgrading a keyless/free
 * installation to a licensed/latest build.
 *
 * Priority:
 * - explicit: executablePath / CLOAKBROWSER_PATH / CLOAKBROWSER_BINARY_PATH
 * - bundled: wrapper-bundled Chromium version in ~/.cloakbrowser (default)
 * - latest: SDK resolution, including free-login/Pro license behavior
 */
export declare function resolveCloakBrowser(options: CloakProviderOptions): Promise<{
    binaryPath: string;
    stealthArgs: string[];
    mode: 'bundled' | 'latest' | 'explicit';
}>;
export declare class CloakBrowserProvider {
    private sessionManager;
    /** Map of port → PID for CloakBrowser instances we launched */
    private managedPorts;
    getSessionManager(): CloakSessionManager;
    isCDPReady(host?: string, port?: number): Promise<boolean>;
    /**
     * Launch CloakBrowser with remote debugging enabled.
     * Uses the cloakbrowser SDK for binary + args, then spawns Chrome independently.
     */
    startBrowser(options?: CloakProviderOptions): Promise<{
        pid?: number;
        host: string;
        port: number;
        binaryMode?: 'bundled' | 'latest' | 'explicit';
        executablePath?: string;
    }>;
    fetchWebSocketDebuggerUrl(host: string, port: number): Promise<string>;
    launch(options?: CloakProviderOptions): Promise<CloakSession>;
    connect(options?: CloakProviderOptions): Promise<{
        cdpUrl: string;
        webSocketDebuggerUrl?: string;
        session: CloakSession;
    }>;
    /**
     * Close a CloakBrowser session by session/account ID.
     * Kills by PID only — never by process name — to avoid touching regular Chrome.
     */
    close(idOrAccountId: string): Promise<void>;
    /**
     * Close all CloakBrowser sessions we manage.
     * Kills by PID only — never by process name.
     */
    closeAll(): Promise<void>;
}
//# sourceMappingURL=provider.d.ts.map