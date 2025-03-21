// Script to update JustTokenUpgradeable contract parameters

// Load environment variables from .env file
require('dotenv').config();

const { ethers } = require('ethers');
const fs = require('fs');
const readline = require('readline');

// ABI fragments for the JustTokenUpgradeable contract functions we need
const TOKEN_ABI = [
  // Read functions
  'function name() view returns (string)',
  'function symbol() view returns (string)',
  'function totalSupply() view returns (uint256)',
  'function balanceOf(address account) view returns (uint256)',
  'function maxTokenSupply() view returns (uint256)',
  'function minLockDuration() view returns (uint256)',
  'function maxLockDuration() view returns (uint256)',
  'function timelock() view returns (address)',
  'function hasRole(bytes32 role, address account) view returns (bool)',
  'function getRoleMember(bytes32 role, uint256 index) view returns (address)',
  'function getRoleMemberCount(bytes32 role) view returns (uint256)',
  
  // Update functions
  'function setMaxTokenSupply(uint256 newMaxSupply) external',
  'function setTimelock(address timelockAddress) external',
  'function addGuardian(address guardian) external',
  'function removeGuardian(address guardian) external',
  'function grantContractRole(bytes32 role, address account) external',
  'function revokeContractRole(bytes32 role, address account) external',
  'function pause() external',
  'function unpause() external',
  
  // Governance functions
  'function governanceMint(address to, uint256 amount) external returns (bool)',
  'function governanceBurn(address from, uint256 amount) external returns (bool)',
  'function governanceTransfer(address from, address to, uint256 amount) external returns (bool)',
  'function createSnapshot() external returns (uint256)',
  
  // Role constants
  'function ADMIN_ROLE() view returns (bytes32)',
  'function GUARDIAN_ROLE() view returns (bytes32)',
  'function GOVERNANCE_ROLE() view returns (bytes32)',
  'function MINTER_ROLE() view returns (bytes32)',
  'function PROPOSER_ROLE() view returns (bytes32)',
];

// Network configurations
const NETWORKS = {
  localhost: {
    name: 'localhost',
    rpcUrl: process.env.LOCAL_RPC_URL || 'http://localhost:8545',
    gasLimit: 3000000,
    gasPrice: '50000000000', // 50 gwei
  },
  sepolia: {
    name: 'sepolia',
    rpcUrl: `https://sepolia.infura.io/v3/${process.env.INFURA_KEY || 'YOUR_INFURA_KEY'}`,
    gasLimit: 3000000,
    gasPrice: '20000000000', // 20 gwei - adjust based on current gas prices
  }
};

// Default configuration
const DEFAULT_CONFIG = {
  network: process.env.NETWORK || 'localhost',
  tokenAddress: process.env.TOKEN_ADDRESS || '',
  privateKey: process.env.PRIVATE_KEY || '',
};

// Create readline interface for user input
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

// Promisify readline question
function question(query) {
  return new Promise(resolve => {
    rl.question(query, resolve);
  });
}

// Load configuration from file or use defaults
async function loadConfig(configPath) {
  let config = { ...DEFAULT_CONFIG };
  
  try {
    if (configPath && fs.existsSync(configPath)) {
      const fileConfig = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      config = { ...config, ...fileConfig };
      console.log(`Loaded configuration from ${configPath}`);
    } else {
      // If values weren't loaded from .env file, prompt for required values
      if (!config.network || (config.network !== 'localhost' && config.network !== 'sepolia')) {
        const networkChoice = await question('Select network (1. localhost, 2. sepolia): ');
        config.network = networkChoice === '2' ? 'sepolia' : 'localhost';
      }
      
      // For Sepolia, check for Infura key
      if (config.network === 'sepolia') {
        // For Sepolia, ask for Infura key if not set in .env
        if (NETWORKS.sepolia.rpcUrl.includes('YOUR_INFURA_KEY')) {
          const infuraKey = await question('Enter your Infura key (or set INFURA_KEY in .env): ');
          NETWORKS.sepolia.rpcUrl = NETWORKS.sepolia.rpcUrl.replace('YOUR_INFURA_KEY', infuraKey);
        }
      }
      
      if (!config.tokenAddress) {
        config.tokenAddress = await question('Enter the JustTokenUpgradeable contract address (or set TOKEN_ADDRESS in .env): ');
      }
      
      if (!config.privateKey) {
        config.privateKey = await question('Enter your private key (will not be stored - consider setting PRIVATE_KEY in .env): ');
      }
    }
    
    // Merge network-specific settings
    const networkConfig = NETWORKS[config.network];
    if (!networkConfig) {
      throw new Error(`Unknown network: ${config.network}`);
    }
    
    config = { ...config, ...networkConfig };
    
    return config;
  } catch (error) {
    console.error('Error loading configuration:', error);
    process.exit(1);
  }
}

