// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title CrowdfundingPlatform
 * @author CDS528 Group Project
 * @notice A single-contract, multi-project crowdfunding platform with trust-minimised
 *         escrow and automatic settlement. Every campaign is funded in native ETH,
 *         held by this contract, and released only by the rules coded below.
 * @dev Security model: checks-effects-interactions everywhere, OpenZeppelin
 *      ReentrancyGuard on every value-transferring function, custom errors instead of
 *      revert strings to reduce bytecode and gas, and no `receive`/`fallback` so that
 *      ETH can only enter through `invest` and accounting can never drift.
 */
contract CrowdfundingPlatform is ReentrancyGuard, Pausable, Ownable {
    struct Project {
        uint256 id;
        address payable creator;
        uint256 target;
        uint256 startTime;
        uint256 deadline;
        uint256 raised;
        bool settled;
        bool success;
        bool withdrawn;
    }

    struct Investment {
        uint256 amount;
        bool refunded;
    }

    uint256 public constant CAMPAIGN_DURATION = 30 days;
    uint256 public constant MIN_INVESTMENT = 0.01 ether;
    uint256 public constant PLATFORM_FEE_RATE = 2;
    uint256 public constant PERCENT_BASE = 100;

    address payable public immutable platform;

    uint256 public projectCount;
    uint256 public platformPool;

    mapping(uint256 => Project) private projects;
    mapping(uint256 => mapping(address => Investment)) private investments;

    event ProjectCreated(
        uint256 indexed id, address indexed creator, uint256 target, uint256 deadline
    );
    event Invested(uint256 indexed id, address indexed investor, uint256 amount, uint256 raised);
    event Settled(uint256 indexed id, bool success, uint256 raised, uint256 platformFee);
    event FundsWithdrawn(
        uint256 indexed id, address indexed creator, uint256 payout, uint256 platformFee
    );
    event Refunded(uint256 indexed id, address indexed investor, uint256 amount);
    event PlatformFeeWithdrawn(address indexed to, uint256 amount);

    error ZeroAddress();
    error InvalidTarget();
    error CampaignNotFound(uint256 id);
    error CampaignEnded(uint256 id);
    error CampaignNotEnded(uint256 id);
    error BelowMinimum(uint256 given, uint256 minimum);
    error NotCreator();
    error CampaignFailed(uint256 id);
    error CampaignSucceeded(uint256 id);
    error NothingToWithdraw(uint256 id);
    error AlreadyRefunded(uint256 id);
    error NoInvestment(uint256 id);
    error NotPlatform();
    error NothingToCollect();
    error TransferFailed();

    constructor(address payable feeRecipient) Ownable(msg.sender) {
        if (feeRecipient == address(0)) revert ZeroAddress();
        platform = feeRecipient;
    }

    function createProject(uint256 target) external whenNotPaused returns (uint256 id) {
        if (target == 0) revert InvalidTarget();
        id = ++projectCount;
        projects[id] = Project({
            id: id,
            creator: payable(msg.sender),
            target: target,
            startTime: block.timestamp,
            deadline: block.timestamp + CAMPAIGN_DURATION,
            raised: 0,
            settled: false,
            success: false,
            withdrawn: false
        });
        emit ProjectCreated(id, msg.sender, target, block.timestamp + CAMPAIGN_DURATION);
    }

    function invest(uint256 id) external payable whenNotPaused nonReentrant {
        Project storage p = _existing(id);
        if (block.timestamp >= p.deadline) revert CampaignEnded(id);
        if (msg.value < MIN_INVESTMENT) revert BelowMinimum(msg.value, MIN_INVESTMENT);
        p.raised += msg.value;
        investments[id][msg.sender].amount += msg.value;
        emit Invested(id, msg.sender, msg.value, p.raised);
    }

    function settle(uint256 id) external {
        _existing(id);
        _settle(id);
    }

    function withdrawFunds(uint256 id) external nonReentrant {
        Project storage p = _existing(id);
        if (msg.sender != p.creator) revert NotCreator();
        _settle(id);
        if (!p.success) revert CampaignFailed(id);
        if (p.withdrawn) revert NothingToWithdraw(id);

        p.withdrawn = true;
        uint256 fee = _feeOf(p.raised);
        uint256 payout = p.raised - fee;
        emit FundsWithdrawn(id, msg.sender, payout, fee);
        _send(p.creator, payout);
    }

    function refund(uint256 id) external nonReentrant {
        Project storage p = _existing(id);
        _settle(id);
        if (p.success) revert CampaignSucceeded(id);

        Investment storage inv = investments[id][msg.sender];
        if (inv.amount == 0) revert NoInvestment(id);
        if (inv.refunded) revert AlreadyRefunded(id);

        uint256 amount = inv.amount;
        inv.refunded = true;
        emit Refunded(id, msg.sender, amount);
        _send(payable(msg.sender), amount);
    }

    function withdrawPlatformFee() external nonReentrant {
        if (msg.sender != platform) revert NotPlatform();
        uint256 amount = platformPool;
        if (amount == 0) revert NothingToCollect();
        platformPool = 0;
        emit PlatformFeeWithdrawn(platform, amount);
        _send(platform, amount);
    }

    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }

    function getProject(uint256 id) external view returns (Project memory) {
        _existing(id);
        return projects[id];
    }

    function getInvestment(uint256 id, address investor)
        external
        view
        returns (Investment memory)
    {
        return investments[id][investor];
    }

    function successRate(uint256 id) external view returns (uint256) {
        Project storage p = projects[id];
        if (p.target == 0) return 0;
        return (p.raised * PERCENT_BASE) / p.target;
    }

    function timeLeft(uint256 id) external view returns (uint256) {
        Project storage p = projects[id];
        if (p.settled || block.timestamp >= p.deadline) return 0;
        return p.deadline - block.timestamp;
    }

    function _settle(uint256 id) internal {
        Project storage p = projects[id];
        if (p.settled) return;
        if (block.timestamp < p.deadline) revert CampaignNotEnded(id);
        bool ok = p.raised >= p.target && p.raised > 0;
        p.settled = true;
        p.success = ok;
        uint256 fee = ok ? _feeOf(p.raised) : 0;
        if (fee > 0) platformPool += fee;
        emit Settled(id, ok, p.raised, fee);
    }

    function _feeOf(uint256 amount) internal pure returns (uint256) {
        return (amount * PLATFORM_FEE_RATE) / PERCENT_BASE;
    }

    function _existing(uint256 id) internal view returns (Project storage) {
        if (id == 0 || id > projectCount) revert CampaignNotFound(id);
        return projects[id];
    }

    function _send(address payable to, uint256 amount) internal {
        (bool ok,) = to.call{value: amount}("");
        if (!ok) revert TransferFailed();
    }
}
