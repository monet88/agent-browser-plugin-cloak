/**
 * CloakBrowser provider for agent-browser plugin.
 *
 * Uses the `cloakbrowser` npm SDK for binary resolution and stealth args,
 * then spawns Chrome as an independent process with --remote-debugging-port.
 *
 * Key design: Chrome must survive the plugin process's exit because
 * agent-browser spawns the plugin, reads the CDP URL, then the plugin exits.
 * On Windows, we use `cmd.exe /c start` to create a truly independent process
 * that is not part of the plugin's process tree.
 */

import * as http from 'node:http';
import * as net from 'node:net';
import { spawn, execSync, ChildProcess } from 'node:child_process';
import * as crypto from 'node:crypto';
import * as path from 'node:path';
import * as os from 'node:os';
import * as fs from 'node:fs';
import { CloakSession, CloakSessionManager, deriveFingerprintSeed } from './sessions.js';

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

/**
 * Find an available port by opening then closing a server on port 0.
 */
async function findFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.listen(0, '127.0.0.1', () => {
      const addr = srv.address();
      const port = typeof addr === 'object' && addr ? addr.port : 0;
      srv.close(() => resolve(port));
    });
    srv.on('error', reject);
  });
}

/**
 * Resolve the CloakBrowser binary without accidentally upgrading a keyless/free
 * installation to a licensed/latest build.
 *
 * Priority:
 * - explicit: executablePath / CLOAKBROWSER_PATH / CLOAKBROWSER_BINARY_PATH
 * - bundled: wrapper-bundled Chromium version in ~/.cloakbrowser (default)
 * - latest: SDK resolution, including free-login/Pro license behavior
 */
export async function resolveCloakBrowser(options: CloakProviderOptions): Promise<{
  binaryPath: string;
  stealthArgs: string[];
  mode: 'bundled' | 'latest' | 'explicit';
}> {
  const explicitBinaryPath = options.executablePath || process.env.CLOAKBROWSER_PATH || process.env.CLOAKBROWSER_BINARY_PATH;
  const configuredMode = options.binaryMode || (process.env.CLOAKBROWSER_BINARY_MODE as CloakProviderOptions['binaryMode']);
  const mode = configuredMode || (explicitBinaryPath ? 'explicit' : 'bundled');
  const sdk = await import('cloakbrowser');

  if (mode === 'explicit') {
    if (!explicitBinaryPath) {
      throw new Error('CloakBrowser explicit mode requires executablePath, CLOAKBROWSER_PATH, or CLOAKBROWSER_BINARY_PATH.');
    }
    if (!fs.existsSync(explicitBinaryPath)) {
      throw new Error(`CloakBrowser explicit binary does not exist: ${explicitBinaryPath}`);
    }
    return { binaryPath: explicitBinaryPath, stealthArgs: sdk.getDefaultStealthArgs(), mode };
  }

  if (mode === 'bundled') {
    const info = sdk.binaryInfo();
    const version = info.bundledVersion as string;
    const cacheRoot = process.env.CLOAKBROWSER_CACHE_DIR || path.join(os.homedir(), '.cloakbrowser');
    const binaryPath = process.platform === 'darwin'
      ? path.join(cacheRoot, `chromium-${version}`, 'Chromium.app', 'Contents', 'MacOS', 'Chromium')
      : path.join(cacheRoot, `chromium-${version}`, process.platform === 'win32' ? 'chrome.exe' : 'chrome');
    if (!fs.existsSync(binaryPath)) {
      throw new Error(
        `Bundled CloakBrowser ${version} is not installed at ${binaryPath}. ` +
        `Run "npx cloakbrowser install" without a license override, or use binaryMode=latest/explicit.`
      );
    }
    return { binaryPath, stealthArgs: sdk.getDefaultStealthArgs(), mode };
  }

  if (mode !== 'latest') {
    throw new Error(`Unsupported CloakBrowser binary mode: ${String(mode)}`);
  }

  const launchOpts = await sdk.buildLaunchOptions({
    headless: options.headless ?? true,
    args: options.extraArgs || [],
  });
  return {
    binaryPath: launchOpts.executablePath as string,
    stealthArgs: (launchOpts.args || []) as string[],
    mode,
  };
}

/**
 * Spawn CloakBrowser as a fully independent process.
 *
 * Uses Node's spawn with detached:true + unref() to orphan the Chrome process.
 * CloakBrowser on Windows does NOT support headless (exits immediately),
 * so we always run headed. The window can be minimized via --window-position.
 *
 * On Linux/macOS: same approach, with optional headless.
 */