// Setup ethers provider and contract instances
async function setupEthers(config) {
  try {
    // Create provider and wallet
    const provider = new ethers.JsonRpcProvider(config.rpcUrl);
    const wallet = new ethers.Wallet(config.privateKey, provider);
    
    // Get account balance
    const balance = await provider.getBalance(wallet.address);
    
    // Create contract instance
    const tokenContract = new ethers.Contract(
      config.tokenAddress,
      TOKEN_ABI,
      wallet
    );
    
    // Get chain ID
    const { chainId } = await provider.getNetwork();
    
    // Get account address
    const address = await wallet.getAddress();
    
    // Check if wallet has the required roles
    const adminRole = await tokenContract.ADMIN_ROLE();
    const guardianRole = await tokenContract.GUARDIAN_ROLE();
    const governanceRole = await tokenContract.GOVERNANCE_ROLE();
    const minterRole = await tokenContract.MINTER_ROLE();
    
    const isAdmin = await tokenContract.hasRole(adminRole, address);
    const isGuardian = await tokenContract.hasRole(guardianRole, address);
    const isGovernance = await tokenContract.hasRole(governanceRole, address);
    const isMinter = await tokenContract.hasRole(minterRole, address);
    
    console.log(`Connected to network: ${config.name} (Chain ID: ${chainId})`);
    console.log(`Using account: ${address}`);
    console.log(`Account balance: ${ethers.formatEther(balance)} ETH`);
    console.log(`Account roles: ${isAdmin ? 'Admin ' : ''}${isGuardian ? 'Guardian ' : ''}${isGovernance ? 'Governance ' : ''}${isMinter ? 'Minter' : ''}`);
    
    // Check if balance is too low
    if (balance === 0n) {
      console.error('\nERROR: Your wallet has no ETH balance. You need ETH to pay for gas fees.');
      if (config.network === 'sepolia') {
        console.log('To get Sepolia testnet ETH, try one of these faucets:');
        console.log('- https://sepoliafaucet.com/');
        console.log('- https://sepolia-faucet.pk910.de/');
      } else {
        console.log('For localhost development:');
        console.log('- Make sure your local node is running');
        console.log('- If using Hardhat, check that you are using an account with funds');
        console.log('- You might need to transfer funds to this address from another account');
      }
      console.log(`\nAddress to fund: ${address}`);
      process.exit(1);
    }
    
    if (balance < ethers.parseEther('0.01')) {
      console.warn('\nWARNING: Your wallet has a very low ETH balance. You might not be able to complete transactions.');
      const proceed = await question('Do you want to continue anyway? (y/n): ');
      if (proceed.toLowerCase() !== 'y') {
        process.exit(0);
      }
    }
    
    if (!isAdmin && !isGovernance) {
      console.warn('\nWARNING: Your account does not have ADMIN_ROLE or GOVERNANCE_ROLE. You may not be able to update parameters.');
      const proceed = await question('Do you want to continue anyway? (y/n): ');
      if (proceed.toLowerCase() !== 'y') {
        process.exit(0);
      }
    }
    
    return { provider, wallet, tokenContract };
  } catch (error) {
    console.error('Error setting up ethers:', error);
    process.exit(1);
  }
}

