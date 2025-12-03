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
- Base Network: LIVE ✅
- Keeta Network: Coming Soon (launching soon)

== SUPPORTED NETWORKS ==

BASE NETWORK (Ethereum L2 by Coinbase):
- Settlement: ~2 seconds
- Gas Token: ETH
- Wallet: Any Web3 wallet (MetaMask, Coinbase Wallet, etc.)
- Features:
  * Classic 50/50 liquidity pools
  * Concentrated pools with custom price ranges
  * OpenOcean aggregation for best rates across DEXs
  * Deep liquidity on popular trading pairs
  * 0.3% swap fee

KEETA NETWORK (High-speed DAG-based blockchain):
- Settlement: ~400ms (ultra-fast)
- Gas Token: KTA
- Wallet: Keythings browser extension required
- Features:
  * AMM pools
  * FX Anchor Trading (access official network anchors)
  * Custom liquidity pools with custom fees (0.01% - 10%)
  * Lower transaction costs

== $BACK TOKEN ==

Token Details:
- Name: Silverback
- Ticker: $BACK
- Network: Base
- Launch: Virtuals Protocol (Unicorn Tokenomics model)

Non-Inflationary Rewards Model:
1. Protocol generates revenue from trading fees
2. Revenue funds buybacks of $BACK from market
3. Purchased tokens go to staking reward pool
4. Stakers earn from actual revenue (not new minted tokens)
Key: No new supply = no dilution. Sustainable yield backed by real earnings.

Revenue Sources:
- DEX swap fees (portion of 0.3% per transaction)
- Anchor Pool operations (Keeta)
- AI agent treasury trading profits
- Cross-chain arbitrage returns

Token Utility:
- Staking: Earn share of protocol revenue
- Governance: Vote on protocol decisions
- Fee Discounts: Reduced trading fees for holders (future)
- Access: Priority features for stakers (future)

Economic Flywheel:
Revenue → Buybacks → Staking Rewards → Less Selling Pressure → Price Support → More Volume → More Revenue

== SILVERBACK AI AGENT ==

Silverback is an autonomous AI trading agent that:
- Executes systematic trading strategies
- Manages treasury for protocol revenue
- Shares profits with $BACK stakers through buybacks
- Educates community on DeFi concepts
- Protects community from scams and risks

All trading revenue flows back to $BACK holders, creating alignment between agent performance and community benefit.

== KEY LINKS ==
- DEX (Base): https://silverbackdefi.app
- DEX (Keeta): https://dexkeeta.onrender.com (coming soon)
- Documentation: https://docs.silverbackdefi.app
- Twitter: @SilverbackAgent

== IMPORTANT FACTS ==
- Silverback DEX is LIVE on Base network
- Keeta network support is launching soon
- $BACK token uses non-inflationary tokenomics
- All protocol revenue goes to $BACK stakers via buybacks
- The AI agent is autonomous and trades with its own treasury
`;

export default SILVERBACK_KNOWLEDGE;
