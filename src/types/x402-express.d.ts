/**
 * Type declarations for x402-express package
 * Updated for x402 v2 with Bazaar discovery support
 */

declare module 'x402-express' {
    import { RequestHandler } from 'express';

    // EIP-155 chain ID format for Bazaar compatibility
    export type Network = string;

    // Bazaar input schema field definition - using flexible types for JSON compatibility
    export interface SchemaField {
        type: string;
        description?: string;
        required?: boolean;
        items?: SchemaField | Record<string, unknown>;
        properties?: Record<string, SchemaField | Record<string, unknown>>;
        [key: string]: unknown;
    }

    // Bazaar discovery extension for x402 v2
    export interface BazaarExtension {
        discoverable: boolean;
        inputSchema?: Record<string, unknown>;
        outputSchema?: Record<string, unknown>;
    }

    // Route extensions including Bazaar
    export interface RouteExtensions {
        bazaar?: BazaarExtension;
        [key: string]: unknown;
    }

    // Route configuration with Bazaar support
    export interface RouteConfig {
        price: string;
        network: Network;
        resource?: string | undefined;
        description?: string;
        extensions?: RouteExtensions;
        // Legacy config (deprecated, use top-level fields)
        config?: {
            description?: string;
            mimeType?: string;
            maxTimeoutSeconds?: number;
            outputSchema?: Record<string, unknown>;
            customPaywallHtml?: string;
            resource?: string;
        };
        [key: string]: unknown;
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