// Get current parameter values from the contract
async function getCurrentParameters(tokenContract) {
  try {
    const name = await tokenContract.name();
    const symbol = await tokenContract.symbol();
    const totalSupply = await tokenContract.totalSupply();
    const maxTokenSupply = await tokenContract.maxTokenSupply();
    const timelockAddress = await tokenContract.timelock();
    
    // Try to get lock durations if they exist
    let minLockDuration, maxLockDuration;
    try {
      minLockDuration = await tokenContract.minLockDuration();
      maxLockDuration = await tokenContract.maxLockDuration();
    } catch (error) {
      // If contract doesn't have these functions, set to zero
      minLockDuration = 0n;
      maxLockDuration = 0n;
    }
    
    // Get role member counts
    const adminRole = await tokenContract.ADMIN_ROLE();
    const guardianRole = await tokenContract.GUARDIAN_ROLE();
    const governanceRole = await tokenContract.GOVERNANCE_ROLE();
    const minterRole = await tokenContract.MINTER_ROLE();
    const proposerRole = await tokenContract.PROPOSER_ROLE();
    
    const adminCount = await tokenContract.getRoleMemberCount(adminRole);
    const guardianCount = await tokenContract.getRoleMemberCount(guardianRole);
    const governanceCount = await tokenContract.getRoleMemberCount(governanceRole);
    const minterCount = await tokenContract.getRoleMemberCount(minterRole);
    const proposerCount = await tokenContract.getRoleMemberCount(proposerRole);
    
    // Get role members
    const adminMembers = [];
    const guardianMembers = [];
    const governanceMembers = [];
    const minterMembers = [];
    const proposerMembers = [];
    
    for (let i = 0; i < adminCount; i++) {
      adminMembers.push(await tokenContract.getRoleMember(adminRole, i));
    }
    
    for (let i = 0; i < guardianCount; i++) {
      guardianMembers.push(await tokenContract.getRoleMember(guardianRole, i));
    }
    
    for (let i = 0; i < governanceCount; i++) {
      governanceMembers.push(await tokenContract.getRoleMember(governanceRole, i));
    }
    
    for (let i = 0; i < minterCount; i++) {
      minterMembers.push(await tokenContract.getRoleMember(minterRole, i));
    }
    
    for (let i = 0; i < proposerCount; i++) {
      proposerMembers.push(await tokenContract.getRoleMember(proposerRole, i));
    }
    
    const params = {
      basicInfo: {
        name,
        symbol,
        totalSupply: totalSupply.toString(),
        maxTokenSupply: maxTokenSupply.toString()
      },
      timelock: timelockAddress,
      lockDurations: {
        minLockDuration: minLockDuration.toString(),
        maxLockDuration: maxLockDuration.toString()
      },
      roles: {
        admin: {
          role: adminRole,
          members: adminMembers
        },
        guardian: {
          role: guardianRole,
          members: guardianMembers
        },
        governance: {
          role: governanceRole,
          members: governanceMembers
        },
        minter: {
          role: minterRole,
          members: minterMembers
        },
        proposer: {
          role: proposerRole,
          members: proposerMembers
        }
      }
    };
    
    // Print human-readable values
    console.log('\nCurrent Token Parameters:');
    console.log('------------------------');
    console.log('Basic Info:');
    console.log(`  Name: ${name}`);
    console.log(`  Symbol: ${symbol}`);
    console.log(`  Total Supply: ${formatTokenAmount(totalSupply)}`);
    console.log(`  Max Token Supply: ${formatTokenAmount(maxTokenSupply)}`);
    
    console.log('\nTimelock Address:');
    console.log(`  ${timelockAddress}`);
    
    if (minLockDuration !== 0n || maxLockDuration !== 0n) {
      console.log('\nLock Durations:');
      console.log(`  Min Lock Duration: ${formatSeconds(minLockDuration)}`);
      console.log(`  Max Lock Duration: ${formatSeconds(maxLockDuration)}`);
    }
    
    console.log('\nRole Assignments:');
    console.log(`  Admins (${adminCount}): ${formatAddressList(adminMembers)}`);
    console.log(`  Guardians (${guardianCount}): ${formatAddressList(guardianMembers)}`);
    console.log(`  Governance (${governanceCount}): ${formatAddressList(governanceMembers)}`);
    console.log(`  Minters (${minterCount}): ${formatAddressList(minterMembers)}`);
    console.log(`  Proposers (${proposerCount}): ${formatAddressList(proposerMembers)}`);
    
    return params;
  } catch (error) {
    console.error('Error getting current parameters:', error);
    throw error;
  }
}

// Format seconds into days, hours, minutes, seconds
function formatSeconds(seconds) {
  const bigSeconds = BigInt(seconds);
  const days = bigSeconds / 86400n;
  const hours = (bigSeconds % 86400n) / 3600n;
  const minutes = (bigSeconds % 3600n) / 60n;
  const secs = bigSeconds % 60n;
  
  let result = '';
  if (days > 0n) result += `${days}d `;
  if (hours > 0n) result += `${hours}h `;
  if (minutes > 0n) result += `${minutes}m `;
  if (secs > 0n || result === '') result += `${secs}s`;
  
  return `${seconds.toString()} (${result.trim()})`;
}

// Format token amount to make it more readable
function formatTokenAmount(amount) {
  // Assuming 18 decimals, but you should adjust this if needed
  const decimals = 18;
  const bigAmount = BigInt(amount);
  
  if (bigAmount === 0n) return "0";
  
  // Convert to a whole number and decimal part
  const divisor = 10n ** BigInt(decimals);
  const wholeNumber = bigAmount / divisor;
  const decimalPart = bigAmount % divisor;
  
  // Format the decimal part
  const decimalStr = decimalPart.toString().padStart(decimals, '0');
  const trimmedDecimal = decimalStr.replace(/0+$/, '');
  
  if (wholeNumber === 0n && trimmedDecimal === '') {
    return "0";
  } else if (wholeNumber === 0n) {
    return `0.${trimmedDecimal}`;
  } else if (trimmedDecimal === '') {
    return wholeNumber.toString();
  } else {
    return `${wholeNumber}.${trimmedDecimal}`;
  }
}

