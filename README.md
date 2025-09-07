# BandShare: Decentralized P2P Bandwidth Sharing Marketplace

## Overview

BandShare is a Web3 project built on the Stacks blockchain using Clarity smart contracts. It creates a peer-to-peer marketplace for sharing internet bandwidth, allowing users with excess capacity (providers) to monetize it by selling to those in need (consumers). This addresses real-world problems like unequal internet access, high costs in underserved areas, and underutilized bandwidth in urban or high-speed zones. By leveraging blockchain, BandShare ensures trustless transactions, transparent pricing, and decentralized dispute resolution.

Key features:
- Providers list bandwidth offers (e.g., WiFi hotspots, mobile data tethering) with details like speed, duration, and location.
- Consumers purchase access via cryptocurrency (STX or a utility token).
- Complaints are handled through virtual reallocations (automatic reassignment to another provider) or in-person hardware swaps (facilitated via NFTs representing physical devices like routers for mesh networks).
- All interactions are governed by 6 smart contracts for security, scalability, and decentralization.

This project solves:
- **Digital Divide**: Enables affordable bandwidth in remote or low-income areas by pooling resources.
- **Inefficient Resource Use**: Turns idle bandwidth into revenue, reducing waste.
- **Trust Issues in Sharing Economies**: Blockchain eliminates intermediaries, with smart contracts enforcing agreements.
- **Dispute Handling**: Quick resolutions without central authorities, using on-chain voting or oracles.

BandShare is inspired by platforms like Helium (for IoT) but focuses on bandwidth, integrating virtual and physical elements for robust service delivery.

## How It Works

1. **Registration**: Users register as providers or consumers.
2. **Listing and Matching**: Providers create offers; consumers browse and purchase.
3. **Fulfillment**: Access is granted via API keys or VPN configs (off-chain), with on-chain verification.
4. **Payments**: Escrow holds funds until service confirmation.
5. **Disputes**: If issues arise (e.g., low speed), users file complaints leading to virtual reallocation or hardware swap proposals.
6. **Incentives**: Utility tokens reward reliable providers and penalize fraud.

Off-chain components (not in contracts) include a dApp frontend for user interaction and oracles for bandwidth verification (e.g., speed tests).

## Tech Stack

- **Blockchain**: Stacks (Bitcoin-secured).
- **Smart Contract Language**: Clarity (secure, predictable, no reentrancy issues).
- **Tokens**: STX for native payments; optional SIP-010 fungible token for utilities.
- **Frontend**: React.js or Svelte dApp (not included in this repo).
- **Testing**: Clarinet for local development and testing.

## Smart Contracts

BandShare consists of 6 core smart contracts, each handling a specific aspect of the marketplace. All are written in Clarity for safety and auditability.

1. **UserRegistry.clar**  
   Handles user onboarding and roles.  
   - Registers users with public keys and metadata (e.g., location via geohash).  
   - Defines roles: Provider, Consumer, Arbitrator.  
   - Functions: `register-user`, `update-profile`, `get-user-role`.  
   - Storage: Maps user principals to profiles.

2. **BandwidthListing.clar**  
   Manages creation and browsing of bandwidth offers.  
   - Providers list offers with params: speed (Mbps), duration (hours), price (STX/micro-STX), location.  
   - Consumers query listings by filters (e.g., proximity, price).  
   - Functions: `create-listing`, `update-listing`, `search-listings`.  
   - Storage: Maps listing IDs to offer details; uses lists for active offers.

3. **MarketplaceEscrow.clar**  
   Facilitates transactions and escrow.  
   - Consumers initiate purchases; funds are locked in escrow.  
   - Providers confirm delivery (e.g., share access credentials off-chain).  
   - Releases funds on successful verification or timeouts.  
   - Functions: `initiate-purchase`, `confirm-delivery`, `release-escrow`.  
   - Storage: Escrow maps with timeouts and states (pending, active, completed).

4. **DisputeResolution.clar**  
   Manages complaints and resolutions.  
   - Users file disputes with evidence (e.g., speed test hashes).  
   - Integrates oracles for verification.  
   - Triggers virtual reallocations or escalates to hardware swaps.  
   - Functions: `file-dispute`, `vote-on-dispute` (for community arbitrators), `resolve-dispute`.  
   - Storage: Dispute maps with statuses, votes, and outcomes.

5. **VirtualAllocation.clar**  
   Handles automatic reallocations for disputes.  
   - On valid complaints, reassigns consumer to a matching alternative provider.  
   - Refunds partial funds or credits tokens.  
   - Ensures seamless service continuity without full refunds.  
   - Functions: `reallocate-bandwidth`, `find-alternative-provider`, `apply-credit`.  
   - Storage: Allocation queues and matching algorithms (simple priority-based).

6. **HardwareSwap.clar**  
   Facilitates in-person hardware exchanges via NFTs.  
   - For severe disputes (e.g., hardware failure), proposes swaps of physical devices (routers, antennas) represented as NFTs.  
   - Uses SIP-009 NFTs for ownership transfer.  
   - Coordinates meetups via on-chain commitments (locations hashed for privacy).  
   - Functions: `propose-swap`, `accept-swap`, `mint-hardware-nft`, `transfer-nft`.  
   - Storage: Swap proposals and NFT metadata maps.

## Installation and Deployment

### Prerequisites
- Install Clarinet: `cargo install clarinet`.
- Stacks wallet for testnet/mainnet deployment.

### Setup
1. Clone the repo: `git clone https://github.com/yourusername/bandshare.git`.
2. Navigate to the project: `cd bandshare`.
3. Initialize Clarinet: `clarinet new .` (if not already set up).
4. Add contracts to `./contracts/` directory.
5. Test locally: `clarinet test`.
6. Deploy to testnet: `clarinet deploy --testnet`.

### Directory Structure
```
bandshare/
├── Clarinet.toml       # Project config
├── contracts/          # Clarity contracts
│   ├── UserRegistry.clar
│   ├── BandwidthListing.clar
│   ├── MarketplaceEscrow.clar
│   ├── DisputeResolution.clar
│   ├── VirtualAllocation.clar
│   ├── HardwareSwap.clar
├── tests/              # Unit tests for each contract
└── README.md           # This file
```

## Usage

- **Deploy Contracts**: Use Clarinet to deploy in order (UserRegistry first, as others depend on it).
- **Interact via dApp**: Build a frontend to call contract functions (e.g., via @stacks/transactions).
- **Example Flow**:
  - Register: Call `UserRegistry::register-user`.
  - List: `BandwidthListing::create-listing`.
  - Buy: `MarketplaceEscrow::initiate-purchase`.
  - Dispute: `DisputeResolution::file-dispute` → `VirtualAllocation::reallocate-bandwidth` or `HardwareSwap::propose-swap`.

## Security and Audits

Clarity's design prevents common vulnerabilities like reentrancy. However, recommend third-party audits before mainnet. Use read-only functions for queries to optimize gas.

## Contributing

Fork the repo, create a branch, and submit PRs. Focus on improving contract efficiency or adding features like oracle integrations.

## License

MIT License. See LICENSE file for details.