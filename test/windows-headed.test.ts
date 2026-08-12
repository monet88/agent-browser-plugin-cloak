import { execFileSync, spawnSync } from 'node:child_process';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const cliPath = path.resolve(__dirname, '../dist/cli.js');
const PROTOCOL = 'agent-browser.plugin.v1';

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(`Assertion failed: ${message}`);
}

function invokePlugin(request: Record<string, unknown>, windowsHide: boolean): any {
  const result = spawnSync(process.execPath, [cliPath], {
    input: `${JSON.stringify(request)}\n`,
    encoding: 'utf8',
    windowsHide,
  });
  assert(result.status === 0, `plugin exited ${result.status}: ${result.stderr}`);
  const line = result.stdout.trim().split(/\r?\n/).filter(Boolean).at(-1);
  assert(Boolean(line), 'plugin returned no JSON response');
  return JSON.parse(line!);
}

function powershell(script: string): string {
  return execFileSync('powershell.exe', ['-NoProfile', '-Command', script], {
    encoding: 'utf8',
    windowsHide: true,
  }).trim();
}
if (process.platform !== 'win32') {
  console.log('SKIP: Windows-only headed foreground regression test.');
  process.exit(0);
}

const session = `headed-regression-${Date.now()}`;
let cleanup: Record<string, unknown> | undefined;

try {
  const launch = invokePlugin({
    type: 'browser.launch',
    capability: 'browser.provider',
    protocol: PROTOCOL,
    request: {
      provider: 'cloak',
      session,
      launchOptions: { headed: true, engine: 'chrome' },
    },
  }, true);

  assert(launch.success === true, `launch failed: ${JSON.stringify(launch)}`);
  cleanup = launch.browser?.cleanup;
  const cdpUrl = String(launch.browser?.cdpUrl || '');
  const port = Number(new URL(cdpUrl).port);
  assert(Number.isInteger(port) && port > 0, `invalid CDP URL: ${cdpUrl}`);

  const pidText = powershell(
    `(Get-NetTCPConnection -LocalPort ${port} -State Listen | Select-Object -First 1).OwningProcess`
  );
  const browserPid = Number(pidText);
  assert(Number.isInteger(browserPid) && browserPid > 0, `no browser PID for port ${port}`);
  // The provider schedules a final foreground handoff after the agent-browser
  // launch path has had time to return focus to the IDE/terminal.
  await new Promise((resolve) => setTimeout(resolve, 9000));

  const stateJson = powershell(`
    Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; public static class FG { [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow(); [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd); }';
    $p = Get-Process -Id ${browserPid};
    [pscustomobject]@{
      handle = [int64]$p.MainWindowHandle;
      visible = [FG]::IsWindowVisible([IntPtr]$p.MainWindowHandle);
      foreground = ([FG]::GetForegroundWindow() -eq [IntPtr]$p.MainWindowHandle)
    } | ConvertTo-Json -Compress
  `);
  const state = JSON.parse(stateJson);
  assert(state.handle !== 0, 'headed CloakBrowser must have a top-level window');
  assert(state.visible === true, 'headed CloakBrowser window must be visible');
  assert(state.foreground === true, 'headed CloakBrowser must be brought to foreground');
  console.log(`PASS: headed browser PID ${browserPid} is visible and foreground.`);
} finally {
  if (cleanup) {
    invokePlugin({
      type: 'browser.close',
      capability: 'browser.provider',
      protocol: PROTOCOL,
      request: cleanup,
    }, true);
  }
}
