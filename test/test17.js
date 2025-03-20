const { expect } = require("chai");
const { ethers, upgrades } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");

describe("Token Holder Governance Test", function () {
  let justToken;
  let justTimelock;
  let justGovernance;
  
  let admin;
  let voter1;
  let voter2;
  let voter3;
  let recipient;
  
  // Governance parameters
  const VOTING_PERIOD = 60 * 60 * 24 * 3; // 3 days
  const TIMELOCK_MIN_DELAY = 60 * 60 * 24 * 1; // 1 day
  const PROPOSAL_THRESHOLD = ethers.parseEther("10"); // 10 tokens
  const QUORUM = ethers.parseEther("100"); // 100 tokens
  
  // Role constants
  let ADMIN_ROLE;
  let GUARDIAN_ROLE;
  let GOVERNANCE_ROLE;
  let PROPOSER_ROLE;
  let EXECUTOR_ROLE;
  
  beforeEach(async function () {
    // Get signers
    [admin, voter1, voter2, voter3, recipient] = await ethers.getSigners();
    
    console.log("Admin address:", admin.address);
    console.log("Voter1 address:", voter1.address);
    
    // Deploy JustToken
    const JustToken = await ethers.getContractFactory("contracts/JustTokenUpgradeable.sol:JustTokenUpgradeable");
    justToken = await upgrades.deployProxy(JustToken, [
      "Just Token",
      "JST",
      admin.address,
      60 * 60 * 24 * 7, // 7 days min lock
      60 * 60 * 24 * 365 // 365 days max lock
    ]);
    await justToken.waitForDeployment();
    console.log("JustToken deployed to:", await justToken.getAddress());
    
    // Deploy JustTimelock
    const JustTimelock = await ethers.getContractFactory("contracts/JustTimelockUpgradeable.sol:JustTimelockUpgradeable");
    justTimelock = await upgrades.deployProxy(JustTimelock, [
      TIMELOCK_MIN_DELAY,
      [admin.address], // Proposers
      [admin.address], // Executors
      admin.address
    ]);
    await justTimelock.waitForDeployment();
    console.log("JustTimelock deployed to:", await justTimelock.getAddress());
    
    // Deploy JustGovernance
    const JustGovernance = await ethers.getContractFactory("contracts/JustGovernanceUpgradeable.sol:JustGovernanceUpgradeable");
    justGovernance = await upgrades.deployProxy(JustGovernance, [
      "Just Governance",
      await justToken.getAddress(),
      await justTimelock.getAddress(),
      admin.address,
      PROPOSAL_THRESHOLD,
      TIMELOCK_MIN_DELAY,
      VOTING_PERIOD,
      QUORUM,
      100, // 100% refund for successful proposals
      50,  // 50% refund for cancelled proposals
      75,  // 75% refund for defeated proposals
      25   // 25% refund for expired proposals
    ]);
    await justGovernance.waitForDeployment();
    console.log("JustGovernance deployed to:", await justGovernance.getAddress());
    
    // Set up roles
    ADMIN_ROLE = await justTimelock.ADMIN_ROLE();
    GUARDIAN_ROLE = await justTimelock.GUARDIAN_ROLE();
    GOVERNANCE_ROLE = await justTimelock.GOVERNANCE_ROLE();
    PROPOSER_ROLE = await justTimelock.PROPOSER_ROLE();
    EXECUTOR_ROLE = await justTimelock.EXECUTOR_ROLE();
    
    console.log("ADMIN_ROLE:", ADMIN_ROLE);
    // In the beforeEach setup, add this line to grant PROPOSER_ROLE to the governance contract
await justTimelock.connect(admin).grantContractRole(PROPOSER_ROLE, await justGovernance.getAddress());
await justTimelock.connect(admin).grantContractRole(EXECUTOR_ROLE, await justGovernance.getAddress());
    // Configure JustToken with timelock
    // Grant additional roles to ensure token transfers work
await justToken.connect(admin).grantContractRole(GOVERNANCE_ROLE, await justTimelock.getAddress());

// Mint some tokens to the governance contract itself to transfer
await justToken.connect(admin).mint(await justGovernance.getAddress(), ethers.parseEther("20"));
    await justToken.connect(admin).setTimelock(await justTimelock.getAddress());
    
    // Grant necessary roles to governance contract
    await justToken.connect(admin).grantContractRole(GOVERNANCE_ROLE, await justGovernance.getAddress());
    await justTimelock.connect(admin).grantContractRole(GOVERNANCE_ROLE, await justGovernance.getAddress());

    // Configure JustToken with timelock
await justToken.connect(admin).setTimelock(await justTimelock.getAddress());

// Grant necessary roles to governance contract
await justToken.connect(admin).grantContractRole(GOVERNANCE_ROLE, await justGovernance.getAddress());
await justTimelock.connect(admin).grantContractRole(GOVERNANCE_ROLE, await justGovernance.getAddress());
await justTimelock.connect(admin).grantContractRole(PROPOSER_ROLE, await justGovernance.getAddress());
await justTimelock.connect(admin).grantContractRole(EXECUTOR_ROLE, await justGovernance.getAddress());
    // In beforeEach, mint tokens to the governance contract
const govAddress = await justGovernance.getAddress();
await justToken.connect(admin).mint(govAddress, ethers.parseEther("20"));
console.log(`Minted 20 JST to governance contract`);

// Check governance token balance
const govBalance = await justToken.balanceOf(govAddress);
console.log(`Governance contract token balance: ${ethers.formatEther(govBalance)} JST`);
    // Mint some tokens to test accounts
    await justToken.connect(admin).mint(voter1.address, ethers.parseEther("100"));
    await justToken.connect(admin).mint(voter2.address, ethers.parseEther("100"));
    await justToken.connect(admin).mint(voter3.address, ethers.parseEther("100"));
    await justToken.connect(admin).mint(recipient.address, ethers.parseEther("5"));
    
    // Enable voter1 to be an executor too (via token holdings or role)
    // Option 1: Set a low token threshold
    // Since we're setting the threshold to a small value, we also need to check
    // that we have the right permissions to do so
    const hasAdminRole = await justTimelock.hasRole(ADMIN_ROLE, admin.address);
    console.log(`Admin has ADMIN_ROLE in timelock: ${hasAdminRole}`);
    
    if (!hasAdminRole) {
      // If for some reason the admin doesn't have ADMIN_ROLE, get someone who does
      const adminCount = await justTimelock.getRoleMemberCount(ADMIN_ROLE);
      if (adminCount > 0) {
        const existingAdmin = await justTimelock.getRoleMember(ADMIN_ROLE, 0);
        console.log(`Using existing admin: ${existingAdmin}`);
        const existingAdminSigner = await ethers.getImpersonatedSigner(existingAdmin);
        await justTimelock.connect(existingAdminSigner).grantContractRole(ADMIN_ROLE, admin.address);
      } else {
        console.log("No admins found! Contract configuration is broken!");
      }
    }
    
    // Set JustToken address in JustTimelock
    await justTimelock.connect(admin).setJustToken(await justToken.getAddress());
    
    // Now set the executor threshold to a low value that our voters will meet
    await justTimelock.connect(admin).updateExecutorTokenThreshold(ethers.parseEther("1"));
    
    // Option 2: Or grant EXECUTOR_ROLE to voter1 (as a backup)
    // await justTimelock.connect(admin).grantContractRole(EXECUTOR_ROLE, voter1.address);
  });
  
  it("Normal token holders should be able to create a proposal", async function () {
    // Create a token transfer proposal
    const transferAmount = ethers.parseEther("10");
    const description = "Transfer tokens to recipient";
    
    // Get initial balance to check stake reduction
    const initialBalance = await justToken.balanceOf(voter1.address);
    console.log(`Initial voter1 balance: ${ethers.formatEther(initialBalance)} JST`);
    
    // Create a proposal to transfer tokens to recipient
    const tx = await justGovernance.connect(voter1).createProposal(
      description,                // description
      2,                          // ProposalType.TokenTransfer
      ethers.ZeroAddress,         // target (not used for TokenTransfer)
      "0x",                       // callData (not used for TokenTransfer)
      transferAmount,             // amount
      recipient.address,          // recipient
      ethers.ZeroAddress,         // externalToken (not used for TokenTransfer)
      0,                          // newThreshold (not used for TokenTransfer)
      0,                          // newQuorum (not used for TokenTransfer)
      0,                          // newVotingDuration (not used for TokenTransfer)
      0                           // newTimelockDelay (not used for TokenTransfer)
    );
    
    const receipt = await tx.wait();
    
    // Check balance after proposal creation to confirm stake
    const afterProposalBalance = await justToken.balanceOf(voter1.address);
    console.log(`After proposal creation voter1 balance: ${ethers.formatEther(afterProposalBalance)} JST`);
    console.log(`Staked amount: ${ethers.formatEther(initialBalance - afterProposalBalance)} JST`);
    
    // Find the proposal creation event
    const proposalEvents = receipt.logs.filter(
      log => log.fragment && log.fragment.name === 'ProposalEvent'
    );
    
    expect(proposalEvents.length).to.be.gt(0, "Proposal was not created");
    
    // Get the proposal ID from the event
    const proposalId = proposalEvents[0].args[0]; // First argument is proposalId
    console.log(`Proposal created with ID: ${proposalId}`);
    
    // Verify the proposal state is Active
    expect(await justGovernance.getProposalState(proposalId)).to.equal(0); // 0 = Active
    
    // Cast votes
    await justGovernance.connect(voter1).castVote(proposalId, 1); // Vote yes
    await justGovernance.connect(voter2).castVote(proposalId, 1); // Vote yes
    await justGovernance.connect(voter3).castVote(proposalId, 0); // Vote no
    
    // Fast forward time past the voting period
    await time.increase(VOTING_PERIOD + 1);
    
    // Verify the proposal state is Succeeded
    const proposalState = await justGovernance.getProposalState(proposalId);
    console.log(`Proposal state after voting: ${proposalState}`); // Should be 3 = Succeeded
    expect(proposalState).to.equal(3); // 3 = Succeeded
    
    try {
      // Queue the proposal for execution
      console.log("Queuing proposal...");
      const queueTx = await justGovernance.connect(voter1).queueProposal(proposalId);
      await queueTx.wait();
      
      // Verify the proposal state is Queued
      const queuedState = await justGovernance.getProposalState(proposalId);
      console.log(`Proposal state after queuing: ${queuedState}`); // Should be 4 = Queued
      expect(queuedState).to.equal(4); // 4 = Queued
      
      // Fast forward time to after timelock delay
      await time.increase(TIMELOCK_MIN_DELAY + 100);
      
      // Execute the proposal
      console.log("Executing proposal...");
      const executeTx = await justGovernance.connect(voter1).executeProposal(proposalId);
      await executeTx.wait();
      
      // Verify the proposal state is Executed
      const executedState = await justGovernance.getProposalState(proposalId);
      console.log(`Proposal state after execution: ${executedState}`); // Should be 5 = Executed
      expect(executedState).to.equal(5); // 5 = Executed
      
      // Check if recipient received tokens
      expect(await justToken.balanceOf(recipient.address)).to.equal(transferAmount + ethers.parseEther("5")); // Added to previous mint
      
      // Check if stake was refunded
      const finalBalance = await justToken.balanceOf(voter1.address);
      console.log(`Final voter1 balance: ${ethers.formatEther(finalBalance)} JST`);
      
    } catch (error) {
      console.error("Error in proposal execution:", error);
      throw error; // Re-throw to fail the test
    }
  });
  it("Should allow checking permissions explicitly", async function() {
    // Check permissions
    const hasAdminRole = await justTimelock.hasRole(ADMIN_ROLE, admin.address);
    expect(hasAdminRole).to.be.true;
    
    const govAddress = await justGovernance.getAddress();
    const hasGovRole = await justTimelock.hasRole(GOVERNANCE_ROLE, govAddress);
    expect(hasGovRole).to.be.true;
    
    // Check if voter1 can queue a transaction in timelock
    const txResponse = await justTimelock.connect(voter1).queueTransactionWithThreatLevel(
      recipient.address,  // target
      0,                  // value
      "0x"                // empty calldata
    );
    
    // Wait for the transaction to be mined
    const receipt = await txResponse.wait();
    
    // Get the transaction hash from the receipt
    // Look for QueuedTransaction event to extract the txHash
    const queuedEvents = receipt.logs.filter(
      log => log.fragment && log.fragment.name === 'TransactionQueued'
    );
    
    expect(queuedEvents.length).to.be.gt(0, "Transaction was not queued");
    const txHash = queuedEvents[0].args[0]; // First argument should be txHash
    
    console.log("Transaction queued successfully with hash:", txHash);
    
    // Fast forward time
    await time.increase(TIMELOCK_MIN_DELAY + 100);
    
    // Execute directly with voter1
    const executeTx = await justTimelock.connect(voter1).executeTransaction(txHash);
    await executeTx.wait();
    console.log("Transaction executed successfully");
  });
});