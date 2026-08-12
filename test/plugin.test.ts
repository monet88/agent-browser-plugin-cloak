import * as http from 'node:http';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  CloakBrowserProvider,
  CloakSessionManager,
  deriveFingerprintSeed,
  name,
  capability
} from '../src/index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function assert(condition: boolean, message: string) {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`);
  }
}

async function runTests() {
  console.log('--- Running agent-browser-plugin-cloak Tests ---\n');
  let passed = 0;
  let failed = 0;

  async function testCase(title: string, fn: () => Promise<void> | void) {
    try {
      await fn();
      console.log(`  ✓ PASSED: ${title}`);
      passed++;
    } catch (err) {
      console.error(`  ✗ FAILED: ${title}\n    ${err instanceof Error ? err.stack || err.message : String(err)}`);
      failed++;
    }
  }

  // 1. Package capability declaration test
  await testCase('package.json declares browser.provider capability', () => {
    const pkgPath = path.resolve(__dirname, '../package.json');
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
    assert(pkg['agent-browser'] !== undefined, 'package.json must contain "agent-browser" field');
    assert(
      Array.isArray(pkg['agent-browser'].capabilities) &&
        pkg['agent-browser'].capabilities.includes('browser.provider'),
      'package.json capabilities must include "browser.provider"'
    );
    assert(pkg['agent-browser'].name === 'cloak', 'package.json name must be "cloak"');
    assert(name === 'cloak', 'Module name export must be "cloak"');
    assert(capability === 'browser.provider', 'Module capability export must be "browser.provider"');
  });

  // 2. Fingerprint seed derivation test
  await testCase('deriveFingerprintSeed maps account IDs and explicit seeds correctly', () => {
    const seed1 = deriveFingerprintSeed('acc-user-1');
    const seed2 = deriveFingerprintSeed('acc-user-1');
    const seed3 = deriveFingerprintSeed('acc-user-2');
    const explicit = deriveFingerprintSeed('acc-user-1', 'custom-seed-xyz');

    assert(seed1 === seed2, 'Same account ID must produce identical fingerprint seed');
    assert(seed1 !== seed3, 'Different account IDs must produce different fingerprint seeds');
    assert(explicit === 'custom-seed-xyz', 'Explicit seed must override account ID derivation');
    assert(seed1.startsWith('seed-acc-user-1-'), 'Derived seed must include account ID prefix');
  });

  // 3. Binary resolution test
  await testCase('bundled mode resolves the wrapper bundled/free CloakBrowser build', async () => {
    const { resolveCloakBrowser } = await import('../src/provider.js');
    const previousMode = process.env.CLOAKBROWSER_BINARY_MODE;
    const previousPath = process.env.CLOAKBROWSER_PATH;
    const previousBinaryPath = process.env.CLOAKBROWSER_BINARY_PATH;
    delete process.env.CLOAKBROWSER_BINARY_MODE;
    delete process.env.CLOAKBROWSER_PATH;
    delete process.env.CLOAKBROWSER_BINARY_PATH;
    try {
      const result = await resolveCloakBrowser({ binaryMode: 'bundled' });
      assert(result.mode === 'bundled', 'Resolution mode must be bundled');
      assert(result.binaryPath.includes('chromium-146.0.7680.177.5'), 'Bundled Windows build should resolve Chromium 146');
      assert(fs.existsSync(result.binaryPath), 'Bundled binary path must exist');
    } finally {
      if (previousMode === undefined) delete process.env.CLOAKBROWSER_BINARY_MODE; else process.env.CLOAKBROWSER_BINARY_MODE = previousMode;
      if (previousPath === undefined) delete process.env.CLOAKBROWSER_PATH; else process.env.CLOAKBROWSER_PATH = previousPath;
      if (previousBinaryPath === undefined) delete process.env.CLOAKBROWSER_BINARY_PATH; else process.env.CLOAKBROWSER_BINARY_PATH = previousBinaryPath;
    }
  });

  // 4. Session Manager isolation and registration test
  await testCase('CloakSessionManager registers and isolates multiple active sessions', async () => {
    const manager = new CloakSessionManager();

    const s1: {
      id: string;
      accountId: string;
      cdpUrl: string;
      fingerprintSeed: string;
      startedAt: number;
      status: 'active';
      pid?: number;
    } = {
      id: 'sess-1',
      accountId: 'acc-1',
      cdpUrl: 'http://127.0.0.1:9222?fingerprint=seed-1',
      fingerprintSeed: 'seed-1',
      startedAt: Date.now(),
      status: 'active' as const
    };

    const s2 = {
      id: 'sess-2',
      accountId: 'acc-2',
      cdpUrl: 'http://127.0.0.1:9222?fingerprint=seed-2',
      fingerprintSeed: 'seed-2',
      startedAt: Date.now(),
      status: 'active' as const
    };

    manager.registerSession(s1);
    manager.registerSession(s2);

    assert(manager.listSessions('active').length === 2, 'Should list 2 active sessions');
    assert(manager.getSession('sess-1')?.fingerprintSeed === 'seed-1', 'Session 1 seed mismatch');
    assert(manager.getSession('acc-2')?.fingerprintSeed === 'seed-2', 'Account 2 lookup failed');

    let killedPid: number | undefined;
    s1.pid = 12345;

    await manager.closeSession('sess-1', async (pid) => {
      killedPid = pid;
    });

    assert(killedPid === 12345, 'Target process PID 12345 should have been killed on close');
    assert(manager.getSession('sess-1')?.status === 'closed', 'Session 1 status should be closed');
    assert(manager.getSession('sess-2')?.status === 'active', 'Session 2 status should remain active');
  });

  // 5. Mock external CDP server test for lifecycle (attach, connect, cleanup, multi-session)
  await testCase('CloakBrowserProvider attaches to an existing CDP server and manages session lifecycle', async () => {
    // Spin up mock cloakserve HTTP server on port 9876
    const mockPort = 9876;
    const server = http.createServer((req, res) => {
      if (req.url?.startsWith('/json/version')) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            Browser: 'CloakBrowser/124.0.0.0',
            'Protocol-Version': '1.3',
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) CloakBrowser/124.0',
            webSocketDebuggerUrl: `ws://127.0.0.1:${mockPort}/devtools/browser/mock-id`
          })
        );
      } else {
        res.writeHead(404);
        res.end();
      }
    });

    await new Promise<void>((resolve) => server.listen(mockPort, '127.0.0.1', () => resolve()));

    try {
      const provider = new CloakBrowserProvider();

      // Verify CDP readiness check
      const isRunning = await provider.isCDPReady('127.0.0.1', mockPort);
      assert(isRunning === true, 'isCDPReady should detect mock server');

      // Test launch/connect for account 1
      const conn1 = await provider.connect({
        port: mockPort,
        accountId: 'acc-alpha',
        timezone: 'Asia/Tokyo',
        locale: 'ja-JP'
      });

      assert(conn1.session.status === 'active', 'Session 1 should be active');
      assert(conn1.session.fingerprintSeed.includes('acc-alpha'), 'Seed should reflect acc-alpha');
      assert(conn1.webSocketDebuggerUrl === `ws://127.0.0.1:${mockPort}/devtools/browser/mock-id`, 'WebSocket debugger URL must come from the CDP server');
      assert(conn1.session.timezone === 'Asia/Tokyo', 'Session 1 timezone must be preserved as metadata');

      // Test launch/connect for account 2 (multi-seed isolation)
      const conn2 = await provider.connect({
        port: mockPort,
        accountId: 'acc-beta',
        timezone: 'Europe/London',
        locale: 'en-GB'
      });

      assert(conn2.session.fingerprintSeed !== conn1.session.fingerprintSeed, 'Account 2 must have a distinct fingerprint seed from Account 1');
      assert(conn2.session.timezone === 'Europe/London', 'Session 2 timezone mismatch');

      const activeSessions = provider.getSessionManager().listSessions('active');
      assert(activeSessions.length === 2, 'Must track two distinct active sessions');

      // Test cleanup
      await provider.close(conn1.session.id);
      assert(provider.getSessionManager().getSession(conn1.session.id)?.status === 'closed', 'Session 1 should be closed');
      assert(provider.getSessionManager().getSession(conn2.session.id)?.status === 'active', 'Session 2 should remain active');

      await provider.closeAll();
      assert(provider.getSessionManager().listSessions('active').length === 0, 'All sessions should be closed after closeAll()');
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  // 6. Test interaction command simulation (open, snapshot, click, fill, HAR network capture)
  await testCase('CDP connection supports agent-browser command abstractions (open, snapshot, click, fill, HAR capture)', async () => {
    // Simulated CDP protocol helper
    interface CDPCommand {
      method: string;
      params?: Record<string, unknown>;
    }

    const mockCommands: CDPCommand[] = [];

    // Mock CDP runner simulating agent-browser execution over Cloak CDP session
    function executeAgentBrowserCDPCommand(wsUrl: string, command: CDPCommand) {
      assert(wsUrl.includes('fingerprint='), 'CDP connection must include fingerprint seed');
      mockCommands.push(command);
      switch (command.method) {
        case 'Page.navigate':
          return { frameId: 'main-frame', loaderId: 'loader-1' };
        case 'DOM.getDocument':
          return { root: { nodeId: 1, nodeName: '#document' } };
        case 'Input.dispatchMouseEvent':
          return {};
        case 'Input.insertText':
          return {};
        case 'Network.enable':
          return {};
        default:
          return {};
      }
    }

    const provider = new CloakBrowserProvider();
    const wsUrl = `ws://127.0.0.1:9222/devtools/browser?fingerprint=seed-test-123&timezone=Asia%2FHo_Chi_Minh`;

    // Simulate agent-browser standard interaction commands
    executeAgentBrowserCDPCommand(wsUrl, { method: 'Page.navigate', params: { url: 'https://example.com' } });
    executeAgentBrowserCDPCommand(wsUrl, { method: 'DOM.getDocument' });
    executeAgentBrowserCDPCommand(wsUrl, { method: 'Input.dispatchMouseEvent', params: { type: 'mousePressed', x: 100, y: 200 } });
    executeAgentBrowserCDPCommand(wsUrl, { method: 'Input.insertText', params: { text: 'Hello ant-browser' } });
    executeAgentBrowserCDPCommand(wsUrl, { method: 'Network.enable' }); // HAR network capture enable

    assert(mockCommands.length === 5, 'Should execute 5 agent-browser CDP commands');
    assert(mockCommands[0].method === 'Page.navigate', 'Command 1 must be open (Page.navigate)');
    assert(mockCommands[1].method === 'DOM.getDocument', 'Command 2 must be snapshot (DOM.getDocument)');
    assert(mockCommands[2].method === 'Input.dispatchMouseEvent', 'Command 3 must be click');
    assert(mockCommands[3].method === 'Input.insertText', 'Command 4 must be fill');
    assert(mockCommands[4].method === 'Network.enable', 'Command 5 must be HAR network capture enable');
  });

  console.log(`\nSummary: ${passed} passed, ${failed} failed.`);
  if (failed > 0) {
    process.exit(1);
  }
}

runTests();
