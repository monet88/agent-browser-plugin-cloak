import { CloakBrowserProvider, CloakProviderOptions } from './provider.js';
export * from './sessions.js';
export * from './provider.js';
export declare const name = "cloak";
export declare const capability = "browser.provider";
export declare function createProvider(options?: CloakProviderOptions): CloakBrowserProvider;
declare const _default: {
    name: string;
    capability: string;
    createProvider: typeof createProvider;
    CloakBrowserProvider: typeof CloakBrowserProvider;
};
export default _default;
//# sourceMappingURL=index.d.ts.map