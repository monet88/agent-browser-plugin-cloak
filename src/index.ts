import { CloakBrowserProvider, CloakProviderOptions } from './provider.js';

export * from './sessions.js';
export * from './provider.js';

export const name = 'cloak';
export const capability = 'browser.provider';

export function createProvider(options?: CloakProviderOptions): CloakBrowserProvider {
  // Keep the factory signature for agent-browser/plugin consumers. Provider
  // options are supplied per launch/connect call rather than stored globally.
  void options;
  return new CloakBrowserProvider();
}

export default {
  name,
  capability,
  createProvider,
  CloakBrowserProvider
};
