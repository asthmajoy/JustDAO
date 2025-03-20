const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("JustTimelockUpgradeable", function () {
  let justTimelockUpgradeable;
  let justToken;
  let admin;
  let proposer;
  let executor;
  let regularUser;
  let tokenHolder;
  let minTokenThreshold;

  beforeEach(async function () {
    [admin, proposer, executor, regularUser, tokenHolder] = await ethers.getSigners();
    
    // Deploy MockERC20 as our token
    const MockERC20 = await ethers.getContractFactory("contracts/MockERC20.sol:MockERC20");
    justToken = await MockERC20.deploy("JustToken", "JST");
    
    // Deploy JustTimelockUpgradeable
    const JustTimelockUpgradeable = await ethers.getContractFactory("contracts/JustTimelockUpgradeable.sol:JustTimelockUpgradeable");
    const timeLockProxy = await upgrades.deployProxy(
      JustTimelockUpgradeable,
      [
        600, // initialMinDelay - 10 minutes
        [proposer.address], // proposers
        [executor.address], // executors
        admin.address // admin
      ]
    );
    
    justTimelockUpgradeable = await ethers.getContractAt(
      "contracts/JustTimelockUpgradeable.sol:JustTimelockUpgradeable",
      timeLockProxy.target
    );
    
    // Set JustToken in the timelock contract
    await justTimelockUpgradeable.connect(admin).setJustToken(justToken.target);
    
    // Get initial threshold value
    minTokenThreshold = await justTimelockUpgradeable.minExecutorTokenThreshold();
    
    // Mint tokens to tokenHolder
    const tokenAmount = ethers.parseEther("1"); // 1 token
    await justToken.connect(admin).mint(tokenHolder.address, tokenAmount);
    
    // Mint a small amount (below threshold) to regularUser
    const smallAmount = ethers.parseEther("0.001"); // 0.001 token (below threshold if threshold is 0.01)
    await justToken.connect(admin).mint(regularUser.address, smallAmount);
    
    // Prepare a test transaction to queue
    // This is a simple transaction to update the minDelay parameter
    const newMinDelay = 1200; // 20 minutes
    const newMaxDelay = 2592000; // 30 days
    const newGracePeriod = 14 * 24 * 60 * 60; // 14 days
    
    // Queue the transaction
    await justTimelockUpgradeable.connect(proposer).queueDelayUpdate(
      newMinDelay,
      newMaxDelay,
      newGracePeriod
    );
  });

  describe("Executor Token Threshold", function () {
    it("Should initialize with the correct token threshold", async function () {
      expect(minTokenThreshold).to.equal(BigInt(10n ** 16n)); // 0.01 tokens
    });
    
    it("Should allow admin to update the executor token threshold", async function () {
      const newThreshold = ethers.parseEther("0.02"); // 0.02 tokens
      
      await justTimelockUpgradeable.connect(admin).updateExecutorTokenThreshold(newThreshold);
      
      const updatedThreshold = await justTimelockUpgradeable.minExecutorTokenThreshold();
      expect(updatedThreshold).to.equal(newThreshold);
    });
    
    it("Should allow users with sufficient tokens to execute transactions", async function () {
      // Get the transaction details to determine exact needed time
      const queuedTransactions = await findQueuedTransactions(justTimelockUpgradeable);
      expect(queuedTransactions.length).to.be.greaterThan(0);
      const txHash = queuedTransactions[0];
      
      const txDetails = await justTimelockUpgradeable.getTransaction(txHash);
      const eta = txDetails[3]; // Extract the eta (timestamp when tx can be executed)
      
      // Fast forward time to exactly after the eta
      const currentBlockTime = (await ethers.provider.getBlock("latest")).timestamp;
      const timeToIncrease = Number(eta) - currentBlockTime + 10; // Add 10 seconds for safety
      
      await ethers.provider.send("evm_increaseTime", [timeToIncrease]);
      await ethers.provider.send("evm_mine");
      
      // We already have the txHash from above
      
      // Token holder should be able to execute even without EXECUTOR_ROLE
      await justTimelockUpgradeable.connect(tokenHolder).executeTransaction(txHash);
      
      // Verify execution
      const txData = await justTimelockUpgradeable.getTransaction(txHash);
      expect(txData[4]).to.be.true; // executed flag should be true
    });
    
    it("Should allow users with EXECUTOR_ROLE to execute even without tokens", async function () {
      // Get a different transaction for this test
      // Queue a new transaction
      const newMinDelay = 1500; // 25 minutes
      const newMaxDelay = 2592000; // 30 days
      const newGracePeriod = 14 * 24 * 60 * 60; // 14 days
      
      await justTimelockUpgradeable.connect(proposer).queueDelayUpdate(
        newMinDelay,
        newMaxDelay,
        newGracePeriod
      );
      
      // Get the transaction details to determine exact needed time
      const queuedTransactions = await findQueuedTransactions(justTimelockUpgradeable);
      // Don't assert the length, just use the most recent transaction
      const txHash = queuedTransactions[queuedTransactions.length - 1]; // Use the latest transaction
      
      const txDetails = await justTimelockUpgradeable.getTransaction(txHash);
      const eta = txDetails[3]; // Extract the eta
      
      // Fast forward time to exactly after the eta
      const currentBlockTime = (await ethers.provider.getBlock("latest")).timestamp;
      const timeToIncrease = Number(eta) - currentBlockTime + 10; // Add 10 seconds for safety
      
      await ethers.provider.send("evm_increaseTime", [timeToIncrease]);
      await ethers.provider.send("evm_mine");
      
      // Executor should be able to execute due to role, even with no tokens
      await justTimelockUpgradeable.connect(executor).executeTransaction(txHash);
      
      // Verify execution
      const txData = await justTimelockUpgradeable.getTransaction(txHash);
      expect(txData[4]).to.be.true; // executed flag should be true
    });
    
    it("Should reject users with insufficient tokens and no EXECUTOR_ROLE", async function () {
      // Queue a new transaction
      const newMinDelay = 1600; // 26.67 minutes
      const newMaxDelay = 2592000; // 30 days
      const newGracePeriod = 14 * 24 * 60 * 60; // 14 days
      
      await justTimelockUpgradeable.connect(proposer).queueDelayUpdate(
        newMinDelay,
        newMaxDelay,
        newGracePeriod
      );
      
      // Get the transaction details to determine exact needed time
      const queuedTransactions = await findQueuedTransactions(justTimelockUpgradeable);
      // Don't assert the length, just use the most recent transaction
      const txHash = queuedTransactions[queuedTransactions.length - 1]; // Use the latest transaction
      
      const txDetails = await justTimelockUpgradeable.getTransaction(txHash);
      const eta = txDetails[3]; // Extract the eta
      
      // Fast forward time to exactly after the eta
      const currentBlockTime = (await ethers.provider.getBlock("latest")).timestamp;
      const timeToIncrease = Number(eta) - currentBlockTime + 10; // Add 10 seconds for safety
      
      await ethers.provider.send("evm_increaseTime", [timeToIncrease]);
      await ethers.provider.send("evm_mine");
      
      // Regular user with tokens below threshold and no EXECUTOR_ROLE should be rejected
      await expect(
        justTimelockUpgradeable.connect(regularUser).executeTransaction(txHash)
      ).to.be.revertedWithCustomError(justTimelockUpgradeable, "NotAuthorized");
    });
    
    it("Should enforce the updated threshold", async function () {
      // Update threshold to a higher value
      const newThreshold = ethers.parseEther("0.5"); // 0.5 tokens
      await justTimelockUpgradeable.connect(admin).updateExecutorTokenThreshold(newThreshold);
      
      // Log the updated threshold
      const updatedThreshold = await justTimelockUpgradeable.minExecutorTokenThreshold();
      console.log("Updated token threshold:", ethers.formatEther(updatedThreshold), "tokens");
      
      // Initial token holder's balance
      const initialTokenHolderBalance = await justToken.balanceOf(tokenHolder.address);
      console.log("Initial token holder balance:", ethers.formatEther(initialTokenHolderBalance), "tokens");
      
      // Burn 0.75 tokens from the token holder to make their balance below the threshold
      // For the MockERC20 contract, we need to use the contract's burn method
      // Check which burn function is available in your contract
      // Option 1: If it uses governanceBurn like in JustTokenUpgradeable
      await justToken.connect(admin).governanceBurn(tokenHolder.address, ethers.parseEther("0.75"));
      
      // Verify the token holder's balance after burning
      const tokenHolderBalance = await justToken.balanceOf(tokenHolder.address);
      console.log("Token holder balance after burn:", ethers.formatEther(tokenHolderBalance), "tokens");
      
      // Queue another transaction
      const newMinDelay = 1800; // 30 minutes
      const newMaxDelay = 2592000; // 30 days
      const newGracePeriod = 14 * 24 * 60 * 60; // 14 days
      
      await justTimelockUpgradeable.connect(proposer).queueDelayUpdate(
        newMinDelay,
        newMaxDelay,
        newGracePeriod
      );
      
      // Get the transaction details to determine exact needed time
      const queuedTransactions = await findQueuedTransactions(justTimelockUpgradeable);
      // Don't assert the length, just use the most recent transaction
      const txHash = queuedTransactions[queuedTransactions.length - 1]; // Use the latest transaction
      
      const txDetails = await justTimelockUpgradeable.getTransaction(txHash);
      const eta = txDetails[3]; // Extract the eta
      
      // Fast forward time to exactly after the eta
      const currentBlockTime = (await ethers.provider.getBlock("latest")).timestamp;
      const timeToIncrease = Number(eta) - currentBlockTime + 10; // Add 10 seconds for safety
      
      await ethers.provider.send("evm_increaseTime", [timeToIncrease]);
      await ethers.provider.send("evm_mine");
      
      // Log useful debug information
      console.log("Transaction hash:", txHash);
      console.log("Transaction ETA:", new Date(Number(eta) * 1000).toISOString());
      console.log("Current block time:", new Date(currentBlockTime * 1000).toISOString());
      console.log("Time increased by:", timeToIncrease, "seconds");
      
      // Token holder now has insufficient tokens for the new threshold
      // They should be rejected
      console.log("Attempting execution with insufficient tokens...");
      await expect(
        justTimelockUpgradeable.connect(tokenHolder).executeTransaction(txHash)
      ).to.be.revertedWithCustomError(justTimelockUpgradeable, "NotAuthorized");
      
      // Give token holder more tokens to meet the new threshold
      await justToken.connect(admin).mint(tokenHolder.address, ethers.parseEther("0.5"));
      
      // Now they should be able to execute
      await justTimelockUpgradeable.connect(tokenHolder).executeTransaction(txHash);
      
      // Verify execution
      const txData = await justTimelockUpgradeable.getTransaction(txHash);
      expect(txData[4]).to.be.true; // executed flag should be true
    });
    
    it("Should revert when non-admin tries to update the threshold", async function () {
      const newThreshold = ethers.parseEther("0.05");
      
      await expect(
        justTimelockUpgradeable.connect(regularUser).updateExecutorTokenThreshold(newThreshold)
      ).to.be.revertedWithCustomError(justTimelockUpgradeable, "NotAuthorized");
    });
  });
});

// Helper function to find all queued transactions
async function findQueuedTransactions(contract) {
  // We need to simulate checking events to find queued transactions
  const filter = await contract.filters.TransactionQueued();
  const events = await contract.queryFilter(filter);
  
  // Extract transaction hashes from events
  return events.map(event => event.args[0]); // Assuming first arg is txHash
}

// Helper to get the correct error message from TxNotReady
function formatTxNotReadyError(txHash, eta, currentTime) {
  return `TxNotReady("${txHash}", ${eta}, ${currentTime})`;
}

// Note: We're using the MockERC20 contract you provided
// You don't need to create a separate mock contract