/**
 * Type declarations for x402 v2 packages
 * These packages use ESM exports, but we need CommonJS compatibility
 */

declare module '@x402/express' {
    import { RequestHandler } from 'express';

    export class x402ResourceServer {
        constructor(facilitatorClient: any);
        registerExtension(extension: any): this;
    }

    export function paymentMiddleware(
        routes: Record<string, RouteConfig>,
        server: x402ResourceServer,
        paywallConfig?: PaywallConfig,
        paywall?: any,
        syncFacilitatorOnStart?: boolean
    ): RequestHandler;

    export interface RouteConfig {
        accepts: PaymentOption | PaymentOption[];
        resource?: string;
        description?: string;
        mimeType?: string;
        customPaywallHtml?: string;
        extensions?: Record<string, unknown>;
    }

    export interface PaymentOption {
        scheme: string;
        payTo: string;
        price: string;
        network: string;
        maxTimeoutSeconds?: number;
    }

    export interface PaywallConfig {
        appName?: string;
        appLogo?: string;
        sessionTokenEndpoint?: string;
    }
}

declare module '@x402/core/server' {
    export interface FacilitatorConfig {
        url?: string;
        createAuthHeaders?: () => Promise<{
            verify: Record<string, string>;
            settle: Record<string, string>;
            supported: Record<string, string>;
        }>;
    }

    export class HTTPFacilitatorClient {
        constructor(config?: FacilitatorConfig);
    }

    export class x402ResourceServer {
        constructor(facilitatorClient?: any);
        register(network: string, server: any): this;
        registerExtension(extension: any): this;
    }
}

declare module '@x402/evm/exact/server' {
    export function registerExactEvmScheme(server: any, network?: string): void;
}

declare module '@x402/extensions/bazaar' {
    export const bazaarResourceServerExtension: any;

    export interface DiscoveryExtensionConfig {
        input?: Record<string, unknown>;
        inputSchema?: {
            properties?: Record<string, {
                type: string;
                description?: string;
                maxLength?: number;
            }>;
            required?: string[];
        };
        bodyType?: 'json' | 'form-data' | 'text';
        output?: {
            example?: unknown;
            schema?: {
                properties?: Record<string, {
                    type: string;
                    description?: string;
                }>;
                required?: string[];
            };
        };
    }

    export function declareDiscoveryExtension(config: DiscoveryExtensionConfig): {
        bazaar: unknown;
    };
}
