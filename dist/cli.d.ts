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
export {};
//# sourceMappingURL=cli.d.ts.map