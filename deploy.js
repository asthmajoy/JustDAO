// SPDX-License-Identifier: MIT
// deploy.js - Robust deployment script with timeout handling

const { ethers, upgrades, network } = require("hardhat");

// Configure deployment options based on network
function getPollingConfig() {
  // Significantly increased values to handle slow networks
  if (network.name === "mainnet") {
    return {
      pollingInterval: 10000,    // 10 seconds between checks
      timeout: 3600000,          // 60 minutes max wait time
      confirmations: 2           // Wait for 2 confirmations
    };
  } else if (network.name === "goerli" || network.name === "sepolia") {
    return {
      pollingInterval: 5000,     // 5 seconds between checks
      timeout: 1800000,          // 30 minutes max wait time
      confirmations: 2           // Wait for 2 confirmations
    };
  } else {
    // For local or faster testnets
    return {
      pollingInterval: 2000,     // 2 seconds between checks
      timeout: 600000,           // 10 minutes max wait time
      confirmations: 1           // Wait for 1 confirmation
    };
  }
}

// Get the current gas price with a premium for faster confirmation
async function getGasPrice() {
  const provider = ethers.provider;
  const gasPrice = await provider.getFeeData();
  
  // Use the maxFeePerGas if EIP-1559 is available, otherwise fall back to gasPrice
  let baseGasPrice;
  if (gasPrice.maxFeePerGas) {
    console.log(`Current max fee per gas: ${ethers.formatUnits(gasPrice.maxFeePerGas, 'gwei')} gwei`);
    baseGasPrice = gasPrice.maxFeePerGas;
  } else {
    console.log(`Current gas price: ${ethers.formatUnits(gasPrice.gasPrice, 'gwei')} gwei`);
    baseGasPrice = gasPrice.gasPrice;
  }
  
  // Add 20% premium to current price for faster confirmation
  const gasPriceWithPremium = baseGasPrice * BigInt(120) / BigInt(100);
  console.log(`Using gas price with 20% premium: ${ethers.formatUnits(gasPriceWithPremium, 'gwei')} gwei`);
  
  return gasPriceWithPremium;
}

async function deployProxy(factory, args, options = {}) {
  const config = getPollingConfig();
  const gasPrice = await getGasPrice();
  
  console.log(`Deploying ${options.contractName || "contract"} with timeout: ${config.timeout}ms, polling: ${config.pollingInterval}ms`);
  
  try {
    // Deploy with custom timeouts and gas settings
    const contract = await upgrades.deployProxy(
      factory, 
      args,
      { 
        initializer: 'initialize',
        timeout: config.timeout,
        pollingInterval: config.pollingInterval,
        gasPrice: gasPrice,
        gasLimit: 8000000, // Increased gas limit for complex contracts
        ...options
      }
    );
    
    // Wait for additional confirmations if specified
    if (config.confirmations > 1) {
      console.log(`Waiting for ${config.confirmations} confirmations...`);
      // If deployProxy returned a transaction, wait for it
      // Otherwise, assume it's a contract instance and continue
      if (contract.wait) {
        await contract.wait(config.confirmations);
      }
    }
    
    const address = await contract.getAddress();
    console.log(`${options.contractName || "Contract"} deployed to: ${address}`);
    
    // Add additional delay after deployment to ensure the contract is fully deployed
    console.log(`Waiting for contract deployment to be fully confirmed...`);
    await new Promise(resolve => setTimeout(resolve, 30000)); // 30 second delay
    
    return contract;
  } catch (error) {
    console.error(`\n----- DEPLOYMENT ERROR -----`);
    console.error(`Failed to deploy ${options.contractName || "contract"}:`, error);
    console.error(`\nTROUBLESHOOTING TIPS:`);
    console.error(`1. Check if the network is congested`);
    console.error(`2. Try increasing the gas price or gas limit`);
    console.error(`3. Verify that your contract initializer doesn't have issues`);
    console.error(`4. Consider deploying contracts one by one to isolate the problem`);
    console.error(`5. Check RPC endpoint stability and connection`);
    console.error(`--------------------------\n`);
    throw error;
  }
}

