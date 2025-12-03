# Silverback - Autonomous DeFi Trading Agent

**Silverback** is an autonomous DeFi trading agent on Keeta Network, powered by Virtuals GAME.

## Mission

Become the leading DeFi trading agent by demonstrating expertise through systematic trading execution, growing liquidity on Silverback DEX, and sharing revenue transparently with $BACK holders.

## Overview

Silverback is not just a data provider - it's an autonomous agent with a comprehensive mission:

**Primary Objectives:**

1. **Trading Excellence** - Execute systematic strategies with transparent performance tracking
2. **Liquidity Growth** - Drive trading activity that deepens Silverback DEX markets
3. **Community Value** - Share trading profits with $BACK stakers through buybacks
4. **Education & Protection** - Educate users and protect them from DeFi risks
5. **Ecosystem Participation** - Collaborate with other agents through the ACP

**Capabilities:**

**DEX Operations:**
- 🔄 Real-time swap quotes from anchor pools
- 💧 Liquidity pool analysis (reserves, APY, fees, volume)
- 📊 DEX-wide metrics (TVL, 24h volume, active pools)
- 💰 Token price monitoring and market conditions
- 🎯 Trade execution through optimal routing

**Social Media:**
- 🐦 Trading insights, performance updates, and market analysis
- 💬 Community engagement and question answering
- 📈 Daily DEX statistics and ecosystem updates
- 🎓 DeFi education and risk management guidance
- 📣 Pool announcements, partnerships, and buyback events

## Architecture

### Virtuals GAME Integration

This agent uses the Virtuals Protocol GAME (Generative Autonomous Multimodal Entities) framework:

- **GAME API**: Handles AI decision-making and natural language understanding
- **Custom Functions**: Connect to Silverback DEX API endpoints
- **Workers**: Process DEX data and format responses

### Silverback DEX Integration

The agent connects to Silverback DEX running on Keeta Network:

- **Network**: Keeta (400ms block times)
- **DEX Type**: Anchor pools (user-created liquidity)
- **Protocol Fee**: 0.05% on swaps
- **API**: `https://dexkeeta.onrender.com/api`

## Setup

### Prerequisites

- Node.js 20.x
- npm or pnpm
- Virtuals GAME API key ([get one here](https://docs.game.virtuals.io/))

### Installation

\`\`\`bash
# Install dependencies
npm install

# Copy environment file
cp .env.example .env

# Add your GAME API key to .env
\`\`\`

### Environment Variables

\`\`\`env
# Required: Your Virtuals GAME API key
API_KEY=your_game_api_key

# Optional: Silverback DEX API URL (defaults to production)
DEX_API_URL=https://dexkeeta.onrender.com/api

# Required for Twitter: Twitter access token from GAME
GAME_TWITTER_TOKEN=apx-xxxxx
\`\`\`

### Twitter Setup

To enable Twitter integration, authenticate your agent:

\`\`\`bash
# Run the authentication command
npx @virtuals-protocol/game-twitter-node auth -k <YOUR_GAME_API_KEY>

# Visit the URL provided and authorize the app
# Copy the access token (format: apx-xxxxx) to your .env file
\`\`\`

**Note:** Virtuals provides Enterprise Twitter API access for free to all GAME agents!

## Development

\`\`\`bash
# Run in development mode
npm run dev

# Build for production
npm run build

# Run production build
npm start
\`\`\`

## Agent Capabilities

### DEX Functions

**1. Swap Quotes** - Get quotes for token swaps with amounts, fees, and price impact

**2. Pool Information** - Query liquidity pools for reserves, APY, and fee structures

**3. DEX Metrics** - Overall statistics: TVL, 24h volume, active pools

**4. Token Prices** - USD prices with 24h change and volume data

### Social Media Functions

**1. Post Tweets** - Share DEX updates, market insights, and DeFi education

**2. Reply to Tweets** - Answer community questions and engage with users

**3. Daily Stats** - Automated daily statistics posts about DEX performance

**4. Search Mentions** - Find and monitor community discussions

## Deployment

### Render.com

1. Connect your Git repository
2. Set environment variable: `API_KEY`
3. Deploy as Web Service
4. Use start command: `npm start`

### Docker

\`\`\`bash
docker build -t silverback-agent .
docker run -d -e API_KEY=your_key silverback-agent
\`\`\`

## Project Structure

\`\`\`
silverback-agent/
├── src/
│   ├── agent.ts                    # Main agent configuration
│   ├── index.ts                    # Entry point with rate limiting
│   ├── knowledge.ts                # Silverback knowledge base
│   ├── functions.ts                # DEX API functions
│   ├── trading-functions.ts        # Trading execution functions
│   ├── twitter-functions.ts        # Twitter API functions
│   ├── twitter.ts                  # Twitter client setup
│   ├── education-functions.ts      # DeFi education functions
│   ├── market-data-functions.ts    # Live market data functions
│   ├── types/
│   │   └── agent-state.ts          # State type definitions
│   ├── state/
│   │   └── state-manager.ts        # SQLite state management
│   ├── market-data/
│   │   ├── types.ts                # Market data types
│   │   ├── indicators.ts           # Technical indicators
│   │   ├── patterns.ts             # Pattern recognition
│   │   ├── fetcher.ts              # CoinGecko API integration
│   │   └── backtest.ts             # Backtesting engine
│   └── workers/
│       ├── twitter-worker.ts       # Twitter engagement (ACTIVE)
│       ├── trading-worker.ts       # Live trading (disabled)
│       ├── paper-trading-worker.ts # Paper trading simulation
│       ├── learning-worker.ts      # Performance analysis
│       ├── market-analysis-worker.ts # Technical analysis
│       ├── education-worker.ts     # Educational content
│       └── analytics-worker.ts     # Reporting & metrics
├── .env.example                    # Environment template
├── package.json                    # Dependencies
├── README.md                       # This file
└── CURRENT_STATUS.md               # Detailed system status
\`\`\`

## License

ISC

---

**Powered by Virtuals GAME** 🦍
