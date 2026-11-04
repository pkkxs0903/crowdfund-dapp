// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {CrowdfundingPlatform} from "../CrowdfundingPlatform.sol";

/// @notice Malicious investor used by the test suite to prove that the
///         reentrancy guard blocks a nested refund.
contract ReentrancyAttacker {
    CrowdfundingPlatform public immutable target;
    uint256 public campaignId;
    bool private attacking;
    uint256 public reentryAttempts;

    constructor(CrowdfundingPlatform _target) {
        target = _target;
    }

    function invest(uint256 id) external payable {
        campaignId = id;
        target.invest{value: msg.value}(id);
    }

    function attack() external {
        attacking = true;
        target.refund(campaignId);
        attacking = false;
    }

    receive() external payable {
        if (attacking) {
            reentryAttempts++;
            try target.refund(campaignId) {} catch {}
        }
    }
}