// Format a list of addresses for display
function formatAddressList(addresses) {
  if (addresses.length === 0) return 'None';
  if (addresses.length <= 2) return addresses.join(', ');
  return `${addresses[0]}, ${addresses[1]}, ... (${addresses.length - 2} more)`;
}

// Prompt the user for parameter updates
async function promptForUpdates(currentParams) {
  try {
    console.log('\nToken Parameter Update Options:');
    console.log('----------------------------');
    console.log('1. Update Max Token Supply');
    console.log('2. Update Timelock Address');
    console.log('3. Manage Role Assignments');
    console.log('4. Create Snapshot');
    console.log('5. Governance Operations (Mint/Burn/Transfer)');
    console.log('6. Pause/Unpause Contract');
    console.log('7. Exit');
    
    const choice = await question('\nSelect an option (1-7): ');
    
    switch (choice) {
      case '1':
        return await promptForMaxSupply(currentParams.basicInfo.maxTokenSupply);
      case '2':
        return await promptForTimelockAddress(currentParams.timelock);
      case '3':
        return await promptForRoleManagement(currentParams.roles);
      case '4':
        return { type: 'createSnapshot' };
      case '5':
        return await promptForGovernanceOperations(currentParams.basicInfo);
      case '6':
        return await promptForPauseUnpause();
      case '7':
        console.log('Exiting...');
        process.exit(0);
      default:
        console.log('Invalid option. Please try again.');
        return await promptForUpdates(currentParams);
    }
  } catch (error) {
    console.error('Error prompting for updates:', error);
    throw error;
  }
}

// Prompt for max token supply update
async function promptForMaxSupply(currentMaxSupply) {
  console.log('\nUpdating Max Token Supply:');
  console.log(`Current Max Supply: ${formatTokenAmount(currentMaxSupply)}`);
  
  const newMaxSupplyInput = await question('\nNew Max Token Supply (in tokens, leave blank to keep current value): ');
  
  if (!newMaxSupplyInput) {
    return await promptForUpdates({ basicInfo: { maxTokenSupply: currentMaxSupply } });
  }
  
  // Parse input and convert to wei
  let newMaxSupply;
  try {
    newMaxSupply = ethers.parseEther(newMaxSupplyInput);
  } catch (error) {
    console.error('Invalid token amount. Please try again.');
    return await promptForMaxSupply(currentMaxSupply);
  }
  
  console.log('\nNew value:');
  console.log(`- Max Token Supply: ${formatTokenAmount(newMaxSupply)}`);
  
  const confirm = await question('\nConfirm this value? (y/n): ');
  if (confirm.toLowerCase() !== 'y') {
    return await promptForMaxSupply(currentMaxSupply);
  }
  
  return {
    type: 'setMaxTokenSupply',
    values: {
      newMaxSupply: newMaxSupply.toString()
    }
  };
}

// Prompt for timelock address update
async function promptForTimelockAddress(currentTimelock) {
  console.log('\nUpdating Timelock Address:');
  console.log(`Current Timelock Address: ${currentTimelock}`);
  
  const newTimelockInput = await question('\nNew Timelock Address (leave blank to keep current value): ');
  
  if (!newTimelockInput) {
    return await promptForUpdates({ timelock: currentTimelock });
  }
  
  // Basic validation
  if (!ethers.isAddress(newTimelockInput)) {
    console.error('Invalid address format. Please enter a valid Ethereum address.');
    return await promptForTimelockAddress(currentTimelock);
  }
  
  console.log('\nNew value:');
  console.log(`- Timelock Address: ${newTimelockInput}`);
  
  const confirm = await question('\nConfirm this address? (y/n): ');
  if (confirm.toLowerCase() !== 'y') {
    return await promptForTimelockAddress(currentTimelock);
  }
  
  return {
    type: 'setTimelock',
    values: {
      timelockAddress: newTimelockInput
    }
  };
}

// Prompt for role management
async function promptForRoleManagement(currentRoles) {
  console.log('\nRole Management:');
  console.log('1. Grant Role');
  console.log('2. Revoke Role');
  console.log('3. Add Guardian');
  console.log('4. Remove Guardian');
  console.log('5. Back to Main Menu');
  
  const choice = await question('\nSelect an option (1-5): ');
  
  switch (choice) {
    case '1':
      return await promptForGrantRole(currentRoles);
    case '2':
      return await promptForRevokeRole(currentRoles);
    case '3':
      return await promptForAddGuardian(currentRoles.guardian.members);
    case '4':
      return await promptForRemoveGuardian(currentRoles.guardian.members);
    case '5':
      return await promptForUpdates({ roles: currentRoles });
    default:
      console.log('Invalid option. Please try again.');
      return await promptForRoleManagement(currentRoles);
  }
}