function spawnIndependentChrome(binaryPath: string, args: string[]): void {
  const child = spawn(binaryPath, args, {
    detached: true,
    stdio: ['ignore', 'ignore', 'ignore'],
    windowsHide: false, // must be false for headed CloakBrowser
  });
  child.unref();
}

/**
 * Find the PID of a process listening on a given TCP port.
 * Uses netstat on Windows, lsof on other platforms.
 * Returns undefined if not found.
 */
function findPidByPort(port: number): number | undefined {
  try {
    if (process.platform === 'win32') {
      const out = execSync(
        `netstat -ano | findstr "LISTENING" | findstr ":${port} "`,
        { encoding: 'utf-8', timeout: 3000, windowsHide: true }
      ).trim();
      // Lines like: TCP  127.0.0.1:52619  0.0.0.0:0  LISTENING  12345
      for (const line of out.split(/\r?\n/)) {
        const parts = line.trim().split(/\s+/);
        const pid = parseInt(parts[parts.length - 1], 10);
        if (pid > 0) return pid;
      }
    } else {
      const out = execSync(
        `lsof -ti :${port} -sTCP:LISTEN 2>/dev/null || true`,
        { encoding: 'utf-8', timeout: 3000 }
      ).trim();
      const pid = parseInt(out.split('\n')[0], 10);
      if (pid > 0) return pid;
    }
  } catch {
    // Ignore — PID not found
  }
  return undefined;
}

/**
 * Kill a CloakBrowser process by PID.
 * On Windows uses taskkill with /T (tree kill) to get all child processes.
 * Only kills by PID — never by name — to avoid touching the user's regular Chrome.
 */
function killByPid(pid: number): void {
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
    // Process already gone
  }
}

export class CloakBrowserProvider {
  private sessionManager = new CloakSessionManager();
  /** Map of port → PID for CloakBrowser instances we launched */
  private managedPorts = new Map<number, number | undefined>();

  public getSessionManager(): CloakSessionManager {
    return this.sessionManager;
  }

  public async isCDPReady(host: string = '127.0.0.1', port: number = 9222): Promise<boolean> {
    return new Promise((resolve) => {
      const req = http.get(`http://${host}:${port}/json/version`, { timeout: 2000 }, (res) => {
        resolve(res.statusCode === 200);
      });
      req.on('error', () => resolve(false));
      req.on('timeout', () => {
        req.destroy();
        resolve(false);
      });
    });
  }

  /**
   * Launch CloakBrowser with remote debugging enabled.
   * Uses the cloakbrowser SDK for binary + args, then spawns Chrome independently.
   */
  public async startBrowser(options: CloakProviderOptions = {}): Promise<{
    pid?: number;
    host: string;
    port: number;
    binaryMode?: 'bundled' | 'latest' | 'explicit';
    executablePath?: string;
  }> {
    const host = options.host || '127.0.0.1';
    let port = options.port || 0;

    // Check if something is already running on the specified port
    if (port > 0) {
      const alreadyRunning = await this.isCDPReady(host, port);
      if (alreadyRunning) {
        return { host, port };
      }
    }

    if (options.autoStart === false) {
      throw new Error(`No CDP endpoint on ${host}:${port} and autoStart is disabled.`);
    }

    if (port === 0) {
      port = await findFreePort();
    }

    // Resolve binary + stealth args from CloakBrowser SDK
    const { binaryPath, stealthArgs, mode: binaryMode } = await resolveCloakBrowser(options);
    const seed = deriveFingerprintSeed(options.accountId, options.fingerprintSeed);

    // Build Chrome launch args
    const sessionSuffix = crypto.randomUUID().substring(0, 8);
    const userDataDir = options.userDataDir ||
      path.join(os.tmpdir(), `cloakbrowser-${seed.substring(0, 16)}-${sessionSuffix}`);

    const args: string[] = [
      ...stealthArgs,
      `--remote-debugging-port=${port}`,
      `--no-first-run`,
      `--no-default-browser-check`,
      `--user-data-dir=${userDataDir}`,
    ];

    // Override fingerprint seed (replace SDK's random seed with deterministic one)
    const seedArgIdx = args.findIndex(a => a.startsWith('--fingerprint='));
    if (seedArgIdx >= 0) {
      args[seedArgIdx] = `--fingerprint=${seed}`;
    } else {
      args.push(`--fingerprint=${seed}`);
    }

    // CloakBrowser on Windows does NOT support headless mode — Chrome exits
    // immediately. Always run headed. On Linux/macOS, headless works fine.
    if (process.platform !== 'win32' && options.headless !== false) {
      args.push('--headless=new');
    }
    if (options.timezone) {
      args.push(`--fingerprint-timezone=${options.timezone}`);
    }
    if (options.locale) {
      args.push(`--fingerprint-locale=${options.locale}`, `--lang=${options.locale}`);
    }
    if (options.proxy) {
      args.push(`--proxy-server=${options.proxy}`);
    }
    if (options.extraArgs) {
      args.push(...options.extraArgs);
    }

    // Launch CloakBrowser as an independent process
    spawnIndependentChrome(binaryPath, args);

    // Wait for CDP to become ready
    const timeout = options.startTimeoutMs || 15000;
    const startTime = Date.now();

    while (Date.now() - startTime < timeout) {
      const ready = await this.isCDPReady(host, port);
      if (ready) {
        // Resolve PID from the port so we can clean up later
        const pid = findPidByPort(port);
        this.managedPorts.set(port, pid);
        return { pid, host, port, binaryMode, executablePath: binaryPath };
      }
      await new Promise((r) => setTimeout(r, 200));
    }

    throw new Error(
      `Timed out waiting for CloakBrowser CDP on ${host}:${port} after ${timeout}ms.\n` +
      `Binary: ${binaryPath}`
    );
  }

