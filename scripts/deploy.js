const hre = require("hardhat");

async function main() {
  const [deployer] = await hre.ethers.getSigners();
  const feeRecipient = process.env.PLATFORM_FEE_RECIPIENT || deployer.address;

  console.log("Network        :", hre.network.name);
  console.log("Deployer       :", deployer.address);
  console.log("Balance        :", hre.ethers.formatEther(
    await hre.ethers.provider.getBalance(deployer.address)
  ), "ETH");
  console.log("Fee recipient  :", feeRecipient);

  const Factory = await hre.ethers.getContractFactory("CrowdfundingPlatform");
  const app = await Factory.deploy(feeRecipient);
  await app.waitForDeployment();

  const address = await app.getAddress();
  const receipt = await app.deploymentTransaction().wait();
  console.log("Contract       :", address);
  console.log("Block          :", receipt.blockNumber);
  console.log("Gas used       :", receipt.gasUsed.toString());

  if (hre.network.name !== "hardhat" && hre.network.name !== "localhost") {
    console.log("Waiting 6 confirmations before verification...");
    await app.deploymentTransaction().wait(6);
    try {
      await hre.run("verify:verify", {
        address,
        constructorArguments: [feeRecipient],
      });
      console.log("Verified       : https://sepolia.etherscan.io/address/" + address);
    } catch (err) {
      console.log("Verification skipped:", err.message);
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
