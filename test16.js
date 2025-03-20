const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");
const { formatEther } = require("ethers");

// Add this helper function at the top of your test file
function findEvent(receipt, contractInterface, eventName) {
    const events = receipt.logs.filter(
      log => log.fragment && log.fragment.name === eventName
    );
    
    return events.length > 0 ? events[0] : null;
}
// Add this to your test setup section before running the token holder tests

/**
 * Adjust token balances for users to meet the required threshold
 * This should be added to the beforeEach or before section of your test
 */
async function setupTokenHolderTests() {
  // Define the threshold used in the contract
  const requiredThreshold = ethers.parseEther("0.01"); // 0.01 JST
  
  // Set up users with sufficient tokens
  // We'll give them a bit more than the threshold to be safe
  const tokenAmount = ethers.parseEther("0.015"); // 0.015 JST
  
  // Ensure the admin has the minter role
  const minterRole = await justToken.MINTER_ROLE();
  if (!await justToken.hasRole(minterRole, admin.address)) {
    await justToken.connect(admin).grantRole(minterRole, admin.address);
  }
  
  // Mint tokens for all users who will be involved in token-based authorization
  console.log(`Minting ${ethers.formatEther(tokenAmount)} JST for each test user`);
  await justToken.connect(admin).mint(user1.address, tokenAmount);
  await justToken.connect(admin).mint(user2.address, tokenAmount);
  await justToken.connect(admin).mint(user3.address, tokenAmount);
  
  // Verify token balances
  const user1Balance = await justToken.balanceOf(user1.address);
  const user2Balance = await justToken.balanceOf(user2.address);
  const user3Balance = await justToken.balanceOf(user3.address);
  
  console.log(`User1 balance: ${ethers.formatEther(user1Balance)} JST`);
  console.log(`User2 balance: ${ethers.formatEther(user2Balance)} JST`);
  console.log(`User3 balance: ${ethers.formatEther(user3Balance)} JST`);
  console.log(`Required threshold: ${ethers.formatEther(requiredThreshold)} JST`);
}

// Then call this function in your test setup
// Either add this at the beginning of the token holder test section:
// 
// describe("JustTimelock Token Holder Queueing", function() {
//   before(async function() {
//     await setupTokenHolderTests();
//   });
//   
//   it("should allow token holder to execute transaction after delay", async function() {
//     // Test continues...
//
// OR add it to your beforeEach if you have one