  public async fetchWebSocketDebuggerUrl(host: string, port: number): Promise<string> {
    return new Promise((resolve) => {
      const defaultWsUrl = `ws://${host}:${port}/devtools/browser`;
      const req = http.get(`http://${host}:${port}/json/version`, { timeout: 2000 }, (res) => {
        let body = '';
        res.on('data', (chunk) => (body += chunk));
        res.on('end', () => {
          try {
            const data = JSON.parse(body);
            if (data.webSocketDebuggerUrl) {
              resolve(data.webSocketDebuggerUrl);
              return;
            }
          } catch {
            // Ignore JSON parse error, fallback to default
          }
          resolve(defaultWsUrl);
        });
      });
      req.on('error', () => resolve(defaultWsUrl));
    });
  }

  public async launch(options: CloakProviderOptions = {}): Promise<CloakSession> {
    const { pid, host, port, binaryMode, executablePath } = await this.startBrowser(options);
    const accountId = options.accountId || `acc-${crypto.randomUUID().substring(0, 8)}`;
    const seed = deriveFingerprintSeed(options.accountId, options.fingerprintSeed);

    const wsDebuggerUrl = await this.fetchWebSocketDebuggerUrl(host, port);
    const cdpUrl = `http://${host}:${port}`;

    const sessionId = `session-${crypto.randomUUID()}`;
    const session: CloakSession = {
      id: sessionId,
      accountId,
      cdpUrl,
      webSocketDebuggerUrl: wsDebuggerUrl,
      fingerprintSeed: seed,
      timezone: options.timezone || 'Asia/Ho_Chi_Minh',
      locale: options.locale || 'vi-VN',
      proxy: options.proxy,
      pid,
      binaryMode,
      executablePath,
      startedAt: Date.now(),
      status: 'active'
    };

    this.sessionManager.registerSession(session);
    return session;
  }

  public async connect(options: CloakProviderOptions = {}): Promise<{
    cdpUrl: string;
    webSocketDebuggerUrl?: string;
    session: CloakSession;
  }> {
    const session = await this.launch(options);
    return {
      cdpUrl: session.cdpUrl,
      webSocketDebuggerUrl: session.webSocketDebuggerUrl,
      session
    };
  }

  /**
   * Close a CloakBrowser session by session/account ID.
   * Kills by PID only — never by process name — to avoid touching regular Chrome.
   */
  public async close(idOrAccountId: string): Promise<void> {
    await this.sessionManager.closeSession(idOrAccountId, async (pid) => {
      killByPid(pid);
    });
  }

  /**
   * Close all CloakBrowser sessions we manage.
   * Kills by PID only — never by process name.
   */
  public async closeAll(): Promise<void> {
    await this.sessionManager.closeAll(async (pid) => {
      killByPid(pid);
    });

    // Also kill any tracked by port
    for (const [port, pid] of this.managedPorts) {
      const actualPid = pid ?? findPidByPort(port);
      if (actualPid) {
        killByPid(actualPid);
      }
    }
    this.managedPorts.clear();
  }
}
