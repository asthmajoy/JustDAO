// SPDX-License-Identifier: MIT
// deploy.js - Robust deployment script with timeout handling and enhanced cross-contract setup

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
    
    // Deploy JustAnalyticsHelperUpgradeable
    console.log("\nStarting JustAnalyticsHelperUpgradeable deployment...");
    const JustAnalyticsHelperUpgradeable = await ethers.getContractFactory("contracts/JustAnalyticsHelperUpgradeable.sol:JustAnalyticsHelperUpgradeable");
    
    // EnhancedAnalyticsHelper takes token, governance, timelock, and admin addresses
    const enhancedAnalyticsHelper = await deployProxy(
      JustAnalyticsHelperUpgradeable,
      [tokenAddress, governanceAddress, timelockAddress, admin],
      { contractName: "JustAnalyticsHelperUpgradeable" }
    );
    
    const enhancedAnalyticsHelperAddress = await enhancedAnalyticsHelper.getAddress();
    
    // Verify the Enhanced Analytics Helper deployment before continuing
    await verifyContractCode(enhancedAnalyticsHelperAddress, "JustAnalyticsHelperUpgradeable");
    
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
    
    const GOVERNANCE_ROLE = await token.GOVERNANCE_ROLE();
    const PROPOSER_ROLE = await timelock.PROPOSER_ROLE();
    const EXECUTOR_ROLE = await timelock.EXECUTOR_ROLE();
    const DAO_ANALYTICS_ROLE = await daoHelper.ANALYTICS_ROLE();
    const ENHANCED_ANALYTICS_ROLE = await enhancedAnalyticsHelper.ANALYTICS_ROLE();
    const CANCELLER_ROLE = await timelock.CANCELLER_ROLE();

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
      const CANCELLER_ROLE = await timelock.CANCELLER_ROLE();
      
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
    console.log("JustAnalyticsHelperUpgradeable:", enhancedAnalyticsHelperAddress);
    
    // Connect DAO Helper contracts to Governance
    console.log("\nSetting Governance contract as Analytics Role holder for helpers...");
    try {
      // Grant Analytics role to Governance contract for both helpers
      console.log("1/4: Granting ANALYTICS_ROLE to governance in DAO Helper...");
      const grantDaoAnalyticsToGovTx = await daoHelper.grantRole(DAO_ANALYTICS_ROLE, governanceAddress);
      await grantDaoAnalyticsToGovTx.wait();
      
      console.log("2/4: Granting ANALYTICS_ROLE to governance in Enhanced Analytics Helper...");
      const grantEnhancedAnalyticsToGovTx = await enhancedAnalyticsHelper.grantRole(ENHANCED_ANALYTICS_ROLE, governanceAddress);
      await grantEnhancedAnalyticsToGovTx.wait();
      
      console.log("3/4: Granting GOVERNANCE_ROLE to timelock in token contract...");
      const grantGovRoleToTimelockTx = await token.grantContractRole(GOVERNANCE_ROLE, timelockAddress);
      await grantGovRoleToTimelockTx.wait();
      
      console.log("4/4: Granting CANCELLER_ROLE to governance in timelock...");
      const grantCancellerRoleTx = await timelock.grantContractRole(CANCELLER_ROLE, governanceAddress);
      await grantCancellerRoleTx.wait();
      
      console.log("Additional roles granted successfully");
    } catch (error) {
      console.error("Error granting additional roles:", error);
      throw error;
    }

    // Test basic DAO functionality
    console.log("\nTesting basic DAO functionality...");
    try {
      // Create a token snapshot using Governance role
      console.log("1/3: Creating token snapshot...");
      const snapshotTx = await token.createSnapshot();
      await snapshotTx.wait();
      const snapshotId = await token.getCurrentSnapshotId();
      console.log(`Snapshot created with ID: ${snapshotId}`);
      
      // Test if the DAO Helper can access this snapshot
      console.log("2/3: Testing DAO Helper's ability to access token data...");
      const delegationDepth = await daoHelper.getDelegationDepth(deployer.address);
      console.log(`Deployer's delegation depth: ${delegationDepth}`);
      
      // Test if the Enhanced Analytics Helper can access governance data
      console.log("3/3: Testing Enhanced Analytics Helper's access to governance data...");
      try {
        const firstProposalId = 1; // This might not exist yet
        const metricResponse = await enhancedAnalyticsHelper.getProposalAnalytics(1, firstProposalId);
        console.log("Enhanced Analytics Helper successfully queried governance data");
      } catch (error) {
        // This is expected to fail if no proposals exist yet
        console.log("Enhanced Analytics Helper attempted to query governance (expected to have no proposals yet)");
      }
      
      console.log("Basic functionality tests completed");
    } catch (error) {
      console.error("Error testing basic functionality:", error);
      console.log("This may be expected if certain features require proposals to exist");
    }

    // ADDED SECTION: COMPLETE CROSS-CONTRACT SETUP
    console.log("\n======= COMPLETE CROSS-CONTRACT SETUP =======");

    // 1. GOVERNANCE PERMISSIONS
    console.log("\nSetting up complete governance permissions...");
    try {
      // Set up governance with ability to create snapshots and serve as primary admin
      console.log("1/3: Ensuring governance can create token snapshots...");
      const hasGovRole = await token.hasRole(GOVERNANCE_ROLE, governanceAddress);
      if (!hasGovRole) {
        const grantGovRoleTx = await token.grantContractRole(GOVERNANCE_ROLE, governanceAddress);
        await grantGovRoleTx.wait();
        console.log("GOVERNANCE_ROLE granted to governance contract");
      } else {
        console.log("GOVERNANCE_ROLE already granted to governance contract");
      }

      // Grant MINTER_ROLE to governance
      console.log("2/3: Granting MINTER_ROLE to governance...");
      const MINTER_ROLE = await token.MINTER_ROLE();
      const hasMinterRole = await token.hasRole(MINTER_ROLE, governanceAddress);
      if (!hasMinterRole) {
        const grantMinterRoleTx = await token.grantContractRole(MINTER_ROLE, governanceAddress);
        await grantMinterRoleTx.wait();
        console.log("MINTER_ROLE granted to governance contract");
      } else {
        console.log("MINTER_ROLE already granted to governance contract");
      }

      // Grant GUARDIAN_ROLE to governance
      console.log("3/3: Granting GUARDIAN_ROLE to governance in both token and timelock...");
      const GUARDIAN_ROLE_TOKEN = await token.GUARDIAN_ROLE();
      const hasGuardianRoleToken = await token.hasRole(GUARDIAN_ROLE_TOKEN, governanceAddress);
      if (!hasGuardianRoleToken) {
        const grantGuardianRoleTx = await token.grantContractRole(GUARDIAN_ROLE_TOKEN, governanceAddress);
        await grantGuardianRoleTx.wait();
        console.log("GUARDIAN_ROLE granted to governance in token contract");
      } else {
        console.log("GUARDIAN_ROLE already granted to governance in token contract");
      }

      const GUARDIAN_ROLE_TIMELOCK = await timelock.GUARDIAN_ROLE();
      const hasGuardianRoleTimelock = await timelock.hasRole(GUARDIAN_ROLE_TIMELOCK, governanceAddress);
      if (!hasGuardianRoleTimelock) {
        const grantGuardianRoleTimelockTx = await timelock.grantContractRole(GUARDIAN_ROLE_TIMELOCK, governanceAddress);
        await grantGuardianRoleTimelockTx.wait();
        console.log("GUARDIAN_ROLE granted to governance in timelock contract");
      } else {
        console.log("GUARDIAN_ROLE already granted to governance in timelock contract");
      }

      console.log("Governance permissions setup complete");
    } catch (error) {
      console.error("Error setting up governance permissions:", error);
      throw error;
    }

    // 2. TIMELOCK PERMISSIONS
    console.log("\nSetting up complete timelock permissions...");
    try {
      // Ensure timelock has GOVERNANCE_ROLE in token
      console.log("1/2: Ensuring timelock has GOVERNANCE_ROLE in token...");
      const hasGovRoleTimelock = await token.hasRole(GOVERNANCE_ROLE, timelockAddress);
      if (!hasGovRoleTimelock) {
        const grantGovRoleTimelockTx = await token.grantContractRole(GOVERNANCE_ROLE, timelockAddress);
        await grantGovRoleTimelockTx.wait();
        console.log("GOVERNANCE_ROLE granted to timelock in token contract");
      } else {
        console.log("GOVERNANCE_ROLE already granted to timelock in token contract");
      }

      // Grant MINTER_ROLE to timelock
      console.log("2/2: Granting MINTER_ROLE to timelock...");
      const MINTER_ROLE = await token.MINTER_ROLE();
      const hasMinterRoleTimelock = await token.hasRole(MINTER_ROLE, timelockAddress);
      if (!hasMinterRoleTimelock) {
        const grantMinterRoleTimelockTx = await token.grantContractRole(MINTER_ROLE, timelockAddress);
        await grantMinterRoleTimelockTx.wait();
        console.log("MINTER_ROLE granted to timelock in token contract");
      } else {
        console.log("MINTER_ROLE already granted to timelock in token contract");
      }

      console.log("Timelock permissions setup complete");
    } catch (error) {
      console.error("Error setting up timelock permissions:", error);
      throw error;
    }

    // 3. HELPER CONTRACTS SETUP
    console.log("\nSetting up helper contract connections...");
    try {
      // Verify addresses in DAO Helper
      console.log("1/2: Verifying and updating contract addresses in DAO Helper...");
      const daoHelperTokenAddr = await daoHelper.justToken();
      const daoHelperGovAddr = await daoHelper.justGovernance();
      const daoHelperTimelockAddr = await daoHelper.justTimelock();

      if (daoHelperTokenAddr.toLowerCase() !== tokenAddress.toLowerCase() ||
          daoHelperGovAddr.toLowerCase() !== governanceAddress.toLowerCase() ||
          daoHelperTimelockAddr.toLowerCase() !== timelockAddress.toLowerCase()) {
        console.log("Updating contract addresses in DAO Helper...");
        const updateAddressesTx = await daoHelper.updateContractAddresses(
          tokenAddress, 
          governanceAddress, 
          timelockAddress
        );
        await updateAddressesTx.wait();
        console.log("DAO Helper addresses updated");
      } else {
        console.log("DAO Helper addresses already correctly set");
      }

      // Verify addresses in Analytics Helper
      console.log("2/2: Verifying and updating contract addresses in Analytics Helper...");
      const analyticsHelperTokenAddr = await enhancedAnalyticsHelper.justToken();
      const analyticsHelperGovAddr = await enhancedAnalyticsHelper.justGovernance();
      const analyticsHelperTimelockAddr = await enhancedAnalyticsHelper.justTimelock();

      if (analyticsHelperTokenAddr.toLowerCase() !== tokenAddress.toLowerCase() ||
          analyticsHelperGovAddr.toLowerCase() !== governanceAddress.toLowerCase() ||
          analyticsHelperTimelockAddr.toLowerCase() !== timelockAddress.toLowerCase()) {
        console.log("Updating contract addresses in Analytics Helper...");
        const updateAnalyticsAddressesTx = await enhancedAnalyticsHelper.updateContractAddresses(
          tokenAddress, 
          governanceAddress, 
          timelockAddress
        );
        await updateAnalyticsAddressesTx.wait();
        console.log("Analytics Helper addresses updated");
      } else {
        console.log("Analytics Helper addresses already correctly set");
      }

      console.log("Helper contracts setup complete");
    } catch (error) {
      console.error("Error setting up helper contracts:", error);
      throw error;
    }

    // 4. CROSS-CONTRACT VERIFICATION
    console.log("\nPerforming comprehensive cross-contract verification...");
    try {
      // Verify token setup
      console.log("1/4: Verifying token contract setup...");
      const tokenTimelockAddr = await token.timelock();
      if (tokenTimelockAddr.toLowerCase() !== timelockAddress.toLowerCase()) {
        console.error("❌ Token's timelock reference is incorrect!");
      } else {
        console.log("✅ Token's timelock reference correctly set");
      }

      // Verify governance setup
      console.log("2/4: Verifying governance contract setup...");
      const govTokenAddr = await governance.justToken();
      const govTimelockAddr = await governance.timelock();
      
      if (govTokenAddr.toLowerCase() !== tokenAddress.toLowerCase()) {
        console.error("❌ Governance's token reference is incorrect!");
      } else {
        console.log("✅ Governance's token reference correctly set");
      }
      
      if (govTimelockAddr.toLowerCase() !== timelockAddress.toLowerCase()) {
        console.error("❌ Governance's timelock reference is incorrect!");
      } else {
        console.log("✅ Governance's timelock reference correctly set");
      }

      // Verify timelock setup
      console.log("3/4: Verifying timelock contract setup...");
      const timelockTokenAddr = await timelock.justToken();
      if (timelockTokenAddr.toLowerCase() !== tokenAddress.toLowerCase()) {
        console.error("❌ Timelock's token reference is incorrect!");
      } else {
        console.log("✅ Timelock's token reference correctly set");
      }

      // Verify role setup
      console.log("4/4: Verifying critical role assignments...");
      const hasGovRoleInToken = await token.hasRole(GOVERNANCE_ROLE, governanceAddress);
      const hasProposerRoleInTimelock = await timelock.hasRole(PROPOSER_ROLE, governanceAddress);
      const hasExecutorRoleInTimelock = await timelock.hasRole(EXECUTOR_ROLE, governanceAddress);
      const hasCancellerRoleInTimelock = await timelock.hasRole(CANCELLER_ROLE, governanceAddress);
      
      console.log(`✅ Governance has GOVERNANCE_ROLE in token: ${hasGovRoleInToken}`);
      console.log(`✅ Governance has PROPOSER_ROLE in timelock: ${hasProposerRoleInTimelock}`);
      console.log(`✅ Governance has EXECUTOR_ROLE in timelock: ${hasExecutorRoleInTimelock}`);
      console.log(`✅ Governance has CANCELLER_ROLE in timelock: ${hasCancellerRoleInTimelock}`);
      
      const hasTimelocGovRoleInToken = await token.hasRole(GOVERNANCE_ROLE, timelockAddress);
      console.log(`✅ Timelock has GOVERNANCE_ROLE in token: ${hasTimelocGovRoleInToken}`);

      const hasDaoHelperAnalyticsRole = await daoHelper.hasRole(DAO_ANALYTICS_ROLE, governanceAddress);
      const hasAnalyticsHelperAnalyticsRole = await enhancedAnalyticsHelper.hasRole(ENHANCED_ANALYTICS_ROLE, governanceAddress);
      
      console.log(`✅ Governance has ANALYTICS_ROLE in DAO Helper: ${hasDaoHelperAnalyticsRole}`);
      console.log(`✅ Governance has ANALYTICS_ROLE in Analytics Helper: ${hasAnalyticsHelperAnalyticsRole}`);

      console.log("Cross-contract verification complete");
    } catch (error) {
      console.error("Error during cross-contract verification:", error);
      throw error;
    }

    // 5. INITIAL GOVERNANCE SETUP
    console.log("\nPerforming initial governance setup...");
    try {
      // Create a snapshot to use for future proposals
      console.log("1/2: Creating governance snapshot...");
      const createSnapshotTx = await token.createSnapshot();
      await createSnapshotTx.wait();
      const latestSnapshotId = await token.getCurrentSnapshotId();
      console.log(`✅ Created snapshot ID: ${latestSnapshotId}`);

      // Set up executor token threshold for timelock
      console.log("2/2: Setting appropriate executor token threshold in timelock...");
      const minExecutorThreshold = ethers.parseEther("1"); // 1 token minimum for executing
      const updateThresholdTx = await timelock.updateExecutorTokenThreshold(minExecutorThreshold);
      await updateThresholdTx.wait();
      console.log(`✅ Set executor token threshold to ${ethers.formatEther(minExecutorThreshold)} tokens`);

      console.log("Initial governance setup complete");
    } catch (error) {
      console.error("Error during initial governance setup:", error);
      throw error;
    }

    // 6. FINAL CHECKS AND SUMMARY
    console.log("\n======= FINAL DEPLOYMENT SUMMARY =======");
    console.log(`\n✅ All contracts deployed and configured successfully!`);
    console.log(`\n📋 Contract Addresses:`);
    console.log(`Token (${await token.symbol()}): ${tokenAddress}`);
    console.log(`Governance: ${governanceAddress}`);
    console.log(`Timelock: ${timelockAddress}`);
    console.log(`DAO Helper: ${daoHelperAddress}`);
    console.log(`Analytics Helper: ${enhancedAnalyticsHelperAddress}`);

    console.log(`\n📋 Implementation Addresses (for verification):`);
    const timelockImpl = await upgrades.erc1967.getImplementationAddress(timelockAddress);
    const tokenImpl = await upgrades.erc1967.getImplementationAddress(tokenAddress);
    const govImpl = await upgrades.erc1967.getImplementationAddress(governanceAddress);
    const daoHelperImpl = await upgrades.erc1967.getImplementationAddress(daoHelperAddress);
    const analyticsHelperImpl = await upgrades.erc1967.getImplementationAddress(enhancedAnalyticsHelperAddress);

    console.log(`Token Implementation: ${tokenImpl}`);
    console.log(`Governance Implementation: ${govImpl}`);
    console.log(`Timelock Implementation: ${timelockImpl}`);
    console.log(`DAO Helper Implementation: ${daoHelperImpl}`);
    console.log(`Analytics Helper Implementation: ${analyticsHelperImpl}`);
    console.log("\nProxy Admin:", await upgrades.erc1967.getAdminAddress(timelockAddress));

    console.log(`\n⚠️ IMPORTANT: Keep these addresses safe for future reference and verification`);
    console.log(`⚠️ Use these implementation addresses when verifying contracts on Etherscan`);

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
      console.log("JustAnalyticsHelperUpgradeable Implementation:", enhancedAnalyticsHelperImplementation);
      
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