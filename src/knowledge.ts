/**
 * Silverback DEX Knowledge Base
 * Source: https://docs.silverbackdefi.app/
 *
 * This file contains factual information about Silverback DEX
 * that the agent should use when answering questions.
 */

export const SILVERBACK_KNOWLEDGE = `
=== SILVERBACK DEX KNOWLEDGE BASE ===
Documentation: https://docs.silverbackdefi.app/

== NETWORK STATUS ==
- Base Network: LIVE ✅ (Primary network)
- Keeta Network: Future expansion (not currently active)

== BASE NETWORK (Primary) ==

Network Details:
- Chain: Base (Ethereum L2 by Coinbase)
- Chain ID: 8453
- Settlement: ~2 seconds
- Gas Token: ETH
- Block Explorer: https://basescan.org

Silverback Contracts on Base:
- Router: 0x565cBf0F3eAdD873212Db91896e9a548f6D64894
- V2 Factory: 0x9cd714C51586B52DD56EbD19E3676de65eBf44Ae
- $BACK Token: 0x558881c4959e9cf961a7E1815FCD6586906babd2

Common Base Tokens:
- WETH: 0x4200000000000000000000000000000000000006
- USDC: 0x833589fcd6edb6e08f4c7c32d4f71b54bda02913
- USDbC: 0xd9aAEc86B65D86f6A7B5B1b0c42FFA531710b6CA
- DAI: 0x50c5725949A6F0c72E6C4a641F24049A917DB0Cb

Features:
- Classic 50/50 liquidity pools (Uniswap V2 style)
- OpenOcean aggregation for best rates across 30+ DEXs
- 0.3% swap fee on Silverback pools
- Any Web3 wallet supported (MetaMask, Coinbase Wallet, Rainbow, etc.)

== $BACK TOKEN ==

Token Details:
- Name: Silverback
- Ticker: $BACK
- Network: Base
- Contract: 0x558881c4959e9cf961a7E1815FCD6586906babd2
- Launch: Virtuals Protocol

=== CURRENT PRIORITY: VIRTUALS TOKEN SALE ===

$BACK token is available on Virtuals Protocol!
- Buy $BACK: https://app.virtuals.io/prototypes/0x558881c4959e9cf961a7E1815FCD6586906babd2
- Platform: Virtuals Protocol (app.virtuals.io)
- This is THE primary way to get $BACK tokens right now

IMPORTANT: The Silverback DEX pools are NOT YET LIVE.
- Do NOT post DEX statistics (no pools exist yet)
- Focus promotional content on the Virtuals token sale
- DEX launch will be announced when pools go live

What to promote:
- $BACK token sale on Virtuals (app.virtuals.io/prototypes/0x558881c4959e9cf961a7E1815FCD6586906babd2)
- The AI agent's trading capabilities and intelligence
- The non-inflationary tokenomics model
- Community engagement and alpha sharing

What NOT to do:
- Post DEX stats (pools don't exist yet)
- Make up numbers about volume, TVL, or swaps
- Say the DEX is "active" or "growing" (it's not yet)

Non-Inflationary Rewards Model:
1. Protocol generates revenue from trading fees
2. Revenue funds buybacks of $BACK from market
3. Purchased tokens go to staking reward pool
4. Stakers earn from actual revenue (not new minted tokens)
Key: No new supply = no dilution. Sustainable yield backed by real earnings.

Revenue Sources:
- DEX swap fees (portion of 0.3% per transaction)
- AI agent treasury trading profits
- x402 API service payments
- ACP (Agent Commerce Protocol) service fees

Token Utility:
- Staking: Earn share of protocol revenue
- Governance: Vote on protocol decisions
- Fee Discounts: Reduced trading fees for holders (future)
- Access: Priority features for stakers (future)

Economic Flywheel:
Revenue → Buybacks → Staking Rewards → Less Selling Pressure → Price Support → More Volume → More Revenue

== SILVERBACK AI AGENT ==

Silverback is an autonomous AI trading agent on Virtuals Protocol that:
- Executes systematic trading strategies on Base
- Manages treasury for protocol revenue
- Shares profits with $BACK stakers through buybacks
- Educates community on DeFi concepts
- Protects community from scams and risks
- Provides paid DeFi intelligence services via x402 and ACP

Revenue-Generating Services:
1. Swap Quotes ($0.02) - Best price routing via OpenOcean
2. Pool Analysis ($0.10) - Liquidity pool deep dives
3. Technical Analysis ($0.25) - Full TA with indicators
4. Execute Swap ($0.50) - Trade execution on Base
5. DEX Metrics ($0.05) - Network statistics
6. Backtesting ($1.00) - Strategy backtesting

All service revenue flows back to $BACK holders via buybacks.

== KEY LINKS ==
- DEX (Base): https://silverbackdefi.app
- Documentation: https://docs.silverbackdefi.app
- Twitter: @SilverbackAgent
- Block Explorer: https://basescan.org

== IMPORTANT FACTS ==
- Silverback DEX is LIVE on Base network
- Uses OpenOcean aggregator for best swap rates
- $BACK token uses non-inflationary tokenomics
- All protocol revenue goes to $BACK stakers via buybacks
- The AI agent is autonomous and trades with its own treasury
- Services available via x402 (HTTP payments) and ACP (agent-to-agent)
`;

export default SILVERBACK_KNOWLEDGE;
