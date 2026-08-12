#!/usr/bin/env node
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

interface AgentBrowserConfig {
  plugins?: Array<Record<string, unknown>>;
  [key: string]: unknown;
}

const local = process.argv.includes('--local');
const configPath = local
  ? path.resolve(process.cwd(), 'agent-browser.json')
  : path.join(os.homedir(), '.agent-browser', 'config.json');
const cliPath = fileURLToPath(new URL('./cli.js', import.meta.url));

let config: AgentBrowserConfig = {};
if (fs.existsSync(configPath)) {
  const raw = fs.readFileSync(configPath, 'utf8').trim();
  if (raw) {
    try {
      config = JSON.parse(raw) as AgentBrowserConfig;
    } catch (err) {
      throw new Error(`Refusing to overwrite invalid JSON at ${configPath}: ${String(err)}`);
    }
  }
}

const entry = {
  name: 'cloak',
  command: process.execPath,
  args: [cliPath],
  capabilities: ['browser.provider'],
  source: 'github:monet88/agent-browser-plugin-cloak',
};

const plugins = Array.isArray(config.plugins) ? config.plugins : [];
config.plugins = [
  ...plugins.filter((plugin) => plugin?.name !== 'cloak'),
  entry,
];

fs.mkdirSync(path.dirname(configPath), { recursive: true });
if (fs.existsSync(configPath)) {
  fs.copyFileSync(configPath, `${configPath}.bak`);
}
const tempPath = `${configPath}.${process.pid}.tmp`;
fs.writeFileSync(tempPath, `${JSON.stringify(config, null, 2)}\n`, 'utf8');
fs.renameSync(tempPath, configPath);

console.log(`Configured CloakBrowser provider in ${configPath}`);
console.log(`Command: ${process.execPath}`);
console.log(`CLI: ${cliPath}`);
console.log('Use: agent-browser --provider cloak open https://example.com');
