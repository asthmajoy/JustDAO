// Add these at the top of your test3.js file
// These constants/variables need to be defined before they're used

const { ethers } = require("hardhat");
const { expect } = require("chai");
const { time } = require("@nomicfoundation/hardhat-network-helpers");
const { parseEther, formatEther } = ethers;


// Define test constants
const TOKEN_NAME = "Just Token";
const TOKEN_SYMBOL = "JUST";
const MIN_LOCK_DURATION = 86400; // 1 day in seconds
const MAX_LOCK_DURATION = 31536000; // 1 year in seconds
const INITIAL_MINT = ethers.parseEther("1000000"); // 1 million tokens
const TEST_AMOUNT = ethers.parseEther("1000"); // 1000 tokens

// Test-specific describe block for JustTokenUpgradeable - Updated Tests
describe("JustTokenUpgradeable - Updated Tests", function () {
  // Test accounts
  let owner, admin, guardian, user1, user2, user3, user4;
  
  // Contract instances
  let tokenFactory, token, timelock;
  
  // Roles
  const ADMIN_ROLE = ethers.keccak256(ethers.toUtf8Bytes("ADMIN_ROLE"));
  const GUARDIAN_ROLE = ethers.keccak256(ethers.toUtf8Bytes("GUARDIAN_ROLE"));
  const GOVERNANCE_ROLE = ethers.keccak256(ethers.toUtf8Bytes("GOVERNANCE_ROLE"));
  const MINTER_ROLE = ethers.keccak256(ethers.toUtf8Bytes("MINTER_ROLE"));
  
  beforeEach(async function () {
    // Get test accounts
    [owner, admin, guardian, user1, user2, user3, user4] = await ethers.getSigners();
    
    // Deploy mock timelock contract (simplified for testing)
    const TimelockFactory = await ethers.getContractFactory("MockTimelock");
    timelock = await TimelockFactory.deploy();
    
    // Deploy token contract - use a simpler reference to avoid the addressing error
    tokenFactory = await ethers.getContractFactory("contracts/JustTokenUpgradeable.sol:JustTokenUpgradeable");
    token = await tokenFactory.deploy();
    
    // Initialize the token contract
    await token.initialize(
      TOKEN_NAME,
      TOKEN_SYMBOL,
      admin.address,
      MIN_LOCK_DURATION,
      MAX_LOCK_DURATION
    );
    
    // Set timelock
    await token.connect(admin).setTimelock(timelock.address);
    
    // Setup roles
    await token.connect(admin).grantContractRole(MINTER_ROLE, admin.address);
    await token.connect(admin).grantContractRole(GUARDIAN_ROLE, guardian.address);
    await token.connect(admin).grantContractRole(GOVERNANCE_ROLE, admin.address);
    
    // Mint initial tokens to test users
    await token.connect(admin).mint(user1.address, TEST_AMOUNT);
    await token.connect(admin).mint(user2.address, TEST_AMOUNT);
    await token.connect(admin).mint(user3.address, TEST_AMOUNT);
    await token.connect(admin).mint(user4.address, TEST_AMOUNT);
  });
});



