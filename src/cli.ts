#!/usr/bin/env node
/**
 * agent-browser plugin stdio adapter for CloakBrowser.
 *
 * Implements the `agent-browser.plugin.v1` stdio JSON protocol.
 * agent-browser spawns this as a child process and communicates via
 * newline-delimited JSON on stdin/stdout.
 *
 * Protocol:
 *   Request (stdin):  {"type":"browser.launch","capability":"browser.provider","protocol":"agent-browser.plugin.v1","request":{...}}
 *   Response (stdout): {"protocol":"agent-browser.plugin.v1","success":true,"browser":{"cdpUrl":"ws://...","directPage":false,"metadata":{...},"cleanup":{...}}}
 *
 *   Request (stdin):  {"type":"browser.close","capability":"browser.provider","protocol":"agent-browser.plugin.v1","request":{...}}
 *   Response (stdout): {"protocol":"agent-browser.plugin.v1","success":true}
 */

import { CloakBrowserProvider, CloakProviderOptions } from './provider.js';
import { cleanupBrowserSession, rememberCleanup } from './cleanup-store.js';
import * as fs from 'node:fs';

const LOG_PATH = process.env.CLOAK_PLUGIN_LOG || '';
const PROTOCOL = 'agent-browser.plugin.v1';

function log(msg: string): void {
  if (!LOG_PATH) return;
  try {
    fs.appendFileSync(LOG_PATH, `[${new Date().toISOString()}] ${msg}\n`);
  } catch {
    // ignore log errors
  }
}

function send(obj: Record<string, unknown>): void {
  const line = JSON.stringify(obj);
  log(`<<< SEND: ${line}`);
  process.stdout.write(line + '\n');
}

function sendSuccess(browser?: Record<string, unknown>): void {
  const response: Record<string, unknown> = {
    protocol: PROTOCOL,
    success: true,
  };
  if (browser) {
    response.browser = browser;
  }
  send(response);
}

function sendError(error: string): void {
  send({
    protocol: PROTOCOL,
    success: false,
    error,
  });
}

const provider = new CloakBrowserProvider();

