const { ethers, upgrades } = require("hardhat");
const { expect } = require("chai");
const { parseEther, formatEther, ZeroAddress } = ethers;

describe("Indiana Legal Aid DAO Test Suite", function () {
  // Test constants
  const ONE_DAY = 86400; // seconds in a day
  const SEVEN_DAYS = ONE_DAY * 7;
  const FOURTEEN_DAYS = ONE_DAY * 14;
  const THIRTY_DAYS = ONE_DAY * 30;
  const ZERO_ADDRESS = ZeroAddress;

  // Token constants
  const TOKEN_NAME = "JUST Token";
  const TOKEN_SYMBOL = "JST";
  const MAX_SUPPLY = parseEther("1000000"); // 1 million tokens
  const INITIAL_MINT = parseEther("1"); // 1 token
  const MIN_LOCK_DURATION = ONE_DAY; // 1 day
  const MAX_LOCK_DURATION = THIRTY_DAYS; // 30 days

  // Governance constants
  const DEFAULT_VOTING_DURATION = SEVEN_DAYS;
  const DEFAULT_QUORUM = parseEther("1"); // 1 token
  const DEFAULT_TIMELOCK_DELAY = 2 * ONE_DAY; // 2 days
  const DEFAULT_PROPOSAL_THRESHOLD = parseEther("0.1"); // 0.1 token
  const DEFAULT_PROPOSAL_STAKE = parseEther("0.01"); // 0.01 token
  const DEFAULT_PARTIAL_REFUND_PERCENTAGE = 50; // 50%

  // Roles (computed dynamically in beforeEach)
  let ADMIN_ROLE;
  let GUARDIAN_ROLE;
  let GOVERNANCE_ROLE;
  let MINTER_ROLE;
  let PROPOSER_ROLE;
  let EXECUTOR_ROLE;
  let CANCELLER_ROLE;

  // Contract instances
  let justToken;
  let justTimelock;
  let justGovernance;

  // Signers
  let deployer;
  let admin;
  let guardian;
  let governance;
  let user1;
  let user2;
  let user3;
  let user4;
  let users;

  // Proposal types (mapped to enum values)
  const ProposalType = {
    General: 0,
    Withdrawal: 1,
    TokenTransfer: 2,
    GovernanceChange: 3,
    ExternalERC20Transfer: 4,
    TokenMint: 5,
    TokenBurn: 6
  };

  // Vote types
  const VoteType = {
    Against: 0,
    For: 1,
    Abstain: 2
  };

  // Proposal states
  const ProposalState = {
    Active: 0,
    Canceled: 1,
    Defeated: 2,
    Succeeded: 3,
    Queued: 4,
    Executed: 5,
    Expired: 6
  };

  // Helper function to compute role hash
  function getRoleHash(role) {
    return ethers.keccak256(ethers.toUtf8Bytes(role));
  }

  // Helper function to advance blockchain time
  async function advanceTime(seconds) {
    await ethers.provider.send("evm_increaseTime", [seconds]);
    await ethers.provider.send("evm_mine");
  }
  
  // Helper to find event by name in transaction receipt
  function findEvent(receipt, contract, eventName) {
    for (const log of receipt.logs) {
      try {
        const parsedLog = contract.interface.parseLog({ 
          data: log.data, 
          topics: log.topics 
        });
        
        if (parsedLog && parsedLog.name === eventName) {
          return parsedLog;
        }
      } catch (e) {
        // Not this event, continue
      }
    }
    return null;
  }

  // Helper function to create a basic proposal of specified type
  async function createBasicProposal(type, options = {}) {
    const description = options.description || "Test proposal";
    const amount = options.amount || parseEther("0.1");
    const recipient = options.recipient || user1.address;
    const externalToken = options.externalToken || ZERO_ADDRESS;
    
    // Set up defaults for governance change
    const newThreshold = options.newThreshold || 0;
    const newQuorum = options.newQuorum || 0;
    const newVotingDuration = options.newVotingDuration || 0;
    const newTimelockDelay = options.newTimelockDelay || 0;
    
    // Set up defaults for general proposal
    const target = options.target || justToken.target;
    const callData = options.callData || "0x";

    const tx = await justGovernance.connect(user1).createProposal(
      description,
      type,
      target,
      callData,
      amount,
      recipient,
      externalToken,
      newThreshold,
      newQuorum,
      newVotingDuration,
      newTimelockDelay
    );

    const receipt = await tx.wait();
    
    // Find proposal ID from events
    // In ethers v6, we need to look for the ProposalEvent
    let proposalId = null;
    
    for (const log of receipt.logs) {
      try {
        const parsedLog = justGovernance.interface.parseLog({ 
          data: log.data, 
          topics: log.topics 
        });
        
        if (parsedLog && parsedLog.name === "ProposalEvent") {
          proposalId = parsedLog.args[0]; // proposalId is the first indexed parameter
          break;
        }
      } catch (e) {
        // Not this event, continue
      }
    }

    if (proposalId === null) {
      throw new Error("Proposal creation event not found");
    }

    return proposalId;
  }

  // Helper function to vote on a proposal and advance to completion
  async function voteAndCompleteProposal(proposalId, voteType = VoteType.For, voters = [user1, user2, user3]) {
    // Cast votes
    for (const voter of voters) {
      const voteTx = await justGovernance.connect(voter).castVote(proposalId, voteType);
      await voteTx.wait();
      
      // Check if the voter has voting power via proposalVoterInfo mapping directly
      const votingPower = await justGovernance.proposalVoterInfo(proposalId, voter.address);
      if (votingPower === 0n) {
        console.warn(`Warning: Vote for ${voter.address} may not have been recorded`);
      }
    }

    // Advance time to end voting period
    await advanceTime(SEVEN_DAYS + 60); // Add a minute for buffer
    
    return proposalId;
  }

  // Helper function to fully process a proposal through to execution
  async function processProposalToExecution(proposalId) {
    // Vote on the proposal
    await voteAndCompleteProposal(proposalId);
    
    // Queue the proposal
    const queueTx = await justGovernance.connect(user1).queueProposal(proposalId);
    await queueTx.wait();
    
    // Verify proposal is queued
    const state = await justGovernance.getProposalState(proposalId);
    if (state !== ProposalState.Queued) {
      console.warn(`Warning: Proposal ${proposalId} state is ${state}, expected ${ProposalState.Queued}`);
    }
    
    // Advance time past the timelock delay
    await advanceTime(DEFAULT_TIMELOCK_DELAY + 60); // Add a minute for buffer
    
    try {
      // Execute the proposal
      const executeTx = await justGovernance.connect(user1).executeProposal(proposalId);
      const receipt = await executeTx.wait();
      console.log(`Execution successful: ${receipt.hash}`);
    } catch (error) {
      console.error(`Execution failed: ${error.message}`);
      throw error; // Re-throw to fail the test
    }
    
    return proposalId;
  }

  beforeEach(async function () {
    // Get signers
    [deployer, admin, guardian, governance, user1, user2, user3, user4, ...users] = await ethers.getSigners();

    // Compute role hashes
    ADMIN_ROLE = getRoleHash("ADMIN_ROLE");
    GUARDIAN_ROLE = getRoleHash("GUARDIAN_ROLE");
    GOVERNANCE_ROLE = getRoleHash("GOVERNANCE_ROLE");
    MINTER_ROLE = getRoleHash("MINTER_ROLE");
    PROPOSER_ROLE = getRoleHash("PROPOSER_ROLE");
    EXECUTOR_ROLE = getRoleHash("EXECUTOR_ROLE");
    CANCELLER_ROLE = getRoleHash("CANCELLER_ROLE");
    const DEFAULT_ADMIN_ROLE = ethers.ZeroHash; // This is the DEFAULT_ADMIN_ROLE in OpenZeppelin's AccessControl

    // Deploy JustTokenUpgradeable contract
    const JustTokenFactory = await ethers.getContractFactory("contracts/JustTokenUpgradeable.sol:JustTokenUpgradeable");
    const JustTokenProxy = await upgrades.deployProxy(
      JustTokenFactory,
      [TOKEN_NAME, TOKEN_SYMBOL, admin.address, MIN_LOCK_DURATION, MAX_LOCK_DURATION],
      { initializer: "initialize" }
    );
    justToken = await JustTokenProxy.waitForDeployment();
    
    // Deploy JustTimelockUpgradeable contract
    const JustTimelockFactory = await ethers.getContractFactory("contracts/JustTimelockUpgradeable.sol:JustTimelockUpgradeable");
    const JustTimelockProxy = await upgrades.deployProxy(
      JustTimelockFactory,
      [DEFAULT_TIMELOCK_DELAY, [admin.address], [admin.address], admin.address],
      { initializer: "initialize" }
    );
    justTimelock = await JustTimelockProxy.waitForDeployment();
    
    // Deploy JustGovernanceUpgradeable contract
    const JustGovernanceFactory = await ethers.getContractFactory("contracts/JustGovernanceUpgradeable.sol:JustGovernanceUpgradeable");
    const JustGovernanceProxy = await upgrades.deployProxy(
      JustGovernanceFactory,
      [
        TOKEN_NAME, // name
        justToken.target, // tokenAddress
        justTimelock.target, // timelockAddress
        admin.address, // admin
        DEFAULT_PROPOSAL_THRESHOLD, // proposalThreshold
        DEFAULT_TIMELOCK_DELAY, // votingDelay
        DEFAULT_VOTING_DURATION, // votingPeriod
        DEFAULT_QUORUM, // quorumNumerator
        100, // successfulRefund
        50, // cancelledRefund
        DEFAULT_PARTIAL_REFUND_PERCENTAGE, // defeatedRefund
        50 // expiredRefund
      ],
      { initializer: "initialize" }
    );
    justGovernance = await JustGovernanceProxy.waitForDeployment();
    
    // Set up roles and permissions
    console.log("Setting up roles and permissions...");
    
    // 1. Configure JustTokenUpgradeable Permissions
    // Grant DEFAULT_ADMIN_ROLE only to Timelock - NOT to Governance
    await justToken.connect(admin).grantRole(DEFAULT_ADMIN_ROLE, justTimelock.target);
    
    // Grant ADMIN_ROLE to Timelock and Governance contracts
    await justToken.connect(admin).grantRole(ADMIN_ROLE, justTimelock.target);
    await justToken.connect(admin).grantRole(ADMIN_ROLE, justGovernance.target);
    
    // Grant GOVERNANCE_ROLE to JustGovernance contract and the governance account for tests
    await justToken.connect(admin).grantRole(GOVERNANCE_ROLE, justGovernance.target);
    await justToken.connect(admin).grantRole(GOVERNANCE_ROLE, governance.address);
    
    // Grant MINTER_ROLE to both timelock and governance contracts
    await justToken.connect(admin).grantRole(MINTER_ROLE, justTimelock.target);
    await justToken.connect(admin).grantRole(MINTER_ROLE, justGovernance.target);
    await justToken.connect(admin).grantRole(GOVERNANCE_ROLE, justTimelock.target);
    
    // 2. Configure JustTimelock Permissions
    // Grant necessary roles to governance contract in timelock
    await justTimelock.connect(admin).grantRole(PROPOSER_ROLE, justGovernance.target);
    await justTimelock.connect(admin).grantRole(EXECUTOR_ROLE, justGovernance.target);
    await justTimelock.connect(admin).grantRole(CANCELLER_ROLE, justGovernance.target);
    
    // Also grant roles to admin for testing purposes
    await justTimelock.connect(admin).grantRole(PROPOSER_ROLE, admin.address);
    await justTimelock.connect(admin).grantRole(EXECUTOR_ROLE, admin.address);
    
    // 3. Configure JustGovernance Permissions
    // Make sure guardian has GUARDIAN_ROLE in JustGovernance
    await justGovernance.connect(admin).grantRole(GUARDIAN_ROLE, guardian.address);
    
    // Grant PROPOSER_ROLE to test users for creating proposals
    for (const user of [user1, user2, user3, user4]) {
      await justGovernance.connect(admin).grantRole(PROPOSER_ROLE, user.address);
    }
    
    // 4. Configure Allowed Targets for Governance Proposals
    // Allow token as a target for proposals
    await justGovernance.connect(admin).updateSecurity(
      "0x00000000", // No selector change
      false,
      justToken.target,
      true // Allow token as target
    );
    
    // Allow governance itself as a target
    await justGovernance.connect(admin).updateSecurity(
      "0x00000000", // No selector change
      false,
      justGovernance.target,
      true // Allow governance as target
    );
    
    // Allow timelock as a target
    await justGovernance.connect(admin).updateSecurity(
      "0x00000000", // No selector change
      false,
      justTimelock.target,
      true // Allow timelock as target
    );
    
    // Allow function selectors
    await authorizeCommonFunctions();
    
    // Mint tokens to users for testing
    const mintAmount = parseEther("10"); // 10 tokens per user
    
    for (const user of [user1, user2, user3, user4]) {
      await justToken.connect(admin).mint(user.address, mintAmount);
    }
    
    // Mint some tokens to governance contract for token transfer tests
    await justToken.connect(admin).mint(justGovernance.target, parseEther("10"));
    
    // Approve governance contract to spend tokens for proposal creation
    for (const user of [user1, user2, user3, user4]) {
      await justToken.connect(user).approve(justGovernance.target, ethers.MaxUint256);
    }
    
    console.log("Setup complete.");
  });
  
  // Helper to authorize all common functions
  async function authorizeCommonFunctions() {
    // Get relevant function selectors 
    const selectors = [
      // Common ERC20 functions
      justToken.interface.getFunction("transfer").selector,
      justToken.interface.getFunction("approve").selector,
      justToken.interface.getFunction("mint").selector,
      justToken.interface.getFunction("burnTokens").selector,
      
      // Governance functions
      justToken.interface.getFunction("setMaxTokenSupply").selector,
      justToken.interface.getFunction("delegate").selector,
      
      // Admin functions
      justToken.interface.getFunction("pause").selector,
      justToken.interface.getFunction("unpause").selector,
      
      // Add any other function selectors we might use in tests
      justToken.interface.getFunction("governanceMint").selector,
      justToken.interface.getFunction("governanceBurn").selector,
      justToken.interface.getFunction("governanceTransfer").selector
    ];
    
    console.log("Authorizing function selectors:");
    for (const selector of selectors) {
      console.log(`  - ${selector}`);
      await justGovernance.connect(admin).updateSecurity(
        selector,
        true, // Allow this selector
        "0x0000000000000000000000000000000000000000", // No target change
        false
      );
    }
    
    console.log("All functions authorized.");
  }

  describe("Deployment and Setup", function () {
    it("Should deploy contracts with correct initialization", async function () {
      // Check token details
      expect(await justToken.name()).to.equal(TOKEN_NAME);
      expect(await justToken.symbol()).to.equal(TOKEN_SYMBOL);
      expect(await justToken.maxTokenSupply()).to.equal(MAX_SUPPLY);
    
      // Check governance parameters
      expect(await justGovernance.minVotingDuration()).to.equal(600); // Contract has 600 seconds as min duration
      
      // Update test to expect 365 days for maxVotingDuration
      const YEAR_IN_SECONDS = 365 * 24 * 60 * 60; // 365 days in seconds
      expect(await justGovernance.maxVotingDuration()).to.equal(YEAR_IN_SECONDS);
      
      // Check timelock parameters
      expect(await justTimelock.minDelay()).to.equal(DEFAULT_TIMELOCK_DELAY);
      
      // Check role assignments
      expect(await justToken.hasRole(ADMIN_ROLE, admin.address)).to.be.true;
      expect(await justToken.hasRole(GOVERNANCE_ROLE, admin.address)).to.be.true; // Admin has governance role
      expect(await justTimelock.hasRole(ADMIN_ROLE, admin.address)).to.be.true;
      expect(await justTimelock.hasRole(PROPOSER_ROLE, justGovernance.target)).to.be.true;
      expect(await justTimelock.hasRole(EXECUTOR_ROLE, justGovernance.target)).to.be.true;
      expect(await justGovernance.hasRole(ADMIN_ROLE, admin.address)).to.be.true;
    });
    
    it("Should have the right token balances for users", async function () {
      const expectedBalance = parseEther("10"); // 10 tokens per user
      
      expect(await justToken.balanceOf(user1.address)).to.equal(expectedBalance);
      expect(await justToken.balanceOf(user2.address)).to.equal(expectedBalance);
      expect(await justToken.balanceOf(user3.address)).to.equal(expectedBalance);
      expect(await justToken.balanceOf(user4.address)).to.equal(expectedBalance);
    });
  });

  describe("Token Delegation", function () {
    it("Should allow delegation to another address", async function () {
      // Initial state - no delegation or self-delegation
      // Note: The contract doesn't initialize with self-delegation for all users
      
      // User1 delegates to User2
      await justToken.connect(user1).delegate(user2.address);
      
      // Check delegation is properly recorded
      expect(await justToken.getDelegate(user1.address)).to.equal(user2.address);
      
      // Check delegated votes are properly tracked
      expect(await justToken.getCurrentDelegatedVotes(user2.address)).to.equal(parseEther("10"));
    });
    
    it("Should correctly handle self-delegation", async function () {
      console.log("--- Starting self-delegation test ---");
      console.log(`User1 address: ${user1.address}`);
      console.log(`User2 address: ${user2.address}`);
      
      // Log initial state
      const initialUser1Balance = await justToken.balanceOf(user1.address);
      const initialUser2Balance = await justToken.balanceOf(user2.address);
      console.log(`Initial balances - User1: ${ethers.formatEther(initialUser1Balance)} ETH, User2: ${ethers.formatEther(initialUser2Balance)} ETH`);
      
      // User1 delegates to User2
      console.log("User1 delegating to User2...");
      await justToken.connect(user1).delegate(user2.address);
      
      // Check initial delegated votes
      const user2DelegatedVotes = await justToken.getCurrentDelegatedVotes(user2.address);
      console.log(`User2 delegated votes after User1's delegation: ${ethers.formatEther(user2DelegatedVotes)} ETH`);
      expect(user2DelegatedVotes).to.equal(parseEther("10"));
      
      // Now User1 self-delegates
      console.log("User1 self-delegating...");
      await justToken.connect(user1).delegate(user1.address);
      
      // Verify User2 no longer has User1's delegated votes
      const user2DelegatedVotesAfter = await justToken.getCurrentDelegatedVotes(user2.address);
      console.log(`User2 delegated votes after User1's self-delegation: ${ethers.formatEther(user2DelegatedVotesAfter)} ETH`);
      expect(user2DelegatedVotesAfter).to.equal(parseEther("0"));
      
      // Updated expectation: Self-delegated tokens are counted as delegated votes
      const user1DelegatedVotes = await justToken.getCurrentDelegatedVotes(user1.address);
      console.log(`User1 delegated votes after self-delegation: ${ethers.formatEther(user1DelegatedVotes)} ETH`);
      expect(user1DelegatedVotes).to.equal(parseEther("10"));
      
      // Create a snapshot to check voting power
      console.log("Creating voting snapshot...");
      const tx = await justToken.connect(governance).createSnapshot();
      const receipt = await tx.wait();
      const snapshotEvent = findEvent(receipt, justToken, "SnapshotCreated");
      const snapshotId = snapshotEvent.args[0];
      console.log(`Created snapshot with ID: ${snapshotId.toString()}`);
      
      // Verify effective voting power is correct
      const effectiveVotingPower = await justToken.getEffectiveVotingPower(user1.address, snapshotId);
      console.log(`User1 effective voting power in snapshot: ${ethers.formatEther(effectiveVotingPower)} ETH`);
      expect(effectiveVotingPower).to.equal(parseEther("10"));
      
      console.log("--- Self-delegation test completed successfully ---");
    });
    it("Should calculate effective voting power correctly", async function () {
      console.log("--- Starting delegation test ---");
      
      // First self-delegate for all users to establish baseline
      await justToken.connect(user1).delegate(user1.address);
      await justToken.connect(user2).delegate(user2.address);
      await justToken.connect(user3).delegate(user3.address);
      
      console.log("Initial balances:");
      const user1Balance = await justToken.balanceOf(user1.address);
      const user2Balance = await justToken.balanceOf(user2.address);
      const user3Balance = await justToken.balanceOf(user3.address);
      console.log("User1 balance:", user1Balance.toString());
      console.log("User2 balance:", user2Balance.toString());
      console.log("User3 balance:", user3Balance.toString());
      
      // Create a snapshot first
      const tx = await justToken.connect(governance).createSnapshot();
      const receipt = await tx.wait();
      const snapshotEvent = findEvent(receipt, justToken, "SnapshotCreated");
      const snapshotId = snapshotEvent.args[0]; // first indexed parameter
      console.log("First snapshot ID:", snapshotId.toString());
      
      // Case 1: Self-delegation
      const user1InitialPower = await justToken.getEffectiveVotingPower(user1.address, snapshotId);
      console.log("User1 initial voting power:", user1InitialPower.toString());
      expect(user1InitialPower).to.equal(user1Balance);
      
      // Case 2: User1 delegates to User2
      console.log("User1 now delegating to User2...");
      await justToken.connect(user1).delegate(user2.address);
      
      // Log current delegated votes before taking snapshot
      const currentDelegatedUser2 = await justToken.getCurrentDelegatedVotes(user2.address);
      console.log("Current delegated votes for User2:", currentDelegatedUser2.toString());
      
      // Get User2's current delegate
      const user2Delegate = await justToken.getDelegate(user2.address);
      console.log("User2's delegate:", user2Delegate);
      
      // Get User1's current delegate
      const user1Delegate = await justToken.getDelegate(user1.address);
      console.log("User1's delegate:", user1Delegate);
      
      // Create another snapshot
      const tx2 = await justToken.connect(governance).createSnapshot();
      const receipt2 = await tx2.wait();
      const snapshotEvent2 = findEvent(receipt2, justToken, "SnapshotCreated");
      const snapshotId2 = snapshotEvent2.args[0]; // first indexed parameter
      console.log("Second snapshot ID:", snapshotId2.toString());
      
      // Wait a moment to ensure delegation is processed
      await network.provider.send("evm_mine");
      
      // User1 should have 0 effective voting power because delegated
      const user1PowerAfterDelegating = await justToken.getEffectiveVotingPower(user1.address, snapshotId2);
      console.log("User1 power after delegating:", user1PowerAfterDelegating.toString());
      expect(user1PowerAfterDelegating).to.equal(parseEther("0"));
      
      // User2 should have increased voting power from delegation
      const user2Power = await justToken.getEffectiveVotingPower(user2.address, snapshotId2);
      console.log("User2 power after User1 delegates:", user2Power.toString());
      
      // Check the delegation data at snapshot
      const user2DelegatedAtSnapshot = await justToken.getDelegatedToAddressAtSnapshot(user2.address, snapshotId2);
      console.log("User2 delegated tokens at snapshot:", user2DelegatedAtSnapshot.toString());
      
      // Get User1's locked tokens
      const user1LockedTokens = await justToken.getLockedTokens(user1.address);
      console.log("User1 locked tokens:", user1LockedTokens.toString());
      
      // Use BigInt operations instead of .add method
      // Convert to BigInt if they're not already
      const user2BalanceBigInt = BigInt(user2Balance.toString());
      const user1BalanceBigInt = BigInt(user1Balance.toString());
      const expectedUser2Power = user2BalanceBigInt + user1BalanceBigInt;
      
      console.log("Expected User2 power:", expectedUser2Power.toString());
      expect(user2Power).to.equal(expectedUser2Power);
      
      // Case 3: Multiple delegations
      console.log("User3 now delegating to User2...");
      await justToken.connect(user3).delegate(user2.address);
      
      // Log current delegated votes before taking snapshot
      const currentDelegatedUser2AfterUser3 = await justToken.getCurrentDelegatedVotes(user2.address);
      console.log("Current delegated votes for User2 after User3 delegation:", 
        currentDelegatedUser2AfterUser3.toString());
      
      // Create another snapshot
      const tx3 = await justToken.connect(governance).createSnapshot();
      const receipt3 = await tx3.wait();
      const snapshotEvent3 = findEvent(receipt3, justToken, "SnapshotCreated");
      const snapshotId3 = snapshotEvent3.args[0]; // first indexed parameter
      console.log("Third snapshot ID:", snapshotId3.toString());
      
      // Wait a moment to ensure delegation is processed
      await network.provider.send("evm_mine");
      
      // User2 should have increased voting power from both delegations
      const user2PowerAfterBoth = await justToken.getEffectiveVotingPower(user2.address, snapshotId3);
      console.log("User2 power after both delegations:", user2PowerAfterBoth.toString());
      
      // Use BigInt operations for all three balances
      const user3BalanceBigInt = BigInt(user3Balance.toString());
      const expectedUser2PowerAfterBoth = user2BalanceBigInt + user1BalanceBigInt + user3BalanceBigInt;
      
      console.log("Expected User2 power after both:", expectedUser2PowerAfterBoth.toString());
      expect(user2PowerAfterBoth).to.equal(expectedUser2PowerAfterBoth);
      
      console.log("--- Delegation test complete ---");
    });
  });


  // Governance tests
  describe("Governance Proposal Lifecycle", function () {
    let proposalId;
    
    beforeEach(async function () {
      // Create a basic proposal for tests
      proposalId = await createBasicProposal(ProposalType.TokenTransfer, {
        amount: parseEther("1"),
        recipient: user2.address,
        description: "Transfer tokens to user2"
      });
    });
    
    it("Should create and retrieve proposal correctly", async function () {
      // Check proposal exists and is in active state
      expect(await justGovernance.getProposalState(proposalId)).to.equal(ProposalState.Active);
    });
    
    it("Should allow voting and change proposal state", async function () {
      // User1 votes for the proposal
      await justGovernance.connect(user1).castVote(proposalId, VoteType.For);
      
      // User2 votes for the proposal
      await justGovernance.connect(user2).castVote(proposalId, VoteType.For);
      
      // User3 votes for the proposal
      await justGovernance.connect(user3).castVote(proposalId, VoteType.For);
      
      // Advance time to end voting period
      await advanceTime(SEVEN_DAYS + 60); // Add a minute for buffer
      
      // Check proposal is in Succeeded state
      expect(await justGovernance.getProposalState(proposalId)).to.equal(ProposalState.Succeeded);
    });
    
    it("Should allow queueing a succeeded proposal", async function () {
      // Vote and complete proposal
      await voteAndCompleteProposal(proposalId);
      
      // Queue the proposal
      await justGovernance.connect(user1).queueProposal(proposalId);
      
      // Check proposal is in Queued state
      expect(await justGovernance.getProposalState(proposalId)).to.equal(ProposalState.Queued);
    });
    
    it("Should allow executing a queued proposal", async function () {
      // Process proposal to execution
      await processProposalToExecution(proposalId);
      
      // Check proposal is in Executed state
      expect(await justGovernance.getProposalState(proposalId)).to.equal(ProposalState.Executed);
    });
    it("Should allow voting with delegated voting power", async function () {
      // First make sure User4 has properly set up self-delegation
      await justToken.connect(user4).delegate(user4.address);
      
      // Get User4's initial balance (this is their own voting power)
      const user4InitialBalance = await justToken.balanceOf(user4.address);
      console.log("User4 initial balance:", user4InitialBalance.toString());
      
      // User3 delegates to User4 BEFORE creating the proposal
      await justToken.connect(user3).delegate(user4.address);
      
      // Get User3's balance (this is the power being delegated)
      const user3Balance = await justToken.balanceOf(user3.address);
      console.log("User3 balance:", user3Balance.toString());
      
      // Verify delegation is correct - User4 should have their own tokens plus User3's tokens
      const currentDelegatedVotes = await justToken.getCurrentDelegatedVotes(user4.address);
      console.log("Total delegated votes to User4:", currentDelegatedVotes.toString());
      
      // Convert balances to BigInt for addition
      const user4BalanceBigInt = BigInt(user4InitialBalance.toString());
      const user3BalanceBigInt = BigInt(user3Balance.toString());
      
      // Calculate expected total using BigInt addition
      const expectedTotalDelegatedVotes = user4BalanceBigInt + user3BalanceBigInt;
      console.log("Expected total votes:", expectedTotalDelegatedVotes.toString());
      
      // Create a proposal AFTER delegation is set up
      const newProposalId = await createBasicProposal(ProposalType.TokenTransfer, {
        amount: parseEther("1"),
        recipient: user2.address,
        description: "Transfer tokens to user2"
      });
      
      // User4 votes with combined voting power
      await justGovernance.connect(user4).castVote(newProposalId, VoteType.For);
      
      // For debugging - check what proposalVoterInfo shows
      const proposalVoterInfo = await justGovernance.proposalVoterInfo(newProposalId, user4.address);
      console.log("Recorded voter info:", proposalVoterInfo.toString());
      
      // The test still fails at this point, which tells us we have a contract issue
      expect(proposalVoterInfo.toString()).to.equal(expectedTotalDelegatedVotes.toString());
    });
    
    it("Should prevent double voting", async function () {
      // User1 votes
      await justGovernance.connect(user1).castVote(proposalId, VoteType.For);
      
      // Try to vote again
      await expect(
        justGovernance.connect(user1).castVote(proposalId, VoteType.Against)
      ).to.be.revertedWithCustomError(justGovernance, "AlreadyVoted");
    });
    
    it("Should prevent voting after deadline", async function () {
      // Advance time past the voting period
      await advanceTime(SEVEN_DAYS + 60); // Add a minute for buffer
      
      // Try to vote
      await expect(
        justGovernance.connect(user1).castVote(proposalId, VoteType.For)
      ).to.be.revertedWithCustomError(justGovernance, "VotingEnded");
    });
  });

  describe("Proposal Cancellation", function () {
    it("Should allow proposer to cancel their proposal", async function () {
      // Create proposal
      const proposalId = await createBasicProposal(ProposalType.TokenTransfer, {
        amount: parseEther("1"),
        recipient: user2.address,
        description: "Transfer tokens"
      });
      
      // Cancel as guardian
      await justGovernance.connect(guardian).cancelProposal(proposalId);
      
      // Check state
      expect(await justGovernance.getProposalState(proposalId)).to.equal(ProposalState.Canceled);
    });
  });

  describe("Emergency Functions", function () {
    it("Should allow guardian to pause governance", async function () {
      // Check initial state
      expect(await justGovernance.paused()).to.be.false;
      
      // Pause as guardian
      await justGovernance.connect(guardian).pause();
      
      // Check paused state
      expect(await justGovernance.paused()).to.be.true;
      
      // Try to create a proposal - should fail
      await expect(
        createBasicProposal(ProposalType.TokenTransfer, {
          amount: parseEther("1"),
          recipient: user2.address
        })
      ).to.be.reverted; // with some pause-related error
      
      // Unpause as admin
      await justGovernance.connect(admin).unpause();
      
      // Check unpaused state
      expect(await justGovernance.paused()).to.be.false;
    });
  });

  describe("Role Management", function () {
    it("Should allow admin to grant roles", async function () {
      // Grant GUARDIAN_ROLE to user4
      await justGovernance.connect(admin).grantContractRole(GUARDIAN_ROLE, user4.address);
      
      // Check role was granted
      expect(await justGovernance.hasRole(GUARDIAN_ROLE, user4.address)).to.be.true;
    });
    
    it("Should allow admin to revoke roles", async function () {
      // First grant a role
      await justGovernance.connect(admin).grantContractRole(GUARDIAN_ROLE, user4.address);
      
      // Then revoke it
      await justGovernance.connect(admin).revokeContractRole(GUARDIAN_ROLE, user4.address);
      
      // Check role was revoked
      expect(await justGovernance.hasRole(GUARDIAN_ROLE, user4.address)).to.be.false;
    });
    
    it("Should prevent revoking the last admin role", async function () {
      // Try to revoke the only admin role
      await expect(
        justGovernance.connect(admin).revokeContractRole(ADMIN_ROLE, admin.address)
      ).to.be.revertedWithCustomError(justGovernance, "LastAdminRole");
    });
  });
  
  describe("Governance Parameter Management", function() {
    it("Should allow admin to update governance parameters", async function() {
      const newVotingDuration = FOURTEEN_DAYS;
      const newQuorum = parseEther("2");
      
      // Update voting duration parameter
      await justGovernance.connect(admin).updateGovParam(0, newVotingDuration); // 0 is PARAM_VOTING_DURATION
      
      // Update quorum parameter
      await justGovernance.connect(admin).updateGovParam(1, newQuorum); // 1 is PARAM_QUORUM
      
      // Get governance parameters
      const govParams = await justGovernance.govParams();
      
      // Check parameters were updated
      expect(govParams.votingDuration).to.equal(newVotingDuration);
      expect(govParams.quorum).to.equal(newQuorum);
    });
    
    it("Should enforce parameter constraints", async function() {
      // Time constants in seconds
      const ONE_DAY = 86400;
      const ONE_YEAR = ONE_DAY * 365;
      
      // Log current values for debugging
      console.log("Current minVotingDuration:", await justGovernance.minVotingDuration());
      console.log("Current maxVotingDuration:", await justGovernance.maxVotingDuration());
      
      // Try to set invalid voting duration (too short)
      // Using 0 directly as PARAM_VOTING_DURATION
      await expect(
        justGovernance.connect(admin).updateGovParam(0, 100) // 100 seconds is too short (min is 600)
      ).to.be.revertedWithCustomError(justGovernance, "InvalidDuration");
      
      // Try to set invalid voting duration (too long)
      // Since max is 365 days, use a value larger than that
      const tooLong = ONE_YEAR + ONE_DAY; // 366 days should exceed max
      console.log("Testing too long duration:", tooLong);
      
      await expect(
        justGovernance.connect(admin).updateGovParam(0, tooLong) // 0 is PARAM_VOTING_DURATION
      ).to.be.revertedWithCustomError(justGovernance, "InvalidDuration");
      
      // Try to set invalid refund percentage
      // Using 5 directly as PARAM_DEFEATED_REFUND_PERCENTAGE 
      await expect(
        justGovernance.connect(admin).updateGovParam(5, 101) // Should not exceed 100%
      ).to.be.revertedWithCustomError(justGovernance, "InvalidPercentage");
      
      // Verify valid parameter update works
      const newVotingDuration = 1200; // Valid value
      await justGovernance.connect(admin).updateGovParam(0, newVotingDuration); // 0 is PARAM_VOTING_DURATION
      const govParams = await justGovernance.govParams();
      expect(govParams.votingDuration).to.equal(newVotingDuration);
    });
  });
  
  describe("Token Operations via Governance", function() {
    it("Should allow token minting via governance proposal", async function() {
      // Get initial balance
      const initialBalance = await justToken.balanceOf(user4.address);
      
      // Create a token mint proposal
      const proposalId = await createBasicProposal(ProposalType.TokenMint, {
        amount: parseEther("5"),
        recipient: user4.address,
        description: "Mint tokens to user4"
      });
      
      // Process through to execution
      await processProposalToExecution(proposalId);
      
      // Check user4's balance increased
      const finalBalance = await justToken.balanceOf(user4.address);
      expect(finalBalance).to.equal(initialBalance + parseEther("5"));
    });
    
    it("Should allow token burning via governance proposal", async function() {
      // Get initial balance
      const initialBalance = await justToken.balanceOf(user1.address);
      
      // Create a token burn proposal
      const proposalId = await createBasicProposal(ProposalType.TokenBurn, {
        amount: parseEther("2"),
        recipient: user1.address, // The account to burn from
        description: "Burn tokens from user1"
      });
      
      // Process through to execution
      await processProposalToExecution(proposalId);
      
      // Check user1's balance decreased
      const finalBalance = await justToken.balanceOf(user1.address);
      expect(finalBalance).to.equal(initialBalance - parseEther("2"));
    });
  });
  
  describe("Proposal Stake Management", function() {
    it("Should refund stake when proposal is executed", async function() {
      // Get initial balance
      const initialBalance = await justToken.balanceOf(user1.address);
      
      // Create a proposal
      const proposalId = await createBasicProposal(ProposalType.TokenTransfer, {
        amount: parseEther("1"),
        recipient: user2.address,
        description: "Transfer tokens to user2"
      });
      
      // Process through to execution
      await processProposalToExecution(proposalId);
      
      // Check user1's balance is restored (minus the proposal execution)
      const finalBalance = await justToken.balanceOf(user1.address);
      
      // The balance should be the initial balance minus 1 ETH transferred in the proposal
      // but plus the stake that was refunded
      expect(finalBalance).to.equal(initialBalance);
    });
  });

  // Test updating and using the new refund percentage parameters
  describe("Refund Percentage Parameters", function() {
    // Parameter type constants as defined in the contract
    const PARAM_DEFEATED_REFUND_PERCENTAGE = 5;
    const PARAM_CANCELED_REFUND_PERCENTAGE = 6;
    const PARAM_EXPIRED_REFUND_PERCENTAGE = 7;
    
    it("Should update refund percentage parameters", async function() {
      // Get the admin account
      const adminAccount = await ethers.getSigners().then(signers => signers[1]);
      
      // Check initial values
      const initialParams = await justGovernance.govParams();
      console.log(`Initial defeated refund percentage: ${initialParams.defeatedRefundPercentage}%`);
      console.log(`Initial canceled refund percentage: ${initialParams.canceledRefundPercentage}%`);
      console.log(`Initial expired refund percentage: ${initialParams.expiredRefundPercentage}%`);
      
      // Update the defeated refund percentage to 60%
      let tx = await justGovernance.connect(adminAccount).updateGovParam(PARAM_DEFEATED_REFUND_PERCENTAGE, 60);
      await tx.wait();
      
      // Update the canceled refund percentage to 80%
      tx = await justGovernance.connect(adminAccount).updateGovParam(PARAM_CANCELED_REFUND_PERCENTAGE, 80);
      await tx.wait();
      
      // Update the expired refund percentage to 40%
      tx = await justGovernance.connect(adminAccount).updateGovParam(PARAM_EXPIRED_REFUND_PERCENTAGE, 40);
      await tx.wait();
      
      // Verify all updates were successful
      const updatedParams = await justGovernance.govParams();
      console.log(`Updated defeated refund percentage: ${updatedParams.defeatedRefundPercentage}%`);
      console.log(`Updated canceled refund percentage: ${updatedParams.canceledRefundPercentage}%`);
      console.log(`Updated expired refund percentage: ${updatedParams.expiredRefundPercentage}%`);
      
      expect(updatedParams.defeatedRefundPercentage).to.equal(60, "Defeated refund update failed");
      expect(updatedParams.canceledRefundPercentage).to.equal(80, "Canceled refund update failed");
      expect(updatedParams.expiredRefundPercentage).to.equal(40, "Expired refund update failed");
      
      // Test updating to invalid values (should revert)
      await expect(
        justGovernance.connect(adminAccount).updateGovParam(PARAM_DEFEATED_REFUND_PERCENTAGE, 101)
      ).to.be.reverted; // Above 100%
      
      await expect(
        justGovernance.connect(adminAccount).updateGovParam(PARAM_CANCELED_REFUND_PERCENTAGE, 101)
      ).to.be.reverted; // Above 100%
      
      await expect(
        justGovernance.connect(adminAccount).updateGovParam(PARAM_EXPIRED_REFUND_PERCENTAGE, 101)
      ).to.be.reverted; // Above 100%
    });

    it("Should allow partial stake refund for defeated proposals", async function() {
      // Get the admin account
      const adminAccount = await ethers.getSigners().then(signers => signers[1]);
      
      // Update the defeated refund percentage to 50%
      const tx = await justGovernance.connect(adminAccount).updateGovParam(PARAM_DEFEATED_REFUND_PERCENTAGE, 50);
      await tx.wait();
      
      // Verify the update was successful
      const params = await justGovernance.govParams();
      expect(params.defeatedRefundPercentage).to.equal(50, "Parameter update failed");
      
      // Get proposal stake amount from the governance parameters
      const proposalStake = (await justGovernance.govParams()).proposalStake;
      console.log(`Proposal stake: ${proposalStake}`);
      
      // Get initial balance before creating proposal
      const initialBalance = await justToken.balanceOf(user1.address);
      console.log(`Initial balance before proposal: ${initialBalance}`);
      
      // Create a proposal
      const proposalId = await createBasicProposal(ProposalType.TokenTransfer, {
        amount: parseEther("1"),
        recipient: user2.address,
        description: "Transfer tokens to user2 - defeated test"
      });
      
      // Get balance after proposal creation (stake has been deducted)
      const balanceAfterProposal = await justToken.balanceOf(user1.address);
      console.log(`Balance after proposal creation: ${balanceAfterProposal}`);
      
      // Calculate actual stake amount taken (the difference)
      const actualStake = initialBalance - balanceAfterProposal;
      console.log(`Actual stake deducted: ${actualStake}`);
      
      // Vote against the proposal to defeat it
      await justGovernance.connect(user2).castVote(proposalId, VoteType.Against);
      await justGovernance.connect(user3).castVote(proposalId, VoteType.Against);
      
      // Advance time to end voting period
      await advanceTime(SEVEN_DAYS + 60);
      
      // Verify proposal is defeated
      const state = await justGovernance.getProposalState(proposalId);
      console.log(`Proposal state: ${state}`);
      expect(state).to.equal(ProposalState.Defeated);
      
      // Claim partial refund
      await justGovernance.connect(user1).claimPartialStakeRefund(proposalId);
      
      // Check user1's balance is partially restored with 50% refund
      const finalBalance = await justToken.balanceOf(user1.address);
      console.log(`Final balance after refund: ${finalBalance}`);
      
      // Calculate expected refund (exactly 50% of stake)
      const expectedRefund = actualStake * BigInt(50) / BigInt(100);
      console.log(`Expected refund (50%): ${expectedRefund}`);
      
      // Calculate the expected balance after refund
      const expectedBalance = balanceAfterProposal + expectedRefund;
      console.log(`Expected final balance: ${expectedBalance}`);
      
      // Verify the final balance matches our expectation for 50% refund
      expect(finalBalance).to.equal(expectedBalance);
    });

    it("Should allow partial stake refund for canceled proposals", async function() {
      // Get the admin account
      const adminAccount = await ethers.getSigners().then(signers => signers[1]);
      
      // Update the canceled refund percentage to 75%
      const tx = await justGovernance.connect(adminAccount).updateGovParam(PARAM_CANCELED_REFUND_PERCENTAGE, 75);
      await tx.wait();
      
      // Verify the update was successful
      const params = await justGovernance.govParams();
      expect(params.canceledRefundPercentage).to.equal(75, "Parameter update failed");
      
      // Get proposal stake amount from the governance parameters
      const proposalStake = (await justGovernance.govParams()).proposalStake;
      console.log(`Proposal stake parameter: ${proposalStake}`);
      
      // Get initial balance before creating proposal
      const initialBalance = await justToken.balanceOf(user1.address);
      console.log(`Initial balance before proposal: ${initialBalance}`);
      
      // Create a proposal
      const proposalId = await createBasicProposal(ProposalType.TokenTransfer, {
        amount: parseEther("1"),
        recipient: user2.address,
        description: "Transfer tokens to user2 - canceled test"
      });
      
      // Get balance after proposal creation (stake has been deducted)
      const balanceAfterProposal = await justToken.balanceOf(user1.address);
      console.log(`Balance after proposal creation: ${balanceAfterProposal}`);
      
      // Calculate actual stake amount taken (the difference)
      const actualStake = initialBalance - balanceAfterProposal;
      console.log(`Actual stake deducted: ${actualStake}`);
      
      // Verify that the correct stake amount was deducted
      expect(actualStake).to.equal(proposalStake, "Incorrect stake amount was deducted");
      
      // Cancel the proposal (the proposer can cancel if no votes have been cast)
      await justGovernance.connect(user1).cancelProposal(proposalId);
      
      // Verify proposal is canceled
      const state = await justGovernance.getProposalState(proposalId);
      console.log(`Proposal state: ${state}`);
      expect(state).to.equal(ProposalState.Canceled);
      
      // Claim partial refund
      await justGovernance.connect(user1).claimPartialStakeRefund(proposalId);
      
      // Check user1's balance is partially restored with 75% refund
      const finalBalance = await justToken.balanceOf(user1.address);
      console.log(`Final balance after refund: ${finalBalance}`);
      
      // Calculate expected refund (exactly 75% of stake)
      const expectedRefund = actualStake * BigInt(75) / BigInt(100);
      console.log(`Expected refund (75%): ${expectedRefund}`);
      
      // Calculate the expected balance after refund
      const expectedBalance = balanceAfterProposal + expectedRefund;
      console.log(`Expected final balance: ${expectedBalance}`);
      
      // Verify the balance increased by exactly the refund amount
      expect(finalBalance - balanceAfterProposal).to.equal(expectedRefund, "Incorrect refund amount was added");
      expect(finalBalance).to.equal(expectedBalance, "Final balance is incorrect");
    });

    it("Should allow partial stake refund for expired proposals", async function() {
      // Get the admin account
      const adminAccount = await ethers.getSigners().then(signers => signers[1]);
      
      // Update the expired refund percentage to 25%
      const tx = await justGovernance.connect(adminAccount).updateGovParam(PARAM_EXPIRED_REFUND_PERCENTAGE, 25);
      await tx.wait();
      
      // Verify the update was successful
      const params = await justGovernance.govParams();
      expect(params.expiredRefundPercentage).to.equal(25, "Parameter update failed");
      
      // Get proposal stake amount from the governance parameters
      const proposalStake = (await justGovernance.govParams()).proposalStake;
      console.log(`Proposal stake parameter: ${proposalStake}`);
      
      // Get initial balance before creating proposal
      const initialBalance = await justToken.balanceOf(user1.address);
      console.log(`Initial balance before proposal: ${initialBalance}`);
      
      // Create a proposal
      const proposalId = await createBasicProposal(ProposalType.TokenTransfer, {
        amount: parseEther("1"),
        recipient: user2.address,
        description: "Transfer tokens to user2 - expiration test"
      });
      
      // Get balance after proposal creation (stake has been deducted)
      const balanceAfterProposal = await justToken.balanceOf(user1.address);
      console.log(`Balance after proposal creation: ${balanceAfterProposal}`);
      
      // Calculate actual stake amount taken (the difference)
      const actualStake = initialBalance - balanceAfterProposal;
      console.log(`Actual stake deducted: ${actualStake}`);
      
      // Verify that the correct stake amount was deducted
      expect(actualStake).to.equal(proposalStake, "Incorrect stake amount was deducted");
      
      // Vote for the proposal to succeed
      await justGovernance.connect(user2).castVote(proposalId, VoteType.For);
      await justGovernance.connect(user3).castVote(proposalId, VoteType.For);
      
      // Advance time to end voting period
      await advanceTime(SEVEN_DAYS + 60);
      
      // Queue the proposal
      await justGovernance.connect(user1).queueProposal(proposalId);
      
      // Get the timelock contract address
      const timelockAddress = await justGovernance.timelock();
      console.log(`Timelock address: ${timelockAddress}`);
      
      // Get the timelock contract instance
      const JustTimelock = await ethers.getContractFactory("contracts/JustTimelockUpgradeable.sol:JustTimelockUpgradeable");
      const timelockContract = JustTimelock.attach(timelockAddress);
      
      // Get the timelock's grace period and delay
      const gracePeriod = await timelockContract.gracePeriod();
      const timelockDelay = (await justGovernance.govParams()).timelockDelay;
      
      console.log(`Grace period: ${gracePeriod}`);
      console.log(`Timelock delay: ${timelockDelay}`);
      
      // Advance time past the grace period to make the proposal expire
      await advanceTime(Number(timelockDelay) + Number(gracePeriod) + 60);
      
      // Verify proposal is expired
      const state = await justGovernance.getProposalState(proposalId);
      console.log(`Proposal state: ${state}`);
      expect(state).to.equal(ProposalState.Expired);
      
      // Claim partial refund
      await justGovernance.connect(user1).claimPartialStakeRefund(proposalId);
      
      // Check user1's balance is partially restored with 25% refund
      const finalBalance = await justToken.balanceOf(user1.address);
      console.log(`Final balance after refund: ${finalBalance}`);
      
      // Calculate expected refund (exactly 25% of stake)
      const expectedRefund = actualStake * BigInt(25) / BigInt(100);
      console.log(`Expected refund (25%): ${expectedRefund}`);
      
      // Calculate the expected balance after refund
      const expectedBalance = balanceAfterProposal + expectedRefund;
      console.log(`Expected final balance: ${expectedBalance}`);
      
      // Verify the balance increased by exactly the refund amount
      expect(finalBalance - balanceAfterProposal).to.equal(expectedRefund, "Incorrect refund amount was added");
      expect(finalBalance).to.equal(expectedBalance, "Final balance is incorrect");
    });
  });
  const { expect } = require("chai");
const { ethers, upgrades } = require("hardhat");

describe("JustToken Complex Delegation Chain Test", function () {
  let JustToken;
  let token;
  let owner;
  let alice, bob, charlie, dave, eve, frank;

  // Helper function to convert to wei (bigint)
  const toWei = (value) => ethers.parseEther(value.toString());
  
  // Helper function to convert from wei to number for assertions
  const fromWei = (value) => Number(ethers.formatEther(value));

  beforeEach(async function () {
    // Get signers
    [owner, alice, bob, charlie, dave, eve, frank] = await ethers.getSigners();

    // Deploy JustToken contract using upgradeable pattern
    JustToken = await ethers.getContractFactory("contracts/JustTokenUpgradeable.sol:JustTokenUpgradeable");
    token = await upgrades.deployProxy(JustToken, [
      "JUST Token",
      "JST",
      owner.address,
      60 * 60 * 24, // minLockDuration (1 day)
      60 * 60 * 24 * 365, // maxLockDuration (1 year)
    ]);
    await token.waitForDeployment();

    // Mint tokens to users - using smaller values to avoid potential overflows
    await token.mint(alice.address, toWei(100));
    await token.mint(bob.address, toWei(50));
    await token.mint(charlie.address, toWei(25));
    await token.mint(dave.address, toWei(12));
    await token.mint(eve.address, toWei(7));
    await token.mint(frank.address, toWei(5));

    // Transfer ownership to ensure contract functions can be called
    await token.grantRole(await token.GOVERNANCE_ROLE(), owner.address);
    await token.grantRole(await token.MINTER_ROLE(), owner.address);
  });
  
  it("should handle complex delegation chains correctly", async function () {
    // Assuming user4, user5, user6 are additional signers from the setup
    const [owner, user1, user2, user3, user4, user5, user6] = await ethers.getSigners();
    
    // Mint tokens to the new users
    await token.connect(owner).mint(user4.address, toWei(40));
    await token.connect(owner).mint(user5.address, toWei(20));
    await token.connect(owner).mint(user6.address, toWei(10));
    
    // Get actual balances and convert to readable format for clarity
    const user1Balance = await token.balanceOf(user1.address);
    const user2Balance = await token.balanceOf(user2.address);
    const user3Balance = await token.balanceOf(user3.address);
    const user4Balance = await token.balanceOf(user4.address);
    const user5Balance = await token.balanceOf(user5.address);
    const user6Balance = await token.balanceOf(user6.address);
    
    console.log("=== Initial Token Balances ===");
    console.log("User 1 balance:", fromWei(user1Balance));
    console.log("User 2 balance:", fromWei(user2Balance));
    console.log("User 3 balance:", fromWei(user3Balance));
    console.log("User 4 balance:", fromWei(user4Balance));
    console.log("User 5 balance:", fromWei(user5Balance));
    console.log("User 6 balance:", fromWei(user6Balance));
    
    // Detailed function to log delegation details
    async function logDelegationDetails(title) {
      console.log(`\n${title}`);
      
      // Get delegates
      const delegate1 = await token.getDelegate(user1.address);
      const delegate2 = await token.getDelegate(user2.address);
      const delegate3 = await token.getDelegate(user3.address);
      const delegate4 = await token.getDelegate(user4.address);
      const delegate5 = await token.getDelegate(user5.address);
      const delegate6 = await token.getDelegate(user6.address);
      
      console.log("Delegate Assignments:");
      console.log(`User 1 delegates to: ${delegate1}`);
      console.log(`User 2 delegates to: ${delegate2}`);
      console.log(`User 3 delegates to: ${delegate3}`);
      console.log(`User 4 delegates to: ${delegate4}`);
      console.log(`User 5 delegates to: ${delegate5}`);
      console.log(`User 6 delegates to: ${delegate6}`);
      
      // Get delegated votes
      const user1Delegated = await token.getCurrentDelegatedVotes(user1.address);
      const user2Delegated = await token.getCurrentDelegatedVotes(user2.address);
      const user3Delegated = await token.getCurrentDelegatedVotes(user3.address);
      const user4Delegated = await token.getCurrentDelegatedVotes(user4.address);
      const user5Delegated = await token.getCurrentDelegatedVotes(user5.address);
      const user6Delegated = await token.getCurrentDelegatedVotes(user6.address);
      
      console.log("\nDelegated Votes:");
      console.log(`User 1 delegated votes: ${fromWei(user1Delegated)}`);
      console.log(`User 2 delegated votes: ${fromWei(user2Delegated)}`);
      console.log(`User 3 delegated votes: ${fromWei(user3Delegated)}`);
      console.log(`User 4 delegated votes: ${fromWei(user4Delegated)}`);
      console.log(`User 5 delegated votes: ${fromWei(user5Delegated)}`);
      console.log(`User 6 delegated votes: ${fromWei(user6Delegated)}`);
    }
    
    // Reset delegations
    await token.connect(user1).resetDelegation();
    await token.connect(user2).resetDelegation();
    await token.connect(user3).resetDelegation();
    await token.connect(user4).resetDelegation();
    await token.connect(user5).resetDelegation();
    await token.connect(user6).resetDelegation();
    console.log("All users reset to self-delegation");
    
    // Create initial snapshot
    await token.connect(owner).createSnapshot();
    const initialSnapshotId = await token.getCurrentSnapshotId();
    console.log(`Created initial snapshot: ${initialSnapshotId}`);
    
    // Log initial state
    await logDelegationDetails("Initial Delegation State");
    
    // Create extended delegation chain: user1 -> user2 -> user3 -> user4 -> user5 -> user6
    console.log("\n=== Setting Up Extended Delegation Chain ===");
    
    // Delegation chain
    await token.connect(user1).delegate(user2.address);
    console.log("User 1 delegated to User 2");
    await logDelegationDetails("After User 1 Delegates to User 2");
    
    await token.connect(user2).delegate(user3.address);
    console.log("User 2 delegated to User 3");
    await logDelegationDetails("After User 2 Delegates to User 3");
    
    await token.connect(user3).delegate(user4.address);
    console.log("User 3 delegated to User 4");
    await logDelegationDetails("After User 3 Delegates to User 4");
    
    await token.connect(user4).delegate(user5.address);
    console.log("User 4 delegated to User 5");
    await logDelegationDetails("After User 4 Delegates to User 5");
    
    await token.connect(user5).delegate(user6.address);
    console.log("User 5 delegated to User 6");
    await logDelegationDetails("After User 5 Delegates to User 6");
    
    // Create snapshot after delegation chain
    await token.connect(owner).createSnapshot();
    const delegationSnapshotId = await token.getCurrentSnapshotId();
    console.log(`Created snapshot after delegation chain: ${delegationSnapshotId}`);
    
    // Check voting power at snapshot
    const user1Power = await token.getEffectiveVotingPower(user1.address, delegationSnapshotId);
    const user2Power = await token.getEffectiveVotingPower(user2.address, delegationSnapshotId);
    const user3Power = await token.getEffectiveVotingPower(user3.address, delegationSnapshotId);
    const user4Power = await token.getEffectiveVotingPower(user4.address, delegationSnapshotId);
    const user5Power = await token.getEffectiveVotingPower(user5.address, delegationSnapshotId);
    const user6Power = await token.getEffectiveVotingPower(user6.address, delegationSnapshotId);
    
    console.log("\n=== Voting Power ===");
    console.log(`User 1 voting power: ${fromWei(user1Power)}`);
    console.log(`User 2 voting power: ${fromWei(user2Power)}`);
    console.log(`User 3 voting power: ${fromWei(user3Power)}`);
    console.log(`User 4 voting power: ${fromWei(user4Power)}`);
    console.log(`User 5 voting power: ${fromWei(user5Power)}`);
    console.log(`User 6 voting power: ${fromWei(user6Power)}`);
    
    // Check that user6 has all delegated power
    const totalSum = BigInt(user1Balance.toString()) + 
                    BigInt(user2Balance.toString()) + 
                    BigInt(user3Balance.toString()) + 
                    BigInt(user4Balance.toString()) + 
                    BigInt(user5Balance.toString()) + 
                    BigInt(user6Balance.toString());
    
    expect(fromWei(user6Power)).to.be.closeTo(
      fromWei(totalSum.toString()), 
      0.1
    );
    
    // Now let's have user5 self-delegate (break the chain between user5 and user6)
    console.log("\n=== Breaking Delegation Chain at User 5 ===");
    await token.connect(user5).resetDelegation();
    console.log("User 5 reset to self-delegation");
    await logDelegationDetails("After User 5 Self-Delegates");
    
    // Create another snapshot
    await token.connect(owner).createSnapshot();
    const brokenChainSnapshotId = await token.getCurrentSnapshotId();
    console.log(`Created snapshot after breaking chain at User 5: ${brokenChainSnapshotId}`);
    
    // Check voting power again
    const user3PowerAfterBreak = await token.getEffectiveVotingPower(user3.address, brokenChainSnapshotId);
    const user5PowerAfterBreak = await token.getEffectiveVotingPower(user5.address, brokenChainSnapshotId);
    const user6PowerAfterBreak = await token.getEffectiveVotingPower(user6.address, brokenChainSnapshotId);
    
    console.log("\n=== Voting Power After Breaking Chain ===");
    console.log(`User 3 voting power: ${fromWei(user3PowerAfterBreak)}`);
    console.log(`User 5 voting power: ${fromWei(user5PowerAfterBreak)}`);
    console.log(`User 6 voting power: ${fromWei(user6PowerAfterBreak)}`);
    
    // Verify User6 has only their own tokens now
    expect(fromWei(user6PowerAfterBreak)).to.be.closeTo(
      fromWei(user6Balance), 
      0.1
    );
    
    // Verify User5 has their own tokens plus User4's delegation
    const user5ExpectedPower = BigInt(user5Balance.toString()) + 
                              BigInt(user4Balance.toString()) + 
                              BigInt(user3Balance.toString()) + 
                              BigInt(user2Balance.toString()) + 
                              BigInt(user1Balance.toString());
    
    expect(fromWei(user5PowerAfterBreak)).to.be.closeTo(
      fromWei(user5ExpectedPower.toString()), 
      0.1
    );
    
    // Verify User3 has 0 voting power (since they delegated to User4)
expect(fromWei(user3PowerAfterBreak)).to.be.closeTo(
  0, 
  0.1
);
  });
});
});