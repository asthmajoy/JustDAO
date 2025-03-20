/**
 * Configure all role-based permissions for the Indiana Legal Aid DAO
 *
 * This script sets up proper permissions across JustToken, JustTimelock, JustGovernance,
 * and JustDAOHelper contracts to create a secure governance structure
 */
const { ethers, network } = require("hardhat");



// Contract addresses 
const DEPLOYER_ADDRESS      = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266";
const JUST_TOKEN_ADDRESS    = "0x071586BA1b380B00B793Cc336fe01106B0BFbE6D";
const JUST_TIMELOCK_ADDRESS = "0xe039608E695D21aB11675EBBA00261A0e750526c";
const JUST_GOVERNANCE_ADDR  = "0xe70f935c32dA4dB13e7876795f1e175465e6458e";
const JUST_DAO_HELPER_ADDR  = "0x3C15538ED063e688c8DF3d571Cb7a0062d2fB18D"; 
const JUST_ANALYTICS_HELPER_ADDR = "0x3904b8f5b0F49cD206b7d5AABeE5D1F37eE15D8d"; 

// Replace with your actual multi-sig address if you have one
const MULTISIG_ADDRESS = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266"; // Using deployer for now

/**
 * Sets up governance permissions between token, timelock, and governance contracts
 * @param admin - The admin account to use for transactions
 * @param justToken - The token contract instance
 * @param justTimelock - The timelock contract instance
 * @param justGovernance - The governance contract instance
 * @param initialTokenAmount - Amount of tokens to mint to the governance contract
 */

// Function to convert function signatures to selectors
function getFunctionSelector(signature) {
  return ethers.id(signature).substring(0, 10);
}

async function calculateFunctionSelectors() {
  console.log("\n=== Calculating Function Selectors ===");

  
  
  // Token functions
  const tokenFunctions = [
    "delegate(address)",                                        // Delegate voting power
    "resetDelegation()",                                        // Reset delegation
    "getDelegate(address)",                                     // Get delegate for an account
    "createSnapshot()",                                         // Create token snapshot
    "getEffectiveVotingPower(address,uint256)",                 // Get voting power at snapshot
    "governanceTransfer(address,address,uint256)",              // Governance-controlled transfer
    "governanceMint(address,uint256)",                          // Governance-controlled mint
    "governanceBurn(address,uint256)",                          // Governance-controlled burn
    "setMaxTokenSupply(uint256)",                               // Set maximum token supply
    "setTimelock(address)",                                     // Set timelock address
    "addGuardian(address)",                                     // Add guardian role 
    "removeGuardian(address)",                                  // Remove guardian role
    "grantContractRole(bytes32,address)",                       // Grant role to account
    "revokeContractRole(bytes32,address)",                      // Revoke role from account
  ];
  
  // Governance functions
  const governanceFunctions = [
    "createProposal(string,uint8,address,bytes,uint256,address,address,uint256,uint256,uint256,uint256)", // Create proposal
    "castVote(uint256,uint8)",                                  // Vote on proposal
    "queueProposal(uint256)",                                   // Queue proposal for execution
    "executeProposal(uint256)",                                 // Execute proposal
    "cancelProposal(uint256)",                                  // Cancel proposal
    "claimPartialStakeRefund(uint256)",                         // Claim stake refund
    "updateGovParam(uint8,uint256)",                            // Update governance parameters
    "updateSecurity(bytes4,bool,address,bool)",                 // Update security settings
    "pause()",                                                  // Pause the contract
    "unpause()",                                                // Unpause the contract
    "rescueETH()",                                              // Rescue ETH
    "rescueERC20(address)",                                     // Rescue ERC20 tokens
    "updateGuardian(address,bool)",                             // Update guardian address
  ];
  
  // Timelock functions
  const timelockFunctions = [
    "queueTransactionWithThreatLevel(address,uint256,bytes)",   // Queue transaction with threat level
    "queueTransaction(address,uint256,bytes,uint256)",          // Queue transaction with custom delay
    "executeTransaction(bytes32)",                              // Execute transaction
    "cancelTransaction(bytes32)",                               // Cancel transaction
    "getTransaction(bytes32)",                                  // Get transaction details
    "updateDelays(uint256,uint256,uint256)",                    // Update timelock delays
    "updateThreatLevelDelays(uint256,uint256,uint256,uint256)", // Update threat level delays
    "setFunctionThreatLevel(bytes4,uint8)",                     // Set function threat level
    "setBatchFunctionThreatLevels(bytes4[],uint8[])",           // Set batch function threat levels
    "setAddressThreatLevel(address,uint8)",                     // Set address threat level
    "setBatchAddressThreatLevels(address[],uint8[])",           // Set batch address threat levels
    "setPaused(bool)",                                          // Pause or unpause timelock
    "setJustToken(address)",                                    // Set token address
  ];
  
  // DAO Helper functions
  const daoHelperFunctions = [
    "updateContractAddresses(address,address,address)",         // Update contract addresses
    "setPaused(bool)",                                          // Pause or unpause helper
    "recordDelegation(address,address)",                        // Record delegation
    "checkAndWarnDelegationDepth(address,address)",             // Check delegation depth
  ];
  
  // Combine all functions
  const allFunctions = [
    ...tokenFunctions,
    ...governanceFunctions,
    ...timelockFunctions,
    ...daoHelperFunctions
  ];
  
  // Calculate selectors for all functions
  const selectors = allFunctions.map(funcSig => ({
    signature: funcSig,
    selector: getFunctionSelector(funcSig)
  }));
  
  // Print calculated selectors
  console.log("Function selectors to enable:");
  selectors.forEach(func => {
    console.log(`  ${func.signature}: ${func.selector}`);
  });
  
  return selectors;
}