async function handleLaunch(request: Record<string, unknown>): Promise<void> {
  const launchOptions = (request.launchOptions ?? {}) as Record<string, unknown>;
  const session = (request.session ?? 'default') as string;

  const options: CloakProviderOptions = {
    accountId: session,
    host: (process.env.CLOAKBROWSER_HOST as string) || '127.0.0.1',
    port: parseInt(process.env.CLOAKBROWSER_PORT || '0', 10), // 0 = auto-find free port
    binaryMode: (process.env.CLOAKBROWSER_BINARY_MODE as CloakProviderOptions['binaryMode']) || undefined,
    executablePath: process.env.CLOAKBROWSER_PATH || process.env.CLOAKBROWSER_BINARY_PATH || undefined,
    autoStart: true,
    startTimeoutMs: parseInt(process.env.CLOAKBROWSER_START_TIMEOUT || '15000', 10),
    headless: launchOptions.headed !== true, // agent-browser sends headed:true to show browser
  };

  log(`>>> Launching CloakBrowser with options: ${JSON.stringify(options)}`);

  try {
    const cloakSession = await provider.launch(options);
    log(`>>> Session created: ${cloakSession.id}, cdpUrl: ${cloakSession.cdpUrl}, wsUrl: ${cloakSession.webSocketDebuggerUrl}`);

    if (cloakSession.pid) {
      rememberCleanup({ sessionId: cloakSession.id, accountId: cloakSession.accountId, pid: cloakSession.pid });
    }

    sendSuccess({
      cdpUrl: cloakSession.webSocketDebuggerUrl || cloakSession.cdpUrl,
      directPage: false,
      metadata: {
        sessionId: cloakSession.id,
        accountId: cloakSession.accountId,
        fingerprintSeed: cloakSession.fingerprintSeed,
        binaryMode: cloakSession.binaryMode,
        executablePath: cloakSession.executablePath,
      },
      cleanup: {
        sessionId: cloakSession.id,
        accountId: cloakSession.accountId,
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log(`>>> Launch error: ${message}`);
    sendError(message);
  }
}

async function handleClose(request: Record<string, unknown>): Promise<void> {
  const sessionId = (request as Record<string, string>).sessionId;
  const accountId = (request as Record<string, string>).accountId;

  log(`>>> Closing session: sessionId=${sessionId} accountId=${accountId}`);

  try {
    const terminated = cleanupBrowserSession(sessionId, accountId);
    log(`>>> Cleanup record ${terminated ? 'terminated browser process' : 'not found; browser already gone or externally managed'}`);
    sendSuccess();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log(`>>> Close error: ${message}`);
    sendError(message);
  }
}

async function handleMessage(msg: {
  type?: string;
  capability?: string;
  protocol?: string;
  request?: Record<string, unknown>;
}): Promise<void> {
  log(`>>> MSG type=${msg.type} capability=${msg.capability} protocol=${msg.protocol}`);

  if (msg.protocol && msg.protocol !== PROTOCOL) {
    sendError(`Unsupported protocol: ${msg.protocol}`);
    return;
  }

  const request = msg.request || {};

  switch (msg.type) {
    case 'browser.launch':
      await handleLaunch(request);
      break;

    case 'browser.close':
      await handleClose(request);
      break;

    case 'plugin.manifest':
      send({
        protocol: PROTOCOL,
        success: true,
        manifest: {
          name: 'cloak',
          capabilities: ['browser.provider'],
          version: '0.1.0',
          description: 'CloakBrowser provider plugin - launches a selected CloakBrowser binary and exposes it to agent-browser over CDP',
        },
      });
      break;

    default:
      log(`>>> Unknown message type: ${msg.type}`);
      sendError(`Unknown request type: ${msg.type}`);
      break;
  }
}

// --- stdio line reader ---

let buf = '';
const pendingMessages: Promise<void>[] = [];

function processLine(line: string): void {
  line = line.trim();
  if (!line) return;

  log(`>>> LINE: ${line}`);

  let msg: ReturnType<typeof JSON.parse>;
  try {
    msg = JSON.parse(line);
  } catch (e) {
    log(`>>> PARSE ERR: ${e instanceof Error ? e.message : String(e)}`);
    return;
  }

  const promise = handleMessage(msg).catch((err) => {
    log(`>>> HANDLER ERR: ${err instanceof Error ? err.message : String(err)}`);
    sendError(err instanceof Error ? err.message : String(err));
  });
  pendingMessages.push(promise);
}

function drainBuffer(): void {
  // Process complete lines
  let idx: number;
  while ((idx = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, idx);
    buf = buf.slice(idx + 1);
    processLine(line);
  }
}

process.stdin.setEncoding('utf-8');
process.stdin.on('data', (chunk: string) => {
  buf += chunk;
  log(`=== RAW (${chunk.length}) ===\n${chunk}`);
  drainBuffer();
});

process.stdin.on('end', () => {
  log('# stdin end');

  // Flush remaining buffer (agent-browser may not send trailing newline)
  if (buf.trim()) {
    log(`>>> Flushing remaining buffer (${buf.length} bytes)`);
    processLine(buf);
    buf = '';
  }

  // Keep process alive while handlers are running
  // agent-browser closes stdin immediately after sending the request,
  // but we need to stay alive to complete async work and send response to stdout
  const keepAlive = setInterval(() => {
    log('# keepalive tick');
  }, 1000);

  // Wait for all pending message handlers to complete before exiting
  Promise.all(pendingMessages)
    .catch(() => {})
    .finally(() => {
      clearInterval(keepAlive);
      log('# All handlers complete, exiting');
      // Give stdout a moment to flush
      setTimeout(() => process.exit(0), 50);
    });
});

process.stdin.resume();

// Graceful shutdown
process.on('SIGTERM', () => {
  log('# SIGTERM received');
  provider.closeAll().catch(() => {}).finally(() => process.exit(0));
});

process.on('SIGINT', () => {
  log('# SIGINT received');
  provider.closeAll().catch(() => {}).finally(() => process.exit(0));
});

log('# Cloak plugin started');
