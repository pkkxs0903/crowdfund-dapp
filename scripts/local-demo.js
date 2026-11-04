/**
 * local-demo.js — full campaign lifecycle on an in-process Hardhat chain.
 *
 * Usage:
 *   npx hardhat run scripts/local-demo.js
 *
 * This script exists because the campaign window is a 30-day constant: on a
 * public testnet you cannot wait for settlement, so the success and refund
 * branches are demonstrated here with evm_increaseTime. Everything printed
 * below is read back from the contract, not hard-coded.
 */
const hre = require("hardhat");

const DAY = 24 * 60 * 60;

function eth(v) {
  return hre.ethers.formatEther(v);
}

async function jump(days) {
  await hre.network.provider.send("evm_increaseTime", [days * DAY + 1]);
  await hre.network.provider.send("evm_mine", []);
}

async function main() {
  const [, platform, creator, alice, bob] = await hre.ethers.getSigners();

  const Factory = await hre.ethers.getContractFactory("CrowdfundingPlatform");
  const app = await Factory.deploy(platform.address);
  await app.waitForDeployment();
  console.log("contract deployed at:", await app.getAddress());

  // =========================================================================
  console.log("\n=== CASE A: campaign reaches its target ===");
  // =========================================================================
  const target = hre.ethers.parseEther("1");
  await (await app.connect(creator).createProject(target)).wait();
  const idA = await app.projectCount(); // ids start at 1

  await (await app.connect(alice).invest(idA, { value: hre.ethers.parseEther("0.6") })).wait();
  await (await app.connect(bob).invest(idA, { value: hre.ethers.parseEther("0.5") })).wait();

  let p = await app.getProject(idA);
  console.log("target        :", eth(p.target), "ETH");
  console.log("raised        :", eth(p.raised), "ETH   (over-subscribed)");
  console.log("progress      :", (await app.successRate(idA)).toString(), "%");
  console.log("days left     :", ((await app.timeLeft(idA)) / BigInt(DAY)).toString());

  console.log("\n-- time travel 30 days --");
  await jump(30);

  const sTx = await app.settle(idA);
  const sRc = await sTx.wait();
  const settled = sRc.logs
    .map((l) => { try { return app.interface.parseLog(l); } catch (_) { return null; } })
    .find((l) => l && l.name === "Settled");
  console.log("settled       :", settled.args.success);
  console.log("platform fee  :", eth(settled.args.platformFee), "ETH  (2 %)");

  const before = await hre.ethers.provider.getBalance(creator.address);
  const wRc = await (await app.connect(creator).withdrawFunds(idA)).wait();
  const after = await hre.ethers.provider.getBalance(creator.address);
  const wEv = wRc.logs
    .map((l) => { try { return app.interface.parseLog(l); } catch (_) { return null; } })
    .find((l) => l && l.name === "FundsWithdrawn");
  console.log("creator got   :", eth(wEv.args.payout), "ETH  (98 %, event)");
  console.log("  balance +  :", eth(after - before), "ETH  (net of gas)");
  console.log("platformPool  :", eth(await app.platformPool()), "ETH");

  const pBefore = await hre.ethers.provider.getBalance(platform.address);
  await (await app.connect(platform).withdrawPlatformFee()).wait();
  const pAfter = await hre.ethers.provider.getBalance(platform.address);
  console.log("platform got  :", eth(pAfter - pBefore), "ETH  (net of gas)");
  console.log("pool drained  :", eth(await app.platformPool()), "ETH");

  p = await app.getProject(idA);
  console.log("withdrawn flag:", p.withdrawn);

  // =========================================================================
  console.log("\n=== CASE B: campaign misses its target -> full refund ===");
  // =========================================================================
  const targetB = hre.ethers.parseEther("5");
  await (await app.connect(creator).createProject(targetB)).wait();
  const idB = await app.projectCount();

  await (await app.connect(alice).invest(idB, { value: hre.ethers.parseEther("0.5") })).wait();
  console.log("target        :", eth(targetB), "ETH");
  console.log("raised        :", eth((await app.getProject(idB)).raised), "ETH  (20 %)");

  await jump(30);
  await (await app.settle(idB)).wait();
  const pB = await app.getProject(idB);
  console.log("settled       :", pB.settled, "  success:", pB.success);
  console.log("platformPool  :", eth(await app.platformPool()), "ETH  (unchanged: no fee on failure)");

  const rRc = await (await app.connect(alice).refund(idB)).wait();
  const rEv = rRc.logs
    .map((l) => { try { return app.interface.parseLog(l); } catch (_) { return null; } })
    .find((l) => l && l.name === "Refunded");
  console.log("investor back :", eth(rEv.args.amount), "ETH  (100 % of principal)");
  console.log("refunded flag :", (await app.getInvestment(idB, alice.address)).refunded);

  console.log("\nAll figures above were read from contract storage after each call.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
