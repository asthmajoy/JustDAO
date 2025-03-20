const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("JustToken Delegation Test", function () {
  // Test participants
  let deployer, admin, user1, user2, user3, user4, user5;
  
  // Contract instances
  let justToken;
  
  // Test parameters
  const initialSupply = ethers.parseEther("1000");
  const minLockDuration = 60 * 60 * 24; // 1 day
  const maxLockDuration = 60 * 60 * 24 * 30; // 30 days
  
  // Helper function to log delegation state
  async function logDelegationState(message) {
    console.log(`\n--- ${message} ---`);
    
    // Take a snapshot to check effective voting power - using admin account which has GOVERNANCE_ROLE
    // We need to wait for the transaction to complete and then get the snapshot ID
    const tx = await justToken.connect(admin).createSnapshot();
    await tx.wait();
    
    // Get the current snapshot ID after creating a new one
    const snapshotId = await justToken.getCurrentSnapshotId();
    
    for (const [name, user] of [
      ["User1", user1],
      ["User2", user2],
      ["User3", user3],
      ["User4", user4],
      ["User5", user5],
    ]) {
      const userAddress = await user.getAddress();
      const delegate = await justToken.getDelegate(userAddress);
      const balance = await justToken.balanceOf(userAddress);
      const lockedTokens = await justToken.getLockedTokens(userAddress);
      const votingPower = await justToken.getEffectiveVotingPower(userAddress, snapshotId);
      
      console.log(`${name} (${userAddress.slice(0, 6)}...)`);
      console.log(`  Balance: ${ethers.formatEther(balance)} JUST`);
      console.log(`  Locked Tokens: ${ethers.formatEther(lockedTokens)} JUST`);
      console.log(`  Delegating To: ${delegate.slice(0, 6)}...`);
      console.log(`  Effective Voting Power: ${ethers.formatEther(votingPower)} JUST`);
    }
    
    return snapshotId;
  }

  // Helper function to log snapshot data
  async function logSnapshotData(snapshotId, message) {
    console.log(`\n--- ${message} (Snapshot ID: ${snapshotId}) ---`);
    
    for (const [name, user] of [
      ["User1", user1],
      ["User2", user2],
      ["User3", user3],
      ["User4", user4],
      ["User5", user5],
    ]) {
      const userAddress = await user.getAddress();
      const balanceAt = await justToken.balanceOfAt(userAddress, snapshotId);
      const lockedTokensAt = await justToken.getLockedTokensAtSnapshot(userAddress, snapshotId);
      const votingPowerAt = await justToken.getDelegatedToAddressAtSnapshot(userAddress, snapshotId);
      const effectiveVotingPower = await justToken.getEffectiveVotingPower(userAddress, snapshotId);
      
      console.log(`${name} (${userAddress.slice(0, 6)}...)`);
      console.log(`  Balance At: ${ethers.formatEther(balanceAt)} JUST`);
      console.log(`  Locked Tokens At: ${ethers.formatEther(lockedTokensAt)} JUST`);
      console.log(`  Delegated Power At: ${ethers.formatEther(votingPowerAt)} JUST`);
      console.log(`  Effective Voting Power: ${ethers.formatEther(effectiveVotingPower)} JUST`);
    }
  }
  
  beforeEach(async function () {
    // Get signers
    [deployer, admin, user1, user2, user3, user4, user5] = await ethers.getSigners();
    
    // Deploy JustToken implementation
    const justTokenFactory = await ethers.getContractFactory("contracts/JustTokenUpgradeable.sol:JustTokenUpgradeable");
    const justTokenImpl = await justTokenFactory.deploy();
    await justTokenImpl.waitForDeployment();
    const implAddress = await justTokenImpl.getAddress();
    
    // Prepare initialization data
    const initData = justTokenFactory.interface.encodeFunctionData("initialize", [
      "JUST Token",
      "JUST",
      await admin.getAddress(),
      minLockDuration,
      maxLockDuration
    ]);
    
    // Deploy ERC1967Proxy
    const ProxyFactory = await ethers.getContractFactory("ERC1967Proxy");
    
    // Deploy the proxy with correct parameters for ethers v6
    // In ethers v6, ERC1967Proxy takes (implementation, data) as constructor arguments
    const proxy = await ProxyFactory.deploy(
      implAddress,
      initData
    );
    await proxy.waitForDeployment();
    const proxyAddress = await proxy.getAddress();
    
    // Create a contract instance connected to the proxy
    justToken = justTokenFactory.attach(proxyAddress);
    
    // Mint initial tokens to test users
    await justToken.connect(admin).mint(await user1.getAddress(), ethers.parseEther("100"));
    await justToken.connect(admin).mint(await user2.getAddress(), ethers.parseEther("100"));
    await justToken.connect(admin).mint(await user3.getAddress(), ethers.parseEther("100"));
    await justToken.connect(admin).mint(await user4.getAddress(), ethers.parseEther("100"));
    await justToken.connect(admin).mint(await user5.getAddress(), ethers.parseEther("100"));
  });

  it("should correctly handle delegation chains and reset delegation", async function () {
    // Get addresses for users - ethers v6 requires calling getAddress()
    const user1Address = await user1.getAddress();
    const user2Address = await user2.getAddress();
    const user3Address = await user3.getAddress();
    const user4Address = await user4.getAddress();
    const user5Address = await user5.getAddress();

    // Initial state
    let initialSnapshotId = await logDelegationState("Initial State - All users should self-delegate by default");
    
    // Create a delegation chain: user2 -> user1, user3 -> user2, user4 -> user3, user5 -> user4
    await justToken.connect(user2).delegate(user1Address);
    await logDelegationState("After User2 delegates to User1");
    
    await justToken.connect(user3).delegate(user2Address);
    await logDelegationState("After User3 delegates to User2");
    
    await justToken.connect(user4).delegate(user3Address);
    await logDelegationState("After User4 delegates to User3");
    
    await justToken.connect(user5).delegate(user4Address);
    let fullChainSnapshotId = await logDelegationState("After User5 delegates to User4 - Full chain established");
    
    // Verify delegation chain is working correctly
    expect(await justToken.getDelegate(user2Address)).to.equal(user1Address);
    expect(await justToken.getDelegate(user3Address)).to.equal(user2Address);
    expect(await justToken.getDelegate(user4Address)).to.equal(user3Address);
    expect(await justToken.getDelegate(user5Address)).to.equal(user4Address);
    
    // Verify user1 has accumulated voting power from the entire chain
    // Each user has 100 tokens, so user1 should have 500 total voting power
    const user1VotingPower = await justToken.getEffectiveVotingPower(user1Address, fullChainSnapshotId);
    console.log(`\nUser1 total effective voting power: ${ethers.formatEther(user1VotingPower)} JUST`);
    expect(user1VotingPower).to.be.closeTo(
      ethers.parseEther("500"), // 100 from each of the 5 users
      ethers.parseEther("0.1") // Allow small rounding errors
    );
    
    // Now have user3 reset delegation, which should break the chain
    await justToken.connect(user3).resetDelegation();
    let brokenChainSnapshotId = await logDelegationState("After User3 resets delegation - Chain is broken");
    
    // Verify user3 is now self-delegating
    expect(await justToken.getDelegate(user3Address)).to.equal(user3Address);
    
    // Verify the delegation chain is broken:
    // user2 -> user1
    // user3 -> user3 (self)
    // user4 -> user3
    // user5 -> user4
    
    // Check user1's voting power after the chain break
    // Should now have 200 (100 own + 100 from user2)
    const user1VotingPowerAfterBreak = await justToken.getEffectiveVotingPower(user1Address, brokenChainSnapshotId);
    console.log(`\nUser1 effective voting power after chain break: ${ethers.formatEther(user1VotingPowerAfterBreak)} JUST`);
    expect(user1VotingPowerAfterBreak).to.be.closeTo(
      ethers.parseEther("200"),
      ethers.parseEther("0.1")
    );
    
    // Check user3's voting power after self-delegation
    // Should have 300 (100 own + 100 from user4 + 100 from user5 via user4)
    const user3VotingPowerAfterReset = await justToken.getEffectiveVotingPower(user3Address, brokenChainSnapshotId);
    console.log(`\nUser3 effective voting power after self-delegation: ${ethers.formatEther(user3VotingPowerAfterReset)} JUST`);
    expect(user3VotingPowerAfterReset).to.be.closeTo(
      ethers.parseEther("300"),
      ethers.parseEther("0.1")
    );
    
    // Have all remaining users reset delegation
    await justToken.connect(user2).resetDelegation();
    await justToken.connect(user4).resetDelegation();
    await justToken.connect(user5).resetDelegation();
    
    let finalSnapshotId = await logDelegationState("After all users reset delegation");
    
    // Verify all users are self-delegating
    for (const user of [user1, user2, user3, user4, user5]) {
      const userAddress = await user.getAddress();
      expect(await justToken.getDelegate(userAddress)).to.equal(userAddress);
      
      // Each user should have exactly their own balance as voting power (100 JUST)
      const finalVotingPower = await justToken.getEffectiveVotingPower(userAddress, finalSnapshotId);
      expect(finalVotingPower).to.be.closeTo(
        ethers.parseEther("100"),
        ethers.parseEther("0.1")
      );
      
      // No tokens should be locked
      const lockedTokens = await justToken.getLockedTokens(userAddress);
      expect(lockedTokens).to.equal(0);
    }

    // Verify snapshot history is preserved correctly
    console.log("\n--- Verifying Snapshot History ---");
    
    // Check full chain snapshot - User1 should have all power (500)
    const user1HistoryVotingPower = await justToken.getEffectiveVotingPower(user1Address, fullChainSnapshotId);
    console.log(`User1 effective voting power at full chain snapshot: ${ethers.formatEther(user1HistoryVotingPower)} JUST`);
    expect(user1HistoryVotingPower).to.be.closeTo(
      ethers.parseEther("500"),
      ethers.parseEther("0.1")
    );
    
    // Check second snapshot after User3 reset
    const user1SnapshotAfterBreak = await justToken.getEffectiveVotingPower(user1Address, brokenChainSnapshotId);
    console.log(`User1 effective voting power after chain break: ${ethers.formatEther(user1SnapshotAfterBreak)} JUST`);
    expect(user1SnapshotAfterBreak).to.be.closeTo(
      ethers.parseEther("200"),
      ethers.parseEther("0.1")
    );
    
    const user3SnapshotAfterBreak = await justToken.getEffectiveVotingPower(user3Address, brokenChainSnapshotId);
    console.log(`User3 effective voting power after chain break: ${ethers.formatEther(user3SnapshotAfterBreak)} JUST`);
    expect(user3SnapshotAfterBreak).to.be.closeTo(
      ethers.parseEther("300"),
      ethers.parseEther("0.1")
    );
    
    // Check final snapshot - all users back to self-delegation with 100 each
    for (const [name, user] of [
      ["User1", user1],
      ["User2", user2],
      ["User3", user3],
      ["User4", user4],
      ["User5", user5],
    ]) {
      const userAddress = await user.getAddress();
      const finalVotingPower = await justToken.getEffectiveVotingPower(userAddress, finalSnapshotId);
      console.log(`${name} final effective voting power: ${ethers.formatEther(finalVotingPower)} JUST`);
      expect(finalVotingPower).to.be.closeTo(
        ethers.parseEther("100"),
        ethers.parseEther("0.1")
      );
    }
  });

  it("should handle token balance changes with delegation", async function() {
    // Get addresses for users
    const user1Address = await user1.getAddress();
    const user2Address = await user2.getAddress();
    const user3Address = await user3.getAddress();
    const user4Address = await user4.getAddress();
    
    // Setup: Instead of having users delegate and then transfer,
    // we'll set up delegation FIRST, then change balances through mints/burns
    
    // Initial state
    let initialSnapshotId = await logDelegationState("Initial State");
    
    // Create delegation setup
    await justToken.connect(user2).delegate(user1Address);
    await justToken.connect(user3).delegate(user1Address);
    
    let delegationSetupSnapshotId = await logDelegationState("After User2 and User3 delegate to User1");
    
    // Check user1's voting power
    const user1VotingPower = await justToken.getEffectiveVotingPower(user1Address, delegationSetupSnapshotId);
    console.log(`\nUser1 effective voting power: ${ethers.formatEther(user1VotingPower)} JUST`);
    expect(user1VotingPower).to.be.closeTo(
      ethers.parseEther("300"), // 100 each from user1, user2, user3
      ethers.parseEther("0.1")
    );
    
    // Add more tokens to user2
    await justToken.connect(admin).mint(user2Address, ethers.parseEther("50"));
    
    // Re-delegate to update the voting power
    await justToken.connect(user2).delegate(user1Address);
    
    let afterMintSnapshotId = await logDelegationState("After User2 gets more tokens and re-delegates");
    
    // Check if user1's voting power includes user2's new tokens
    const user1VotingPowerAfterMint = await justToken.getEffectiveVotingPower(user1Address, afterMintSnapshotId);
    console.log(`\nUser1 effective voting power after User2 gets more tokens: ${ethers.formatEther(user1VotingPowerAfterMint)} JUST`);
    expect(user1VotingPowerAfterMint).to.be.closeTo(
      ethers.parseEther("350"), // 100 + 150 + 100
      ethers.parseEther("0.1")
    );
    
    // For User3, we'll:
    // 1. Reset delegation (unlock tokens)
    await justToken.connect(user3).resetDelegation();
    
    // 2. Mint tokens to User4 
    await justToken.connect(admin).mint(user4Address, ethers.parseEther("50"));
    
    // 3. Now user3 can burn tokens since they're unlocked
    await justToken.connect(user3).burnTokens(ethers.parseEther("50"));
    
    let afterBurnSnapshotId = await logDelegationState("After User3 resets, User4 gets tokens, and User3 burns tokens");
    
    // Now User3 delegates with just 50 tokens (remaining balance after burn)
    await justToken.connect(user3).delegate(user1Address);
    
    let finalSnapshotId = await logDelegationState("After User3 delegates only 50 tokens to User1");
    
    // Check user1's updated voting power (should be 300 = 100 + 150 + 50)
    const finalUser1VotingPower = await justToken.getEffectiveVotingPower(user1Address, finalSnapshotId);
    console.log(`\nUser1 final effective voting power: ${ethers.formatEther(finalUser1VotingPower)} JUST`);
    expect(finalUser1VotingPower).to.be.closeTo(
      ethers.parseEther("300"), // 100 + 150 + 50
      ethers.parseEther("0.1")
    );
  });
});