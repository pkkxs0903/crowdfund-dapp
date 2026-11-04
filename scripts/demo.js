/**
 * demo.js — drive the deployed contract on Sepolia WITHOUT any browser wallet.
 *
 * Usage:
 *   node scripts/demo.js <contractAddress> [targetEth]
 *
 * What it does:
 *   1. creates a campaign whose target is `targetEth` (default 0.1 ETH)
 *   2. generates a throw-away investor wallet, funds it from the deployer,
 *      and invests 0.05 ETH through it
 *   3. prints the project state and the Etherscan link for every transaction
 *
 * Note: settlement cannot be shown on Sepolia because CAMPAIGN_DURATION is a
 * 30-day constant. Use scripts/local-demo.js for the settlement / refund path.
 */
const hre = require("hardhat");

function link(hash) {
  const base =
    hre.network.name === "sepolia"
      ? "https://sepolia.etherscan.io/tx/"
      : "";
  return base + hash;
}

async function main() {
  const address = process.argv[2] || process.env.CONTRACT_ADDRESS;
  if (!address || !hre.ethers.isAddress(address)) {
    throw new Error("usage: node scripts/demo.js <contractAddress> [targetEth]");
  }
  const targetEth = process.argv[3] || "0.1";

  const [deployer] = await hre.ethers.getSigners();
  const app = await hre.ethers.getContractAt("CrowdfundingPlatform", address);

  console.log("network        :", hre.network.name);
  console.log("contract       :", address);
  console.log("creator        :", deployer.address);
  console.log("balance        :", hre.ethers.formatEther(
    await hre.ethers.provider.getBalance(deployer.address)
  ), "ETH");

  // ---- 1. create a campaign -------------------------------------------------
  const target = hre.ethers.parseEther(targetEth);
  const tx1 = await app.createProject(target);
  const rc1 = await tx1.wait();

  let id = null;
  for (const log of rc1.logs) {
    try {
      const parsed = app.interface.parseLog(log);
      if (parsed && parsed.name === "ProjectCreated") id = parsed.args.id;
    } catch (_) { /* not ours */ }
  }
  if (id === null) throw new Error("ProjectCreated event not found");

  console.log("\n[1] createProject");
  console.log("    id   :", id.toString());
  console.log("    tx   :", link(tx1.hash));
  console.log("    gas  :", rc1.gasUsed.toString());

  // ---- 2. invest from a second wallet --------------------------------------
  const investor = hre.ethers.Wallet.createRandom().connect(hre.ethers.provider);
  console.log("\n[2] investor wallet generated");
  console.log("    address:", investor.address);
  console.log("    privkey:", investor.privateKey, "  (testnet only, discard after demo)");

  const amount = hre.ethers.parseEther("0.05");
  const need = amount + hre.ethers.parseEther("0.005"); // gas headroom
  const bal = await hre.ethers.provider.getBalance(investor.address);
  if (bal < need) {
    const fund = await deployer.sendTransaction({
      to: investor.address,
      value: need - bal,
    });
    await fund.wait();
    console.log("    funded :", hre.ethers.formatEther(need - bal), "ETH  tx:", link(fund.hash));
  }

  const tx2 = await app.connect(investor).invest(id, { value: amount });
  const rc2 = await tx2.wait();
  console.log("    invest :", hre.ethers.formatEther(amount), "ETH  tx:", link(tx2.hash));
  console.log("    gas    :", rc2.gasUsed.toString());

  // ---- 3. read back the state ----------------------------------------------
  const p = await app.getProject(id);
  const rate = await app.successRate(id);
  console.log("\n[3] on-chain state");
  console.log("    target   :", hre.ethers.formatEther(p.target), "ETH");
  console.log("    raised   :", hre.ethers.formatEther(p.raised), "ETH");
  console.log("    progress :", rate.toString(), "%");
  console.log("    deadline :", new Date(Number(p.deadline) * 1000).toISOString());
  console.log("    settled  :", p.settled);

  const contractUrl =
    hre.network.name === "sepolia"
      ? "https://sepolia.etherscan.io/address/" + address
      : address;
  console.log("\ncontract page:", contractUrl);
  console.log("\nSettlement cannot be demonstrated on Sepolia: the campaign window is");
  console.log("fixed at 30 days. Run `npx hardhat run scripts/local-demo.js` to show");
  console.log("settlement and refund with time travel on a local chain.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
