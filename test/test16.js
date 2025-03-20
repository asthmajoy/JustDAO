const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");

describe("Token Holder Governance Test", function () {
  let justToken;
  let justTimelock;
  let justGovernance;
  let owner;
  let admin;
  let voter1;
  let voter2;
  let voter3;
  let recipient;
  let tokenAddress;
  let timelockAddress;
  let governanceAddress;

  // Common constants for governance setup
  const MINT_AMOUNT = ethers.parseEther("100"); // 100 tokens for each voter
  const PROPOSAL_THRESHOLD = ethers.parseEther("10"); // 10 tokens needed to create a proposal
  const PROPOSAL_STAKE = ethers.parseEther("0.2"); // Estimate of what contract takes as stake
  const VOTING_DELAY = 3600; // 1 hour delay before voting starts
  const VOTING_PERIOD = 10000; // 10000 seconds voting period
  const QUORUM = ethers.parseEther("30"); // 30 tokens needed for quorum
  const TIMELOCK_MIN_DELAY = 3600; // 1 hour timelock delay for tests
  const MIN_LOCK_DURATION = 86400; // 1 day min lock
  const MAX_LOCK_DURATION = 604800; // 7 days max lock
  
  
  before(async function () {
    [owner, admin, voter1, voter2, voter3, recipient] = await ethers.getSigners();
    
    // Deploy token
    const JustToken = await ethers.getContractFactory("contracts/JustTokenUpgradeable.sol:JustTokenUpgradeable");
    const tokenProxy = await upgrades.deployProxy(JustToken, [
      "Just Token",
      "JST",
      admin.address,
      MIN_LOCK_DURATION,
      MAX_LOCK_DURATION
    ]);
    justToken = await tokenProxy.waitForDeployment();
    tokenAddress = await justToken.getAddress();
    console.log(`Token deployed at: ${tokenAddress}`);
    
    // Deploy timelock
    const JustTimelock = await ethers.getContractFactory("contracts/JustTimelockUpgradeable.sol:JustTimelockUpgradeable");
    const timelockProxy = await upgrades.deployProxy(JustTimelock, [
      TIMELOCK_MIN_DELAY,
      [],    // No proposers
      [],    // No executors
      admin.address
    ]);
    justTimelock = await timelockProxy.waitForDeployment();
    timelockAddress = await justTimelock.getAddress();
    console.log(`Timelock deployed at: ${timelockAddress}`);
    
    // Deploy governance
    const JustGovernance = await ethers.getContractFactory("contracts/JustGovernanceUpgradeable.sol:JustGovernanceUpgradeable");
    const governanceProxy = await upgrades.deployProxy(JustGovernance, [
      "Just Governance",
      tokenAddress,
      timelockAddress,
      admin.address,
      PROPOSAL_THRESHOLD,  // proposalThreshold
      VOTING_DELAY,        // votingDelay
      VOTING_PERIOD,       // votingPeriod
      QUORUM,              // quorumNumerator
      100,                 // successfulRefund
      80,                  // cancelledRefund
      50,                  // defeatedRefund
      50                   // expiredRefund
    ]);
    justGovernance = await governanceProxy.waitForDeployment();
    governanceAddress = await justGovernance.getAddress();
    console.log(`Governance deployed at: ${governanceAddress}`);
    
    // Set token in timelock
    await justTimelock.connect(admin).setJustToken(tokenAddress);
    console.log("Set token in timelock");
    
    // Set a very low token threshold for testing
    const lowThreshold = ethers.parseEther("1"); // 1 token is enough to execute timelock transactions
    await justTimelock.connect(admin).updateExecutorTokenThreshold(lowThreshold);
    console.log(`Set token threshold to ${ethers.formatEther(lowThreshold)} JST`);
    
    // Grant PROPOSER_ROLE and EXECUTOR_ROLE to governance contract on timelock
    const proposerRole = await justTimelock.PROPOSER_ROLE();
    await justTimelock.connect(admin).grantContractRole(proposerRole, governanceAddress);
    console.log("Granted PROPOSER_ROLE to governance contract on timelock");
    
    const executorRole = await justTimelock.EXECUTOR_ROLE();
    await justTimelock.connect(admin).grantContractRole(executorRole, governanceAddress);
    console.log("Granted EXECUTOR_ROLE to governance contract on timelock");
    
    // Configure permissions for governance and timelock
    const governanceRole = await justToken.GOVERNANCE_ROLE();
    await justToken.connect(admin).grantContractRole(governanceRole, governanceAddress);
    console.log("Granted GOVERNANCE_ROLE to governance contract on token");
    
    // Give timelock governance role on token for future upgradeability management
    await justToken.connect(admin).grantContractRole(governanceRole, timelockAddress);
    console.log("Granted GOVERNANCE_ROLE to timelock on token");
    
    // Give timelock admin role on governance for governance changes
    const adminRole = await justGovernance.ADMIN_ROLE();
    await justGovernance.connect(admin).grantContractRole(adminRole, timelockAddress);
    console.log("Granted ADMIN_ROLE to timelock on governance");
    
    // Set up allowlist for security updates
    await justGovernance.connect(admin).updateSecurity(
      "0x12345678", // Example selector
      true,
      ethers.ZeroAddress,
      false
    );
    console.log("Set up security allowlist for test function");
    
    // Get the current governance parameters
    const govParams = await justGovernance.govParams();
    console.log("Current Governance Parameters:");
    console.log("- Voting Duration:", govParams.votingDuration);
    console.log("- Quorum:", ethers.formatEther(govParams.quorum));
    console.log("- Timelock Delay:", govParams.timelockDelay);
    console.log("- Proposal Creation Threshold:", ethers.formatEther(govParams.proposalCreationThreshold));
    console.log("- Proposal Stake:", ethers.formatEther(govParams.proposalStake));
    
    // Mint tokens to voters
    const minterRole = await justToken.MINTER_ROLE();
    await justToken.connect(admin).grantContractRole(minterRole, admin.address);
    
    // Mint and distribute tokens to voters
    await justToken.connect(admin).mint(voter1.address, MINT_AMOUNT);
    await justToken.connect(admin).mint(voter2.address, MINT_AMOUNT);
    await justToken.connect(admin).mint(voter3.address, MINT_AMOUNT);
    
    // Log balances
    console.log(`Voter1 balance: ${ethers.formatEther(await justToken.balanceOf(voter1.address))} JST`);
    console.log(`Voter2 balance: ${ethers.formatEther(await justToken.balanceOf(voter2.address))} JST`);
    console.log(`Voter3 balance: ${ethers.formatEther(await justToken.balanceOf(voter3.address))} JST`);
    
    // Check contract versions to ensure we're using the right implementation
    console.log("Contract versions:");
    console.log("- Token implementation:", await justToken.MINTER_ROLE());
    console.log("- Timelock implementation:", await justTimelock.PROPOSER_ROLE());
    
    // Verify address connections
    console.log("Contract connections:");
    console.log("- Token address in governance:", await justGovernance.justToken()); 
    console.log("- Timelock address in governance:", await justGovernance.timelock());
    console.log("- Token address in timelock:", await justTimelock.justToken());

    // ======= ADD ADDITIONAL PERMISSIONS TO FIX THE EXECUTION ISSUE =======
    console.log("\n=== Adding Additional Permissions ===");

    // 1. Ensure timelock has EXECUTOR_ROLE on itself (for self-execution)
    console.log("Ensuring timelock has EXECUTOR_ROLE on itself...");
    if (!(await justTimelock.hasRole(executorRole, timelockAddress))) {
      await justTimelock.connect(admin).grantContractRole(executorRole, timelockAddress);
      console.log("EXECUTOR_ROLE granted to timelock on itself");
    } else {
      console.log("Timelock already has EXECUTOR_ROLE on itself");
    }

    // 2. Explicitly add the executeProposalLogic selector from the error message
    const executeProposalLogicSelectorHardcoded = "0xa01fc1c6";
    const executeProposalLogicSelector = justGovernance.interface.getFunction("executeProposalLogic").selector;
    console.log(`Hardcoded executeProposalLogic selector: ${executeProposalLogicSelectorHardcoded}`);
    console.log(`Interface executeProposalLogic selector: ${executeProposalLogicSelector}`);
    
    // Verify they match
    if (executeProposalLogicSelectorHardcoded.toLowerCase() !== executeProposalLogicSelector.toLowerCase()) {
      console.warn("WARNING: Selector mismatch! Using both to be safe.");
    }

    // 3. Make sure the executeProposalLogic function can be called by the timelock
    // This is the critical permission needed based on the error message
    console.log("Allowing executeProposalLogic selector in governance security...");
    await justGovernance.connect(admin).updateSecurity(
      executeProposalLogicSelector,
      true,               // Allow this selector
      governanceAddress,  // Target is the governance contract itself
      true                // Allow this target
    );
    
    // Also try with the hardcoded selector just to be sure
    if (executeProposalLogicSelectorHardcoded.toLowerCase() !== executeProposalLogicSelector.toLowerCase()) {
      await justGovernance.connect(admin).updateSecurity(
        executeProposalLogicSelectorHardcoded,
        true,
        governanceAddress,
        true
      );
    }

    // 4. Get the governanceTransfer selector
    const governanceTransferSelector = justToken.interface.getFunction("governanceTransfer").selector;
    console.log(`governanceTransfer selector: ${governanceTransferSelector}`);

    // 5. Allow the governanceTransfer selector in governance security settings
    console.log("Allowing governanceTransfer selector in governance security...");
    await justGovernance.connect(admin).updateSecurity(
      governanceTransferSelector,
      true,
      tokenAddress,
      true
    );

    // 6. Set the timelock threat levels for these functions to LOW for quicker testing
    console.log("Setting threat levels in timelock...");
    await justTimelock.connect(admin).setFunctionThreatLevel(executeProposalLogicSelector, 0); // LOW
    if (executeProposalLogicSelectorHardcoded.toLowerCase() !== executeProposalLogicSelector.toLowerCase()) {
      await justTimelock.connect(admin).setFunctionThreatLevel(executeProposalLogicSelectorHardcoded, 0); // LOW
    }
    await justTimelock.connect(admin).setFunctionThreatLevel(governanceTransferSelector, 0); // LOW

    // 7. Grant CANCELLER_ROLE to governance on timelock (might be needed for proposal cancellation)
    const cancellerRole = await justTimelock.CANCELLER_ROLE();
    console.log("Granting CANCELLER_ROLE to governance on timelock...");
    await justTimelock.connect(admin).grantContractRole(cancellerRole, governanceAddress);

    // 8. Explicitly verify all security settings are in place
    console.log("Verifying security settings...");
    console.log(`- executeProposalLogic selector allowed: ${await justGovernance.allowedFunctionSelectors(executeProposalLogicSelector)}`);
    console.log(`- governanceTransfer selector allowed: ${await justGovernance.allowedFunctionSelectors(governanceTransferSelector)}`);
    console.log(`- Governance address allowed as target: ${await justGovernance.allowedTargets(governanceAddress)}`);
    console.log(`- Token address allowed as target: ${await justGovernance.allowedTargets(tokenAddress)}`);

    console.log("=== All Permissions Updated ===\n");
  });

  it("Normal token holders should be auto-delegated to themselves", async function () {
    // Check that voters are auto-delegated to themselves
    expect(await justToken.getDelegate(voter1.address)).to.equal(voter1.address);
    expect(await justToken.getDelegate(voter2.address)).to.equal(voter2.address);
    expect(await justToken.getDelegate(voter3.address)).to.equal(voter3.address);
    
    // Check effective voting power
    const createSnapshotTx = await justToken.connect(admin).createSnapshot();
    await createSnapshotTx.wait();
    const snapshotId = await justToken.getCurrentSnapshotId();
    
    expect(await justToken.getEffectiveVotingPower(voter1.address, snapshotId)).to.equal(MINT_AMOUNT);
    expect(await justToken.getEffectiveVotingPower(voter2.address, snapshotId)).to.equal(MINT_AMOUNT);
    expect(await justToken.getEffectiveVotingPower(voter3.address, snapshotId)).to.equal(MINT_AMOUNT);
  });

  it("Normal token holders should be able to execute a timelock transaction", async function () {
    // We'll use a simple mint transaction to test timelock execution
    const mintAmount = ethers.parseEther("5");
    
    // Encode the function call for minting
    const mintCallData = justToken.interface.encodeFunctionData("governanceMint", [
      recipient.address,
      mintAmount
    ]);
    
    console.log("Voter2 queueing transaction...");
    
    // Queue the transaction using voter2's token holdings
    const queueTx = await justTimelock.connect(voter2).queueTransactionWithThreatLevel(
      tokenAddress,
      0,  // no ETH value
      mintCallData
    );
    
    const receipt = await queueTx.wait();
    
    // Find the queued event
    const queuedEvents = receipt.logs.filter(
      log => log.fragment && log.fragment.name === 'TransactionQueued'
    );
    
    expect(queuedEvents.length).to.be.gt(0, "Transaction was not queued");
    const txHash = queuedEvents[0].args[0];
    console.log(`Transaction queued with hash: ${txHash}`);
    
    // Verify the transaction is actually queued
    const isQueued = await justTimelock.queuedTransactions(txHash);
    expect(isQueued).to.be.true;
    
    // Get the transaction details
    const tx = await justTimelock.getTransaction(txHash);
    const eta = tx[3];
    
    // Fast forward time to after eta
    const currentTime = await time.latest();
    const timeToAdvance = Number(eta) - currentTime + 60; // Add 60 seconds buffer
    console.log(`Fast forwarding time by ${timeToAdvance} seconds...`);
    await time.increase(timeToAdvance);
    
    // Store recipient's balance before execution
    const beforeBalance = await justToken.balanceOf(recipient.address);
    
    // Execute the transaction using voter3's token holdings
    console.log("Voter3 executing transaction...");
    const executeTx = await justTimelock.connect(voter3).executeTransaction(txHash);
    const executeReceipt = await executeTx.wait();
    
    // Verify the transaction was executed
    const executedEvents = executeReceipt.logs.filter(
      log => log.fragment && log.fragment.name === 'TransactionExecuted'
    );
    expect(executedEvents.length).to.be.gt(0, "Transaction was not executed");
    
    // Verify the mint was successful
    const afterBalance = await justToken.balanceOf(recipient.address);
    expect(afterBalance - beforeBalance).to.equal(mintAmount);
    
    console.log("Transaction successfully executed by normal user");
  });

  it("Normal token holders should be able to create and execute a governance change proposal", async function () {
    // Get the current governance parameters
    const oldParams = await justGovernance.govParams();
    const oldVotingDuration = oldParams.votingDuration;
    
    // Create a governance change proposal with slightly longer voting period
    const newVotingDuration = Number(oldVotingDuration) + 1000; // Increase by 1000 seconds
    const description = "Update voting duration";
    
    // Create the proposal
    console.log("Creating governance change proposal...");
    const tx = await justGovernance.connect(voter2).createProposal(
      description,
      3,                        // ProposalType.GovernanceChange
      ethers.ZeroAddress,       // target (not used)
      "0x",                     // callData (not used)
      0,                        // amount (not used)
      ethers.ZeroAddress,       // recipient (not used)
      ethers.ZeroAddress,       // externalToken (not used)
      0,                        // newThreshold (not changing)
      0,                        // newQuorum (not changing)
      newVotingDuration,        // newVotingDuration (changing this)
      0                         // newTimelockDelay (not changing)
    );
    
    const receipt = await tx.wait();
    const proposalEvents = receipt.logs.filter(
      log => log.fragment && log.fragment.name === 'ProposalEvent'
    );
    
    const proposalId = proposalEvents[0].args[0]; // First argument is proposalId
    console.log(`Governance change proposal created with ID: ${proposalId}`);
    
    // Cast votes to pass the proposal
    await justGovernance.connect(voter1).castVote(proposalId, 1); // Vote yes
    await justGovernance.connect(voter2).castVote(proposalId, 1); // Vote yes
    await justGovernance.connect(voter3).castVote(proposalId, 1); // Vote yes
    
    // Fast forward time past the voting period
    await time.increase(VOTING_PERIOD + 1);
    
    // Check proposal state
    const state = await justGovernance.getProposalState(proposalId);
    console.log(`Proposal state after voting period: ${state}`);
    
    try {
      // Queue the proposal for execution
      console.log("Queuing governance change proposal...");
      const queueTx = await justGovernance.connect(voter2).queueProposal(proposalId);
      await queueTx.wait();
      
      // Check state after queuing
      const queuedState = await justGovernance.getProposalState(proposalId);
      console.log(`Proposal state after queuing: ${queuedState}`);
      
      // Fast forward time to after timelock delay
      await time.increase(TIMELOCK_MIN_DELAY + 100);
      
      // Execute the proposal
      console.log("Executing governance change proposal...");
      const executeTx = await justGovernance.connect(voter2).executeProposal(proposalId);
      await executeTx.wait();
      
      // Check state after execution
      const executedState = await justGovernance.getProposalState(proposalId);
      console.log(`Proposal state after execution: ${executedState}`);
      
      // Check if voting duration was updated
      const newParams = await justGovernance.govParams();
      console.log(`Old voting duration: ${oldVotingDuration}, New voting duration: ${newParams.votingDuration}`);
      expect(newParams.votingDuration).to.equal(BigInt(newVotingDuration));
    } catch (error) {
      console.error("Error in governance change proposal:", error);
      throw error;
    }
  });

  it("Normal token holders should be able to delegate their tokens", async function () {
    // First create a new snapshot for baseline
    const baselineSnapshot = await justToken.connect(admin).createSnapshot();
    const baselineSnapshotId = await justToken.getCurrentSnapshotId();
    
    // Capture baseline voting power
    const voter1BaselinePower = await justToken.getEffectiveVotingPower(voter1.address, baselineSnapshotId);
    const voter3BaselinePower = await justToken.getEffectiveVotingPower(voter3.address, baselineSnapshotId);
    
    // Voter3 delegates to Voter1
    console.log("Delegating tokens from voter3 to voter1...");
    await justToken.connect(voter3).delegate(voter1.address);
    
    // Check delegation status
    expect(await justToken.getDelegate(voter3.address)).to.equal(voter1.address);
    
    // Check locked tokens
    expect(await justToken.getLockedTokens(voter3.address)).to.equal(MINT_AMOUNT);
    
    // Create a snapshot to record delegation
    const delegationSnapshot = await justToken.connect(admin).createSnapshot();
    const delegationSnapshotId = await justToken.getCurrentSnapshotId();
    
    // Check effective voting power after delegation
    const voter3PowerAfterDelegation = await justToken.getEffectiveVotingPower(voter3.address, delegationSnapshotId);
    console.log(`Voter3 voting power after delegation: ${ethers.formatEther(voter3PowerAfterDelegation)} JST`);
    expect(voter3PowerAfterDelegation).to.equal(0); // Delegated away
    
    // Get voter1's voting power after receiving delegation
    const voter1NewPower = await justToken.getEffectiveVotingPower(voter1.address, delegationSnapshotId);
    console.log("Voter1 baseline power:", ethers.formatEther(voter1BaselinePower));
    console.log("Voter3 baseline power:", ethers.formatEther(voter3BaselinePower));
    console.log("Voter1 power after delegation:", ethers.formatEther(voter1NewPower));
    
    // Verify voter1's power increased by approximately voter3's amount
    // (We allow for tiny differences due to previous proposal stakes)
    const powerDifference = voter1NewPower - voter1BaselinePower;
    console.log(`Power difference: ${ethers.formatEther(powerDifference)} JST`);
    const diffRatio = Number(powerDifference) / Number(voter3BaselinePower);
    expect(diffRatio).to.be.closeTo(1, 0.05); // Within 5% of expected
    
    // Voter3 undelegates (returns to self-delegation)
    console.log("Resetting delegation for voter3...");
    await justToken.connect(voter3).resetDelegation();
    
    // Check delegation status after undelegating
    expect(await justToken.getDelegate(voter3.address)).to.equal(voter3.address);
    expect(await justToken.getLockedTokens(voter3.address)).to.equal(0); // Tokens unlocked
    
    // Create final snapshot to verify return to normal
    const finalSnapshot = await justToken.connect(admin).createSnapshot();
    const finalSnapshotId = await justToken.getCurrentSnapshotId();
    
    // Verify voting powers are back to normal (approximately)
    const finalVoter1Power = await justToken.getEffectiveVotingPower(voter1.address, finalSnapshotId);
    const finalVoter3Power = await justToken.getEffectiveVotingPower(voter3.address, finalSnapshotId);
    
    console.log("Final voter1 power:", ethers.formatEther(finalVoter1Power));
    console.log("Final voter3 power:", ethers.formatEther(finalVoter3Power));
    
    // Allow for small differences due to proposal stakes
    const voter1PowerRatio = Number(finalVoter1Power) / Number(voter1BaselinePower);
    const voter3PowerRatio = Number(finalVoter3Power) / Number(voter3BaselinePower);
    
    expect(voter1PowerRatio).to.be.closeTo(1, 0.05); // Within 5% of baseline
    expect(voter3PowerRatio).to.be.closeTo(1, 0.05); // Within 5% of baseline
  });
});