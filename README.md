# CrowdfundingPlatform — trust-minimised escrow for crowdfunding

CDS528 Blockchain DeFi Smart Contract Development — group project.

A single Solidity contract that replaces the two things investors cannot verify on a
traditional crowdfunding platform: **where the money is held** and **who decides what
happens to it**. Funds are escrowed by the contract, the campaign window is enforced by
`block.timestamp`, and the 98 % / 2 % split (or the 100 % refund) is executed by code that
nobody — including the platform — can change after deployment.

- **Network**: Ethereum Sepolia (testnet only, no real assets)
- **Solidity**: 0.8.24, optimizer on, 200 runs
- **Dependencies**: OpenZeppelin Contracts 5.x (`ReentrancyGuard`, `Pausable`, `Ownable`)

---

## 1. Repository layout

```
crowdfund-dapp/
├── contracts/
│   ├── CrowdfundingPlatform.sol     # the platform (single contract, multi-project)
│   └── mocks/ReentrancyAttacker.sol # malicious investor used by the reentrancy test
├── test/
│   └── CrowdfundingPlatform.test.js # 37 tests in 4 groups
├── scripts/
│   ├── deploy.js                    # deploy + Etherscan verification
│   ├── demo.js                      # drive the deployed contract without a wallet
│   └── local-demo.js                # full lifecycle incl. settlement, via time travel
├── docs/
│   ├── fig1-architecture.png/.jpg
│   ├── fig2-flow.png/.jpg
│   ├── make_figures.py
│   └── slither-output.txt
├── hardhat.config.js
├── slither.config.json
├── .env.example
└── package.json
```

## 2. Quick start

```bash
# 2.1 install
git clone <this-repository-url>
cd crowdfund-dapp
npm install

# 2.2 compile
npx hardhat compile

# 2.3 test (37 tests, about 1 s)
npx hardhat test

# 2.4 gas report
REPORT_GAS=true npx hardhat test
```

## 3. Deploy to Sepolia

```bash
# 3.1 configure
cp .env.example .env
#    then fill in SEPOLIA_RPC_URL, PRIVATE_KEY, ETHERSCAN_API_KEY,
#    and optionally PLATFORM_FEE_RECIPIENT

# 3.2 deploy (the script also runs Etherscan verification)
npm run deploy:sepolia

# 3.3 verify manually if the automatic step is skipped
npx hardhat verify --network sepolia <CONTRACT_ADDRESS> <FEE_RECIPIENT>
```

### Deployed instance

| Item | Value |
| --- | --- |
| Network | Sepolia (chain id 11155111) |
| Contract address | `0x__________________________________________` |
| Etherscan (verified) | https://sepolia.etherscan.io/address/0x__________________________________________#code |
| Deployment tx | `0x__________________________________________` |

> Replace the three placeholders above after running `npm run deploy:sepolia`.

### 3.4 Exercising the contract (no browser wallet required)

Deployment only needs a private key, and every function can be called from a
script, so MetaMask is optional for testing the deployed instance:

```bash
# create a campaign and invest into it on Sepolia (0.1 ETH target by default)
node scripts/demo.js <CONTRACT_ADDRESS> 0.1
```

The script prints the Etherscan link of every transaction it sends, plus the
project state read back from the contract.

The settlement and refund branches cannot be shown on a public testnet because
`CAMPAIGN_DURATION` is a 30-day constant. They are demonstrated on an
in-process chain instead, with `evm_increaseTime` to jump over the window:

```bash
npx hardhat run scripts/local-demo.js
```

Expected tail of that output:

```
creator got   : 1.078 ETH  (98 %, event)
platformPool  : 0.022 ETH
platform got  : 0.0219... ETH  (net of gas)
investor back : 0.5 ETH  (100 % of principal)
```

All numbers are read from contract storage after each call; nothing is
hard-coded.


## 4. How the contract works

| Rule | Constant | Meaning |
| --- | --- | --- |
| Campaign window | `CAMPAIGN_DURATION = 30 days` | starts at `createProject`, not at deployment |
| Minimum ticket | `MIN_INVESTMENT = 0.01 ether` | smaller transfers revert with `BelowMinimum` |
| Platform fee | `PLATFORM_FEE_RATE = 2`, `PERCENT_BASE = 100` | `F = M × 2 / 100`, charged only on success |
| Payout | `W = M − F` | 98 % to the creator, 2 % to `platformPool` |
| Refund | `Rᵢ = Iᵢ` | 100 % of principal when `M < T` |

Lifecycle: `createProject` → `invest` (× n) → deadline → `settle` (anyone, idempotent) →
`withdrawFunds` **or** `refund` → `withdrawPlatformFee`.

Two design decisions are worth calling out:

1. **Pull payments.** `settle` never moves money; it only freezes the outcome. Creators and
   investors pull their funds themselves, which removes the unbounded loop, the gas-bomb and
   the reentrancy surface that a push design would create. `settle` is also called lazily from
   `withdrawFunds` and `refund`, so the platform is never able to stall a campaign by refusing
   to settle.
2. **No upgradeability, no `receive`.** The contract is immutable and rejects plain ETH
   transfers, so the balance can only ever change through `invest`, and the accounting can
   never drift from the funds actually held.

## 5. Security

| Threat | Mitigation |
| --- | --- |
| Reentrancy on refund / withdraw | `ReentrancyGuard` + checks-effects-interactions (`refunded` / `withdrawn` set before the call) |
| Unauthorised access | `onlyOwner` (pause only), `platform` check, `creator` check; no admin can move user funds |
| Timestamp manipulation | ±15 s miner drift cannot flip a 30-day deadline; no randomness, no price dependency |
| Double spending a refund | `Investment.refunded` flag, tested |
| Fund mis-accounting | no `receive`, single entry point for ETH, conservation asserted in tests |
| Stuck funds | `withdrawFunds` / `refund` are never pausable |

Static analysis:

```bash
python3 -m pip install slither-analyzer
npm run slither
```

## 6. Gas snapshot

Measured with `hardhat-gas-reporter` (optimizer on, 200 runs):

| Operation | Avg gas |
| --- | --- |
| Deployment | 1,102,563 |
| `createProject` | 162,755 |
| `invest` | 73,818 |
| `settle` | 59,026 |
| `withdrawFunds` | 92,140 |
| `refund` | 83,608 |
| `withdrawPlatformFee` | 32,473 |

Gas-awareness choices: one contract with `mapping(uint256 => Project)` instead of one contract
per campaign, `constant` for every rule parameter, struct fields packed into single 32-byte
slots, custom errors instead of revert strings, and no loop anywhere in the code base.

## 7. Licence

MIT for the project code. OpenZeppelin Contracts is used under the MIT licence
(https://github.com/OpenZeppelin/openzeppelin-contracts, MIT).

## 8. AI assistance disclosure

Parts of the contract comments, the test suite and this README were drafted with the help of an
AI assistant and then reviewed, compiled and executed by the group. Every line of code in this
repository has been run at least once by `npx hardhat test`; the gas numbers above are copied
from an actual run rather than estimated.
