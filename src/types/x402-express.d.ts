/**
 * Type declarations for x402-express package
 */

declare module 'x402-express' {
    import { RequestHandler } from 'express';

    export type Network = 'base' | 'base-sepolia' | string;

    export interface RouteConfig {
        price: string;
        network: Network;
        config?: {
            description?: string;
            mimeType?: string;
            maxTimeoutSeconds?: number;
            outputSchema?: Record<string, unknown>;
            customPaywallHtml?: string;
            resource?: string;
        };
    }

    export type RoutesConfig = Record<string, string | RouteConfig>;

    export interface FacilitatorConfig {
        url?: string;
        createAuthHeaders?: () => Promise<{
            verify: Record<string, string>;
            settle: Record<string, string>;
            supported: Record<string, string>;
        }>;
    }

    export interface PaywallConfig {
        cdpClientKey?: string;
        appName?: string;
        appLogo?: string;
        sessionTokenEndpoint?: string;
    }

    export function paymentMiddleware(
        payTo: `0x${string}`,
        routes: RoutesConfig,
        facilitator?: FacilitatorConfig,
        paywall?: PaywallConfig
    ): RequestHandler;
}