// Function to verify a contract exists
async function verifyContractCode(address, contractName = "Contract") {
  console.log(`Verifying ${contractName} code at ${address}...`);
  try {
    // Try up to 3 times with increasing delays
    let code = "0x";
    for (let i = 0; i < 3; i++) {
      code = await ethers.provider.getCode(address);
      if (code !== "0x" && code !== "0x0") {
        console.log(`${contractName} code verified successfully (${code.length / 2 - 1} bytes)`);
        return true;
      }
      console.log(`Attempt ${i+1}: ${contractName} code not found yet. Waiting longer...`);
      // Increase wait time with each attempt
      await new Promise(resolve => setTimeout(resolve, 15000 * (i+1)));
    }
    
    // Final check
    if (code === "0x" || code === "0x0") {
      throw new Error(`${contractName} code not found at ${address} after multiple attempts`);
    }
    return true;
  } catch (error) {
    console.error(`Error verifying ${contractName} code:`, error);
    throw error;
  }
}

async function main() {
  try {
    const [deployer] = await ethers.getSigners();
    console.log(`Deploying contracts with account: ${deployer.address}`);
    console.log(`Network: ${network.name}`);
    console.log(`Account balance: ${ethers.formatEther(await deployer.provider.getBalance(deployer.address))} ETH\n`);
    
    // Add special handling for hardhat network
    if (network.name === "hardhat") {
      console.log("Warning: Running on Hardhat network. Contract verification may not work as expected.");
      console.log("This is normal for local development, since contracts might not be mined the same way.");
    }
    
    // Deploy JustTimelockUpgradeable
    console.log("Starting JustTimelock deployment...");
    const JustTimelock = await ethers.getContractFactory("contracts/JustTimelockUpgradeable.sol:JustTimelockUpgradeable");
    const initialMinDelay = 86400; // 1 day in seconds
    const proposers = [deployer.address];
    const executors = [deployer.address];
    const admin = deployer.address;
    
    // Deploy the timelock contract
    const timelock = await deployProxy(
      JustTimelock, 
      [initialMinDelay, proposers, executors, admin],
      { contractName: "JustTimelock" }
    );
    
    const timelockAddress = await timelock.getAddress();
    
    // Verify the timelock deployment before continuing
    await verifyContractCode(timelockAddress, "JustTimelock");
    
    // Deploy JustTokenUpgradeable
    console.log("\nStarting JustToken deployment...");
    const JustToken = await ethers.getContractFactory("contracts/JustTokenUpgradeable.sol:JustTokenUpgradeable");
    const name = "Justice Token";
    const symbol = "JST";
    const minLockDuration = 3600; // 1 hour
    const maxLockDuration = 31536000; // 1 year
    
    const token = await deployProxy(
      JustToken, 
      [name, symbol, admin, minLockDuration, maxLockDuration],
      { contractName: "JustToken" }
    );
    
    const tokenAddress = await token.getAddress();
    
    // Verify the token deployment before continuing
    await verifyContractCode(tokenAddress, "JustToken");
    
    // Deploy JustGovernanceUpgradeable
    console.log("\nStarting JustGovernance deployment...");
    const JustGovernance = await ethers.getContractFactory("contracts/JustGovernanceUpgradeable.sol:JustGovernanceUpgradeable");
    const govName = "Justice Governance";
    const proposalThreshold = ethers.parseEther("1000"); // 1000 tokens
    const votingDelay = 86400; // 1 day
    const votingPeriod = 604800; // 1 week
    const quorumNumerator = 4; // 4%
    const successfulRefund = 100; // 100% refund
    const cancelledRefund = 50; // 50% refund
    const defeatedRefund = 25; // 25% refund
    const expiredRefund = 25; // 25% refund
    
    const governance = await deployProxy(
      JustGovernance, 
      [
        govName, 
        tokenAddress,
        timelockAddress, 
        admin, 
        proposalThreshold, 
        votingDelay, 
        votingPeriod, 
        quorumNumerator, 
        successfulRefund, 
        cancelledRefund, 
        defeatedRefund, 
        expiredRefund
      ],
      { contractName: "JustGovernance" }
    );
    
    const governanceAddress = await governance.getAddress();
    
    // Verify the governance deployment before continuing
    await verifyContractCode(governanceAddress, "JustGovernance");
    
    // Deploy JustDAOHelperUpgradeable
    console.log("\nStarting JustDAOHelper deployment...");
    const JustDAOHelper = await ethers.getContractFactory("contracts/JustDAOHelperUpgradeable.sol:JustDAOHelperUpgradeable");
    
    // DAOHelper takes token, governance, timelock, and admin addresses
    const daoHelper = await deployProxy(
      JustDAOHelper,
      [tokenAddress, governanceAddress, timelockAddress, admin],
      { contractName: "JustDAOHelper" }
    );
    
    const daoHelperAddress = await daoHelper.getAddress();
    
    // Verify the DAO helper deployment before continuing
    await verifyContractCode(daoHelperAddress, "JustDAOHelper");
    
    // Deploy JustEnhancedAnalyticsHelper
    console.log("\nStarting JustEnhancedAnalyticsHelper deployment...");
    const JustEnhancedAnalyticsHelper = await ethers.getContractFactory("contracts/JustEnhancedAnalyticsHelper.sol:JustEnhancedAnalyticsHelper");
    
    // EnhancedAnalyticsHelper takes token, governance, timelock, and admin addresses
    const enhancedAnalyticsHelper = await deployProxy(
      JustEnhancedAnalyticsHelper,
      [tokenAddress, governanceAddress, timelockAddress, admin],
      { contractName: "JustEnhancedAnalyticsHelper" }
    );
    
    const enhancedAnalyticsHelperAddress = await enhancedAnalyticsHelper.getAddress();
    
    // Verify the Enhanced Analytics Helper deployment before continuing
    await verifyContractCode(enhancedAnalyticsHelperAddress, "JustEnhancedAnalyticsHelper");
    
    // Debug connection to contracts before interacting with them
    console.log("\nDebug: Checking contract connections...");
    try {
      // Validate timelock contract has been properly deployed
      const timelockMinDelay = await timelock.minDelay();
      console.log(`Timelock minDelay: ${timelockMinDelay}`);
      
      // Validate token contract has been properly deployed
      const tokenSymbol = await token.symbol();
      console.log(`Token symbol: ${tokenSymbol}`);
      
      // Validate governance contract has been properly deployed
      const governanceProposalThreshold = await governance.govParams();
      console.log(`Governance proposal threshold: ${governanceProposalThreshold.proposalCreationThreshold.toString()}`);
      
      // Validate DAO helper contract has been properly deployed
      const helperTokenAddress = await daoHelper.justToken();
      console.log(`DAOHelper connected to token: ${helperTokenAddress}`);
      
      const helperGovernanceAddress = await daoHelper.justGovernance();
      console.log(`DAOHelper connected to governance: ${helperGovernanceAddress}`);
      
      const helperTimelockAddress = await daoHelper.justTimelock();
      console.log(`DAOHelper connected to timelock: ${helperTimelockAddress}`);
      
      // Validate EnhancedAnalyticsHelper contract has been properly deployed
      const analyticsHelperTokenAddress = await enhancedAnalyticsHelper.justToken();
      console.log(`EnhancedAnalyticsHelper connected to token: ${analyticsHelperTokenAddress}`);
      
      const analyticsHelperGovernanceAddress = await enhancedAnalyticsHelper.justGovernance();
      console.log(`EnhancedAnalyticsHelper connected to governance: ${analyticsHelperGovernanceAddress}`);
      
      const analyticsHelperTimelockAddress = await enhancedAnalyticsHelper.justTimelock();
      console.log(`EnhancedAnalyticsHelper connected to timelock: ${analyticsHelperTimelockAddress}`);
      
      // Verify addresses match
      if (helperTokenAddress.toLowerCase() !== tokenAddress.toLowerCase()) {
        throw new Error("DAOHelper's token address doesn't match the deployed token");
      }
      
      if (helperGovernanceAddress.toLowerCase() !== governanceAddress.toLowerCase()) {
        throw new Error("DAOHelper's governance address doesn't match the deployed governance");
      }
      
      if (helperTimelockAddress.toLowerCase() !== timelockAddress.toLowerCase()) {
        throw new Error("DAOHelper's timelock address doesn't match the deployed timelock");
      }
      
      if (analyticsHelperTokenAddress.toLowerCase() !== tokenAddress.toLowerCase()) {
        throw new Error("EnhancedAnalyticsHelper's token address doesn't match the deployed token");
      }
      
      if (analyticsHelperGovernanceAddress.toLowerCase() !== governanceAddress.toLowerCase()) {
        throw new Error("EnhancedAnalyticsHelper's governance address doesn't match the deployed governance");
      }
      
      if (analyticsHelperTimelockAddress.toLowerCase() !== timelockAddress.toLowerCase()) {
        throw new Error("EnhancedAnalyticsHelper's timelock address doesn't match the deployed timelock");
      }
    } catch (error) {
      console.error("Error connecting to deployed contracts:", error);
      throw error;
    }
    
    // Set up the token contract with timelock reference
    console.log("\nSetting timelock in token...");
    try {
      const setTimelockTx = await token.setTimelock(timelockAddress);
      console.log(`Set timelock transaction hash: ${setTimelockTx.hash}`);
      await setTimelockTx.wait();
      console.log("Timelock set successfully in token");
    } catch (error) {
      console.error("Error setting timelock in token:", error);
      throw error;
    }
    
    // Set up the JustToken reference in timelock
    console.log("\nSetting JustToken in timelock...");
    try {
      const setTokenTx = await timelock.setJustToken(tokenAddress);
      console.log(`Set token transaction hash: ${setTokenTx.hash}`);
      await setTokenTx.wait();
      console.log("Token set successfully in timelock");
    } catch (error) {
      console.error("Error setting token in timelock:", error);
      throw error;
    }
    
    // Grant roles with detailed error reporting
    console.log("\nSetting up roles...");
    
    try {
      // Get role hashes
      const GOVERNANCE_ROLE = await token.GOVERNANCE_ROLE();
      const PROPOSER_ROLE = await timelock.PROPOSER_ROLE();
      const EXECUTOR_ROLE = await timelock.EXECUTOR_ROLE();
      const DAO_ANALYTICS_ROLE = await daoHelper.ANALYTICS_ROLE();
      const ENHANCED_ANALYTICS_ROLE = await enhancedAnalyticsHelper.ANALYTICS_ROLE();
      
      console.log("1/5: Granting GOVERNANCE_ROLE to governance contract...");
      const grantGovRoleTx = await token.grantContractRole(GOVERNANCE_ROLE, governanceAddress);
      await grantGovRoleTx.wait();
      
      console.log("2/5: Granting PROPOSER_ROLE to governance contract...");
      const grantPropRoleTx = await timelock.grantContractRole(PROPOSER_ROLE, governanceAddress);
      await grantPropRoleTx.wait();
      
      console.log("3/5: Granting EXECUTOR_ROLE to governance contract...");
      const grantExecRoleTx = await timelock.grantContractRole(EXECUTOR_ROLE, governanceAddress);
      await grantExecRoleTx.wait();
      
      console.log("4/5: Granting ANALYTICS_ROLE to deployer for DAO helper...");
      const grantDAOAnalyticsRoleTx = await daoHelper.grantRole(DAO_ANALYTICS_ROLE, deployer.address);
      await grantDAOAnalyticsRoleTx.wait();
      
      console.log("5/5: Granting ANALYTICS_ROLE to deployer for Enhanced Analytics helper...");
      const grantEnhancedAnalyticsRoleTx = await enhancedAnalyticsHelper.grantRole(ENHANCED_ANALYTICS_ROLE, deployer.address);
      await grantEnhancedAnalyticsRoleTx.wait();
      
      console.log("All roles granted successfully");
    } catch (error) {
      console.error("Error granting roles:", error);
      throw error;
    }
    
    console.log("\nDeployment and setup complete!");
    
    // Output all the addresses
    console.log("\nDeployed contract addresses:");
    console.log("JustTimelock:", timelockAddress);
    console.log("JustToken:", tokenAddress);
    console.log("JustGovernance:", governanceAddress);
    console.log("JustDAOHelper:", daoHelperAddress);
    console.log("JustEnhancedAnalyticsHelper:", enhancedAnalyticsHelperAddress);
    
    try {
      // Get implementation addresses
      const timelockImplementation = await upgrades.erc1967.getImplementationAddress(timelockAddress);
      const tokenImplementation = await upgrades.erc1967.getImplementationAddress(tokenAddress);
      const governanceImplementation = await upgrades.erc1967.getImplementationAddress(governanceAddress);
      const daoHelperImplementation = await upgrades.erc1967.getImplementationAddress(daoHelperAddress);
      const enhancedAnalyticsHelperImplementation = await upgrades.erc1967.getImplementationAddress(enhancedAnalyticsHelperAddress);
      
      console.log("\nImplementation addresses for verification:");
      console.log("JustTimelock Implementation:", timelockImplementation);
      console.log("JustToken Implementation:", tokenImplementation);
      console.log("JustGovernance Implementation:", governanceImplementation);
      console.log("JustDAOHelper Implementation:", daoHelperImplementation);
      console.log("JustEnhancedAnalyticsHelper Implementation:", enhancedAnalyticsHelperImplementation);
      
      // Get proxy admin address
      const adminAddress = await upgrades.erc1967.getAdminAddress(timelockAddress);
      console.log("\nProxy Admin:", adminAddress);
    } catch (error) {
      console.error("Error retrieving implementation addresses:", error);
    }
    
  } catch (error) {
    console.error("Deployment failed:", error);
    process.exit(1);
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("Unhandled error:", error);
    process.exit(1);
  });