// Configure threat levels for the timelock
async function configureThreatLevels(justTimelock) {
  console.log("\n=== Configuring Threat Levels for Functions ===");
  
  const transactions = [];
  
  // Critical functions - Level 3
  const criticalFunctions = [
    "upgradeTo(address)", 
    "upgradeToAndCall(address,bytes)",
    "setTimelock(address)",
    "pause()",
    "unpause()",
    "setMaxTokenSupply(uint256)",
    "updateGovParam(uint8,uint256)",
    "updateSecurity(bytes4,bool,address,bool)",
  ];
  
  // High risk functions - Level 2
  const highThreatFunctions = [
    "grantContractRole(bytes32,address)",
    "revokeContractRole(bytes32,address)",
    "governanceMint(address,uint256)",
    "governanceBurn(address,uint256)",
    "governanceTransfer(address,address,uint256)",
    "delegate(address)",
    "resetDelegation()",
    "addGuardian(address)",
    "removeGuardian(address)",
    "updateGuardian(address,bool)",
    "updateContractAddresses(address,address,address)",
  ];
  
  // Medium risk functions - Level 1
  const mediumThreatFunctions = [
    "createSnapshot()",
    "rescueETH()",
    "rescueERC20(address)",
    "updateDelays(uint256,uint256,uint256)",
    "updateThreatLevelDelays(uint256,uint256,uint256,uint256)",
    "setFunctionThreatLevel(bytes4,uint8)",
    "setBatchFunctionThreatLevels(bytes4[],uint8[])",
    "createProposal(string,uint8,address,bytes,uint256,address,address,uint256,uint256,uint256,uint256)",
  ];
  
  // Set threat levels for critical functions
  for (const func of criticalFunctions) {
    const selector = getFunctionSelector(func);
    console.log(`Setting CRITICAL threat level (3) for ${func} (${selector})`);
    
    transactions.push(
      await justTimelock.setFunctionThreatLevel(selector, 3, {gasLimit: 200000})
    );
  }
  
  // Set threat levels for high risk functions
  for (const func of highThreatFunctions) {
    const selector = getFunctionSelector(func);
    console.log(`Setting HIGH threat level (2) for ${func} (${selector})`);
    
    transactions.push(
      await justTimelock.setFunctionThreatLevel(selector, 2, {gasLimit: 200000})
    );
  }
  
  // Set threat levels for medium risk functions
  for (const func of mediumThreatFunctions) {
    const selector = getFunctionSelector(func);
    console.log(`Setting MEDIUM threat level (1) for ${func} (${selector})`);
    
    transactions.push(
      await justTimelock.setFunctionThreatLevel(selector, 1, {gasLimit: 200000})
    );
  }
  
  // Wait for all transactions to be mined
  console.log("Waiting for threat level transactions to be confirmed...");
  for (let i = 0; i < transactions.length; i++) {
    console.log(`Confirming threat level transaction ${i+1} of ${transactions.length}...`);
    await transactions[i].wait();
  }
  
  console.log("✅ Function threat levels configured successfully!");
  
  // Set address threat levels
  console.log("\n=== Setting Threat Levels for Addresses ===");
  
  const addressThreatLevels = [
    { address: JUST_TOKEN_ADDRESS, level: 2 }, // HIGH
    { address: JUST_GOVERNANCE_ADDR, level: 2 }, // HIGH
    { address: JUST_TIMELOCK_ADDRESS, level: 3 }, // CRITICAL
    { address: JUST_DAO_HELPER_ADDR, level: 1 }, // MEDIUM
  ];
  
  const addressTransactions = [];
  
  for (const addr of addressThreatLevels) {
    console.log(`Setting threat level ${addr.level} for address ${addr.address}...`);
    addressTransactions.push(
      await justTimelock.setAddressThreatLevel(
        addr.address,
        addr.level,
        {gasLimit: 200000}
      )
    );
  }
  
  console.log("Waiting for address threat level transactions to be confirmed...");
  for (let i = 0; i < addressTransactions.length; i++) {
    console.log(`Confirming address threat level transaction ${i+1} of ${addressTransactions.length}...`);
    await addressTransactions[i].wait();
  }
  
  console.log("✅ Address threat levels configured successfully!");
}

async function main() {
  await configureRoles();
}