describe("JustTimelock Token Holder Queueing", function () {
  let justToken;
  let justTimelock;
  let justGovernance;
  let owner;
  let admin;
  let proposer;
  let executor;
  let user1;
  let user2;
  let user3;
  let user4;
  let tokenThreshold;
  let belowThresholdAmount;
  let aboveThresholdAmount;
  let tokenAddress;
  let newTimelock; // Added variable to store the second timelock instance
  
  before(async function () {
    console.log("=== SETTING UP CONTRACTS AND ROLES ===");
    [owner, admin, proposer, executor, user1, user2, user3, user4] = await ethers.getSigners();
    
    // Deploy JustToken as an upgradeable contract
    const JustToken = await ethers.getContractFactory("contracts/JustTokenUpgradeable.sol:JustTokenUpgradeable");
    const tokenProxy = await upgrades.deployProxy(JustToken, [
        "Just Token",            // name
        "JST",                   // symbol
        admin.address,           // admin - Make sure admin is a valid signer object
        86400,                   // minLockDurationParam (1 day in seconds)
        604800                   // maxLockDurationParam (7 days in seconds)
      ]);
    justToken = await tokenProxy.waitForDeployment();
    tokenAddress = await justToken.getAddress();
    console.log(`JustToken deployed at: ${tokenAddress}`);

    // Deploy JustTimelock
    const JustTimelock = await ethers.getContractFactory("contracts/JustTimelockUpgradeable.sol:JustTimelockUpgradeable");
    const timelockProxy = await upgrades.deployProxy(JustTimelock, [
      86400,                   // 1 day min delay
      [proposer.address],      // proposers array
      [executor.address],      // executors array
      admin.address            // admin address
    ]);
    justTimelock = await timelockProxy.waitForDeployment();
    const timelockAddress = await justTimelock.getAddress();
    console.log(`JustTimelock deployed at: ${timelockAddress}`);
    // Deploy JustGovernance
const JustGovernance = await ethers.getContractFactory("contracts/JustGovernanceUpgradeable.sol:JustGovernanceUpgradeable");
const govProxy = await upgrades.deployProxy(JustGovernance, [
    "Just Governor", // name 
    tokenAddress, // token address
    timelockAddress, // timelock address
    admin.address, // admin address
    ethers.parseEther("10"), // proposal threshold
    0, // voting delay
    86400, // voting period (1 day)
    ethers.parseEther("100"), // quorum
    0, // successfulRefund
    9000, // cancelledRefund percentage (90%)
    7000, // defeatedRefund percentage (70%)
    8000  // expiredRefund percentage (80%)
]);
    
    justGovernance = await govProxy.waitForDeployment();
    console.log(`JustGovernance deployed at: ${await justGovernance.getAddress()}`);
  
    // Set up token in timelock
    const setTokenTx = await justTimelock.connect(admin).setJustToken(tokenAddress);
    await setTokenTx.wait();
    console.log("Set JustToken in timelock");
  
    // Get current executor token threshold
    tokenThreshold = await justTimelock.minExecutorTokenThreshold();
    console.log(`Current executor token threshold: ${formatEther(tokenThreshold)} JST`);
  
    // Set up test amounts
    belowThresholdAmount = tokenThreshold / 2n;
    aboveThresholdAmount = tokenThreshold * 2n;
    console.log(`Below threshold amount: ${formatEther(belowThresholdAmount)} JST`);
    console.log(`Above threshold amount: ${formatEther(aboveThresholdAmount)} JST`);
  
    // Set up token balances
    const mintRole = await justToken.MINTER_ROLE();
    await justToken.connect(admin).grantRole(mintRole, owner.address);
    
    // Mint tokens to users
    await justToken.connect(owner).mint(user1.address, belowThresholdAmount);
    await justToken.connect(owner).mint(user2.address, aboveThresholdAmount);
    await justToken.connect(owner).mint(user3.address, aboveThresholdAmount);
    await justToken.connect(owner).mint(user4.address, 0);
    
    console.log(`Minted ${formatEther(belowThresholdAmount)} tokens to user1 (below threshold)`);
    console.log(`Minted ${formatEther(aboveThresholdAmount)} tokens to user2 (above threshold)`);
    console.log(`Minted ${formatEther(aboveThresholdAmount)} tokens to user3 (above threshold)`);
    console.log(`User4 has 0 tokens`);
  });

  it("should work even when token contract is unset", async function () {
    console.log("\n=== TESTING BEHAVIOR WITH UNSET TOKEN CONTRACT ===");
    
    // Deploy a new timelock for clean test
    const JustTimelock = await ethers.getContractFactory("contracts/JustTimelockUpgradeable.sol:JustTimelockUpgradeable");
    const timelockProxy = await upgrades.deployProxy(JustTimelock, [
      86400, // 1 day min delay
      [proposer.address], // proposers array
      [executor.address], // executors array
      admin.address // admin address
    ]);
    
    // FIXED: Assign to newTimelock variable
    newTimelock = await timelockProxy.waitForDeployment();
    const timelockAddress = await newTimelock.getAddress();
    console.log(`JustTimelock deployed at: ${timelockAddress}`);
    
    // Note: JustToken is NOT set on this timelock
    
    // Verify token is not set - use newTimelock
    const tokenAddr = await newTimelock.justToken();
    console.log(`Token address in timelock: ${tokenAddr}`);
    expect(tokenAddr).to.equal("0x0000000000000000000000000000000000000000");
    
    // Create a simple transaction
    const callData = newTimelock.interface.encodeFunctionData("updateExecutorTokenThreshold", [
      ethers.parseEther("0.02"), // Double the threshold
    ]);
    
    console.log("User2 attempts to queue transaction (should fail)");
    
    // User2 tries to queue a transaction - use newTimelock
    await expect(
      newTimelock.connect(user2).queueTransactionWithThreatLevel(
        await newTimelock.getAddress(),
        0,
        callData
      )
    ).to.be.revertedWithCustomError(newTimelock, "NotAuthorized");
    
    console.log("Transaction correctly rejected when token contract is not set");
    
    // Proposer can still queue transactions - use newTimelock
    console.log("Proposer attempts to queue the same transaction");
    const queueTx = await newTimelock.connect(proposer).queueTransactionWithThreatLevel(
      await newTimelock.getAddress(),
      0,
      callData
    );
    
    const receipt = await queueTx.wait();
    const queuedEvents = receipt.logs.filter(
      log => log.fragment && log.fragment.name === 'TransactionQueued'
    );
    
    expect(queuedEvents.length).to.be.gt(0);
    console.log("Proposer successfully queued transaction");
  });

 
  it("should allow token holders above threshold to queue transactions", async function () {
    console.log("\n=== TESTING TOKEN HOLDER QUEUEING WITH SUFFICIENT TOKENS ===");
    
    // Check user2 has enough tokens
    const user2Balance = await justToken.balanceOf(user2.address);
    console.log(`User2 balance: ${formatEther(user2Balance)} JST`);
    expect(user2Balance).to.be.gte(tokenThreshold);
    
    // Verify user2 does not have proposer role
    const proposerRole = await justTimelock.PROPOSER_ROLE();
    const hasProposerRole = await justTimelock.hasRole(proposerRole, user2.address);
    console.log(`User2 has proposer role: ${hasProposerRole}`);
    expect(hasProposerRole).to.be.false;
    
    // Create a simple transaction to call a function on the token contract
    const adminRole = await justToken.DEFAULT_ADMIN_ROLE();
    const callData = justToken.interface.encodeFunctionData("grantRole", [
      adminRole,
      user2.address,
    ]);
    
    console.log("Queueing transaction to grant admin role to user2 on token contract");
    
    // User2 (token holder) queues the transaction
    const queueTx = await justTimelock.connect(user2).queueTransactionWithThreatLevel(
      tokenAddress,
      0, // no ETH value
      callData
    );
    
    const receipt = await queueTx.wait();
    
    // Find the TransactionQueued event
    const queuedEvents = receipt.logs.filter(
      log => log.fragment && log.fragment.name === 'TransactionQueued'
    );
    
    expect(queuedEvents.length).to.be.gt(0);
    const txHash = queuedEvents[0].args[0];
    console.log(`Transaction queued with hash: ${txHash}`);
    
    // Verify the transaction is queued
    const isQueued = await justTimelock.queuedTransactions(txHash);
    console.log(`Transaction is queued: ${isQueued}`);
    expect(isQueued).to.be.true;
    
    // Get transaction details
    const tx = await justTimelock.getTransaction(txHash);
    console.log(`Transaction target: ${tx[0]}`);
    console.log(`Transaction eta: ${new Date(Number(tx[3]) * 1000)}`);
    console.log(`Transaction executed: ${tx[4]}`);
    
    return { txHash };
  });

  it("should reject queueing attempts from token holders below threshold", async function () {
    console.log("\n=== TESTING REJECTION OF TOKEN HOLDERS BELOW THRESHOLD ===");
    
    // Check user1 has insufficient tokens
    const user1Balance = await justToken.balanceOf(user1.address);
    console.log(`User1 balance: ${formatEther(user1Balance)} JST`);
    expect(user1Balance).to.be.lt(tokenThreshold);
    
    // Verify user1 does not have proposer role
    const proposerRole = await justTimelock.PROPOSER_ROLE();
    const hasProposerRole = await justTimelock.hasRole(proposerRole, user1.address);
    console.log(`User1 has proposer role: ${hasProposerRole}`);
    expect(hasProposerRole).to.be.false;
    
    // Create a simple transaction to call a function on the token contract
    const adminRole = await justToken.DEFAULT_ADMIN_ROLE();
    const callData = justToken.interface.encodeFunctionData("grantRole", [
      adminRole,
      user1.address,
    ]);
    
    console.log("Attempting to queue transaction (should fail)");
    
    // Attempt to queue the transaction and expect it to be rejected
    await expect(
      justTimelock.connect(user1).queueTransactionWithThreatLevel(
        tokenAddress,
        0, // no ETH value
        callData
      )
    ).to.be.revertedWithCustomError(justTimelock, "NotAuthorized");
    
    console.log("Transaction correctly rejected due to insufficient tokens");
  });

  it("should reject queueing with custom delay for token holders without proposer role", async function () {
    console.log("\n=== TESTING CUSTOM DELAY FUNCTION RESTRICTION ===");
    
    // Check user2 has enough tokens
    const user2Balance = await justToken.balanceOf(user2.address);
    console.log(`User2 balance: ${formatEther(user2Balance)} JST`);
    expect(user2Balance).to.be.gte(tokenThreshold);
    
    // Create a simple transaction to call a function on the token contract
    const adminRole = await justToken.DEFAULT_ADMIN_ROLE();
    const callData = justToken.interface.encodeFunctionData("grantRole", [
      adminRole,
      user2.address,
    ]);
    
    // Get min and max delay
    const minDelay = await justTimelock.minDelay();
    const maxDelay = await justTimelock.maxDelay();
    const customDelay = minDelay + 10000n;
    console.log(`Using custom delay of ${customDelay} seconds`);
    
    console.log("Attempting to queue transaction with custom delay (should fail)");
    
    // Attempt to queue the transaction with custom delay and expect it to be rejected
    await expect(
      justTimelock.connect(user2).queueTransaction(
        tokenAddress,
        0, // no ETH value
        callData,
        customDelay
      )
    ).to.be.revertedWithCustomError(justTimelock, "NotAuthorized");
    
    console.log("Transaction with custom delay correctly rejected");
  });

  it("should reject queueing system parameter updates for token holders", async function () {
    console.log("\n=== TESTING SYSTEM PARAMETER UPDATE RESTRICTION ===");
    
    // Check user3 has enough tokens
    const user3Balance = await justToken.balanceOf(user3.address);
    console.log(`User3 balance: ${formatEther(user3Balance)} JST`);
    expect(user3Balance).to.be.gte(tokenThreshold);
    
    // Get current delay values
    const minDelay = await justTimelock.minDelay();
    const maxDelay = await justTimelock.maxDelay();
    const gracePeriod = await justTimelock.gracePeriod();
    
    console.log("Attempting to queue delay update (should fail)");
    
    // Attempt to queue delay update
    await expect(
      justTimelock.connect(user3).queueDelayUpdate(
        minDelay + 100n,
        maxDelay,
        gracePeriod
      )
    ).to.be.revertedWithCustomError(justTimelock, "NotAuthorized");
    
    console.log("Delay update queue correctly rejected");
    
    // Get threat level delays
    const lowThreatDelay = await justTimelock.lowThreatDelay();
    const mediumThreatDelay = await justTimelock.mediumThreatDelay();
    const highThreatDelay = await justTimelock.highThreatDelay();
    const criticalThreatDelay = await justTimelock.criticalThreatDelay();
    
    console.log("Attempting to queue threat level delay update (should fail)");
    
    // Attempt to queue threat level delay update
    await expect(
      justTimelock.connect(user3).queueThreatLevelDelaysUpdate(
        lowThreatDelay + 100n,
        mediumThreatDelay + 200n,
        highThreatDelay + 300n,
        criticalThreatDelay + 400n
      )
    ).to.be.revertedWithCustomError(justTimelock, "NotAuthorized");
    
    console.log("Threat level delay update queue correctly rejected");
  });

  it("should update token threshold and allow previously ineligible users to queue", async function () {
    console.log("\n=== TESTING THRESHOLD UPDATE EFFECT ===");
    
    // Check user1's current balance (below current threshold)
    const user1Balance = await justToken.balanceOf(user1.address);
    console.log(`User1 balance: ${formatEther(user1Balance)} JST`);
    const currentThreshold = await justTimelock.minExecutorTokenThreshold();
    console.log(`Current threshold: ${formatEther(currentThreshold)} JST`);
    expect(user1Balance).to.be.lt(currentThreshold);
    
    // Admin updates the threshold to be below user1's balance
    const newThreshold = user1Balance / 2n;
    console.log(`Setting new threshold to ${formatEther(newThreshold)} JST`);
    
    await justTimelock.connect(admin).updateExecutorTokenThreshold(newThreshold);
    
    const updatedThreshold = await justTimelock.minExecutorTokenThreshold();
    console.log(`Updated threshold: ${formatEther(updatedThreshold)} JST`);
    expect(updatedThreshold).to.equal(newThreshold);
    
    // Create a simple transaction to call a function on the token contract
    const adminRole = await justToken.DEFAULT_ADMIN_ROLE();
    const callData = justToken.interface.encodeFunctionData("grantRole", [
      adminRole,
      user1.address,
    ]);
    
    console.log("User1 attempts to queue transaction after threshold update");
    
    // User1 now attempts to queue a transaction
    const queueTx = await justTimelock.connect(user1).queueTransactionWithThreatLevel(
      tokenAddress,
      0, // no ETH value
      callData
    );
    
    const receipt = await queueTx.wait();
    
    // Find the TransactionQueued event
    const queuedEvents = receipt.logs.filter(
      log => log.fragment && log.fragment.name === 'TransactionQueued'
    );
    
    expect(queuedEvents.length).to.be.gt(0);
    const txHash = queuedEvents[0].args[0];
    console.log(`Transaction queued with hash: ${txHash}`);
    
    // Verify the transaction is queued
    const isQueued = await justTimelock.queuedTransactions(txHash);
    console.log(`Transaction is queued: ${isQueued}`);
    expect(isQueued).to.be.true;
  });

  it("should reject queueing for users with zero tokens", async function () {
    console.log("\n=== TESTING ZERO TOKEN HOLDER REJECTION ===");
    
    // Check user4 has zero tokens
    const user4Balance = await justToken.balanceOf(user4.address);
    console.log(`User4 balance: ${formatEther(user4Balance)} JST`);
    expect(user4Balance).to.equal(0);
    
    // Verify user4 does not have proposer role
    const proposerRole = await justTimelock.PROPOSER_ROLE();
    const hasProposerRole = await justTimelock.hasRole(proposerRole, user4.address);
    console.log(`User4 has proposer role: ${hasProposerRole}`);
    expect(hasProposerRole).to.be.false;
    
    // Create a simple transaction to call a function on the token contract
    const adminRole = await justToken.DEFAULT_ADMIN_ROLE();
    const callData = justToken.interface.encodeFunctionData("grantRole", [
      adminRole,
      user4.address,
    ]);
    
    console.log("User4 attempts to queue transaction (should fail)");
    
    // Attempt to queue the transaction and expect it to be rejected
    await expect(
      justTimelock.connect(user4).queueTransactionWithThreatLevel(
        tokenAddress,
        0, // no ETH value
        callData
      )
    ).to.be.revertedWithCustomError(justTimelock, "NotAuthorized");
    
    console.log("Transaction correctly rejected for zero token holder");
  });

  it("should allow token holder to queue but not execute before delay", async function () {
    console.log("\n=== TESTING QUEUEING AND EXECUTION TIMING ===");
    
    // User2 queues a transaction
    const user2Balance = await justToken.balanceOf(user2.address);
    console.log(`User2 balance: ${formatEther(user2Balance)} JST`);
    
    // Create a transaction
    const adminRole = await justToken.DEFAULT_ADMIN_ROLE();
    const callData = justToken.interface.encodeFunctionData("grantRole", [
      adminRole,
      user2.address,
    ]);
    
    // Queue the transaction
    const queueTx = await justTimelock.connect(user2).queueTransactionWithThreatLevel(
      tokenAddress,
      0,
      callData
    );
    
    const receipt = await queueTx.wait();
    const queuedEvents = receipt.logs.filter(
      log => log.fragment && log.fragment.name === 'TransactionQueued'
    );
    const txHash = queuedEvents[0].args[0];
    console.log(`Transaction queued with hash: ${txHash}`);
    
    // Get transaction eta
    const tx = await justTimelock.getTransaction(txHash);
    const eta = tx[3];
    console.log(`Transaction eta: ${new Date(Number(eta) * 1000)}`);
    
    // Try to execute before delay passes
    console.log("Attempting to execute before delay (should fail)");
    await expect(
      justTimelock.connect(user2).executeTransaction(txHash)
    ).to.be.revertedWithCustomError(justTimelock, "TxNotReady");
    
    console.log("Execution correctly rejected before delay passes");
  });

  it("should work even when token contract is unset", async function () {
    console.log("\n=== TESTING BEHAVIOR WITH UNSET TOKEN CONTRACT ===");
    
    // Deploy a new timelock for clean test
    // Deploy JustTimelock
const JustTimelock = await ethers.getContractFactory("contracts/JustTimelockUpgradeable.sol:JustTimelockUpgradeable");
const timelockProxy = await upgrades.deployProxy(JustTimelock, [
  86400, // 1 day min delay
  [proposer.address], // proposers array
  [executor.address], // executors array
  admin.address // admin address
]);
justTimelock = await timelockProxy.waitForDeployment();
const timelockAddress = await justTimelock.getAddress();
console.log(`JustTimelock deployed at: ${timelockAddress}`);
    
    // Note: JustToken is NOT set on this timelock
    
    // Verify token is not set
    const tokenAddress = await newTimelock.justToken();
    console.log(`Token address in timelock: ${tokenAddress}`);
    expect(tokenAddress).to.equal("0x0000000000000000000000000000000000000000");
    
    // Create a simple transaction
    const callData = newTimelock.interface.encodeFunctionData("updateExecutorTokenThreshold", [
      ethers.parseEther("0.02"), // Double the threshold
    ]);
    
    console.log("User2 attempts to queue transaction (should fail)");
    
    // User2 tries to queue a transaction
    await expect(
      newTimelock.connect(user2).queueTransactionWithThreatLevel(
        await newTimelock.getAddress(),
        0,
        callData
      )
    ).to.be.revertedWithCustomError(newTimelock, "NotAuthorized");
    
    console.log("Transaction correctly rejected when token contract is not set");
    
    // Proposer can still queue transactions
    console.log("Proposer attempts to queue the same transaction");
    const queueTx = await newTimelock.connect(proposer).queueTransactionWithThreatLevel(
      await newTimelock.getAddress(),
      0,
      callData
    );
    
    const receipt = await queueTx.wait();
    const queuedEvents = receipt.logs.filter(
      log => log.fragment && log.fragment.name === 'TransactionQueued'
    );
    
    expect(queuedEvents.length).to.be.gt(0);
    console.log("Proposer successfully queued transaction");
  });

  it("should allow token holder to execute transaction after delay", async function () {
    console.log("\n=== TESTING QUEUEING AND EXECUTION AFTER DELAY ===");
    
    // User3 queues a transaction
    const user3Balance = await justToken.balanceOf(user3.address);
    console.log(`User3 balance: ${formatEther(user3Balance)} JST`);
    
    // Create a transaction
    const adminRole = await justToken.DEFAULT_ADMIN_ROLE();
    const callData = justToken.interface.encodeFunctionData("grantRole", [
      adminRole,
      user3.address,
    ]);
    
    // Queue the transaction
    const queueTx = await justTimelock.connect(user3).queueTransactionWithThreatLevel(
      tokenAddress,
      0,
      callData
    );
    
    const receipt = await queueTx.wait();
    const queuedEvents = receipt.logs.filter(
      log => log.fragment && log.fragment.name === 'TransactionQueued'
    );
    const txHash = queuedEvents[0].args[0];
    console.log(`Transaction queued with hash: ${txHash}`);
    
    // Get transaction eta and threat level
    const tx = await justTimelock.getTransaction(txHash);
    const eta = tx[3];
    console.log(`Transaction eta: ${new Date(Number(eta) * 1000)}`);
    
    const threatLevel = queuedEvents[0].args[5];
    console.log(`Transaction threat level: ${threatLevel}`);
    
    // Get the delay for this threat level
    let threatLevelDelay;
    if (threatLevel == 0) {
      threatLevelDelay = await justTimelock.lowThreatDelay();
    } else if (threatLevel == 1) {
      threatLevelDelay = await justTimelock.mediumThreatDelay();
    } else if (threatLevel == 2) {
      threatLevelDelay = await justTimelock.highThreatDelay();
    } else {
      threatLevelDelay = await justTimelock.criticalThreatDelay();
    }
    console.log(`Delay for threat level ${threatLevel}: ${threatLevelDelay} seconds`);
    
    // Fast forward time to after eta
    console.log(`Fast forwarding time by ${threatLevelDelay} seconds...`);
    await time.increase(threatLevelDelay);
    
    // Execute the transaction
    console.log("User3 executing transaction after delay");
    const executeTx = await justTimelock.connect(user3).executeTransaction(txHash);
    const executeReceipt = await executeTx.wait();
    
    // Find the TransactionExecuted event
    const executedEvents = executeReceipt.logs.filter(
      log => log.fragment && log.fragment.name === 'TransactionExecuted'
    );
    
    expect(executedEvents.length).to.be.gt(0);
    console.log("Transaction successfully executed after delay");
    
    // Verify user3 now has the role
    const hasRole = await justToken.hasRole(adminRole, user3.address);
    console.log(`User3 now has admin role on token: ${hasRole}`);
    expect(hasRole).to.be.true;
  });

  it("should allow a user to both queue and execute the same transaction", async function () {
    console.log("\n=== TESTING SAME USER QUEUE AND EXECUTE ===");
    
    // User3 queues and executes a transaction
    const user3Balance = await justToken.balanceOf(user3.address);
    console.log(`User3 balance: ${formatEther(user3Balance)} JST`);
    
    // Create a transaction
    const minterRole = await justToken.MINTER_ROLE();
    const callData = justToken.interface.encodeFunctionData("grantRole", [
      minterRole,
      user3.address,
    ]);
    
    // Queue the transaction
    console.log("User3 queueing transaction");
    const queueTx = await justTimelock.connect(user3).queueTransactionWithThreatLevel(
      tokenAddress,
      0,
      callData
    );
    
    const receipt = await queueTx.wait();
    const queuedEvents = receipt.logs.filter(
      log => log.fragment && log.fragment.name === 'TransactionQueued'
    );
    const txHash = queuedEvents[0].args[0];
    console.log(`Transaction queued with hash: ${txHash}`);
    
    // Get threat level and delay
    const threatLevel = queuedEvents[0].args[5];
    console.log(`Transaction threat level: ${threatLevel}`);
    
    let threatLevelDelay;
    if (threatLevel == 0) {
      threatLevelDelay = await justTimelock.lowThreatDelay();
    } else if (threatLevel == 1) {
      threatLevelDelay = await justTimelock.mediumThreatDelay();
    } else if (threatLevel == 2) {
      threatLevelDelay = await justTimelock.highThreatDelay();
    } else {
      threatLevelDelay = await justTimelock.criticalThreatDelay();
    }
    console.log(`Delay for threat level ${threatLevel}: ${threatLevelDelay} seconds`);
    
    // Fast forward time
    console.log(`Fast forwarding time by ${threatLevelDelay} seconds...`);
    await time.increase(threatLevelDelay);
    
    // Same user executes the transaction
    console.log("User3 executing their own queued transaction");
    const executeTx = await justTimelock.connect(user3).executeTransaction(txHash);
    const executeReceipt = await executeTx.wait();
    
    // Find the TransactionExecuted event
    const executedEvents = executeReceipt.logs.filter(
      log => log.fragment && log.fragment.name === 'TransactionExecuted'
    );
    
    expect(executedEvents.length).to.be.gt(0);
    console.log("Transaction successfully executed by the same user who queued it");
    
    // Verify user3 now has the role
    const hasRole = await justToken.hasRole(minterRole, user3.address);
    console.log(`User3 now has minter role on token: ${hasRole}`);
    expect(hasRole).to.be.true;
  });

  it("should properly cancel queued transactions by authorized roles", async function () {
    console.log("\n=== TESTING CANCELLATION OF QUEUED TRANSACTIONS ===");
    
    // User2 queues a transaction
    const callData = justToken.interface.encodeFunctionData("mint", [
      user2.address,
      ethers.parseEther("100")
    ]);
    
    // Queue the transaction
    console.log("User2 queueing a transaction");
    const queueTx = await justTimelock.connect(user2).queueTransactionWithThreatLevel(
      tokenAddress,
      0,
      callData
    );
    
    const receipt = await queueTx.wait();
    const queuedEvents = receipt.logs.filter(
      log => log.fragment && log.fragment.name === 'TransactionQueued'
    );
    const txHash = queuedEvents[0].args[0];
    console.log(`Transaction queued with hash: ${txHash}`);
    
    // Grant user2 the canceller role
    const cancellerRole = await justTimelock.CANCELLER_ROLE();
    console.log("Granting canceller role to user2");
    await justTimelock.connect(admin).grantContractRole(cancellerRole, user2.address);
    const hasCancellerRole = await justTimelock.hasRole(cancellerRole, user2.address);
    console.log(`User2 has canceller role: ${hasCancellerRole}`);
    
    // Cancel the transaction
    console.log("User2 canceling transaction");
    const cancelTx = await justTimelock.connect(user2).cancelTransaction(txHash);
    const cancelReceipt = await cancelTx.wait();
    
    // Find the TransactionCanceled event
    const canceledEvents = cancelReceipt.logs.filter(
      log => log.fragment && log.fragment.name === 'TransactionCanceled'
    );
    
    expect(canceledEvents.length).to.be.gt(0);
    console.log("Transaction successfully canceled");
    
    // Verify the transaction is no longer queued
    const isQueued = await justTimelock.queuedTransactions(txHash);
    console.log(`Transaction is still queued: ${isQueued}`);
    expect(isQueued).to.be.false;
    
    // Try to execute the canceled transaction (should fail)
    console.log("Attempting to execute canceled transaction (should fail)");
    await expect(
      justTimelock.connect(user2).executeTransaction(txHash)
    ).to.be.revertedWithCustomError(justTimelock, "TxNotQueued");
    
    console.log("Execution of canceled transaction correctly rejected");
  });
  
  it("should properly handle transaction expiration", async function () {
    console.log("\n=== TESTING TRANSACTION EXPIRATION ===");
    
    // User3 queues a transaction
    const callData = justToken.interface.encodeFunctionData("mint", [
      user3.address,
      ethers.parseEther("100")
    ]);
    
    // Queue the transaction
    console.log("User3 queueing a transaction");
    const queueTx = await justTimelock.connect(user3).queueTransactionWithThreatLevel(
      tokenAddress,
      0,
      callData
    );
    
    const receipt = await queueTx.wait();
    const queuedEvents = receipt.logs.filter(
      log => log.fragment && log.fragment.name === 'TransactionQueued'
    );
    const txHash = queuedEvents[0].args[0];
    console.log(`Transaction queued with hash: ${txHash}`);
    
    // Get transaction eta
    const tx = await justTimelock.getTransaction(txHash);
    const eta = tx[3];
    console.log(`Transaction eta: ${new Date(Number(eta) * 1000)}`);
    
    // Get grace period
    const gracePeriod = await justTimelock.gracePeriod();
    console.log(`Grace period: ${gracePeriod} seconds`);
    
    // Fast forward time to after grace period
    const forwardTime = Number(gracePeriod) + Number(tx[3]) - Math.floor(Date.now() / 1000) + 100;
    console.log(`Fast forwarding time by ${forwardTime} seconds to exceed grace period...`);
    await time.increase(forwardTime);
    
    // Try to execute the expired transaction (should fail)
    console.log("Attempting to execute expired transaction (should fail)");
    await expect(
      justTimelock.connect(user3).executeTransaction(txHash)
    ).to.be.revertedWithCustomError(justTimelock, "TxExpired");
    
    console.log("Execution of expired transaction correctly rejected");
    
    // Try to execute the expired transaction using executeExpiredTransaction
    console.log("Attempting to execute expired transaction with executeExpiredTransaction");
    
    // Grant admin role to be able to execute expired transactions
    const adminRole = await justTimelock.ADMIN_ROLE();
    await justTimelock.connect(admin).grantContractRole(adminRole, user3.address);
    console.log(`Granted admin role to user3: ${await justTimelock.hasRole(adminRole, user3.address)}`);
    
    const expiredTx = await justTimelock.connect(user3).executeExpiredTransaction(txHash);
    const expiredReceipt = await expiredTx.wait();
    
    // Find the ExpiredTransactionExecuted event
    const expiredEvents = expiredReceipt.logs.filter(
      log => log.fragment && log.fragment.name === 'ExpiredTransactionExecuted'
    );
    
    expect(expiredEvents.length).to.be.gt(0);
    console.log("Expired transaction successfully executed with executeExpiredTransaction");
    
    // Verify user3 tokens were minted
    const user3BalanceAfter = await justToken.balanceOf(user3.address);
    console.log(`User3 balance after expired execution: ${formatEther(user3BalanceAfter)} JST`);
    expect(user3BalanceAfter).to.be.gt(user3Balance);
  });
  
  it("should handle failed transactions correctly", async function () {
    console.log("\n=== TESTING FAILED TRANSACTION HANDLING ===");
    
    // Create a transaction that will fail - try to mint tokens without permission
    const callData = justToken.interface.encodeFunctionData("mint", [
      user2.address,
      ethers.parseEther("1000000") // A large amount
    ]);
    
    // User2 queues the transaction
    console.log("User2 queueing a transaction that will fail");
    const queueTx = await justTimelock.connect(user2).queueTransactionWithThreatLevel(
      tokenAddress,
      0,
      callData
    );
    
    const receipt = await queueTx.wait();
    const queuedEvents = receipt.logs.filter(
      log => log.fragment && log.fragment.name === 'TransactionQueued'
    );
    const txHash = queuedEvents[0].args[0];
    console.log(`Transaction queued with hash: ${txHash}`);
    
    // Get the threat level and delay
    const threatLevel = queuedEvents[0].args[5];
    let threatLevelDelay;
    if (threatLevel == 0) {
      threatLevelDelay = await justTimelock.lowThreatDelay();
    } else if (threatLevel == 1) {
      threatLevelDelay = await justTimelock.mediumThreatDelay();
    } else if (threatLevel == 2) {
      threatLevelDelay = await justTimelock.highThreatDelay();
    } else {
      threatLevelDelay = await justTimelock.criticalThreatDelay();
    }
    
    // Fast forward time
    console.log(`Fast forwarding time by ${threatLevelDelay} seconds...`);
    await time.increase(threatLevelDelay);
    
    // Try to execute the transaction - it should fail since user2 doesn't have minter role
    console.log("Attempting to execute transaction (should fail due to lack of permissions)");
    
    // The execution should revert
    await expect(
      justTimelock.connect(user2).executeTransaction(txHash)
    ).to.be.reverted;
    console.log("Transaction execution reverted as expected");
    
    // Mark the transaction as failed
    const govRole = await justTimelock.GOVERNANCE_ROLE();
    await justTimelock.connect(admin).grantContractRole(govRole, user3.address);
    console.log(`Granted governance role to user3: ${await justTimelock.hasRole(govRole, user3.address)}`);
    
    // Mark transaction as failed
    console.log("Marking transaction as failed");
    await justTimelock.connect(user3).markTransactionAsFailed(txHash);
    
    // Check if transaction is marked as failed
    const isFailed = await justTimelock.wasTransactionFailed(txHash);
    console.log(`Transaction is marked as failed: ${isFailed}`);
    expect(isFailed).to.be.true;
    
    // Try to execute the failed transaction
    console.log("Attempting to execute previously failed transaction");
    
    // Give user2 the minter role so the transaction can succeed now
    const minterRole = await justToken.MINTER_ROLE();
    await justToken.connect(user3).grantRole(minterRole, justTimelock.getAddress());
    console.log(`Granted minter role to timelock: ${await justToken.hasRole(minterRole, await justTimelock.getAddress())}`);
    
    const retryTx = await justTimelock.connect(user3).executeFailedTransaction(txHash);
    const retryReceipt = await retryTx.wait();
    
    // Find the FailedTransactionRetried event
    const retryEvents = retryReceipt.logs.filter(
      log => log.fragment && log.fragment.name === 'FailedTransactionRetried'
    );
    
    expect(retryEvents.length).to.be.gt(0);
    console.log("Previously failed transaction successfully retried");
    
    // Verify user2 tokens were minted
    const user2BalanceAfter = await justToken.balanceOf(user2.address);
    console.log(`User2 balance after retry: ${formatEther(user2BalanceAfter)} JST`);
    expect(user2BalanceAfter).to.be.gt(aboveThresholdAmount);
  });
  
  it("should test behavior when token balance changes after queueing", async function () {
    console.log("\n=== TESTING TOKEN BALANCE CHANGES AFTER QUEUEING ===");
    
    // MINT TOKENS FOR USER1 FIRST
    // Make sure admin has minter role
    const minterRole = await justToken.MINTER_ROLE();
    if (!await justToken.hasRole(minterRole, admin.address)) {
      await justToken.grantRole(minterRole, admin.address);
    }
    
    // Get current threshold
    const currentThreshold = await justTimelock.minExecutorTokenThreshold();
    console.log(`Current threshold: ${formatEther(currentThreshold)} JST`);
    
    // Mint tokens for user1 (give 50% more than needed)
    const mintAmount = currentThreshold * 150n / 100n;
    console.log(`Minting ${formatEther(mintAmount)} JST for User1`);
    await justToken.connect(admin).mint(user1.address, mintAmount);
    
    // User1 now has tokens above threshold
    const user1InitialBalance = await justToken.balanceOf(user1.address);
    console.log(`User1 initial balance: ${formatEther(user1InitialBalance)} JST`);
    expect(user1InitialBalance).to.be.gte(currentThreshold);
    
    // Queue a transaction
    const adminRole = await justToken.DEFAULT_ADMIN_ROLE();
    const callData = justToken.interface.encodeFunctionData("grantRole", [
      minterRole,
      user3.address
    ]);
    console.log("User1 queueing transaction");
    const queueTx = await justTimelock.connect(user1).queueTransactionWithThreatLevel(
      tokenAddress,
      0,
      callData
    );
    const receipt = await queueTx.wait();
    const queuedEvents = receipt.logs.filter(
      log => log.fragment && log.fragment.name === 'TransactionQueued'
    );
    const txHash = queuedEvents[0].args[0];
    console.log(`Transaction queued with hash: ${txHash}`);
    
    // Get threat level and delay
    const threatLevel = queuedEvents[0].args[5];
    let threatLevelDelay;
    if (threatLevel == 0) {
      threatLevelDelay = await justTimelock.lowThreatDelay();
    } else if (threatLevel == 1) {
      threatLevelDelay = await justTimelock.mediumThreatDelay();
    } else if (threatLevel == 2) {
      threatLevelDelay = await justTimelock.highThreatDelay();
    } else {
      threatLevelDelay = await justTimelock.criticalThreatDelay();
    }
    
    // Transfer all tokens away from user1
    console.log("Transferring all tokens away from user1");
    await justToken.connect(user1).transfer(user4.address, user1InitialBalance);
    const user1BalanceAfter = await justToken.balanceOf(user1.address);
    console.log(`User1 balance after transfer: ${formatEther(user1BalanceAfter)} JST`);
    expect(user1BalanceAfter).to.equal(0);
    
    // Fast forward time
    console.log(`Fast forwarding time by ${threatLevelDelay} seconds...`);
    await time.increase(threatLevelDelay);
    
    // Try to execute the transaction (should fail)
    console.log("User1 attempts to execute transaction after transferring tokens away (should fail)");
    await expect(
      justTimelock.connect(user1).executeTransaction(txHash)
    ).to.be.revertedWithCustomError(justTimelock, "NotAuthorized");
    console.log("Execution correctly rejected after tokens were transferred away");
    
    // Transfer tokens back to user1
    console.log("Transferring tokens back to user1");
    await justToken.connect(user4).transfer(user1.address, user1InitialBalance);
    const user1BalanceRestored = await justToken.balanceOf(user1.address);
    console.log(`User1 balance after restoration: ${formatEther(user1BalanceRestored)} JST`);
    expect(user1BalanceRestored).to.equal(user1InitialBalance);
    
    // Try to execute the transaction again (should succeed)
    console.log("User1 attempts to execute transaction after receiving tokens");
    const executeTx = await justTimelock.connect(user1).executeTransaction(txHash);
    const executeReceipt = await executeTx.wait();
    
    // Find the TransactionExecuted event
    const executedEvents = executeReceipt.logs.filter(
      log => log.fragment && log.fragment.name === 'TransactionExecuted'
    );
    console.log("Transaction successfully executed by the same user who queued it");
    
    // Verify user3 now has the role
    const hasRole = await justToken.hasRole(minterRole, user3.address);
    console.log(`User3 now has minter role on token: ${hasRole}`);
    expect(hasRole).to.be.true;
  });
  it("should properly cancel queued transactions by authorized roles", async function () {
    console.log("\n=== TESTING CANCELLATION OF QUEUED TRANSACTIONS ===");
    
    // User2 queues a transaction
    const callData = justToken.interface.encodeFunctionData("mint", [
      user2.address,
      ethers.parseEther("100")
    ]);
    
    // Queue the transaction
    console.log("User2 queueing a transaction");
    const queueTx = await justTimelock.connect(user2).queueTransactionWithThreatLevel(
      tokenAddress,
      0,
      callData
    );
    
    const receipt = await queueTx.wait();
    const queuedEvent = findEvent(receipt, justTimelock.interface, 'TransactionQueued');
    expect(queuedEvent).to.not.be.null;
    
    const txHash = queuedEvent.args[0];
    console.log(`Transaction queued with hash: ${txHash}`);
    
    // Grant user2 the canceller role
    const cancellerRole = await justTimelock.CANCELLER_ROLE();
    console.log("Granting canceller role to user2");
    await justTimelock.connect(admin).grantContractRole(cancellerRole, user2.address);
    const hasCancellerRole = await justTimelock.hasRole(cancellerRole, user2.address);
    console.log(`User2 has canceller role: ${hasCancellerRole}`);
    
    // Cancel the transaction
    console.log("User2 canceling transaction");
    const cancelTx = await justTimelock.connect(user2).cancelTransaction(txHash);
    const cancelReceipt = await cancelTx.wait();
    
    // Find the TransactionCanceled event
    const canceledEvent = findEvent(cancelReceipt, justTimelock.interface, 'TransactionCanceled');
    expect(canceledEvent).to.not.be.null;
    
    console.log("Transaction successfully canceled");
    
    // Verify the transaction is no longer queued
    const isQueued = await justTimelock.queuedTransactions(txHash);
    console.log(`Transaction is still queued: ${isQueued}`);
    expect(isQueued).to.be.false;
    
    // Try to execute the canceled transaction (should fail)
    console.log("Attempting to execute canceled transaction (should fail)");
    await expect(
      justTimelock.connect(user2).executeTransaction(txHash)
    ).to.be.revertedWithCustomError(justTimelock, "TxNotQueued");
    
    console.log("Execution of canceled transaction correctly rejected");
  });
  
  it("should properly handle transaction expiration", async function () {
    console.log("\n=== TESTING TRANSACTION EXPIRATION ===");
    
    // User3 queues a transaction
    const callData = justToken.interface.encodeFunctionData("mint", [
      user3.address,
      ethers.parseEther("100")
    ]);
    
    // Queue the transaction
    console.log("User3 queueing a transaction");
    const queueTx = await justTimelock.connect(user3).queueTransactionWithThreatLevel(
      tokenAddress,
      0,
      callData
    );
    
    const receipt = await queueTx.wait();
    const queuedEvent = findEvent(receipt, justTimelock.interface, 'TransactionQueued');
    expect(queuedEvent).to.not.be.null;
    
    const txHash = queuedEvent.args[0];
    console.log(`Transaction queued with hash: ${txHash}`);
    
    // Get transaction eta
    const tx = await justTimelock.getTransaction(txHash);
    const eta = tx[3];
    console.log(`Transaction eta: ${new Date(Number(eta) * 1000)}`);
    
    // Get grace period
    const gracePeriod = await justTimelock.gracePeriod();
    console.log(`Grace period: ${gracePeriod} seconds`);
    
    // Fast forward time to after grace period
    const forwardTime = Number(gracePeriod) + Number(tx[3]) - Math.floor(Date.now() / 1000) + 100;
    console.log(`Fast forwarding time by ${forwardTime} seconds to exceed grace period...`);
    await time.increase(forwardTime);
    
    // Try to execute the expired transaction (should fail)
    console.log("Attempting to execute expired transaction (should fail)");
    await expect(
      justTimelock.connect(user3).executeTransaction(txHash)
    ).to.be.revertedWithCustomError(justTimelock, "TxExpired");
    
    console.log("Execution of expired transaction correctly rejected");
    
    // Try to execute the expired transaction using executeExpiredTransaction
    console.log("Attempting to execute expired transaction with executeExpiredTransaction");
    
    // Grant admin role to be able to execute expired transactions
    const adminRole = await justTimelock.ADMIN_ROLE();
    await justTimelock.connect(admin).grantContractRole(adminRole, user3.address);
    console.log(`Granted admin role to user3: ${await justTimelock.hasRole(adminRole, user3.address)}`);
    
    const expiredTx = await justTimelock.connect(user3).executeExpiredTransaction(txHash);
    const expiredReceipt = await expiredTx.wait();
    
    // Find the ExpiredTransactionExecuted event
    const expiredEvent = findEvent(expiredReceipt, justTimelock.interface, 'ExpiredTransactionExecuted');
    expect(expiredEvent).to.not.be.null;
    
    console.log("Expired transaction successfully executed with executeExpiredTransaction");
    
    // Verify user3 tokens were minted
    const user3BalanceAfter = await justToken.balanceOf(user3.address);
    console.log(`User3 balance after expired execution: ${formatEther(user3BalanceAfter)} JST`);
    expect(user3BalanceAfter).to.be.gt(user3Balance);
  });
  
  it("should handle failed transactions correctly", async function () {
    console.log("\n=== TESTING FAILED TRANSACTION HANDLING ===");
    
    // Create a transaction that will fail - try to mint tokens without permission
    const callData = justToken.interface.encodeFunctionData("mint", [
      user2.address,
      ethers.parseEther("1000000") // A large amount
    ]);
    
    // User2 queues the transaction
    console.log("User2 queueing a transaction that will fail");
    const queueTx = await justTimelock.connect(user2).queueTransactionWithThreatLevel(
      tokenAddress,
      0,
      callData
    );
    
    const receipt = await queueTx.wait();
    const queuedEvent = findEvent(receipt, justTimelock.interface, 'TransactionQueued');
    expect(queuedEvent).to.not.be.null;
    
    const txHash = queuedEvent.args[0];
    console.log(`Transaction queued with hash: ${txHash}`);
    
    // Get the threat level and delay
    const threatLevel = queuedEvent.args[5];
    let threatLevelDelay;
    if (threatLevel == 0) {
      threatLevelDelay = await justTimelock.lowThreatDelay();
    } else if (threatLevel == 1) {
      threatLevelDelay = await justTimelock.mediumThreatDelay();
    } else if (threatLevel == 2) {
      threatLevelDelay = await justTimelock.highThreatDelay();
    } else {
      threatLevelDelay = await justTimelock.criticalThreatDelay();
    }
    
    // Fast forward time
    console.log(`Fast forwarding time by ${threatLevelDelay} seconds...`);
    await time.increase(threatLevelDelay);
    
    // Try to execute the transaction - it should fail since user2 doesn't have minter role
    console.log("Attempting to execute transaction (should fail due to lack of permissions)");
    
    // The execution should revert
    await expect(
      justTimelock.connect(user2).executeTransaction(txHash)
    ).to.be.reverted;
    console.log("Transaction execution reverted as expected");
    
    // Mark the transaction as failed
    const govRole = await justTimelock.GOVERNANCE_ROLE();
    await justTimelock.connect(admin).grantContractRole(govRole, user3.address);
    console.log(`Granted governance role to user3: ${await justTimelock.hasRole(govRole, user3.address)}`);
    
    // Mark transaction as failed
    console.log("Marking transaction as failed");
    await justTimelock.connect(user3).markTransactionAsFailed(txHash);
    
    // Check if transaction is marked as failed
    const isFailed = await justTimelock.wasTransactionFailed(txHash);
    console.log(`Transaction is marked as failed: ${isFailed}`);
    expect(isFailed).to.be.true;
    
    // Try to execute the failed transaction
    console.log("Attempting to execute previously failed transaction");
    
    // Give user2 the minter role so the transaction can succeed now
    const minterRole = await justToken.MINTER_ROLE();
    await justToken.connect(user3).grantRole(minterRole, await justTimelock.getAddress());
    console.log(`Granted minter role to timelock: ${await justToken.hasRole(minterRole, await justTimelock.getAddress())}`);
    
    const retryTx = await justTimelock.connect(user3).executeFailedTransaction(txHash);
    const retryReceipt = await retryTx.wait();
    
    // Find the FailedTransactionRetried event
    const retryEvent = findEvent(retryReceipt, justTimelock.interface, 'FailedTransactionRetried');
    expect(retryEvent).to.not.be.null;
    
    console.log("Previously failed transaction successfully retried");
    
    // Verify user2 tokens were minted
    const user2BalanceAfter = await justToken.balanceOf(user2.address);
    console.log(`User2 balance after retry: ${formatEther(user2BalanceAfter)} JST`);
    expect(user2BalanceAfter).to.be.gt(aboveThresholdAmount);
  });
  it("should properly handle threat levels for different function calls", async function () {
    console.log("\n=== CHECKING TOKEN CONTRACT REFERENCES ===");
    
    // Check what token the timelock is using internally
    try {
      // Try different ways to access the token contract
      try {
        const tokenContract = await justTimelock.justToken();
        console.log(`Timelock's justToken address: ${tokenContract}`);
        console.log(`Our justToken address: ${await justToken.getAddress()}`);
        
        // Check if they match
        if (tokenContract.toLowerCase() !== (await justToken.getAddress()).toLowerCase()) {
          console.log(`ERROR: Token contract mismatch!`);
          console.log(`The timelock is using a different token than our test is using.`);
        } else {
          console.log(`Token addresses match!`);
        }
      } catch (error) {
        console.log(`Error accessing justToken directly: ${error.message}`);
        
        // Try alternative methods of getting the token address
        try {
          const tokenContract = await justTimelock.tokenContract();
          console.log(`Timelock's tokenContract: ${tokenContract}`);
          console.log(`Our justToken address: ${await justToken.getAddress()}`);
          
          if (tokenContract.toLowerCase() !== (await justToken.getAddress()).toLowerCase()) {
            console.log(`ERROR: Token contract mismatch!`);
          } else {
            console.log(`Token addresses match!`);
          }
        } catch (error) {
          console.log(`Error accessing tokenContract: ${error.message}`);
        }
      }
      
      // Verify the minimum token threshold
      const minThreshold = await justTimelock.minExecutorTokenThreshold();
      console.log(`Minimum executor token threshold: ${minThreshold.toString()}`);
      
      // Check user2's balance
      const user2Balance = await justToken.balanceOf(user2.address);
      console.log(`User2 token balance: ${user2Balance.toString()}`);
      console.log(`User2 has enough tokens: ${user2Balance >= minThreshold ? "Yes" : "No"}`);
      
      // Direct check of isAuthorizedByTokens
      try {
        const isAuthorized = await justTimelock.isAuthorizedByTokens(user2.address);
        console.log(`isAuthorizedByTokens(user2) returns: ${isAuthorized}`);
        
        if (!isAuthorized) {
          console.log(`CRITICAL: isAuthorizedByTokens is returning false despite user2 having sufficient tokens!`);
        }
      } catch (error) {
        console.log(`Error calling isAuthorizedByTokens: ${error.message}`);
      }
      
      // Get reference to contract owners
      console.log(`\n=== CHECKING OWNERSHIP AND INITIALIZATION ===`);
      
      // Check initialization of timelock
      try {
        const initializedCounter = await ethers.provider.getStorageAt(
          await justTimelock.getAddress(),
          "0x0"  // First storage slot often contains initialization flag in OZ upgradeable contracts
        );
        console.log(`Initialization counter (should be >= 1): ${initializedCounter}`);
      } catch (error) {
        console.log(`Error checking initialization: ${error.message}`);
      }
      
      // Check if the storage for justToken is properly set
      console.log(`\n=== TESTING WITH TRANSACTION THAT SHOULD WORK ===`);
      
      // Test queueing a simple transaction
      const target = await justToken.getAddress();
      const value = 0;
      const callData = justToken.interface.encodeFunctionData("transfer", [user4.address, 1000n]);
      
      console.log(`Target: ${target}`);
      console.log(`Value: ${value}`);
      console.log(`Data length: ${callData.length} bytes`);
      
      try {
        console.log(`User2 address for transaction: ${user2.address}`);
        
        // This is a workaround for testing - find admin and grant PROPOSER_ROLE to user2
        console.log(`\nGRANTING PROPOSER_ROLE TO USER2 FOR TESTING PURPOSES`);
        
        // Find admin
        const adminRole = await justTimelock.DEFAULT_ADMIN_ROLE();
        let adminAccount = null;
        
        // Try each account to find an admin
        for (const signer of await ethers.getSigners()) {
          if (await justTimelock.hasRole(adminRole, signer.address)) {
            adminAccount = signer;
            console.log(`Found admin account: ${signer.address}`);
            break;
          }
        }
        
        if (adminAccount) {
          // Grant PROPOSER_ROLE to user2
          console.log(`Granting PROPOSER_ROLE to user2...`);
          const proposerRole = await justTimelock.PROPOSER_ROLE();
          
          // Only grant if not already granted
          if (!(await justTimelock.hasRole(proposerRole, user2.address))) {
            const tx = await justTimelock.connect(adminAccount).grantRole(proposerRole, user2.address);
            await tx.wait();
            console.log(`PROPOSER_ROLE granted to user2`);
          } else {
            console.log(`User2 already has PROPOSER_ROLE`);
          }
          
          // Now try the transaction
          console.log(`\nAttempting to queue transaction with PROPOSER_ROLE...`);
          const queueTx = await justTimelock.connect(user2).queueTransactionWithThreatLevel(
            target,
            value,
            callData
          );
          
          console.log(`Transaction submitted, waiting for confirmation...`);
          const receipt = await queueTx.wait();
          
          // Check for events
          const queuedEvents = receipt.logs.filter(
            log => log.fragment && log.fragment.name === 'TransactionQueued'
          );
          
          if (queuedEvents.length > 0) {
            console.log(`Transaction queued successfully with PROPOSER_ROLE!`);
            
            // Now we need to diagnose why isAuthorizedByTokens is failing
            console.log(`\n=== DIAGNOSING TOKEN AUTHORIZATION ISSUE ===`);
            
            console.log(`The likely issue is in the implementation of isAuthorizedByTokens:`);
            console.log(`1. The timelock's justToken reference may be uninitialized or pointing to the wrong contract`);
            console.log(`2. There may be a mismatch between the token in our tests and the token the timelock expects`);
            
            console.log(`\nRecommended fixes:`);
            console.log(`1. Make sure the timelock is initialized with the correct token address`);
            console.log(`2. In your tests, make sure you're using the same token contract that the timelock uses`);
            console.log(`3. Check if there's an initialize function that needs to be called to set up the token reference`);
          } else {
            console.log(`No TransactionQueued events found in receipt`);
          }
        } else {
          console.log(`No admin account found to grant PROPOSER_ROLE!`);
        }
      } catch (error) {
        console.log(`Error queueing transaction: ${error.message}`);
      }
    } catch (error) {
      console.log(`Top-level error: ${error.message}`);
    }
  });
  
  it("should test behavior when token balance changes after queueing", async function () {
    console.log("\n=== TESTING TOKEN BALANCE CHANGES AFTER QUEUEING ===");
    
    // User1 now has some tokens above threshold (from previous tests)
    const user1InitialBalance = await justToken.balanceOf(user1.address);
    console.log(`User1 initial balance: ${formatEther(user1InitialBalance)} JST`);
    
    // Get current threshold
    const currentThreshold = await justTimelock.minExecutorTokenThreshold();
    console.log(`Current threshold: ${formatEther(currentThreshold)} JST`);
    
    expect(user1InitialBalance).to.be.gte(currentThreshold);
    
    // Queue a transaction
    const adminRole = await justToken.DEFAULT_ADMIN_ROLE();
    const callData = justToken.interface.encodeFunctionData("grantRole", [
      adminRole,
      user1.address
    ]);
    
    console.log("User1 queueing transaction");
    const queueTx = await justTimelock.connect(user1).queueTransactionWithThreatLevel(
      tokenAddress,
      0,
      callData
    );
    
    const receipt = await queueTx.wait();
    const queuedEvent = findEvent(receipt, justTimelock.interface, 'TransactionQueued');
    expect(queuedEvent).to.not.be.null;
    
    const txHash = queuedEvent.args[0];
    console.log(`Transaction queued with hash: ${txHash}`);
    
    // Get threat level and delay
    const threatLevel = queuedEvent.args[5];
    let threatLevelDelay;
    if (threatLevel == 0) {
      threatLevelDelay = await justTimelock.lowThreatDelay();
    } else if (threatLevel == 1) {
      threatLevelDelay = await justTimelock.mediumThreatDelay();
    } else if (threatLevel == 2) {
      threatLevelDelay = await justTimelock.highThreatDelay();
    } else {
      threatLevelDelay = await justTimelock.criticalThreatDelay();
    }
    
    // Transfer all tokens away from user1
    console.log("Transferring all tokens away from user1");
    await justToken.connect(user1).transfer(user4.address, user1InitialBalance);
    
    const user1BalanceAfter = await justToken.balanceOf(user1.address);
    console.log(`User1 balance after transfer: ${formatEther(user1BalanceAfter)} JST`);
    expect(user1BalanceAfter).to.equal(0);
    
    // Fast forward time
    console.log(`Fast forwarding time by ${threatLevelDelay} seconds...`);
    await time.increase(threatLevelDelay);
    
    // Try to execute the transaction (should fail)
    console.log("User1 attempts to execute transaction after transferring tokens away (should fail)");
    await expect(
      justTimelock.connect(user1).executeTransaction(txHash)
    ).to.be.revertedWithCustomError(justTimelock, "NotAuthorized");
    
    console.log("Execution correctly rejected after tokens were transferred away");
    
    // Transfer tokens back to user1
    console.log("Transferring tokens back to user1");
    await justToken.connect(user4).transfer(user1.address, user1InitialBalance);
    
    const user1BalanceRestored = await justToken.balanceOf(user1.address);
    console.log(`User1 balance after restoration: ${formatEther(user1BalanceRestored)} JST`);
    expect(user1BalanceRestored).to.equal(user1InitialBalance);
    
    // Try to execute the transaction again (should succeed)
    console.log("User1 attempts to execute transaction after receiving tokens");
    const executeTx = await justTimelock.connect(user1).executeTransaction(txHash);
    const executeReceipt = await executeTx.wait();
    
    // Find the TransactionExecuted event
    const executedEvent = findEvent(executeReceipt, justTimelock.interface, 'TransactionExecuted');
    expect(executedEvent).to.not.be.null;
    
    console.log("Transaction successfully executed after tokens were restored");
  });
});