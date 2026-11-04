const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");

const THIRTY_DAYS = 30 * 24 * 60 * 60;
const TARGET = ethers.parseEther("10");
const MIN = ethers.parseEther("0.01");

async function deploy() {
  const [deployer, platform, creator, alice, bob] = await ethers.getSigners();
  const Factory = await ethers.getContractFactory("CrowdfundingPlatform");
  const app = await Factory.deploy(platform.address);
  await app.waitForDeployment();
  return { app, deployer, platform, creator, alice, bob };
}

async function createCampaign(app, creator, target = TARGET) {
  const tx = await app.connect(creator).createProject(target);
  const rc = await tx.wait();
  const log = rc.logs.find((l) => l.fragment && l.fragment.name === "ProjectCreated");
  return log.args.id;
}

describe("CrowdfundingPlatform", function () {
  let app, deployer, platform, creator, alice, bob;

  beforeEach(async function () {
    ({ app, deployer, platform, creator, alice, bob } = await deploy());
  });

  describe("Group 1 - deployment and campaign creation", function () {
    it("stores the platform fee recipient and starts with no campaign", async function () {
      expect(await app.platform()).to.equal(platform.address);
      expect(await app.projectCount()).to.equal(0n);
      expect(await app.PLATFORM_FEE_RATE()).to.equal(2n);
      expect(await app.MIN_INVESTMENT()).to.equal(MIN);
      expect(await app.CAMPAIGN_DURATION()).to.equal(BigInt(THIRTY_DAYS));
    });

    it("rejects a zero platform address", async function () {
      const F = await ethers.getContractFactory("CrowdfundingPlatform");
      await expect(F.deploy(ethers.ZeroAddress)).to.be.revertedWithCustomError(
        app,
        "ZeroAddress"
      );
    });

    it("creates a campaign with a fixed 30-day window", async function () {
      const tx = await app.connect(creator).createProject(TARGET);
      const rc = await tx.wait();
      const block = await ethers.provider.getBlock(rc.blockNumber);
      const id = await app.projectCount();

      const p = await app.getProject(id);
      expect(p.id).to.equal(id);
      expect(p.creator).to.equal(creator.address);
      expect(p.target).to.equal(TARGET);
      expect(p.startTime).to.equal(BigInt(block.timestamp));
      expect(p.deadline).to.equal(BigInt(block.timestamp + THIRTY_DAYS));
      expect(p.raised).to.equal(0n);
      expect(p.settled).to.equal(false);
      expect(p.success).to.equal(false);
      expect(p.withdrawn).to.equal(false);
    });

    it("emits ProjectCreated and increments the id counter", async function () {
      await expect(app.connect(creator).createProject(TARGET))
        .to.emit(app, "ProjectCreated")
        .withArgs(1n, creator.address, TARGET, (v) => v > 0n);
      expect(await app.projectCount()).to.equal(1n);
      await createCampaign(app, alice);
      expect(await app.projectCount()).to.equal(2n);
    });

    it("rejects a zero target", async function () {
      await expect(app.connect(creator).createProject(0)).to.be.revertedWithCustomError(
        app,
        "InvalidTarget"
      );
    });

    it("blocks creation while paused and allows it again after unpause", async function () {
      await app.connect(deployer).pause();
      await expect(app.connect(creator).createProject(TARGET)).to.be.revertedWithCustomError(
        app,
        "EnforcedPause"
      );
      await app.connect(deployer).unpause();
      await expect(app.connect(creator).createProject(TARGET)).to.emit(app, "ProjectCreated");
    });

    it("only lets the owner pause", async function () {
      await expect(app.connect(alice).pause()).to.be.revertedWithCustomError(
        app,
        "OwnableUnauthorizedAccount"
      );
    });
  });

  describe("Group 2 - investment", function () {
    let id;
    beforeEach(async function () {
      id = await createCampaign(app, creator);
    });

    it("records an investment and increases the raised amount", async function () {
      await expect(app.connect(alice).invest(id, { value: ethers.parseEther("1") }))
        .to.emit(app, "Invested")
        .withArgs(id, alice.address, ethers.parseEther("1"), ethers.parseEther("1"));

      const p = await app.getProject(id);
      expect(p.raised).to.equal(ethers.parseEther("1"));
      const inv = await app.getInvestment(id, alice.address);
      expect(inv.amount).to.equal(ethers.parseEther("1"));
      expect(inv.refunded).to.equal(false);
    });

    it("accepts exactly the minimum investment", async function () {
      await app.connect(alice).invest(id, { value: MIN });
      expect((await app.getInvestment(id, alice.address)).amount).to.equal(MIN);
    });

    it("rejects an amount below the minimum", async function () {
      await expect(
        app.connect(alice).invest(id, { value: ethers.parseEther("0.001") })
      ).to.be.revertedWithCustomError(app, "BelowMinimum");
    });

    it("accumulates repeated investments from the same address", async function () {
      await app.connect(alice).invest(id, { value: ethers.parseEther("1") });
      await app.connect(alice).invest(id, { value: ethers.parseEther("2") });
      expect((await app.getInvestment(id, alice.address)).amount).to.equal(
        ethers.parseEther("3")
      );
      expect((await app.getProject(id)).raised).to.equal(ethers.parseEther("3"));
    });

    it("keeps separate balances for different investors", async function () {
      await app.connect(alice).invest(id, { value: ethers.parseEther("2") });
      await app.connect(bob).invest(id, { value: ethers.parseEther("5") });
      const p = await app.getProject(id);
      expect(p.raised).to.equal(ethers.parseEther("7"));
      expect((await app.getInvestment(id, alice.address)).amount).to.equal(
        ethers.parseEther("2")
      );
      expect((await app.getInvestment(id, bob.address)).amount).to.equal(ethers.parseEther("5"));
    });

    it("rejects an investment after the deadline", async function () {
      await time.increase(THIRTY_DAYS + 1);
      await expect(
        app.connect(alice).invest(id, { value: ethers.parseEther("1") })
      ).to.be.revertedWithCustomError(app, "CampaignEnded");
    });

    it("rejects an investment in a campaign that does not exist", async function () {
      await expect(
        app.connect(alice).invest(99, { value: ethers.parseEther("1") })
      ).to.be.revertedWithCustomError(app, "CampaignNotFound");
    });

    it("blocks investment while paused", async function () {
      await app.connect(deployer).pause();
      await expect(
        app.connect(alice).invest(id, { value: ethers.parseEther("1") })
      ).to.be.revertedWithCustomError(app, "EnforcedPause");
    });

    it("rejects plain ETH transfers so that accounting cannot drift", async function () {
      await expect(
        alice.sendTransaction({ to: await app.getAddress(), value: ethers.parseEther("1") })
      ).to.be.reverted;
    });
  });

  describe("Group 3 - settlement", function () {
    it("rejects settlement before the deadline", async function () {
      const id = await createCampaign(app, creator);
      await expect(app.settle(id)).to.be.revertedWithCustomError(app, "CampaignNotEnded");
    });

    it("marks a campaign as successful when raised >= target", async function () {
      const id = await createCampaign(app, creator);
      await app.connect(alice).invest(id, { value: TARGET });
      await time.increase(THIRTY_DAYS + 1);

      await expect(app.settle(id))
        .to.emit(app, "Settled")
        .withArgs(id, true, TARGET, (TARGET * 2n) / 100n);

      const p = await app.getProject(id);
      expect(p.settled).to.equal(true);
      expect(p.success).to.equal(true);
      expect(await app.platformPool()).to.equal((TARGET * 2n) / 100n);
    });

    it("treats exactly hitting the target as success (boundary)", async function () {
      const id = await createCampaign(app, creator);
      await app.connect(alice).invest(id, { value: ethers.parseEther("6") });
      await app.connect(bob).invest(id, { value: ethers.parseEther("4") });
      await time.increase(THIRTY_DAYS + 1);
      await app.settle(id);
      expect((await app.getProject(id)).success).to.equal(true);
    });

    it("marks a campaign as failed when raised < target and charges no fee", async function () {
      const id = await createCampaign(app, creator);
      await app.connect(alice).invest(id, { value: ethers.parseEther("9") });
      await time.increase(THIRTY_DAYS + 1);

      await expect(app.settle(id))
        .to.emit(app, "Settled")
        .withArgs(id, false, ethers.parseEther("9"), 0n);

      expect((await app.getProject(id)).success).to.equal(false);
      expect(await app.platformPool()).to.equal(0n);
    });

    it("is idempotent: calling settle twice changes nothing", async function () {
      const id = await createCampaign(app, creator);
      await app.connect(alice).invest(id, { value: ethers.parseEther("1") });
      await time.increase(THIRTY_DAYS + 1);
      await app.settle(id);
      const before = await app.getProject(id);
      await app.settle(id);
      const after = await app.getProject(id);
      expect(after.settled).to.equal(before.settled);
      expect(after.success).to.equal(before.success);
      expect(await app.platformPool()).to.equal(0n);
    });

    it("can be settled by anybody, not only by the platform", async function () {
      const id = await createCampaign(app, creator);
      await time.increase(THIRTY_DAYS + 1);
      await expect(app.connect(bob).settle(id)).to.emit(app, "Settled");
    });

    it("reports a completion rate for the progress bar", async function () {
      const id = await createCampaign(app, creator);
      await app.connect(alice).invest(id, { value: ethers.parseEther("5") });
      expect(await app.successRate(id)).to.equal(50n);
    });
  });

  describe("Group 4 - withdrawal, refund and fund conservation", function () {
    it("pays the creator 98% and reserves 2% for the platform", async function () {
      const id = await createCampaign(app, creator);
      await app.connect(alice).invest(id, { value: TARGET });
      await time.increase(THIRTY_DAYS + 1);

      const fee = (TARGET * 2n) / 100n;
      const payout = TARGET - fee;
      const tx = app.connect(creator).withdrawFunds(id);
      await expect(tx)
        .to.emit(app, "FundsWithdrawn")
        .withArgs(id, creator.address, payout, fee);
      await expect(tx).to.changeEtherBalance(creator, payout);

      expect(await app.platformPool()).to.equal(fee);
      expect(await ethers.provider.getBalance(await app.getAddress())).to.equal(fee);
    });

    it("lets the platform collect the accumulated fee", async function () {
      const id = await createCampaign(app, creator);
      await app.connect(alice).invest(id, { value: TARGET });
      await time.increase(THIRTY_DAYS + 1);
      await app.connect(creator).withdrawFunds(id);

      const fee = (TARGET * 2n) / 100n;
      await expect(app.connect(platform).withdrawPlatformFee()).to.changeEtherBalance(
        platform,
        fee
      );
      expect(await app.platformPool()).to.equal(0n);
      expect(await ethers.provider.getBalance(await app.getAddress())).to.equal(0n);
    });

    it("blocks a non-platform address from collecting the fee", async function () {
      await expect(app.connect(alice).withdrawPlatformFee()).to.be.revertedWithCustomError(
        app,
        "NotPlatform"
      );
    });

    it("blocks withdrawal when there is no fee", async function () {
      await expect(app.connect(platform).withdrawPlatformFee()).to.be.revertedWithCustomError(
        app,
        "NothingToCollect"
      );
    });

    it("blocks anybody but the creator from withdrawing", async function () {
      const id = await createCampaign(app, creator);
      await app.connect(alice).invest(id, { value: TARGET });
      await time.increase(THIRTY_DAYS + 1);
      await expect(app.connect(alice).withdrawFunds(id)).to.be.revertedWithCustomError(
        app,
        "NotCreator"
      );
    });

    it("blocks withdrawal on a failed campaign", async function () {
      const id = await createCampaign(app, creator);
      await app.connect(alice).invest(id, { value: ethers.parseEther("1") });
      await time.increase(THIRTY_DAYS + 1);
      await expect(app.connect(creator).withdrawFunds(id)).to.be.revertedWithCustomError(
        app,
        "CampaignFailed"
      );
    });

    it("blocks a second withdrawal", async function () {
      const id = await createCampaign(app, creator);
      await app.connect(alice).invest(id, { value: TARGET });
      await time.increase(THIRTY_DAYS + 1);
      await app.connect(creator).withdrawFunds(id);
      await expect(app.connect(creator).withdrawFunds(id)).to.be.revertedWithCustomError(
        app,
        "NothingToWithdraw"
      );
    });

    it("refunds every investor the full principal on failure", async function () {
      const id = await createCampaign(app, creator);
      await app.connect(alice).invest(id, { value: ethers.parseEther("3") });
      await app.connect(bob).invest(id, { value: ethers.parseEther("2") });
      await time.increase(THIRTY_DAYS + 1);

      const tx1 = app.connect(alice).refund(id);
      await expect(tx1)
        .to.emit(app, "Refunded")
        .withArgs(id, alice.address, ethers.parseEther("3"));
      await expect(tx1).to.changeEtherBalance(alice, ethers.parseEther("3"));
      await expect(app.connect(bob).refund(id)).to.changeEtherBalance(
        bob,
        ethers.parseEther("2")
      );
      expect(await ethers.provider.getBalance(await app.getAddress())).to.equal(0n);
    });

    it("refunds without anybody calling settle first (lazy settlement)", async function () {
      const id = await createCampaign(app, creator);
      await app.connect(alice).invest(id, { value: ethers.parseEther("1") });
      await time.increase(THIRTY_DAYS + 1);
      expect((await app.getProject(id)).settled).to.equal(false);
      await app.connect(alice).refund(id);
      expect((await app.getProject(id)).settled).to.equal(true);
    });

    it("blocks a double refund", async function () {
      const id = await createCampaign(app, creator);
      await app.connect(alice).invest(id, { value: ethers.parseEther("1") });
      await time.increase(THIRTY_DAYS + 1);
      await app.connect(alice).refund(id);
      await expect(app.connect(alice).refund(id)).to.be.revertedWithCustomError(
        app,
        "AlreadyRefunded"
      );
    });

    it("blocks a refund on a successful campaign", async function () {
      const id = await createCampaign(app, creator);
      await app.connect(alice).invest(id, { value: TARGET });
      await time.increase(THIRTY_DAYS + 1);
      await expect(app.connect(alice).refund(id)).to.be.revertedWithCustomError(
        app,
        "CampaignSucceeded"
      );
    });

    it("blocks a refund from a non-investor", async function () {
      const id = await createCampaign(app, creator);
      await time.increase(THIRTY_DAYS + 1);
      await expect(app.connect(bob).refund(id)).to.be.revertedWithCustomError(
        app,
        "NoInvestment"
      );
    });

    it("survives a reentrancy attack: the attacker is paid exactly once", async function () {
      const id = await createCampaign(app, creator);
      const Attacker = await ethers.getContractFactory("ReentrancyAttacker");
      const attacker = await Attacker.deploy(await app.getAddress());
      await attacker.waitForDeployment();

      const stake = ethers.parseEther("1");
      await attacker.connect(alice).invest(id, { value: stake });
      await time.increase(THIRTY_DAYS + 1);

      await attacker.connect(alice).attack();

      expect(await attacker.reentryAttempts()).to.equal(1n);
      expect(await ethers.provider.getBalance(await app.getAddress())).to.equal(0n);
      expect(await ethers.provider.getBalance(await attacker.getAddress())).to.equal(stake);

      await expect(attacker.connect(alice).attack()).to.be.revertedWithCustomError(
        app,
        "AlreadyRefunded"
      );
      expect(await ethers.provider.getBalance(await attacker.getAddress())).to.equal(stake);
    });

    it("keeps the books balanced across a success and a failure in parallel", async function () {
      const ok = await createCampaign(app, creator, ethers.parseEther("1"));
      const bad = await createCampaign(app, creator, ethers.parseEther("5"));
      await app.connect(alice).invest(ok, { value: ethers.parseEther("2") });
      await app.connect(bob).invest(bad, { value: ethers.parseEther("1") });
      await time.increase(THIRTY_DAYS + 1);

      await app.connect(creator).withdrawFunds(ok);
      await app.connect(bob).refund(bad);
      await app.connect(platform).withdrawPlatformFee();
      expect(await ethers.provider.getBalance(await app.getAddress())).to.equal(0n);
    });
  });
});