// Prompt for granting a role
async function promptForGrantRole(currentRoles) {
  console.log('\nGrant Role:');
  console.log('1. Admin Role');
  console.log('2. Governance Role');
  console.log('3. Minter Role');
  console.log('4. Proposer Role');
  console.log('5. Back');
  
  const roleChoice = await question('\nSelect role to grant (1-5): ');
  
  if (roleChoice === '5') {
    return await promptForRoleManagement(currentRoles);
  }
  
  let role;
  let roleName;
  
  switch (roleChoice) {
    case '1':
      role = currentRoles.admin.role;
      roleName = 'ADMIN_ROLE';
      break;
    case '2':
      role = currentRoles.governance.role;
      roleName = 'GOVERNANCE_ROLE';
      break;
    case '3':
      role = currentRoles.minter.role;
      roleName = 'MINTER_ROLE';
      break;
    case '4':
      role = currentRoles.proposer.role;
      roleName = 'PROPOSER_ROLE';
      break;
    default:
      console.log('Invalid option. Please try again.');
      return await promptForGrantRole(currentRoles);
  }
  
  const address = await question('\nEnter address to grant role to: ');
  
  if (!ethers.isAddress(address)) {
    console.error('Invalid address format. Please enter a valid Ethereum address.');
    return await promptForGrantRole(currentRoles);
  }
  
  console.log(`\nGrant ${roleName} to ${address}`);
  
  const confirm = await question('\nConfirm? (y/n): ');
  if (confirm.toLowerCase() !== 'y') {
    return await promptForGrantRole(currentRoles);
  }
  
  return {
    type: 'grantContractRole',
    values: {
      role,
      account: address
    }
  };
}

// Prompt for revoking a role
async function promptForRevokeRole(currentRoles) {
  console.log('\nRevoke Role:');
  console.log('1. Admin Role');
  console.log('2. Governance Role');
  console.log('3. Minter Role');
  console.log('4. Proposer Role');
  console.log('5. Back');
  
  const roleChoice = await question('\nSelect role to revoke (1-5): ');
  
  if (roleChoice === '5') {
    return await promptForRoleManagement(currentRoles);
  }
  
  let role;
  let roleName;
  let members;
  
  switch (roleChoice) {
    case '1':
      role = currentRoles.admin.role;
      roleName = 'ADMIN_ROLE';
      members = currentRoles.admin.members;
      break;
    case '2':
      role = currentRoles.governance.role;
      roleName = 'GOVERNANCE_ROLE';
      members = currentRoles.governance.members;
      break;
    case '3':
      role = currentRoles.minter.role;
      roleName = 'MINTER_ROLE';
      members = currentRoles.minter.members;
      break;
    case '4':
      role = currentRoles.proposer.role;
      roleName = 'PROPOSER_ROLE';
      members = currentRoles.proposer.members;
      break;
    default:
      console.log('Invalid option. Please try again.');
      return await promptForRevokeRole(currentRoles);
  }
  
  if (members.length === 0) {
    console.log(`\nNo accounts have the ${roleName}`);
    return await promptForRevokeRole(currentRoles);
  }
  
  console.log(`\nCurrent ${roleName} holders:`);
  for (let i = 0; i < members.length; i++) {
    console.log(`${i + 1}. ${members[i]}`);
  }
  
  const memberChoice = await question(`\nSelect account number to revoke ${roleName} from (1-${members.length}): `);
  const memberIndex = parseInt(memberChoice) - 1;
  
  if (isNaN(memberIndex) || memberIndex < 0 || memberIndex >= members.length) {
    console.log('Invalid selection. Please try again.');
    return await promptForRevokeRole(currentRoles);
  }
  
  const address = members[memberIndex];
  
  console.log(`\nRevoke ${roleName} from ${address}`);
  
  const confirm = await question('\nConfirm? (y/n): ');
  if (confirm.toLowerCase() !== 'y') {
    return await promptForRevokeRole(currentRoles);
  }
  
  return {
    type: 'revokeContractRole',
    values: {
      role,
      account: address
    }
  };
}

// Prompt for adding a guardian
async function promptForAddGuardian(currentGuardians) {
  console.log('\nAdd Guardian:');
  console.log(`Current Guardians: ${formatAddressList(currentGuardians)}`);
  
  const address = await question('\nEnter address to add as guardian: ');
  
  if (!ethers.isAddress(address)) {
    console.error('Invalid address format. Please enter a valid Ethereum address.');
    return await promptForAddGuardian(currentGuardians);
  }
  
  console.log(`\nAdd ${address} as guardian`);
  
  const confirm = await question('\nConfirm? (y/n): ');
  if (confirm.toLowerCase() !== 'y') {
    return await promptForAddGuardian(currentGuardians);
  }
  
  return {
    type: 'addGuardian',
    values: {
      guardian: address
    }
  };
}