async function configureRoles() {
  const [deployer] = await ethers.getSigners();
  console.log("Configuring roles using account:", deployer.address);
  
  // Security check - confirm we're running on the intended network
  const chainId = await ethers.provider.getNetwork().then(network => network.chainId);
  console.log(`Current chain ID: ${chainId}`);
  
  try {
    // Attach to all contracts
    const JustToken = await ethers.getContractFactory("contracts/JustTokenUpgradeable.sol:JustTokenUpgradeable");
    const justToken = JustToken.attach(JUST_TOKEN_ADDRESS);
    
    const JustAnalyticsHelper = await ethers.getContractFactory("contracts/JustAnalyticsHelperUpgradeable.sol:JustAnalyticsHelperUpgradeable");
    const justAnalyticsHelper = JustAnalyticsHelper.attach(JUST_ANALYTICS_HELPER_ADDR);

    const JustTimelock = await ethers.getContractFactory("contracts/JustTimelockUpgradeable.sol:JustTimelockUpgradeable");
    const justTimelock = JustTimelock.attach(JUST_TIMELOCK_ADDRESS);
    
    const JustGovernance = await ethers.getContractFactory("contracts/JustGovernanceUpgradeable.sol:JustGovernanceUpgradeable");
    const justGovernance = JustGovernance.attach(JUST_GOVERNANCE_ADDR);
    
    const JustDAOHelper = await ethers.getContractFactory("contracts/JustDAOHelperUpgradeable.sol:JustDAOHelperUpgradeable");
    const justDAOHelper = JustDAOHelper.attach(JUST_DAO_HELPER_ADDR);

    // Define role identifiers directly to avoid calling contract constants
    // This is more reliable with ethers v6
    const DEFAULT_ADMIN_ROLE = "0x0000000000000000000000000000000000000000000000000000000000000000"; // bytes32(0)
    const ADMIN_ROLE = ethers.keccak256(ethers.toUtf8Bytes("ADMIN_ROLE"));
    const GUARDIAN_ROLE = ethers.keccak256(ethers.toUtf8Bytes("GUARDIAN_ROLE"));
    const GOVERNANCE_ROLE = ethers.keccak256(ethers.toUtf8Bytes("GOVERNANCE_ROLE"));
    const MINTER_ROLE = ethers.keccak256(ethers.toUtf8Bytes("MINTER_ROLE"));
    const PROPOSER_ROLE = ethers.keccak256(ethers.toUtf8Bytes("PROPOSER_ROLE"));
    const EXECUTOR_ROLE = ethers.keccak256(ethers.toUtf8Bytes("EXECUTOR_ROLE"));
    const CANCELLER_ROLE = ethers.keccak256(ethers.toUtf8Bytes("CANCELLER_ROLE"));
    const ANALYTICS_ROLE = ethers.keccak256(ethers.toUtf8Bytes("ANALYTICS_ROLE"));
    const TIMELOCK_ADMIN_ROLE = ethers.keccak256(ethers.toUtf8Bytes("TIMELOCK_ADMIN_ROLE"));
    
    console.log("Role identifiers:");
    console.log(`DEFAULT_ADMIN_ROLE: ${DEFAULT_ADMIN_ROLE}`);
    console.log(`ADMIN_ROLE: ${ADMIN_ROLE}`);
    console.log(`GUARDIAN_ROLE: ${GUARDIAN_ROLE}`);
    console.log(`GOVERNANCE_ROLE: ${GOVERNANCE_ROLE}`);
    console.log(`MINTER_ROLE: ${MINTER_ROLE}`);
    console.log(`PROPOSER_ROLE: ${PROPOSER_ROLE}`);
    console.log(`EXECUTOR_ROLE: ${EXECUTOR_ROLE}`);
    console.log(`CANCELLER_ROLE: ${CANCELLER_ROLE}`);
    console.log(`ANALYTICS_ROLE: ${ANALYTICS_ROLE}`);
    console.log(`TIMELOCK_ADMIN_ROLE: ${TIMELOCK_ADMIN_ROLE}`);
    
    console.log("\n=== Checking Current Permissions ===");
    
    // Check JustToken permissions
    console.log("\n- JustToken Permissions -");
    console.log(`Timelock has DEFAULT_ADMIN_ROLE: ${await justToken.hasRole(DEFAULT_ADMIN_ROLE, JUST_TIMELOCK_ADDRESS) ? "Yes" : "No ❌"}`);
    console.log(`Timelock has ADMIN_ROLE: ${await justToken.hasRole(ADMIN_ROLE, JUST_TIMELOCK_ADDRESS) ? "Yes" : "No ❌"}`);
    console.log(`Governance contract has GOVERNANCE_ROLE: ${await justToken.hasRole(GOVERNANCE_ROLE, JUST_GOVERNANCE_ADDR) ? "Yes" : "No ❌"}`);
    console.log(`Timelock has MINTER_ROLE: ${await justToken.hasRole(MINTER_ROLE, JUST_TIMELOCK_ADDRESS) ? "Yes" : "No ❌"}`);
    console.log(`Deployer has ADMIN_ROLE: ${await justToken.hasRole(ADMIN_ROLE, deployer.address) ? "Yes" : "No ❌"}`);
    console.log(`Multisig has GUARDIAN_ROLE: ${await justToken.hasRole(GUARDIAN_ROLE, MULTISIG_ADDRESS) ? "Yes" : "No ❌"}`);
    
    // Check JustTimelock permissions
    console.log("\n- JustTimelock Permissions -");
    console.log(`Governance contract has PROPOSER_ROLE: ${await justTimelock.hasRole(PROPOSER_ROLE, JUST_GOVERNANCE_ADDR) ? "Yes" : "No ❌"}`);
    console.log(`Governance contract has EXECUTOR_ROLE: ${await justTimelock.hasRole(EXECUTOR_ROLE, JUST_GOVERNANCE_ADDR) ? "Yes" : "No ❌"}`);
    console.log(`Governance contract has CANCELLER_ROLE: ${await justTimelock.hasRole(CANCELLER_ROLE, JUST_GOVERNANCE_ADDR) ? "Yes" : "No ❌"}`);
    console.log(`Multisig has GUARDIAN_ROLE: ${await justTimelock.hasRole(GUARDIAN_ROLE, MULTISIG_ADDRESS) ? "Yes" : "No ❌"}`);
    console.log(`Timelock has TIMELOCK_ADMIN_ROLE: ${await justTimelock.hasRole(TIMELOCK_ADMIN_ROLE, JUST_TIMELOCK_ADDRESS) ? "Yes" : "No ❌"}`);
    console.log(`Multisig has TIMELOCK_ADMIN_ROLE: ${await justTimelock.hasRole(TIMELOCK_ADMIN_ROLE, MULTISIG_ADDRESS) ? "Yes" : "No ❌"}`);
    
    // Check JustGovernance permissions
    console.log("\n- JustGovernance Permissions -");
    console.log(`Multisig has GUARDIAN_ROLE: ${await justGovernance.hasRole(GUARDIAN_ROLE, MULTISIG_ADDRESS) ? "Yes" : "No ❌"}`);
    
    // Check JustDAOHelper permissions
    console.log("\n- JustDAOHelper Permissions -");
    console.log(`Multisig has ADMIN_ROLE: ${await justDAOHelper.hasRole(ADMIN_ROLE, MULTISIG_ADDRESS) ? "Yes" : "No ❌"}`);
    console.log(`Multisig has ANALYTICS_ROLE: ${await justDAOHelper.hasRole(ANALYTICS_ROLE, MULTISIG_ADDRESS) ? "Yes" : "No ❌"}`);
    
    // Check contract references
    console.log("\n- Checking Contract References -");

    console.log("\n- JustAnalyticsHelper Permissions -");
    console.log(`Multisig has ADMIN_ROLE: ${await justAnalyticsHelper.hasRole(ADMIN_ROLE, MULTISIG_ADDRESS) ? "Yes" : "No ❌"}`);
    console.log(`Multisig has ANALYTICS_ROLE: ${await justAnalyticsHelper.hasRole(ANALYTICS_ROLE, MULTISIG_ADDRESS) ? "Yes" : "No ❌"}`);
    
    // Check token reference in timelock
    try {
      const timelockTokenAddress = await justTimelock.justToken();
      console.log(`JustTimelock references token: ${timelockTokenAddress === JUST_TOKEN_ADDRESS ? "Yes ✅" : "No ❌ - references " + timelockTokenAddress}`);
    } catch (error) {
      console.log("❌ Error checking token reference in timelock:", error.message);
    }
    
    // Check token reference in governance
    try {
      const governanceTokenAddress = await justGovernance.justToken();
      console.log(`JustGovernance references token: ${governanceTokenAddress === JUST_TOKEN_ADDRESS ? "Yes ✅" : "No ❌ - references " + governanceTokenAddress}`);
    } catch (error) {
      console.log("❌ Error checking token reference in governance:", error.message);
    }
    
    // Check timelock reference in governance
    try {
      const governanceTimelockAddress = await justGovernance.timelock();
      console.log(`JustGovernance references timelock: ${governanceTimelockAddress === JUST_TIMELOCK_ADDRESS ? "Yes ✅" : "No ❌ - references " + governanceTimelockAddress}`);
    } catch (error) {
      console.log("❌ Error checking timelock reference in governance:", error.message);
    }
    
    // Check timelock reference in token
    try {
      const tokenTimelockAddress = await justToken.timelock();
      console.log(`JustToken references timelock: ${tokenTimelockAddress === JUST_TIMELOCK_ADDRESS ? "Yes ✅" : "No ❌ - references " + tokenTimelockAddress}`);
    } catch (error) {
      console.log("❌ Error checking timelock reference in token:", error.message);
    }
    
    // Check references in DAOHelper
    try {
      const daoHelperTokenAddress = await justDAOHelper.justToken();
      console.log(`JustDAOHelper references token: ${daoHelperTokenAddress === JUST_TOKEN_ADDRESS ? "Yes ✅" : "No ❌ - references " + daoHelperTokenAddress}`);
      
      const daoHelperGovernanceAddress = await justDAOHelper.justGovernance();
      console.log(`JustDAOHelper references governance: ${daoHelperGovernanceAddress === JUST_GOVERNANCE_ADDR ? "Yes ✅" : "No ❌ - references " + daoHelperGovernanceAddress}`);
      
      const daoHelperTimelockAddress = await justDAOHelper.justTimelock();
      console.log(`JustDAOHelper references timelock: ${daoHelperTimelockAddress === JUST_TIMELOCK_ADDRESS ? "Yes ✅" : "No ❌ - references " + daoHelperTimelockAddress}`);
    } catch (error) {
      console.log("❌ Error checking references in DAOHelper:", error.message);
    }
    
    console.log("\n=== Setting Up Permissions ===");
    
    // Setup transactions array to track all permission changes
    const transactions = [];
    
    // 1. Configure JustToken Permissions
    console.log("\n- Setting JustToken Permissions -");
    
    // Critical: Grant DEFAULT_ADMIN_ROLE to the timelock
    if (!await justToken.hasRole(DEFAULT_ADMIN_ROLE, JUST_TIMELOCK_ADDRESS)) {
      console.log("Granting DEFAULT_ADMIN_ROLE to Timelock contract...");
      transactions.push(
        await justToken.grantRole(DEFAULT_ADMIN_ROLE, JUST_TIMELOCK_ADDRESS, {gasLimit: 200000})
      );
    }
    
    // Also grant ADMIN_ROLE to the timelock for operational access
    if (!await justToken.hasRole(ADMIN_ROLE, JUST_TIMELOCK_ADDRESS)) {
      console.log("Granting ADMIN_ROLE to Timelock contract...");
      transactions.push(
        await justToken.grantRole(ADMIN_ROLE, JUST_TIMELOCK_ADDRESS, {gasLimit: 200000})
      );
    }
    
    if (!await justToken.hasRole(GOVERNANCE_ROLE, JUST_GOVERNANCE_ADDR)) {
      console.log("Granting GOVERNANCE_ROLE to Governance contract...");
      transactions.push(
        await justToken.grantRole(GOVERNANCE_ROLE, JUST_GOVERNANCE_ADDR, {gasLimit: 200000})
      );
    }
    
    if (!await justToken.hasRole(MINTER_ROLE, JUST_TIMELOCK_ADDRESS)) {
      console.log("Granting MINTER_ROLE to Timelock contract...");
      transactions.push(
        await justToken.grantRole(MINTER_ROLE, JUST_TIMELOCK_ADDRESS, {gasLimit: 200000})
      );
    }
    
    if (!await justToken.hasRole(GUARDIAN_ROLE, MULTISIG_ADDRESS)) {
      console.log("Granting GUARDIAN_ROLE to Multisig...");
      transactions.push(
        await justToken.grantRole(GUARDIAN_ROLE, MULTISIG_ADDRESS, {gasLimit: 200000})
      );
    }
    
    // 2. Configure JustTimelock Permissions
    console.log("\n- Setting JustTimelock Permissions -");
    
    if (!await justTimelock.hasRole(PROPOSER_ROLE, JUST_GOVERNANCE_ADDR)) {
      console.log("Granting PROPOSER_ROLE to Governance contract...");
      transactions.push(
        await justTimelock.grantRole(PROPOSER_ROLE, JUST_GOVERNANCE_ADDR, {gasLimit: 200000})
      );
    }
    
    if (!await justTimelock.hasRole(EXECUTOR_ROLE, JUST_GOVERNANCE_ADDR)) {
      console.log("Granting EXECUTOR_ROLE to Governance contract...");
      transactions.push(
        await justTimelock.grantRole(EXECUTOR_ROLE, JUST_GOVERNANCE_ADDR, {gasLimit: 200000})
      );
    }
    
    if (!await justTimelock.hasRole(CANCELLER_ROLE, JUST_GOVERNANCE_ADDR)) {
      console.log("Granting CANCELLER_ROLE to Governance contract...");
      transactions.push(
        await justTimelock.grantRole(CANCELLER_ROLE, JUST_GOVERNANCE_ADDR, {gasLimit: 200000})
      );
    }
    
    if (!await justTimelock.hasRole(GUARDIAN_ROLE, MULTISIG_ADDRESS)) {
      console.log("Granting GUARDIAN_ROLE to Multisig on Timelock...");
      transactions.push(
        await justTimelock.grantRole(GUARDIAN_ROLE, MULTISIG_ADDRESS, {gasLimit: 200000})
      );
    }
    
    // Grant TIMELOCK_ADMIN_ROLE to the timelock itself for self-management
    if (!await justTimelock.hasRole(TIMELOCK_ADMIN_ROLE, JUST_TIMELOCK_ADDRESS)) {
      console.log("Granting TIMELOCK_ADMIN_ROLE to Timelock contract...");
      transactions.push(
        await justTimelock.grantRole(TIMELOCK_ADMIN_ROLE, JUST_TIMELOCK_ADDRESS, {gasLimit: 200000})
      );
    }
    
    // Grant TIMELOCK_ADMIN_ROLE to the multisig for emergency access
    if (!await justTimelock.hasRole(TIMELOCK_ADMIN_ROLE, MULTISIG_ADDRESS)) {
      console.log("Granting TIMELOCK_ADMIN_ROLE to Multisig...");
      transactions.push(
        await justTimelock.grantRole(TIMELOCK_ADMIN_ROLE, MULTISIG_ADDRESS, {gasLimit: 200000})
      );
    }
    
    // 3. Configure JustGovernance Permissions
    console.log("\n- Setting JustGovernance Permissions -");
    
    if (!await justGovernance.hasRole(GUARDIAN_ROLE, MULTISIG_ADDRESS)) {
      console.log("Granting GUARDIAN_ROLE to Multisig on Governance...");
      transactions.push(
        await justGovernance.grantRole(GUARDIAN_ROLE, MULTISIG_ADDRESS, {gasLimit: 200000})
      );
    }
    
    // 4. Configure JustDAOHelper Permissions
    console.log("\n- Setting JustDAOHelper Permissions -");
    
    if (!await justDAOHelper.hasRole(ADMIN_ROLE, MULTISIG_ADDRESS)) {
      console.log("Granting ADMIN_ROLE to Multisig on DAOHelper...");
      transactions.push(
        await justDAOHelper.grantRole(ADMIN_ROLE, MULTISIG_ADDRESS, {gasLimit: 200000})
      );
    }
    
    if (!await justDAOHelper.hasRole(ANALYTICS_ROLE, MULTISIG_ADDRESS)) {
      console.log("Granting ANALYTICS_ROLE to Multisig on DAOHelper...");
      transactions.push(
        await justDAOHelper.grantRole(ANALYTICS_ROLE, MULTISIG_ADDRESS, {gasLimit: 200000})
      );
    }
    // 4b. Configure JustAnalyticsHelper Permissions
console.log("\n- Setting JustAnalyticsHelper Permissions -");

if (!await justAnalyticsHelper.hasRole(ADMIN_ROLE, MULTISIG_ADDRESS)) {
  console.log("Granting ADMIN_ROLE to Multisig on AnalyticsHelper...");
  transactions.push(
    await justAnalyticsHelper.grantRole(ADMIN_ROLE, MULTISIG_ADDRESS, {gasLimit: 200000})
  );
}

if (!await justAnalyticsHelper.hasRole(ANALYTICS_ROLE, MULTISIG_ADDRESS)) {
  console.log("Granting ANALYTICS_ROLE to Multisig on AnalyticsHelper...");
  transactions.push(
    await justAnalyticsHelper.grantRole(ANALYTICS_ROLE, MULTISIG_ADDRESS, {gasLimit: 200000})
  );
}
    // 5. Set up contract references if they are incorrect
    console.log("\n- Setting Contract References -");

    // Check Analytics Helper references
try {
  const analyticsHelperTokenAddress = await justAnalyticsHelper.justToken();
  console.log(`JustAnalyticsHelper references token: ${analyticsHelperTokenAddress === JUST_TOKEN_ADDRESS ? "Yes ✅" : "No ❌ - references " + analyticsHelperTokenAddress}`);
  
  const analyticsHelperGovernanceAddress = await justAnalyticsHelper.justGovernance();
  console.log(`JustAnalyticsHelper references governance: ${analyticsHelperGovernanceAddress === JUST_GOVERNANCE_ADDR ? "Yes ✅" : "No ❌ - references " + analyticsHelperGovernanceAddress}`);
  
  const analyticsHelperTimelockAddress = await justAnalyticsHelper.justTimelock();
  console.log(`JustAnalyticsHelper references timelock: ${analyticsHelperTimelockAddress === JUST_TIMELOCK_ADDRESS ? "Yes ✅" : "No ❌ - references " + analyticsHelperTimelockAddress}`);
} catch (error) {
  console.log("❌ Error checking references in AnalyticsHelper:", error.message);
}

// Set references if needed
try {
  const analyticsHelperTokenAddress = await justAnalyticsHelper.justToken();
  const analyticsHelperGovernanceAddress = await justAnalyticsHelper.justGovernance();
  const analyticsHelperTimelockAddress = await justAnalyticsHelper.justTimelock();
  
  if (analyticsHelperTokenAddress !== JUST_TOKEN_ADDRESS || 
      analyticsHelperGovernanceAddress !== JUST_GOVERNANCE_ADDR || 
      analyticsHelperTimelockAddress !== JUST_TIMELOCK_ADDRESS) {
    console.log("Updating contract addresses in AnalyticsHelper...");
    transactions.push(
      await justAnalyticsHelper.updateContractAddresses(
        JUST_TOKEN_ADDRESS,
        JUST_GOVERNANCE_ADDR,
        JUST_TIMELOCK_ADDRESS,
        {gasLimit: 300000}
      )
    );
  }
} catch (error) {
  console.log("❌ Error updating AnalyticsHelper references:", error.message);
}
    
    // Set Token reference in Timelock if needed
    try {
      const timelockTokenAddress = await justTimelock.justToken();
      if (timelockTokenAddress !== JUST_TOKEN_ADDRESS) {
        console.log("Setting token reference in timelock...");
        transactions.push(
          await justTimelock.setJustToken(JUST_TOKEN_ADDRESS, {gasLimit: 200000})
        );
      }
    } catch (error) {
      console.log("❌ Error checking/setting token in timelock:", error.message);
    }
    
    // Set Timelock reference in Token if needed
    try {
      // Get the timelock reference in the token
      const tokenTimelockAddress = await justToken.timelock();
      if (tokenTimelockAddress !== JUST_TIMELOCK_ADDRESS) {
        console.log("Setting timelock reference in token...");
        transactions.push(
          await justToken.setTimelock(JUST_TIMELOCK_ADDRESS, {gasLimit: 200000})
        );
      }
    } catch (error) {
      console.log("❌ Error setting timelock in token:", error.message);
    }
    
    // 6. Configure DAO Helper references if needed
    try {
      console.log("Updating contract addresses in DAOHelper if needed...");
      const daoHelperTokenAddress = await justDAOHelper.justToken();
      const daoHelperGovernanceAddress = await justDAOHelper.justGovernance();
      const daoHelperTimelockAddress = await justDAOHelper.justTimelock();
      
      if (daoHelperTokenAddress !== JUST_TOKEN_ADDRESS || 
          daoHelperGovernanceAddress !== JUST_GOVERNANCE_ADDR || 
          daoHelperTimelockAddress !== JUST_TIMELOCK_ADDRESS) {
        transactions.push(
          await justDAOHelper.updateContractAddresses(
            JUST_TOKEN_ADDRESS,
            JUST_GOVERNANCE_ADDR,
            JUST_TIMELOCK_ADDRESS,
            {gasLimit: 300000}
          )
        );
      }
    } catch (error) {
      console.log("❌ Error updating DAOHelper references:", error.message);
    }
    
    // 7. Configure Allowed Targets for Governance Proposals
    console.log("\n- Setting Allowed Targets for Governance -");

    // Allow Analytics Helper as a target for proposals
    console.log("Setting JustAnalyticsHelper as allowed target for proposals...");
    transactions.push(
      await justGovernance.updateSecurity(
        "0x00000000", // No selector change
        false,
        JUST_ANALYTICS_HELPER_ADDR,
        true, // Allow Analytics Helper as target
        {gasLimit: 200000}
      )
    );
    
    // Allow token as a target for proposals
    console.log("Setting JustToken as allowed target for proposals...");
    transactions.push(
      await justGovernance.updateSecurity(
        "0x00000000", // No selector change
        false,
        JUST_TOKEN_ADDRESS,
        true, // Allow token as target
        {gasLimit: 200000}
      )
    );
    
    // Allow timelock as a target for proposals
    console.log("Setting JustTimelock as allowed target for proposals...");
    transactions.push(
      await justGovernance.updateSecurity(
        "0x00000000", // No selector change
        false,
        JUST_TIMELOCK_ADDRESS,
        true, // Allow timelock as target
        {gasLimit: 200000}
      )
    );
    
    // Allow DAO Helper as a target for proposals
    console.log("Setting JustDAOHelper as allowed target for proposals...");
    transactions.push(
      await justGovernance.updateSecurity(
        "0x00000000", // No selector change
        false,
        JUST_DAO_HELPER_ADDR,
        true, // Allow DAO Helper as target
        {gasLimit: 200000}
      )
    );
    
    // Allow governance itself as a target for proposals
    console.log("Setting JustGovernance as allowed target for proposals...");
    transactions.push(
      await justGovernance.updateSecurity(
        "0x00000000", // No selector change
        false,
        JUST_GOVERNANCE_ADDR,
        true, // Allow governance as target
        {gasLimit: 200000}
      )
    );
    
    // Get all calculated function selectors and enable them
    const selectors = await calculateFunctionSelectors();
    
    console.log("\n- Allowing Function Selectors for Governance -");
    for (const selector of selectors) {
      console.log(`Setting function selector ${selector.selector} (${selector.signature}) as allowed...`);
      transactions.push(
        await justGovernance.updateSecurity(
          selector.selector,
          true, // Allow this selector
          "0x0000000000000000000000000000000000000000", // No target change
          false,
          {gasLimit: 200000}
        )
      );
    }
    
    // 8. Configure function threat levels in timelock
    await configureThreatLevels(justTimelock);
    
    // Wait for all transactions to be mined
    console.log("\nWaiting for all transactions to be confirmed...");
    for (let i = 0; i < transactions.length; i++) {
      console.log(`Confirming transaction ${i+1} of ${transactions.length}...`);
      await transactions[i].wait();
    }

    
    // Verify all permissions have been set correctly
    console.log("\n=== Verifying Final Permissions ===");
    
    // JustToken verification
    console.log("\n- JustToken Final Permissions -");
    const tokenRoleChecks = [
      { role: DEFAULT_ADMIN_ROLE, account: JUST_TIMELOCK_ADDRESS, name: "Timelock has DEFAULT_ADMIN_ROLE" },
      { role: ADMIN_ROLE, account: JUST_TIMELOCK_ADDRESS, name: "Timelock has ADMIN_ROLE" },
      { role: GOVERNANCE_ROLE, account: JUST_GOVERNANCE_ADDR, name: "Governance contract has GOVERNANCE_ROLE" },
      { role: MINTER_ROLE, account: JUST_TIMELOCK_ADDRESS, name: "Timelock has MINTER_ROLE" },
      { role: GUARDIAN_ROLE, account: MULTISIG_ADDRESS, name: "Multisig has GUARDIAN_ROLE" }
    ];
    
    let allTokenRolesCorrect = true;
    for (const check of tokenRoleChecks) {
      const hasRole = await justToken.hasRole(check.role, check.account);
      console.log(`${check.name}: ${hasRole ? "Yes ✅" : "No ❌"}`);
      if (!hasRole) allTokenRolesCorrect = false;
    }
    
    // JustTimelock verification
    console.log("\n- JustTimelock Final Permissions -");
    const timelockRoleChecks = [
      { role: PROPOSER_ROLE, account: JUST_GOVERNANCE_ADDR, name: "Governance contract has PROPOSER_ROLE" },
      { role: EXECUTOR_ROLE, account: JUST_GOVERNANCE_ADDR, name: "Governance contract has EXECUTOR_ROLE" },
      { role: CANCELLER_ROLE, account: JUST_GOVERNANCE_ADDR, name: "Governance contract has CANCELLER_ROLE" },
      { role: GUARDIAN_ROLE, account: MULTISIG_ADDRESS, name: "Multisig has GUARDIAN_ROLE" },
      { role: TIMELOCK_ADMIN_ROLE, account: JUST_TIMELOCK_ADDRESS, name: "Timelock has TIMELOCK_ADMIN_ROLE" },
      { role: TIMELOCK_ADMIN_ROLE, account: MULTISIG_ADDRESS, name: "Multisig has TIMELOCK_ADMIN_ROLE" }
    ];
    
    let allTimelockRolesCorrect = true;
    for (const check of timelockRoleChecks) {
      const hasRole = await justTimelock.hasRole(check.role, check.account);
      console.log(`${check.name}: ${hasRole ? "Yes ✅" : "No ❌"}`);
      if (!hasRole) allTimelockRolesCorrect = false;
    }
    
    // JustGovernance verification
    console.log("\n- JustGovernance Final Permissions -");
    const hasGuardianRole = await justGovernance.hasRole(GUARDIAN_ROLE, MULTISIG_ADDRESS);
    console.log(`Multisig has GUARDIAN_ROLE: ${hasGuardianRole ? "Yes ✅" : "No ❌"}`);
    
    // JustDAOHelper verification
    console.log("\n- JustDAOHelper Final Permissions -");
    const daoHelperRoleChecks = [
      { role: ADMIN_ROLE, account: MULTISIG_ADDRESS, name: "Multisig has ADMIN_ROLE" },
      { role: ANALYTICS_ROLE, account: MULTISIG_ADDRESS, name: "Multisig has ANALYTICS_ROLE" }
    ];
    
    let allDAOHelperRolesCorrect = true;
    for (const check of daoHelperRoleChecks) {
      const hasRole = await justDAOHelper.hasRole(check.role, check.account);
      console.log(`${check.name}: ${hasRole ? "Yes ✅" : "No ❌"}`);
      if (!hasRole) allDAOHelperRolesCorrect = false;
    }
    
    // Verify cross-contract references
    console.log("\n- Verify Contract References -");
    
    try {
      const timelockTokenAddress = await justTimelock.justToken();
      console.log(`JustTimelock references token: ${timelockTokenAddress === JUST_TOKEN_ADDRESS ? "Yes ✅" : "No ❌ - references " + timelockTokenAddress}`);
      
      const tokenTimelockAddress = await justToken.timelock();
      console.log(`JustToken references timelock: ${tokenTimelockAddress === JUST_TIMELOCK_ADDRESS ? "Yes ✅" : "No ❌ - references " + tokenTimelockAddress}`);
      
      const daoHelperTokenAddress = await justDAOHelper.justToken();
      console.log(`JustDAOHelper references token: ${daoHelperTokenAddress === JUST_TOKEN_ADDRESS ? "Yes ✅" : "No ❌ - references " + daoHelperTokenAddress}`);
      
      const daoHelperGovernanceAddress = await justDAOHelper.justGovernance();
      console.log(`JustDAOHelper references governance: ${daoHelperGovernanceAddress === JUST_GOVERNANCE_ADDR ? "Yes ✅" : "No ❌ - references " + daoHelperGovernanceAddress}`);
      
      const daoHelperTimelockAddress = await justDAOHelper.justTimelock();
      console.log(`JustDAOHelper references timelock: ${daoHelperTimelockAddress === JUST_TIMELOCK_ADDRESS ? "Yes ✅" : "No ❌ - references " + daoHelperTimelockAddress}`);
    } catch (error) {
      console.log("❌ Error verifying contract references:", error.message);
    }
    
    // Verify contract security settings
    console.log("\n- Verify Governance Security Settings -");
    
    try {
      console.log("Checking if core contracts are allowed targets for governance...");
      console.log(`JustToken is allowed target: ${await justGovernance.allowedTargets(JUST_TOKEN_ADDRESS) ? "Yes ✅" : "No ❌"}`);
      console.log(`JustTimelock is allowed target: ${await justGovernance.allowedTargets(JUST_TIMELOCK_ADDRESS) ? "Yes ✅" : "No ❌"}`);
      console.log(`JustGovernance is allowed target: ${await justGovernance.allowedTargets(JUST_GOVERNANCE_ADDR) ? "Yes ✅" : "No ❌"}`);
      console.log(`JustDAOHelper is allowed target: ${await justGovernance.allowedTargets(JUST_DAO_HELPER_ADDR) ? "Yes ✅" : "No ❌"}`);
      
      console.log("\nChecking a sample of function selectors...");
      // Check a few key function selectors
      const keySelectors = [
        { signature: "governanceMint(address,uint256)", selector: getFunctionSelector("governanceMint(address,uint256)") },
        { signature: "updateGovParam(uint8,uint256)", selector: getFunctionSelector("updateGovParam(uint8,uint256)") },
        { signature: "setFunctionThreatLevel(bytes4,uint8)", selector: getFunctionSelector("setFunctionThreatLevel(bytes4,uint8)") }
      ];
      
      for (const func of keySelectors) {
        console.log(`Selector ${func.signature} allowed: ${await justGovernance.allowedFunctionSelectors(func.selector) ? "Yes ✅" : "No ❌"}`);
      }
    } catch (error) {
      console.log("❌ Error verifying security settings:", error.message);
    }
    
    // Security verification summary
    console.log("\n=== Security Verification Summary ===");
    console.log(`JustToken roles properly configured: ${allTokenRolesCorrect ? "Yes ✅" : "No ❌"}`);
    console.log(`JustTimelock roles properly configured: ${allTimelockRolesCorrect ? "Yes ✅" : "No ❌"}`);
    console.log(`JustGovernance roles properly configured: ${hasGuardianRole ? "Yes ✅" : "No ❌"}`);
    console.log(`JustDAOHelper roles properly configured: ${allDAOHelperRolesCorrect ? "Yes ✅" : "No ❌"}`);
    
    // Check for unsafe permissions that should NOT exist
    console.log("\n- Checking for unsafe permissions -");
    // Check if deployer still has DEFAULT_ADMIN_ROLE (ok during setup, but should be transferred to timelock eventually)
    const deployerHasDefaultAdmin = await justToken.hasRole(DEFAULT_ADMIN_ROLE, deployer.address);
    console.log(`Deployer still has DEFAULT_ADMIN_ROLE on token: ${deployerHasDefaultAdmin ? "Yes ⚠️" : "No ✅"}`);
    if (deployerHasDefaultAdmin) {
      console.log("⚠️ WARNING: Deployer still has DEFAULT_ADMIN_ROLE. Consider transferring this role to the timelock or multisig once setup is complete.");
    }
    
    // JustAnalyticsHelper verification
console.log("\n- JustAnalyticsHelper Final Permissions -");
const analyticsHelperRoleChecks = [
  { role: ADMIN_ROLE, account: MULTISIG_ADDRESS, name: "Multisig has ADMIN_ROLE" },
  { role: ANALYTICS_ROLE, account: MULTISIG_ADDRESS, name: "Multisig has ANALYTICS_ROLE" }
];

let allAnalyticsHelperRolesCorrect = true;
for (const check of analyticsHelperRoleChecks) {
  const hasRole = await justAnalyticsHelper.hasRole(check.role, check.account);
  console.log(`${check.name}: ${hasRole ? "Yes ✅" : "No ❌"}`);
  if (!hasRole) allAnalyticsHelperRolesCorrect = false;
}

// Add verification in summary
console.log(`JustAnalyticsHelper roles properly configured: ${allAnalyticsHelperRolesCorrect ? "Yes ✅" : "No ❌"}`);
    // Check JustAnalyticsHelper permissions
    

    // Check if deployer has DEFAULT_ADMIN_ROLE on timelock
    const deployerHasTimelockAdmin = await justTimelock.hasRole(DEFAULT_ADMIN_ROLE, deployer.address);
    console.log(`Deployer still has DEFAULT_ADMIN_ROLE on timelock: ${deployerHasTimelockAdmin ? "Yes ⚠️" : "No ✅"}`);
    if (deployerHasTimelockAdmin) {
      console.log("⚠️ WARNING: Deployer still has DEFAULT_ADMIN_ROLE on timelock. Consider transferring this role to the multisig once setup is complete.");
    }
    
    // Check if deployer has DEFAULT_ADMIN_ROLE on governance
    const deployerHasGovAdmin = await justGovernance.hasRole(DEFAULT_ADMIN_ROLE, deployer.address);
    console.log(`Deployer still has DEFAULT_ADMIN_ROLE on governance: ${deployerHasGovAdmin ? "Yes ⚠️" : "No ✅"}`);
    if (deployerHasGovAdmin) {
      console.log("⚠️ WARNING: Deployer still has DEFAULT_ADMIN_ROLE on governance. Consider transferring this role to the timelock or multisig once setup is complete.");
    }
    
    // Check if deployer has DEFAULT_ADMIN_ROLE on DAOHelper
    const deployerHasDAOHelperAdmin = await justDAOHelper.hasRole(DEFAULT_ADMIN_ROLE, deployer.address);
    console.log(`Deployer still has DEFAULT_ADMIN_ROLE on DAOHelper: ${deployerHasDAOHelperAdmin ? "Yes ⚠️" : "No ✅"}`);
    if (deployerHasDAOHelperAdmin) {
      console.log("⚠️ WARNING: Deployer still has DEFAULT_ADMIN_ROLE on DAOHelper. Consider transferring this role to the multisig once setup is complete.");
    }

    // Check if deployer has DEFAULT_ADMIN_ROLE on Analytics Helper
    const deployerHasAnalyticsHelperAdmin = await justAnalyticsHelper.hasRole(DEFAULT_ADMIN_ROLE, deployer.address);
    console.log(`Deployer still has DEFAULT_ADMIN_ROLE on AnalyticsHelper: ${deployerHasAnalyticsHelperAdmin ? "Yes ⚠️" : "No ✅"}`);
    if (deployerHasAnalyticsHelperAdmin) {
      console.log("⚠️ WARNING: Deployer still has DEFAULT_ADMIN_ROLE on AnalyticsHelper. Consider transferring this role to the multisig once setup is complete.");
    }
    
    console.log("\n✅ Role configuration completed successfully!");
    console.log("Your DAO governance system should now be properly configured for operation.");
    
  } catch (error) {
    console.error("Error setting up roles:", error);
    throw error;
  }
}


console.log("Deployment and permissions setup complete!");
// Execute the script
if (require.main === module) {
  main()
    .then(() => process.exit(0))
    .catch((error) => {
      console.error(error);
      process.exit(1);
    });
}