describe("JustTokenUpgradeable - Updated Tests", function () {
  let admin, user1, user2, user3, user4, user5, user6;
  let justToken, justGovernance, justTimelock;

  beforeEach(async function () {
    [admin, user1, user2, user3, user4, user5, user6] = await ethers.getSigners();
    
    // Deploy token contract - fixing the path issue
    const JustToken = await ethers.getContractFactory("contracts/JustTokenUpgradeable.sol:JustTokenUpgradeable");
    justToken = await upgrades.deployProxy(
      JustToken,
      ["TEST", "TST", admin.address, 86400, 31536000],
      { initializer: "initialize" }
    );
    await justToken.waitForDeployment();
    
    // Deploy timelock contract - fixing the path issue
    const JustTimelock = await ethers.getContractFactory("contracts/JustTimelockUpgradeable.sol:JustTimelockUpgradeable");
    justTimelock = await upgrades.deployProxy(
      JustTimelock,
      [86400, [admin.address], [admin.address], admin.address],
      { initializer: "initialize" }
    );
    await justTimelock.waitForDeployment();
    
    // Deploy governance contract - fixing the path issue
    const JustGovernance = await ethers.getContractFactory("contracts/JustGovernanceUpgradeable.sol:JustGovernanceUpgradeable");
    justGovernance = await upgrades.deployProxy(
      JustGovernance,
      [
        "TestGov", 
        await justToken.getAddress(), 
        await justTimelock.getAddress(), 
        admin.address, 
        ethers.parseEther("1"), // Low threshold for testing
        86400, 
        86400, 
        ethers.parseEther("1"), 
        0, 
        50, 
        75, 
        25
      ],
      { initializer: "initialize" }
    );
    await justGovernance.waitForDeployment();
    
    // Setup permissions
    await justToken.setTimelock(await justTimelock.getAddress());
    const GOVERNANCE_ROLE = ethers.id("GOVERNANCE_ROLE");
    const PROPOSER_ROLE = ethers.id("PROPOSER_ROLE");
    
    await justToken.grantContractRole(GOVERNANCE_ROLE, await justGovernance.getAddress());
    await justGovernance.grantContractRole(PROPOSER_ROLE, user6.address);
    
    // Mint tokens for testing
    await justToken.mint(user1.address, ethers.parseEther("1000"));
    await justToken.mint(user2.address, ethers.parseEther("2000"));
    await justToken.mint(user3.address, ethers.parseEther("3000"));
    await justToken.mint(user4.address, ethers.parseEther("4000"));
    await justToken.mint(user5.address, ethers.parseEther("5000"));
    await justToken.mint(user6.address, ethers.parseEther("6000"));
  });

  describe("Delegation System - Normal Cases", function () {
    it("should set self-delegation by default", async function () {
      // Check that all users are self-delegated by default
      expect(await justToken.getDelegate(user1.address)).to.equal(user1.address);
      expect(await justToken.getDelegate(user2.address)).to.equal(user2.address);
    });

    it("should allow delegation to another address", async function () {
      await justToken.connect(user1).delegate(user2.address);
      expect(await justToken.getDelegate(user1.address)).to.equal(user2.address);
    });

    it("should update delegated votes when delegating", async function () {
      // Initially no delegated votes
      expect(await justToken.getCurrentDelegatedVotes(user2.address)).to.equal(0);
      
      // User1 delegates to user2
      await justToken.connect(user1).delegate(user2.address);
      
      // User2 should now have user1's votes delegated to them
      expect(await justToken.getCurrentDelegatedVotes(user2.address)).to.equal(ethers.parseEther("1000"));
    });
  });
});
  
  
describe("JustToken Delegation and Voting Tests", function () {
  let admin, user1, user2, user3, user4, user5, user6;
  let justToken, justGovernance, justTimelock;

  beforeEach(async function () {
    [admin, user1, user2, user3, user4, user5, user6] = await ethers.getSigners();
    
    // Deploy token contract with fully qualified name
    const JustToken = await ethers.getContractFactory("contracts/JustTokenUpgradeable.sol:JustTokenUpgradeable");
    justToken = await upgrades.deployProxy(
      JustToken,
      ["TEST", "TST", admin.address, 86400, 31536000],
      { initializer: "initialize" }
    );
    
    // Deploy timelock contract with fully qualified name
    const JustTimelock = await ethers.getContractFactory("contracts/JustTimelockUpgradeable.sol:JustTimelockUpgradeable");
    justTimelock = await upgrades.deployProxy(
      JustTimelock,
      [86400, [admin.address], [admin.address], admin.address],
      { initializer: "initialize" }
    );
    
    // Deploy governance contract with fully qualified name
    const JustGovernance = await ethers.getContractFactory("contracts/JustGovernanceUpgradeable.sol:JustGovernanceUpgradeable");
    justGovernance = await upgrades.deployProxy(
      JustGovernance,
      [
        "TestGov", 
        await justToken.getAddress(), 
        await justTimelock.getAddress(), 
        admin.address, 
        ethers.parseUnits("1", 18), // Low threshold for testing
        86400, 
        86400, 
        ethers.parseUnits("1", 18), 
        0, 
        50, 
        75, 
        25
      ],
      { initializer: "initialize" }
    );
    
    // Setup permissions
    await justToken.setTimelock(await justTimelock.getAddress());
    const GOVERNANCE_ROLE = ethers.id("GOVERNANCE_ROLE");
    const PROPOSER_ROLE = ethers.id("PROPOSER_ROLE");
    
    await justToken.grantContractRole(GOVERNANCE_ROLE, await justGovernance.getAddress());
    await justGovernance.grantContractRole(PROPOSER_ROLE, user6.address);
    
    // Mint tokens for testing
    await justToken.mint(user1.address, ethers.parseEther("1000"));
    await justToken.mint(user2.address, ethers.parseEther("2000"));
    await justToken.mint(user3.address, ethers.parseEther("3000"));
    await justToken.mint(user4.address, ethers.parseEther("4000"));
    await justToken.mint(user5.address, ethers.parseEther("5000"));
    await justToken.mint(user6.address, ethers.parseEther("6000"));
  });

  describe("Delegation System - Normal Cases", function () {
    it("should set self-delegation by default", async function () {
      // Check that all users are self-delegated by default
      expect(await justToken.getDelegate(user1.address)).to.equal(user1.address);
      expect(await justToken.getDelegate(user2.address)).to.equal(user2.address);
    });

    it("should allow delegation to another address", async function () {
      await justToken.connect(user1).delegate(user2.address);
      expect(await justToken.getDelegate(user1.address)).to.equal(user2.address);
    });

    it("should update delegated votes when delegating", async function () {
      // Initially no delegated votes
      expect(await justToken.getCurrentDelegatedVotes(user2.address)).to.equal(0);
      
      // User1 delegates to user2
      await justToken.connect(user1).delegate(user2.address);
      
      // User2 should now have user1's votes delegated to them
      expect(await justToken.getCurrentDelegatedVotes(user2.address)).to.equal(ethers.parseEther("1000"));
    });

    it("should allow changing delegation", async function () {
      // User1 delegates to user2
      await justToken.connect(user1).delegate(user2.address);
      expect(await justToken.getCurrentDelegatedVotes(user2.address)).to.equal(ethers.parseEther("1000"));
      
      // User1 changes delegation to user3
      await justToken.connect(user1).resetDelegation();
      await justToken.connect(user1).delegate(user3.address);
      
      // Delegated votes should be updated
      expect(await justToken.getCurrentDelegatedVotes(user2.address)).to.equal(0);
      expect(await justToken.getCurrentDelegatedVotes(user3.address)).to.equal(ethers.parseEther("1000"));
    });

    it("should correctly calculate voting power after delegation", async function () {
      // Create a snapshot for voting
      await justToken.connect(admin).createSnapshot();
      const snapshotId = await justToken.getCurrentSnapshotId();
      
      // Initial voting power should equal token balance
      expect(await justToken.getEffectiveVotingPower(user1.address, snapshotId)).to.equal(ethers.parseEther("1000"));
      expect(await justToken.getEffectiveVotingPower(user2.address, snapshotId)).to.equal(ethers.parseEther("2000"));
      
      // Create a new snapshot after delegation
      await justToken.connect(user1).delegate(user2.address);
      await justToken.connect(admin).createSnapshot();
      const snapshotId2 = await justToken.getCurrentSnapshotId();
      
      // After delegation, user1's voting power should be 0 (delegated away)
      // and user2's should include the delegated votes
      expect(await justToken.getEffectiveVotingPower(user1.address, snapshotId2)).to.equal(0);
      expect(await justToken.getEffectiveVotingPower(user2.address, snapshotId2)).to.equal(ethers.parseEther("3000")); // Own 2000 + delegated 1000
    });
  
  it("should handle multiple delegations to the same delegatee", async function () {
      // Both user1 and user2 delegate to user3
      await justToken.connect(user1).delegate(user3.address);
      await justToken.connect(user2).delegate(user3.address);
      
      // User3 should have both users' votes delegated to them
      expect(await justToken.getCurrentDelegatedVotes(user3.address)).to.equal(ethers.parseEther("3000")); // 1000 + 2000
  });

  it("should handle zero balances when delegating", async function () {
    // Deploy a new account with zero balance
    const zeroAccount = ethers.Wallet.createRandom().connect(ethers.provider);
    
    // Fund the account with ETH for gas
    await admin.sendTransaction({
      to: zeroAccount.address,
      value: ethers.parseEther("1")
    });
    
    // Ensure the account exists in the token system
    await justToken.connect(user1).transfer(zeroAccount.address, 0);
    
    // First, self-delegate the zero balance account
    await justToken.connect(zeroAccount).resetDelegation();
    
    // Then delegate to user1
    await justToken.connect(zeroAccount).delegate(user1.address);
    
    // Should not affect user1's delegated votes since zeroAccount has no tokens
    expect(await justToken.getCurrentDelegatedVotes(user1.address)).to.equal(0);
  });
});

const { expect } = require("chai");
const { ethers, upgrades } = require("hardhat");
describe("JustToken Delegation and Voting Tests", function () {
  // Import required functions
  const { expect } = require("chai");
  
  // Import or define parseEther and formatEther - works with both ethers v5 and v6
  let parseEther, formatEther;
  
  before(function() {
    // Determine ethers version and set up utility functions appropriately
    if (ethers.utils && ethers.utils.parseEther) {
      // ethers v5
      parseEther = ethers.utils.parseEther;
      formatEther = ethers.utils.formatEther;
    } else {
      // ethers v6
      parseEther = ethers.parseEther;
      formatEther = ethers.formatEther;
    }
  });
  
  describe("Complex Delegation with Chain Breaking", function () {
    let admin, user1, user2, user3, user4, user5, user6;
    let justToken, justGovernance, justTimelock;

    beforeEach(async function () {
      [admin, user1, user2, user3, user4, user5, user6] = await ethers.getSigners();
      
      // Deploy token contract
      const JustToken = await ethers.getContractFactory("contracts/JustTokenUpgradeable.sol:JustTokenUpgradeable");
      justToken = await upgrades.deployProxy(
        JustToken,
        ["TEST", "TST", admin.address, 86400, 31536000],
        { initializer: "initialize" }
      );

      // Deploy timelock contract
      const JustTimelock = await ethers.getContractFactory("contracts/JustTimelockUpgradeable.sol:JustTimelockUpgradeable");
      justTimelock = await upgrades.deployProxy(
        JustTimelock,
        [86400, [admin.address], [admin.address], admin.address],
        { initializer: "initialize" }
      );

      // Get contract addresses - compatible with both v5 and v6
      const tokenAddress = justToken.address || await justToken.getAddress();
      const timelockAddress = justTimelock.address || await justTimelock.getAddress();

      // Deploy governance contract
      const JustGovernance = await ethers.getContractFactory("contracts/JustGovernanceUpgradeable.sol:JustGovernanceUpgradeable");
      justGovernance = await upgrades.deployProxy(
        JustGovernance,
        [
          "TestGov",
          tokenAddress,
          timelockAddress,
          admin.address,
          parseEther("1"), // Low threshold for testing
          86400,
          86400,
          parseEther("1"),
          0,
          50,
          75,
          25
        ],
        { initializer: "initialize" }
      );
      
      // Wait for deployment to complete (v5 style)
      if (justGovernance.deployed) {
        await justGovernance.deployed();
      }
      
      // Mint tokens to users for testing
      await justToken.connect(admin).mint(user1.address, parseEther("1000"));
      await justToken.connect(admin).mint(user2.address, parseEther("2000"));
      await justToken.connect(admin).mint(user3.address, parseEther("3000"));
      await justToken.connect(admin).mint(user4.address, parseEther("4000"));
      await justToken.connect(admin).mint(user5.address, parseEther("5000"));
      await justToken.connect(admin).mint(user6.address, parseEther("6000"));
    });

    it("should handle snapshot calculations correctly", async function () {
      // First, confirm initial balances
      expect(await justToken.balanceOf(user1.address)).to.equal(parseEther("1000"));
      expect(await justToken.balanceOf(user3.address)).to.equal(parseEther("3000"));
      
      // Transfer BEFORE first snapshot
      await justToken.connect(user1).transfer(user3.address, parseEther("300"));
      
      // Verify transfer succeeded
      expect(await justToken.balanceOf(user1.address)).to.equal(parseEther("700"));
      expect(await justToken.balanceOf(user3.address)).to.equal(parseEther("3300"));
      
      // First snapshot after transfer, before delegation
      await justToken.connect(admin).createSnapshot();
      const snapshot1 = await justToken.getCurrentSnapshotId();
      
      // User1 delegates to user2
      await justToken.connect(user1).delegate(user2.address);
      
      // Second snapshot after delegation
      await justToken.connect(admin).createSnapshot();
      const snapshot2 = await justToken.getCurrentSnapshotId();
      
      // Check voting power at different snapshots
      // At snapshot 1 (after transfer, before delegation)
      expect(await justToken.getEffectiveVotingPower(user1.address, snapshot1)).to.equal(parseEther("700"));
      expect(await justToken.getEffectiveVotingPower(user3.address, snapshot1)).to.equal(parseEther("3300"));
      
      // At snapshot 2 (after delegation)
      expect(await justToken.getEffectiveVotingPower(user1.address, snapshot2)).to.equal(parseEther("0")); // Delegated away
      expect(await justToken.getEffectiveVotingPower(user2.address, snapshot2)).to.equal(parseEther("2700")); // 2000 + 700
    });
    
    it("should handle multi-level delegation chains", async function () {
      // Create a delegation chain: user6 -> user5 -> user4 -> user3
      await justToken.connect(user6).delegate(user5.address);
      await justToken.connect(user5).delegate(user4.address);
      await justToken.connect(user4).delegate(user3.address);
      
      // Create snapshot after delegations
      await justToken.connect(admin).createSnapshot();
      const snapshotId = await justToken.getCurrentSnapshotId();
      
      // Check voting power
      const user3Power = await justToken.getEffectiveVotingPower(user3.address, snapshotId);
      const user4Power = await justToken.getEffectiveVotingPower(user4.address, snapshotId);
      const user5Power = await justToken.getEffectiveVotingPower(user5.address, snapshotId);
      const user6Power = await justToken.getEffectiveVotingPower(user6.address, snapshotId);
      
      console.log("Multi-level delegation chain voting power:");
      console.log(" - User3:", formatEther(user3Power));
      console.log(" - User4:", formatEther(user4Power));
      console.log(" - User5:", formatEther(user5Power));
      console.log(" - User6:", formatEther(user6Power));
      
      // User3 should have their own 3000 + 4000 from user4 + 5000 from user5 + 6000 from user6
      expect(user3Power).to.equal(parseEther("18000"), "User3 should have the voting power of the entire chain");
      expect(user4Power).to.equal(parseEther("0"), "User4 should have 0 voting power (delegated away)");
      expect(user5Power).to.equal(parseEther("0"), "User5 should have 0 voting power (delegated away)");
      expect(user6Power).to.equal(parseEther("0"), "User6 should have 0 voting power (delegated away)");
    });
    
    it("should handle broken delegation chains", async function () {
      // Create a delegation chain: user6 -> user5 -> user4 -> user3
      await justToken.connect(user6).delegate(user5.address);
      await justToken.connect(user5).delegate(user4.address);
      await justToken.connect(user4).delegate(user3.address);
      
      // Create first snapshot with full chain
      await justToken.connect(admin).createSnapshot();
      const snapshot1 = await justToken.getCurrentSnapshotId();
      
      // Break the chain in the middle: user4 self-delegates
      await justToken.connect(user4).resetDelegation();
      
      // Create second snapshot after breaking the chain
      await justToken.connect(admin).createSnapshot();
      const snapshot2 = await justToken.getCurrentSnapshotId();
      
      // Check snapshot 1 (full chain)
      const user3Power1 = await justToken.getEffectiveVotingPower(user3.address, snapshot1);
      expect(user3Power1).to.equal(parseEther("18000"), "User3 should have full chain power in snapshot 1");
      
      // Check snapshot 2 (broken chain)
      const user3Power2 = await justToken.getEffectiveVotingPower(user3.address, snapshot2);
      const user4Power2 = await justToken.getEffectiveVotingPower(user4.address, snapshot2);
      
      console.log("Broken delegation chain voting power:");
      console.log(" - User3 power at snapshot 2:", formatEther(user3Power2));
      console.log(" - User4 power at snapshot 2:", formatEther(user4Power2));
      
      // User3 should only have their own 3000 tokens in snapshot 2
      expect(user3Power2).to.equal(parseEther("3000"), "User3 should only have their own voting power after chain break");
      
      // User4 should have their own 4000 + 5000 from user5 + 6000 from user6
      expect(user4Power2).to.equal(parseEther("15000"), "User4 should have voting power from user5 and user6 after chain break");
    });
  });
});

describe("JustToken Delegation and Voting Tests", function () {
  // Declare variables in the outer scope
  let admin, user1, user2, user3, user4, user5, user6;
  let justToken, justGovernance, justTimelock;
  let TEST_AMOUNT;
  
  // Use hardhat's ethers, not a global ethers
  const { ethers, upgrades } = hre;
  
  // Helper functions
  const toWei = (amount) => ethers.parseEther(amount.toString());
  const fromWei = (amount) => Number(ethers.formatEther(amount));

  beforeEach(async function () {
    // Get signers for test accounts
    [admin, user1, user2, user3, user4, user5, user6] = await ethers.getSigners();
    
    // Set the test amount
    TEST_AMOUNT = ethers.parseEther("1000");
    
    // Deploy token contract - use simple name without path
    const JustToken = await ethers.getContractFactory("contracts/JustTokenUpgradeable.sol:JustTokenUpgradeable");
    justToken = await upgrades.deployProxy(
      JustToken,
      ["TEST", "TST", admin.address, 86400, 31536000],
      { initializer: "initialize" }
    );
    await justToken.waitForDeployment();
    
    // Deploy timelock contract - use simple name without path
    const JustTimelock = await ethers.getContractFactory("contracts/JustTimelockUpgradeable.sol:JustTimelockUpgradeable");
    justTimelock = await upgrades.deployProxy(
      JustTimelock,
      [86400, [admin.address], [admin.address], admin.address],
      { initializer: "initialize" }
    );
    await justTimelock.waitForDeployment();
    
    // Deploy governance contract - use simple name without path
    const JustGovernance = await ethers.getContractFactory("contracts/JustGovernanceUpgradeable.sol:JustGovernanceUpgradeable");
    justGovernance = await upgrades.deployProxy(
      JustGovernance,
      [
        "TestGov", 
        await justToken.getAddress(), 
        await justTimelock.getAddress(), 
        admin.address, 
        ethers.parseEther("0.1"), // Low threshold for testing
        86400, 
        86400, 
        ethers.parseEther("0.1"), 
        0, 
        50, 
        75, 
        25
      ],
      { initializer: "initialize" }
    );
    await justGovernance.waitForDeployment();
    
    // Setup permissions
    await justToken.setTimelock(await justTimelock.getAddress());
    const GOVERNANCE_ROLE = ethers.id("GOVERNANCE_ROLE");
    const PROPOSER_ROLE = ethers.id("PROPOSER_ROLE");
    
    await justToken.grantContractRole(GOVERNANCE_ROLE, await justGovernance.getAddress());
    await justGovernance.grantContractRole(PROPOSER_ROLE, user6.address);
    
    // Mint tokens for testing
    await justToken.mint(user1.address, TEST_AMOUNT);
    await justToken.mint(user2.address, TEST_AMOUNT);
    await justToken.mint(user3.address, TEST_AMOUNT);
    await justToken.mint(user4.address, TEST_AMOUNT);
    await justToken.mint(user5.address, TEST_AMOUNT);
    await justToken.mint(user6.address, TEST_AMOUNT);
  });

  describe("Delegation Reset Test", function () {
    it("should reset delegation when self-delegating", async function () {
      // Create initial snapshot to check voting power later
      await justToken.connect(admin).createSnapshot();
      const initialSnapshotId = await justToken.getCurrentSnapshotId();
      
      // Reset delegation before delegating
      await justToken.connect(user1).resetDelegation();
      
      // Set up the initial delegation: user1 -> user2
      await justToken.connect(user1).delegate(user2.address);
      
      // Verify the initial delegation worked
      expect(await justToken.getDelegate(user1.address)).to.equal(user2.address);
      expect(await justToken.getCurrentDelegatedVotes(user2.address)).to.equal(TEST_AMOUNT);
      
      // Create a snapshot to capture the state after initial delegation
      await justToken.connect(admin).createSnapshot();
      const delegationSnapshotId = await justToken.getCurrentSnapshotId();
      
      // Verify voting power after initial delegation
      expect(await justToken.getEffectiveVotingPower(user1.address, delegationSnapshotId)).to.equal(0);
      const user2VotingPower = await justToken.getEffectiveVotingPower(user2.address, delegationSnapshotId);
      
      // Using addition with BigInt (works with ethers v6)
      expect(user2VotingPower).to.equal(TEST_AMOUNT * 2n); // user2's 1000 + user1's 1000
      
      // Reset delegation before self-delegating
      await justToken.connect(user1).resetDelegation();
      
      // Now reset by self-delegating
      await justToken.connect(user1).delegate(user1.address);
      
      // Verify delegation was reset
      expect(await justToken.getDelegate(user1.address)).to.equal(user1.address);
      expect(await justToken.getCurrentDelegatedVotes(user2.address)).to.equal(0);
      
      // Create a final snapshot to capture the state after self-delegation
      await justToken.connect(admin).createSnapshot();
      const resetSnapshotId = await justToken.getCurrentSnapshotId();
      
      // Verify voting power after self-delegation reset
      expect(await justToken.getEffectiveVotingPower(user1.address, resetSnapshotId)).to.equal(TEST_AMOUNT);
      expect(await justToken.getEffectiveVotingPower(user2.address, resetSnapshotId)).to.equal(TEST_AMOUNT);
      
      // Reset delegation before new delegation
      await justToken.connect(user3).resetDelegation();
      
      // First set up a new delegation: user3 -> user2
      await justToken.connect(user3).delegate(user2.address);
      expect(await justToken.getCurrentDelegatedVotes(user2.address)).to.equal(TEST_AMOUNT);
      
      // Reset delegation before using resetDelegation function
      await justToken.connect(user3).resetDelegation();
      
      // Now reset using resetDelegation function
      await justToken.connect(user3).resetDelegation();
      
      // Verify the reset worked
      expect(await justToken.getDelegate(user3.address)).to.equal(user3.address);
      expect(await justToken.getCurrentDelegatedVotes(user2.address)).to.equal(0);
    });
    
    it("should handle complex delegation chains correctly", async function () {
      // Detailed function to log delegation details
      async function logDelegationDetails(title) {
        console.log(`\n${title}`);
        
        // Get delegates
        const delegate1 = await justToken.getDelegate(user1.address);
        const delegate2 = await justToken.getDelegate(user2.address);
        const delegate3 = await justToken.getDelegate(user3.address);
        const delegate4 = await justToken.getDelegate(user4.address);
        const delegate5 = await justToken.getDelegate(user5.address);
        const delegate6 = await justToken.getDelegate(user6.address);
        
        console.log("Delegate Assignments:");
        console.log(`User 1 delegates to: ${delegate1}`);
        console.log(`User 2 delegates to: ${delegate2}`);
        console.log(`User 3 delegates to: ${delegate3}`);
        console.log(`User 4 delegates to: ${delegate4}`);
        console.log(`User 5 delegates to: ${delegate5}`);
        console.log(`User 6 delegates to: ${delegate6}`);
        
        // Get delegated votes
        const user1Delegated = await justToken.getCurrentDelegatedVotes(user1.address);
        const user2Delegated = await justToken.getCurrentDelegatedVotes(user2.address);
        const user3Delegated = await justToken.getCurrentDelegatedVotes(user3.address);
        const user4Delegated = await justToken.getCurrentDelegatedVotes(user4.address);
        const user5Delegated = await justToken.getCurrentDelegatedVotes(user5.address);
        const user6Delegated = await justToken.getCurrentDelegatedVotes(user6.address);
        
        console.log("\nDelegated Votes:");
        console.log(`User 1 delegated votes: ${fromWei(user1Delegated)}`);
        console.log(`User 2 delegated votes: ${fromWei(user2Delegated)}`);
        console.log(`User 3 delegated votes: ${fromWei(user3Delegated)}`);
        console.log(`User 4 delegated votes: ${fromWei(user4Delegated)}`);
        console.log(`User 5 delegated votes: ${fromWei(user5Delegated)}`);
        console.log(`User 6 delegated votes: ${fromWei(user6Delegated)}`);
      }
      
      // Get actual balances and convert to readable format for clarity
      const user1Balance = await justToken.balanceOf(user1.address);
      const user2Balance = await justToken.balanceOf(user2.address);
      const user3Balance = await justToken.balanceOf(user3.address);
      const user4Balance = await justToken.balanceOf(user4.address);
      const user5Balance = await justToken.balanceOf(user5.address);
      const user6Balance = await justToken.balanceOf(user6.address);
      
      console.log("=== Initial Token Balances ===");
      console.log("User 1 balance:", fromWei(user1Balance));
      console.log("User 2 balance:", fromWei(user2Balance));
      console.log("User 3 balance:", fromWei(user3Balance));
      console.log("User 4 balance:", fromWei(user4Balance));
      console.log("User 5 balance:", fromWei(user5Balance));
      console.log("User 6 balance:", fromWei(user6Balance));
      
      // Reset delegations
      await justToken.connect(user1).resetDelegation();
      await justToken.connect(user2).resetDelegation();
      await justToken.connect(user3).resetDelegation();
      await justToken.connect(user4).resetDelegation();
      await justToken.connect(user5).resetDelegation();
      await justToken.connect(user6).resetDelegation();
      console.log("All users reset to self-delegation");
      
      // Create initial snapshot
      await justToken.connect(admin).createSnapshot();
      const initialSnapshotId = await justToken.getCurrentSnapshotId();
      console.log(`Created initial snapshot: ${initialSnapshotId}`);
      
      // Log initial state
      await logDelegationDetails("Initial Delegation State");
      
      // Create extended delegation chain: user1 -> user2 -> user3 -> user4 -> user5 -> user6
      console.log("\n=== Setting Up Extended Delegation Chain ===");
      
      // Delegation chain
      await justToken.connect(user1).delegate(user2.address);
      console.log("User 1 delegated to User 2");
      await logDelegationDetails("After User 1 Delegates to User 2");
      
      await justToken.connect(user2).delegate(user3.address);
      console.log("User 2 delegated to User 3");
      await logDelegationDetails("After User 2 Delegates to User 3");
      
      await justToken.connect(user3).delegate(user4.address);
      console.log("User 3 delegated to User 4");
      await logDelegationDetails("After User 3 Delegates to User 4");
      
      await justToken.connect(user4).delegate(user5.address);
      console.log("User 4 delegated to User 5");
      await logDelegationDetails("After User 4 Delegates to User 5");
      
      await justToken.connect(user5).delegate(user6.address);
      console.log("User 5 delegated to User 6");
      await logDelegationDetails("After User 5 Delegates to User 6");
      
      // Create snapshot after delegation chain
      await justToken.connect(admin).createSnapshot();
      const delegationSnapshotId = await justToken.getCurrentSnapshotId();
      console.log(`Created snapshot after delegation chain: ${delegationSnapshotId}`);
      
      // Check voting power at snapshot
      const user1Power = await justToken.getEffectiveVotingPower(user1.address, delegationSnapshotId);
      const user2Power = await justToken.getEffectiveVotingPower(user2.address, delegationSnapshotId);
      const user3Power = await justToken.getEffectiveVotingPower(user3.address, delegationSnapshotId);
      const user4Power = await justToken.getEffectiveVotingPower(user4.address, delegationSnapshotId);
      const user5Power = await justToken.getEffectiveVotingPower(user5.address, delegationSnapshotId);
      const user6Power = await justToken.getEffectiveVotingPower(user6.address, delegationSnapshotId);
      
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
      await justToken.connect(user5).resetDelegation();
      console.log("User 5 reset to self-delegation");
      await logDelegationDetails("After User 5 Self-Delegates");
      
      // Create another snapshot
      await justToken.connect(admin).createSnapshot();
      const brokenChainSnapshotId = await justToken.getCurrentSnapshotId();
      console.log(`Created snapshot after breaking chain at User 5: ${brokenChainSnapshotId}`);
      
      // Check voting power again
      const user1PowerAfterBreak = await justToken.getEffectiveVotingPower(user1.address, brokenChainSnapshotId);
      const user2PowerAfterBreak = await justToken.getEffectiveVotingPower(user2.address, brokenChainSnapshotId);
      const user3PowerAfterBreak = await justToken.getEffectiveVotingPower(user3.address, brokenChainSnapshotId);
      const user4PowerAfterBreak = await justToken.getEffectiveVotingPower(user4.address, brokenChainSnapshotId);
      const user5PowerAfterBreak = await justToken.getEffectiveVotingPower(user5.address, brokenChainSnapshotId);
      const user6PowerAfterBreak = await justToken.getEffectiveVotingPower(user6.address, brokenChainSnapshotId);
      
      console.log("\n=== Voting Power After Breaking Chain ===");
      console.log(`User 1 voting power: ${fromWei(user1PowerAfterBreak)}`);
      console.log(`User 2 voting power: ${fromWei(user2PowerAfterBreak)}`);
      console.log(`User 3 voting power: ${fromWei(user3PowerAfterBreak)}`);
      console.log(`User 4 voting power: ${fromWei(user4PowerAfterBreak)}`);
      console.log(`User 5 voting power: ${fromWei(user5PowerAfterBreak)}`);
      console.log(`User 6 voting power: ${fromWei(user6PowerAfterBreak)}`);
      
      // Users 1-4 delegated their tokens in a chain, so they should have 0 voting power
      expect(fromWei(user1PowerAfterBreak)).to.be.closeTo(0, 0.1);
      expect(fromWei(user2PowerAfterBreak)).to.be.closeTo(0, 0.1);
      expect(fromWei(user3PowerAfterBreak)).to.be.closeTo(0, 0.1);
      expect(fromWei(user4PowerAfterBreak)).to.be.closeTo(0, 0.1);
      
      // User 6 should only have their own tokens now
      expect(fromWei(user6PowerAfterBreak)).to.be.closeTo(
        fromWei(user6Balance), 
        0.1
      );
      
      // User 5 should have their own tokens plus all the delegated tokens from users 1-4
      // This is because the delegation chain was user1 -> user2 -> user3 -> user4 -> user5
      // When user 5 resets to self-delegation, they keep all the tokens delegated to them
      const user5ExpectedPower = BigInt(user5Balance.toString()) + 
                              BigInt(user4Balance.toString()) + 
                              BigInt(user3Balance.toString()) + 
                              BigInt(user2Balance.toString()) + 
                              BigInt(user1Balance.toString());
      
      expect(fromWei(user5PowerAfterBreak)).to.be.closeTo(
        fromWei(user5ExpectedPower.toString()), 
        0.1
      );
    });
  });
});
describe("Diagnosis Tests", function () {
  // Test accounts
  let owner, admin, guardian, user1, user2, user3, user4;
  // Contract instances
  let tokenFactory, token, timelock;
  // Constants
  const TOKEN_NAME = "JUST Token";
  const TOKEN_SYMBOL = "JUST";
  const MIN_LOCK_DURATION = 86400; // 1 day
  const MAX_LOCK_DURATION = 31536000; // 1 year
  const TEST_AMOUNT = ethers.parseEther("1000");
  const MINTER_ROLE = ethers.id("MINTER_ROLE");
  const GUARDIAN_ROLE = ethers.id("GUARDIAN_ROLE");
  const GOVERNANCE_ROLE = ethers.id("GOVERNANCE_ROLE");
  
  beforeEach(async function () {
    // Get test accounts
    [owner, admin, guardian, user1, user2, user3, user4] = await ethers.getSigners();
    
    // Deploy timelock contract
    const JustTimelock = await ethers.getContractFactory("contracts/JustTimelockUpgradeable.sol:JustTimelockUpgradeable");
    timelock = await upgrades.deployProxy(
      JustTimelock,
      [86400, [admin.address], [admin.address], admin.address],
      { initializer: "initialize" }
    );
    await timelock.waitForDeployment();
    
    // Deploy token contract
    const JustToken = await ethers.getContractFactory("contracts/JustTokenUpgradeable.sol:JustTokenUpgradeable");
    token = await upgrades.deployProxy(
      JustToken,
      [TOKEN_NAME, TOKEN_SYMBOL, admin.address, MIN_LOCK_DURATION, MAX_LOCK_DURATION],
      { initializer: "initialize" }
    );
    await token.waitForDeployment();
    
    // Set timelock
    await token.connect(admin).setTimelock(await timelock.getAddress());
    
    // Setup roles
    await token.connect(admin).grantContractRole(MINTER_ROLE, admin.address);
    await token.connect(admin).grantContractRole(GUARDIAN_ROLE, guardian.address);
    await token.connect(admin).grantContractRole(GOVERNANCE_ROLE, admin.address);
    
    // Mint initial tokens to test users
    await token.connect(admin).mint(user1.address, TEST_AMOUNT);
    await token.connect(admin).mint(user2.address, TEST_AMOUNT);
    await token.connect(admin).mint(user3.address, TEST_AMOUNT);
    await token.connect(admin).mint(user4.address, TEST_AMOUNT);
  });
  
  it("DEBUG - Token locking and unlocking flow", async function () {
    // Make sure user1 exists and has a delegate set
    if (await token.getDelegate(user1.address) === ethers.ZeroAddress) {
      // Set to self-delegation if not set
      await token.connect(user1).resetDelegation();
    }
    
    console.log("Initial state:");
    console.log("User1 balance:", ethers.formatEther(await token.balanceOf(user1.address)));
    console.log("User1 locked tokens:", ethers.formatEther(await token.getLockedTokens(user1.address)));
    console.log("User1 delegate:", await token.getDelegate(user1.address));
    
    console.log("\nAfter delegating to user2:");
    await token.connect(user1).delegate(user2.address);
    console.log("User1 balance:", ethers.formatEther(await token.balanceOf(user1.address)));
    console.log("User1 locked tokens:", ethers.formatEther(await token.getLockedTokens(user1.address)));
    console.log("User1 delegate:", await token.getDelegate(user1.address));
    console.log("User2 delegated amount:", ethers.formatEther(await token.getDelegatedToAddress(user2.address)));
    
    console.log("\nAfter resetting delegation:");
    await token.connect(user1).resetDelegation();
    console.log("User1 balance:", ethers.formatEther(await token.balanceOf(user1.address)));
    console.log("User1 locked tokens:", ethers.formatEther(await token.getLockedTokens(user1.address)));
    console.log("User1 delegate:", await token.getDelegate(user1.address));
    console.log("User2 delegated amount:", ethers.formatEther(await token.getDelegatedToAddress(user2.address)));
  });

  
  it("DEBUG - Delegation when already delegated", async function () {
    // First delegate to user2
    await token.connect(user1).delegate(user2.address);
    
    console.log("After first delegation:");
    console.log("User1 locked tokens:", ethers.formatEther(await token.getLockedTokens(user1.address)));
    console.log("User2 delegated amount:", ethers.formatEther(await token.getDelegatedToAddress(user2.address)));
    
    try {
      // Try to delegate to user3
      await token.connect(user1).delegate(user3.address);
      
      console.log("After second delegation:");
      console.log("User1 locked tokens:", ethers.formatEther(await token.getLockedTokens(user1.address)));
      console.log("User2 delegated amount:", ethers.formatEther(await token.getDelegatedToAddress(user2.address)));
      console.log("User3 delegated amount:", ethers.formatEther(await token.getDelegatedToAddress(user3.address)));
    } catch (error) {
      console.log("Failed to change delegation:", error.message);
    }
  });
});

describe("Decimal Delegation Test Suite", function() {
  // Variables for common access
  let token, owner, user1, user2, user3, user4, user5;
  let initialBalances = {};
  
  // Helper function to convert wei to human-readable format with 4 decimal places
  function formatEther(value) {
    return parseFloat(ethers.formatEther(value)).toFixed(4);
  }
  
  // Helper function to add BigInt values
  function addBigInts(values) {
    return values.reduce((sum, val) => sum + BigInt(val), BigInt(0));
  }
  
  // Helper function to log delegation state
  async function logDelegationState(title) {
    console.log(`\n=== ${title} ===`);
    
    // Array of users to check
    const users = [user1, user2, user3, user4, user5];
    const userLabels = ["User1", "User2", "User3", "User4", "User5"];
    
    // Table for balances and locked tokens
    console.log("Address | Balance | Locked | Delegate | Delegated Votes");
    console.log("--------|---------|--------|----------|---------------");
    
    for (let i = 0; i < users.length; i++) {
      const addr = users[i].address;
      const balance = await token.balanceOf(addr);
      const locked = await token.getLockedTokens(addr);
      const delegate = await token.getDelegate(addr);
      const delegatedVotes = await token.getDelegatedToAddress(addr);
      
      // Find short name for delegate
      let delegateName = "Self";
      for (let j = 0; j < users.length; j++) {
        if (delegate === users[j].address && delegate !== addr) {
          delegateName = userLabels[j];
          break;
        }
      }
      
      console.log(
        `${userLabels[i]} | ${formatEther(balance)} | ${formatEther(locked)} | ${delegateName} | ${formatEther(delegatedVotes)}`
      );
    }
  }
  
  // Setup before each test
  beforeEach(async function() {
    [owner, user1, user2, user3, user4, user5] = await ethers.getSigners();
    
    // Deploy token
    const TokenFactory = await ethers.getContractFactory("contracts/JustTokenUpgradeable.sol:JustTokenUpgradeable");
    token = await upgrades.deployProxy(TokenFactory, [
      "Just Token", 
      "JUST", 
      owner.address, 
      86400, // minLockDuration
      365 * 86400 // maxLockDuration
    ]);
    
    // Initial token balances with decimal values
    await token.connect(owner).mint(user1.address, ethers.parseEther("100.5"));
    await token.connect(owner).mint(user2.address, ethers.parseEther("50.25"));
    await token.connect(owner).mint(user3.address, ethers.parseEther("75.75"));
    await token.connect(owner).mint(user4.address, ethers.parseEther("32.125"));
    await token.connect(owner).mint(user5.address, ethers.parseEther("45.375"));
    
    // Store initial balances for reference
    initialBalances = {
      user1: await token.balanceOf(user1.address),
      user2: await token.balanceOf(user2.address),
      user3: await token.balanceOf(user3.address),
      user4: await token.balanceOf(user4.address),
      user5: await token.balanceOf(user5.address)
    };
    
    // Grant GOVERNANCE_ROLE to owner for creating snapshots
    const GOVERNANCE_ROLE = ethers.keccak256(ethers.toUtf8Bytes("GOVERNANCE_ROLE"));
    await token.connect(owner).grantContractRole(GOVERNANCE_ROLE, owner.address);
  });
  
  it("should properly lock and unlock tokens with decimal amounts", async function() {
    console.log("=== BASIC DELEGATION FLOW WITH DECIMAL AMOUNTS ===");
    
    console.log("Initial balances:");
    console.log("User1 balance:", formatEther(initialBalances.user1));
    console.log("User2 balance:", formatEther(initialBalances.user2));
    
    // Log initial state
    await logDelegationState("Initial State");
    
    // Test 1: User1 delegates to User2
    console.log("\n--- Test 1: User1 delegates to User2 ---");
    await token.connect(user1).delegate(user2.address);
    
    // Check if tokens are locked and delegation is updated
    const user1LockedAfterDelegate = await token.getLockedTokens(user1.address);
    const user2DelegatedAfterUser1 = await token.getDelegatedToAddress(user2.address);
    
    console.log("User1 locked tokens:", formatEther(user1LockedAfterDelegate));
    console.log("User2 delegated votes:", formatEther(user2DelegatedAfterUser1));
    
    // Assertions
    expect(user1LockedAfterDelegate).to.equal(initialBalances.user1);
    expect(user2DelegatedAfterUser1).to.equal(initialBalances.user1);
    
    // Test 2: Reset delegation
    console.log("\n--- Test 2: User1 resets delegation ---");
    await token.connect(user1).resetDelegation();
    
    const user1LockedAfterReset = await token.getLockedTokens(user1.address);
    const user2DelegatedAfterReset = await token.getDelegatedToAddress(user2.address);
    
    console.log("User1 locked tokens after reset:", formatEther(user1LockedAfterReset));
    console.log("User2 delegated votes after reset:", formatEther(user2DelegatedAfterReset));
    
    // Assertions
    expect(user1LockedAfterReset).to.equal(BigInt(0));
    expect(user2DelegatedAfterReset).to.equal(BigInt(0));
    
    await logDelegationState("After Reset");
  });
  
  it("should correctly handle decimal amounts in complex delegation chains", async function() {
    console.log("=== COMPLEX DELEGATION CHAIN WITH DECIMAL AMOUNTS ===");
    
    console.log("Starting delegation chain: User1 -> User2 -> User3 -> User4 -> User5");
    
    // Initial state
    await logDelegationState("Initial State");
    
    // Create first snapshot before delegation
    await token.connect(owner).createSnapshot();
    const snapshot1 = await token.getCurrentSnapshotId();
    console.log("\nCreated initial snapshot:", snapshot1.toString());
    
    // Build delegation chain
    await token.connect(user1).delegate(user2.address);
    console.log("\nUser1 delegated to User2");
    await logDelegationState("After User1 -> User2");
    
    await token.connect(user2).delegate(user3.address);
    console.log("\nUser2 delegated to User3");
    await logDelegationState("After User2 -> User3");
    
    await token.connect(user3).delegate(user4.address);
    console.log("\nUser3 delegated to User4");
    await logDelegationState("After User3 -> User4");
    
    await token.connect(user4).delegate(user5.address);
    console.log("\nUser4 delegated to User5");
    await logDelegationState("After User4 -> User5");
    
    // Create second snapshot after full delegation chain
    await token.connect(owner).createSnapshot();
    const snapshot2 = await token.getCurrentSnapshotId();
    console.log("\nCreated snapshot after full delegation chain:", snapshot2.toString());
    
    // Check voting power at snapshot 2
    console.log("\n=== Voting Power at Snapshot 2 ===");
    const votingPowers2 = await Promise.all([
      token.getEffectiveVotingPower(user1.address, snapshot2),
      token.getEffectiveVotingPower(user2.address, snapshot2),
      token.getEffectiveVotingPower(user3.address, snapshot2),
      token.getEffectiveVotingPower(user4.address, snapshot2),
      token.getEffectiveVotingPower(user5.address, snapshot2),
    ]);
    
    console.log("User1 voting power:", formatEther(votingPowers2[0]));
    console.log("User2 voting power:", formatEther(votingPowers2[1]));
    console.log("User3 voting power:", formatEther(votingPowers2[2]));
    console.log("User4 voting power:", formatEther(votingPowers2[3]));
    console.log("User5 voting power:", formatEther(votingPowers2[4]));
    
    // Calculate total tokens in system
    const totalTokens = addBigInts([
      initialBalances.user1,
      initialBalances.user2,
      initialBalances.user3,
      initialBalances.user4,
      initialBalances.user5
    ]);
    
    console.log("\nTotal tokens in system:", formatEther(totalTokens));
    console.log("User5 voting power (should have all):", formatEther(votingPowers2[4]));
    
    // Verify User5 has all voting power
    expect(votingPowers2[4]).to.equal(totalTokens);
    
    // Break the chain in the middle
    console.log("\n=== BREAKING DELEGATION CHAIN AT USER3 ===");
    await token.connect(user3).resetDelegation();
    
    // Create third snapshot after breaking chain
    await token.connect(owner).createSnapshot();
    const snapshot3 = await token.getCurrentSnapshotId();
    console.log("Created snapshot after breaking chain:", snapshot3.toString());
    
    await logDelegationState("After Breaking Chain at User3");
    
    // Check voting power at snapshot 3
    console.log("\n=== Voting Power at Snapshot 3 ===");
    const votingPowers3 = await Promise.all([
      token.getEffectiveVotingPower(user1.address, snapshot3),
      token.getEffectiveVotingPower(user2.address, snapshot3),
      token.getEffectiveVotingPower(user3.address, snapshot3),
      token.getEffectiveVotingPower(user4.address, snapshot3),
      token.getEffectiveVotingPower(user5.address, snapshot3),
    ]);
    
    console.log("User1 voting power:", formatEther(votingPowers3[0]));
    console.log("User2 voting power:", formatEther(votingPowers3[1]));
    console.log("User3 voting power:", formatEther(votingPowers3[2]));
    console.log("User4 voting power:", formatEther(votingPowers3[3]));
    console.log("User5 voting power:", formatEther(votingPowers3[4]));
    
    // After breaking at User3:
    // - User3 should have their balance + User1 + User2 delegated
    // - User5 should have their balance + User4 delegated
    const expectedUser3Power = addBigInts([
      initialBalances.user1,
      initialBalances.user2,
      initialBalances.user3
    ]);
    
    const expectedUser5Power = addBigInts([
      initialBalances.user4,
      initialBalances.user5
    ]);
    
    console.log("\nExpected User3 power:", formatEther(expectedUser3Power));
    console.log("Actual User3 power:", formatEther(votingPowers3[2]));
    
    console.log("Expected User5 power:", formatEther(expectedUser5Power));
    console.log("Actual User5 power:", formatEther(votingPowers3[4]));
    
    // Verify voting power distribution
    expect(votingPowers3[2]).to.equal(expectedUser3Power);
    expect(votingPowers3[4]).to.equal(expectedUser5Power);
    
    // Test voting power persistence across snapshots
    console.log("\n=== TESTING SNAPSHOT CONSISTENCY ===");
    
    // Voting power at snapshot 2 should remain unchanged
    const user5PowerAtSnapshot2 = await token.getEffectiveVotingPower(user5.address, snapshot2);
    console.log("User5 power at snapshot 2 (should still be total):", formatEther(user5PowerAtSnapshot2));
    expect(user5PowerAtSnapshot2).to.equal(totalTokens);
    
    // Create a complex re-delegation
    console.log("\n=== COMPLEX RE-DELEGATION ===");
    
    // User3 (who has User1 and User2 delegated) now delegates to User5
    await token.connect(user3).delegate(user5.address);
    console.log("User3 delegated to User5");
    
    // Create fourth snapshot after re-delegation
    await token.connect(owner).createSnapshot();
    const snapshot4 = await token.getCurrentSnapshotId();
    console.log("Created snapshot after re-delegation:", snapshot4.toString());
    
    await logDelegationState("After User3 -> User5");
    
    // Now User5 should have all voting power again
    const user5PowerAtSnapshot4 = await token.getEffectiveVotingPower(user5.address, snapshot4);
    console.log("\nUser5 power at snapshot 4 (should be total again):", formatEther(user5PowerAtSnapshot4));
    expect(user5PowerAtSnapshot4).to.equal(totalTokens);
    
    // Test with additional mints (changing token supply)
    console.log("\n=== TESTING WITH ADDITIONAL TOKEN MINTING ===");
    
    // Mint additional 10.5 tokens to User1 (who is part of the delegation chain)
    await token.connect(owner).mint(user1.address, ethers.parseEther("10.5"));
    console.log("Minted 10.5 additional tokens to User1");
    
    // Create fifth snapshot after minting
    await token.connect(owner).createSnapshot();
    const snapshot5 = await token.getCurrentSnapshotId();
    console.log("Created snapshot after minting:", snapshot5.toString());
    
    // Check balances after minting
    const user1BalanceAfterMint = await token.balanceOf(user1.address);
    console.log("User1 balance after mint:", formatEther(user1BalanceAfterMint));
    
    // The newly minted tokens aren't automatically delegated, so we need to re-delegate
    await token.connect(user1).delegate(user2.address);
    console.log("User1 re-delegated to User2 (to include new tokens)");
    
    // Create sixth snapshot after re-delegation
    await token.connect(owner).createSnapshot();
    const snapshot6 = await token.getCurrentSnapshotId();
    console.log("Created snapshot after re-delegation:", snapshot6.toString());
    
    await logDelegationState("After Re-delegation with New Tokens");
    
    // Calculate updated total tokens
    const updatedTotalTokens = addBigInts([
      user1BalanceAfterMint,
      initialBalances.user2,
      initialBalances.user3,
      initialBalances.user4,
      initialBalances.user5
    ]);
    
    // Check User5's voting power - should now include the newly minted tokens
    const user5PowerAfterMint = await token.getEffectiveVotingPower(user5.address, snapshot6);
    console.log("\nTotal tokens after mint:", formatEther(updatedTotalTokens));
    console.log("User5 power after re-delegation:", formatEther(user5PowerAfterMint));
    
    // Verify User5 has all voting power including new tokens
    expect(user5PowerAfterMint).to.equal(updatedTotalTokens);
    
    // Final verification - check voting power across different snapshots
    console.log("\n=== FINAL VERIFICATION: VOTING POWER ACROSS SNAPSHOTS ===");
    console.log("Snapshot 1 (Initial)");
    console.log("Snapshot 2 (Full Delegation Chain)");
    console.log("Snapshot 3 (After Breaking at User3)");
    console.log("Snapshot 4 (After User3 -> User5 Re-delegation)");
    console.log("Snapshot 5 (After Minting to User1)");
    console.log("Snapshot 6 (After Re-delegation with New Tokens)");
    
    // Total system voting power should remain consistent at each snapshot
    const totalVotingPower2 = addBigInts(votingPowers2);
    const totalVotingPower3 = addBigInts(votingPowers3);
    
    console.log("\nTotal voting power at snapshot 2:", formatEther(totalVotingPower2));
    console.log("Total voting power at snapshot 3:", formatEther(totalVotingPower3));
    console.log("Total tokens (original):", formatEther(totalTokens));
    console.log("Total tokens (after mint):", formatEther(updatedTotalTokens));
    
    // Verify total voting power conservation
    expect(totalVotingPower2).to.equal(totalTokens);
    expect(totalVotingPower3).to.equal(totalTokens);
    expect(updatedTotalTokens).to.equal(
      totalTokens + BigInt(ethers.parseEther("10.5"))
    );
  });
});

describe("JustTokenUpgradeable - Delegation Fixes", function () {
  let JustToken;
  let token;
  let owner, user1, user2, user3;
  
  // Helper function to handle different ethers versions
  const parseEther = (value) => {
    // Try ethers v5 style
    if (ethers.utils && ethers.utils.parseEther) {
      return ethers.utils.parseEther(value);
    }
    // Try ethers v6 style
    else if (ethers.parseEther) {
      return ethers.parseEther(value);
    }
    // Fallback - manually calculate
    else {
      return ethers.BigNumber.from(value).mul(ethers.BigNumber.from("10").pow(18));
    }
  };
  
  beforeEach(async function () {
    // Get signers
    [owner, user1, user2, user3] = await ethers.getSigners();
    
    // Deploy the fixed token contract
    JustToken = await ethers.getContractFactory("contracts/JustTokenUpgradeable.sol:JustTokenUpgradeable");
    
    // Initialize the proxy with the implementation
    token = await upgrades.deployProxy(
      JustToken, 
      [
        "JustTokenFixed", 
        "JSTF",
        owner.address,
        86400,   // 1 day min lock
        31536000 // 1 year max lock
      ],
      { initializer: "initialize" }
    );
    
    // Mint tokens to test users
    await token.connect(owner).mint(user1.address, parseEther("1000"));
    await token.connect(owner).mint(user2.address, parseEther("2000"));
    await token.connect(owner).mint(user3.address, parseEther("3000"));
  });
  });
  
  describe("Delegation reset mechanism", function () {
    it("should reset delegation when self-delegating", async function () {
      // Create initial snapshot to check voting power later
      await justToken.connect(admin).createSnapshot();
      const initialSnapshotId = await justToken.getCurrentSnapshotId();
      
      // Set up the initial delegation: user1 -> user2
      await justToken.connect(user1).delegate(user2.address);
      
      // Verify the initial delegation worked
      expect(await justToken.getDelegate(user1.address)).to.equal(user2.address);
      expect(await justToken.getCurrentDelegatedVotes(user2.address)).to.equal(ethers.parseEther("1000"));
      
      // Create a snapshot to capture the state after initial delegation
      await justToken.connect(admin).createSnapshot();
      const delegationSnapshotId = await justToken.getCurrentSnapshotId();
      
      // Verify voting power after initial delegation
      expect(await justToken.getEffectiveVotingPower(user1.address, delegationSnapshotId)).to.equal(0);
      const user2VotingPower = await justToken.getEffectiveVotingPower(user2.address, delegationSnapshotId);
      expect(user2VotingPower).to.equal(ethers.parseEther("3000")); // user2's 2000 + user1's 1000
      
      // Now reset by self-delegating
      await justToken.connect(user1).delegate(user1.address);
      
      // Verify delegation was reset
      expect(await justToken.getDelegate(user1.address)).to.equal(user1.address);
      expect(await justToken.getCurrentDelegatedVotes(user2.address)).to.equal(0);
      
      // Create a final snapshot to capture the state after self-delegation
      await justToken.connect(admin).createSnapshot();
      const resetSnapshotId = await justToken.getCurrentSnapshotId();
      
      // Verify voting power after self-delegation reset
      expect(await justToken.getEffectiveVotingPower(user1.address, resetSnapshotId)).to.equal(ethers.parseEther("1000"));
      expect(await justToken.getEffectiveVotingPower(user2.address, resetSnapshotId)).to.equal(ethers.parseEther("2000"));
    });
  
    it("should reset delegation using resetDelegation function", async function () {
      // First set up a delegation: user3 -> user2
      await justToken.connect(user3).delegate(user2.address);
      expect(await justToken.getCurrentDelegatedVotes(user2.address)).to.equal(ethers.parseEther("3000")); // user3's 3000
      
      // Now reset using resetDelegation function
      await justToken.connect(user3).resetDelegation();
      
      // Verify the reset worked
      expect(await justToken.getDelegate(user3.address)).to.equal(user3.address);
    });
  });

describe("Complex Delegation with Chain Breaking", function () {
  let admin, user1, user2, user3, user4, user5, user6;
  let justToken, justGovernance, justTimelock;

  beforeEach(async function () {
    [admin, user1, user2, user3, user4, user5, user6] = await ethers.getSigners();
    
    // Deploy contracts with fully qualified names
    const JustToken = await ethers.getContractFactory("contracts/JustTokenUpgradeable.sol:JustTokenUpgradeable");
    justToken = await upgrades.deployProxy(
      JustToken,
      ["TEST", "TST", admin.address, 86400, 31536000],
      { initializer: "initialize" }
    );
    
    const JustTimelock = await ethers.getContractFactory("contracts/JustTimelockUpgradeable.sol:JustTimelockUpgradeable");
    justTimelock = await upgrades.deployProxy(
      JustTimelock,
      [86400, [admin.address], [admin.address], admin.address],
      { initializer: "initialize" }
    );
    
    const JustGovernance = await ethers.getContractFactory("contracts/JustGovernanceUpgradeable.sol:JustGovernanceUpgradeable");
    justGovernance = await upgrades.deployProxy(
      JustGovernance,
      [
        "TestGov", 
        await justToken.getAddress(), 
        await justTimelock.getAddress(), 
        admin.address, 
        ethers.parseUnits("1", 18), // Low threshold for testing
        86400, 
        86400, 
        ethers.parseUnits("1", 18), 
        0, 
        50, 
        75, 
        25
      ],
      { initializer: "initialize" }
    );
    
    // Rest of your setup code...
  });

});
});