// Prompt for removing a guardian
async function promptForRemoveGuardian(currentGuardians) {
  console.log('\nRemove Guardian:');
  
  if (currentGuardians.length === 0) {
    console.log('No guardians to remove.');
    return await promptForRoleManagement({ guardian: { members: currentGuardians } });
  }
  
  console.log('Current Guardians:');
  for (let i = 0; i < currentGuardians.length; i++) {
    console.log(`${i + 1}. ${currentGuardians[i]}`);
  }
  
  const guardianChoice = await question(`\nSelect guardian number to remove (1-${currentGuardians.length}): `);
  const guardianIndex = parseInt(guardianChoice) - 1;
  
  if (isNaN(guardianIndex) || guardianIndex < 0 || guardianIndex >= currentGuardians.length) {
    console.log('Invalid selection. Please try again.');
    return await promptForRemoveGuardian(currentGuardians);
  }
  
  const address = currentGuardians[guardianIndex];
  
  console.log(`\nRemove ${address} as guardian`);
  
  const confirm = await question('\nConfirm? (y/n): ');
  if (confirm.toLowerCase() !== 'y') {
    return await promptForRemoveGuardian(currentGuardians);
  }
  
  return {
    type: 'removeGuardian',
    values: {
      guardian: address
    }
  };
}

// Prompt for governance operations
async function promptForGovernanceOperations(basicInfo) {
  console.log('\nGovernance Operations:');
  console.log('1. Mint Tokens');
  console.log('2. Burn Tokens');
  console.log('3. Transfer Tokens');
  console.log('4. Back to Main Menu');
  
  const choice = await question('\nSelect an option (1-4): ');
  
  switch (choice) {
    case '1':
      return await promptForMintTokens(basicInfo);
    case '2':
      return await promptForBurnTokens(basicInfo);
    case '3':
      return await promptForTransferTokens(basicInfo);
    case '4':
      return await promptForUpdates({ basicInfo });
    default:
      console.log('Invalid option. Please try again.');
      return await promptForGovernanceOperations(basicInfo);
  }
}

// Prompt for minting tokens
async function promptForMintTokens(basicInfo) {
  const currentSupply = BigInt(basicInfo.totalSupply);
  const maxSupply = BigInt(basicInfo.maxTokenSupply);
  const remainingSupply = maxSupply - currentSupply;
  
  console.log('\nMint Tokens:');
  console.log(`Current Supply: ${formatTokenAmount(currentSupply)}`);
  console.log(`Max Supply: ${formatTokenAmount(maxSupply)}`);
  console.log(`Remaining Mintable: ${formatTokenAmount(remainingSupply)}`);
  
  const recipientAddress = await question('\nEnter recipient address: ');
  
  if (!ethers.isAddress(recipientAddress)) {
    console.error('Invalid address format. Please enter a valid Ethereum address.');
    return await promptForMintTokens(basicInfo);
  }
  
  const amountInput = await question('\nEnter amount to mint (in tokens): ');
  
  let amount;
  try {
    amount = ethers.parseEther(amountInput);
  } catch (error) {
    console.error('Invalid token amount. Please try again.');
    return await promptForMintTokens(basicInfo);
  }
  
  if (amount > remainingSupply) {
    console.error(`Cannot mint more than remaining supply (${formatTokenAmount(remainingSupply)})`);
    return await promptForMintTokens(basicInfo);
  }
  
  console.log(`\nMint ${formatTokenAmount(amount)} tokens to ${recipientAddress}`);
  
  const confirm = await question('\nConfirm? (y/n): ');
  if (confirm.toLowerCase() !== 'y') {
    return await promptForMintTokens(basicInfo);
  }
  
  return {
    type: 'governanceMint',
    values: {
      to: recipientAddress,
      amount: amount.toString()
    }
  };
}

// Prompt for burning tokens
async function promptForBurnTokens(basicInfo) {
  console.log('\nBurn Tokens:');
  
  const fromAddress = await question('\nEnter address to burn tokens from: ');
  
  if (!ethers.isAddress(fromAddress)) {
    console.error('Invalid address format. Please enter a valid Ethereum address.');
    return await promptForBurnTokens(basicInfo);
  }
  
  const amountInput = await question('\nEnter amount to burn (in tokens): ');
  
  let amount;
  try {
    amount = ethers.parseEther(amountInput);
  } catch (error) {
    console.error('Invalid token amount. Please try again.');
    return await promptForBurnTokens(basicInfo);
  }
  
  console.log(`\nBurn ${formatTokenAmount(amount)} tokens from ${fromAddress}`);
  
  const confirm = await question('\nConfirm? (y/n): ');
  if (confirm.toLowerCase() !== 'y') {
    return await promptForBurnTokens(basicInfo);
  }
  
  return {
    type: 'governanceBurn',
    values: {
      from: fromAddress,
      amount: amount.toString()
    }
  };
}

