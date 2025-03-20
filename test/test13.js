const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");

describe("JustDAO Minimal Authorization Test", function () {
  let justToken;
  let justTimelock;
  let admin, regularUser;

  before(async function () {
    [admin, regularUser] = await ethers.getSigners();

    // Deploy just the token and timelock contracts for direct testing
    const JustToken = await ethers.getContractFactory("contracts/JustTokenUpgradeable.sol:JustTokenUpgradeable");
    const JustTimelock = await ethers.getContractFactory("contracts/JustTimelockUpgradeable.sol:JustTimelockUpgradeable");

    // Initialize token contract
    const tokenProxy = await upgrades.deployProxy(JustToken, [
      "Just Token", 
      "JST", 
      admin.address, 
      86400, // Min lock duration
      7 * 86400 // Max lock duration
    ]);
    justToken = await tokenProxy.waitForDeployment();

    // Initialize timelock contract
    const timelockProxy = await upgrades.deployProxy(JustTimelock, [
      60, // 60 second delay
      [admin.address], // Proposers
      [admin.address], // Executors
      admin.address
    ]);
    justTimelock = await timelockProxy.waitForDeployment();

    // Set token address in timelock
    await justTimelock.connect(admin).setJustToken(await justToken.getAddress());
    
    // Mint tokens to regularUser - but don't delegate
    await justToken.connect(admin).mint(regularUser.address, ethers.parseEther("10"));

    // Log token balances
    console.log(`RegularUser balance: ${ethers.formatEther(await justToken.balanceOf(regularUser.address))}`);
    console.log(`RegularUser locked tokens: ${ethers.formatEther(await justToken.getLockedTokens(regularUser.address))}`);
  });

  it("Should allow a token holder to execute a transaction", async function () {
    // Create parameters for a transaction
    const target = await justTimelock.getAddress();
    const value = 0; // No ETH value
    const delay = 60; // 60 second delay
    
    // Prepare the function data to call updateDelays
    const callData = justTimelock.interface.encodeFunctionData("updateDelays", [
      120, // New min delay
      2592000, // New max delay
      1209600 // New grace period
    ]);
    
    // Queue the transaction
    const queueTx = await justTimelock.connect(admin).queueTransaction(
      target,
      value,
      callData,
      delay
    );
    
    // Get the transaction receipt
    const receipt = await queueTx.wait();
    
    // Get the transaction hash from the TransactionQueued event
    const filter = justTimelock.filters.TransactionQueued();
    const events = await justTimelock.queryFilter(filter, receipt.blockNumber, receipt.blockNumber);
    
    if (events.length === 0) {
      throw new Error("TransactionQueued event not found");
    }
    
    const txHash = events[0].args[0]; // First indexed parameter is the transaction hash
    console.log(`Transaction hash: ${txHash}`);
    
    // Wait for delay to pass
    await time.increase(61);

    // Get regularUser's token balance to verify they're a token holder
    const tokenBalance = await justToken.balanceOf(regularUser.address);
    console.log(`RegularUser token balance before execution: ${ethers.formatEther(tokenBalance)}`);
    
    // Regular user should now be able to execute the transaction
    await justTimelock.connect(regularUser).executeTransaction(txHash);
    
    // Verify transaction executed
    const newMinDelay = await justTimelock.minDelay();
    expect(newMinDelay).to.equal(120);
  });
});