// Prompt for transferring tokens
async function promptForTransferTokens(basicInfo) {
  console.log('\nTransfer Tokens:');
  
  const fromAddress = await question('\nEnter address to transfer tokens from: ');
  
  if (!ethers.isAddress(fromAddress)) {
    console.error('Invalid address format. Please enter a valid Ethereum address.');
    return await promptForTransferTokens(basicInfo);
  }
  
  const toAddress = await question('\nEnter address to transfer tokens to: ');
  
  if (!ethers.isAddress(toAddress)) {
    console.error('Invalid address format. Please enter a valid Ethereum address.');
    return await promptForTransferTokens(basicInfo);
  }
  
  const amountInput = await question('\nEnter amount to transfer (in tokens): ');
  
  let amount;
  try {
    amount = ethers.parseEther(amountInput);
  } catch (error) {
    console.error('Invalid token amount. Please try again.');
    return await promptForTransferTokens(basicInfo);
  }
  
  console.log(`\nTransfer ${formatTokenAmount(amount)} tokens from ${fromAddress} to ${toAddress}`);
  
  const confirm = await question('\nConfirm? (y/n): ');
  if (confirm.toLowerCase() !== 'y') {
    return await promptForTransferTokens(basicInfo);
  }
  
  return {
    type: 'governanceTransfer',
    values: {
      from: fromAddress,
      to: toAddress,
      amount: amount.toString()
    }
  };
}

// Prompt for pause/unpause
async function promptForPauseUnpause() {
  console.log('\nPause/Unpause Contract:');
  console.log('1. Pause Contract');
  console.log('2. Unpause Contract');
  console.log('3. Back to Main Menu');
  
  const choice = await question('\nSelect an option (1-3): ');
  
  switch (choice) {
    case '1':
      console.log('\nPausing contract...');
      const confirmPause = await question('Confirm? (y/n): ');
      if (confirmPause.toLowerCase() !== 'y') {
        return await promptForPauseUnpause();
      }
      return { type: 'pause' };
    case '2':
      console.log('\nUnpausing contract...');
      const confirmUnpause = await question('Confirm? (y/n): ');
      if (confirmUnpause.toLowerCase() !== 'y') {
        return await promptForPauseUnpause();
      }
      return { type: 'unpause' };
    case '3':
      return await promptForUpdates({});
    default:
      console.log('Invalid option. Please try again.');
      return await promptForPauseUnpause();
  }
}

// Execute a transaction
async function executeTransaction(tokenContract, updateData, config) {
  try {
    console.log('\nExecuting transaction...');
    
    // Get gas price and estimate gas cost
    const wallet = tokenContract.runner;
    const provider = wallet.provider;
    
    // Allow user to customize gas settings if desired
    let gasPrice;
    let gasLimit;
    
    const customGas = await question('Do you want to customize gas settings? (y/n): ');
    if (customGas.toLowerCase() === 'y') {
      const currentGasPrice = await provider.getGasPrice();
      console.log(`Current network gas price: ${ethers.formatUnits(currentGasPrice, 'gwei')} gwei`);
      
      const customPriceInput = await question(`Enter gas price in gwei (default: ${ethers.formatUnits(currentGasPrice, 'gwei')}): `);
      gasPrice = customPriceInput ? 
        ethers.parseUnits(customPriceInput, 'gwei') : 
        currentGasPrice;
      
      const customLimitInput = await question(`Enter gas limit (default: ${config.gasLimit}): `);
      gasLimit = customLimitInput ? 
        parseInt(customLimitInput) : 
        config.gasLimit;
    } else {
      gasPrice = ethers.parseUnits(config.gasPrice, 'wei');
      gasLimit = config.gasLimit;
    }
    
    // Estimate transaction cost
    const estimatedCost = gasPrice * BigInt(gasLimit);
    console.log(`Estimated maximum transaction cost: ${ethers.formatEther(estimatedCost)} ETH`);
    
    // Check if wallet has enough balance
    const balance = await provider.getBalance(wallet.address);
    if (balance < estimatedCost) {
      console.error(`ERROR: Insufficient funds. Your wallet has ${ethers.formatEther(balance)} ETH but needs at least ${ethers.formatEther(estimatedCost)} ETH.`);
      const forceContinue = await question('This transaction will likely fail. Continue anyway? (y/n): ');
      if (forceContinue.toLowerCase() !== 'y') {
        throw new Error('Transaction cancelled due to insufficient funds');
      }
    }
    
    let tx;
    const options = {
      gasLimit: gasLimit,
      gasPrice: gasPrice
    };
    
    console.log(`Using gas limit: ${gasLimit}, gas price: ${ethers.formatUnits(gasPrice, 'gwei')} gwei`);
    
    switch (updateData.type) {
      case 'setMaxTokenSupply':
        console.log('Setting max token supply...');
        tx = await tokenContract.setMaxTokenSupply(
          updateData.values.newMaxSupply,
          options
        );
        break;
        
      case 'setTimelock':
        console.log('Setting timelock address...');
        tx = await tokenContract.setTimelock(
          updateData.values.timelockAddress,
          options
        );
        break;
        
      case 'grantContractRole':
        console.log('Granting contract role...');
        tx = await tokenContract.grantContractRole(
          updateData.values.role,
          updateData.values.account,
          options
        );
        break;
        
      case 'revokeContractRole':
        console.log('Revoking contract role...');
        tx = await tokenContract.revokeContractRole(
          updateData.values.role,
          updateData.values.account,
          options
        );
        break;
        
      case 'addGuardian':
        console.log('Adding guardian...');
        tx = await tokenContract.addGuardian(
          updateData.values.guardian,
          options
        );
        break;
        
      case 'removeGuardian':
        console.log('Removing guardian...');
        tx = await tokenContract.removeGuardian(
          updateData.values.guardian,
          options
        );
        break;
        
      case 'createSnapshot':
        console.log('Creating snapshot...');
        tx = await tokenContract.createSnapshot(options);
        break;
        
      case 'governanceMint':
        console.log('Minting tokens...');
        tx = await tokenContract.governanceMint(
          updateData.values.to,
          updateData.values.amount,
          options
        );
        break;
        
      case 'governanceBurn':
        console.log('Burning tokens...');
        tx = await tokenContract.governanceBurn(
          updateData.values.from,
          updateData.values.amount,
          options
        );
        break;
        
      case 'governanceTransfer':
        console.log('Transferring tokens...');
        tx = await tokenContract.governanceTransfer(
          updateData.values.from,
          updateData.values.to,
          updateData.values.amount,
          options
        );
        break;
        
      case 'pause':
        console.log('Pausing contract...');
        tx = await tokenContract.pause(options);
        break;
        
      case 'unpause':
        console.log('Unpausing contract...');
        tx = await tokenContract.unpause(options);
        break;
        
      default:
        throw new Error(`Unknown update type: ${updateData.type}`);
    }
    
    // Wait for transaction to be mined
    console.log('Transaction sent. Waiting for confirmation...');
    console.log(`Transaction hash: ${tx.hash}`);
    const receipt = await tx.wait();
    
    console.log(`Transaction executed successfully!`);
    return receipt;
  } catch (error) {
    console.error('Error executing transaction:', error);
    throw error;
  }
}

// Main function to run the script
async function main() {
  try {
    // Get the configuration file path from command line arguments
    const args = process.argv.slice(2);
    let configPath = null;
    
    for (let i = 0; i < args.length; i++) {
      if (args[i] === '--config' && args[i + 1]) {
        configPath = args[i + 1];
        break;
      }
    }
    
    // Load configuration
    const config = await loadConfig(configPath);
    
    // Setup ethers
    const { tokenContract } = await setupEthers(config);
    
    // Get current parameters
    const currentParams = await getCurrentParameters(tokenContract);
    
    // Main update loop
    let continueUpdating = true;
    
    while (continueUpdating) {
      // Prompt for updates
      const updateData = await promptForUpdates(currentParams);
      
      try {
        // Execute the transaction
        await executeTransaction(tokenContract, updateData, config);
        
        // Ask if user wants to perform another update
        const anotherUpdate = await question('\nWould you like to perform another update? (y/n): ');
        continueUpdating = anotherUpdate.toLowerCase() === 'y';
        
        // If continuing, refresh the parameters
        if (continueUpdating) {
          console.log('\nRefreshing contract parameters...');
          Object.assign(currentParams, await getCurrentParameters(tokenContract));
        }
      } catch (error) {
        console.error('Transaction failed:', error.message || error);
        
        const retry = await question('\nWould you like to try another operation? (y/n): ');
        continueUpdating = retry.toLowerCase() === 'y';
      }
    }
    
    // Clean up
    rl.close();
  } catch (error) {
    console.error('Error in main function:', error);
    rl.close();
    process.exit(1);
  }
}

// Run the main function
main()
  .then(() => process.exit(0))
  .catch(error => {
    console.error('Unhandled error:', error);
    process.exit(1);
  });