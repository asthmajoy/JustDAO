// direct-timelock-update.js
// Script to directly update JustTimelockUpgradeable contract parameters without queueing
// Usage: node direct-timelock-update.js [--config ./config.json]

// Load environment variables from .env file
require('dotenv').config();

const { ethers } = require('ethers');
const fs = require('fs');
const readline = require('readline');

// ABI fragments for the JustTimelockUpgradeable contract functions we need
const TIMELOCK_ABI = [
  // Read functions
  'function minDelay() view returns (uint256)',
  'function maxDelay() view returns (uint256)',
  'function gracePeriod() view returns (uint256)',
  'function lowThreatDelay() view returns (uint256)',
  'function mediumThreatDelay() view returns (uint256)',
  'function highThreatDelay() view returns (uint256)',
  'function criticalThreatDelay() view returns (uint256)',
  'function minExecutorTokenThreshold() view returns (uint256)',
  'function hasRole(bytes32 role, address account) view returns (bool)',
  
  // Direct update functions
  'function updateThreatLevelDelays(uint256 newLowDelay, uint256 newMediumDelay, uint256 newHighDelay, uint256 newCriticalDelay)',
  'function updateDelays(uint256 newMinDelay, uint256 newMaxDelay, uint256 newGracePeriod)',
  'function updateExecutorTokenThreshold(uint256 newThreshold)',
  
  // Role identifiers
  'function ADMIN_ROLE() view returns (bytes32)',
  'function PROPOSER_ROLE() view returns (bytes32)',
  'function EXECUTOR_ROLE() view returns (bytes32)',
  'function GUARDIAN_ROLE() view returns (bytes32)',
  'function GOVERNANCE_ROLE() view returns (bytes32)',
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
  timelockAddress: process.env.TIMELOCK_ADDRESS || '',
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
      
      if (!config.timelockAddress) {
        config.timelockAddress = await question('Enter the JustTimelockUpgradeable contract address (or set TIMELOCK_ADDRESS in .env): ');
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
    const timelockContract = new ethers.Contract(
      config.timelockAddress,
      TIMELOCK_ABI,
      wallet
    );
    
    // Get chain ID
    const { chainId } = await provider.getNetwork();
    
    // Get account address
    const address = await wallet.getAddress();
    
    // Check if wallet has the required roles
    const adminRole = await timelockContract.ADMIN_ROLE();
    const proposerRole = await timelockContract.PROPOSER_ROLE();
    const executorRole = await timelockContract.EXECUTOR_ROLE();
    const guardianRole = await timelockContract.GUARDIAN_ROLE();
    const governanceRole = await timelockContract.GOVERNANCE_ROLE();
    
    const isAdmin = await timelockContract.hasRole(adminRole, address);
    const isProposer = await timelockContract.hasRole(proposerRole, address);
    const isExecutor = await timelockContract.hasRole(executorRole, address);
    const isGuardian = await timelockContract.hasRole(guardianRole, address);
    const isGovernance = await timelockContract.hasRole(governanceRole, address);
    
    console.log(`Connected to network: ${config.name} (Chain ID: ${chainId})`);
    console.log(`Using account: ${address}`);
    console.log(`Account balance: ${ethers.formatEther(balance)} ETH`);
    console.log(`Account roles: ${isProposer ? 'Proposer ' : ''}${isExecutor ? 'Executor ' : ''}${isAdmin ? 'Admin ' : ''}${isGuardian ? 'Guardian ' : ''}${isGovernance ? 'Governance' : ''}`);
    
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
    
    return { provider, wallet, timelockContract };
  } catch (error) {
    console.error('Error setting up ethers:', error);
    process.exit(1);
  }
}

// Get current parameter values from the contract
async function getCurrentParameters(timelockContract) {
  try {
    const minDelay = await timelockContract.minDelay();
    const maxDelay = await timelockContract.maxDelay();
    const gracePeriod = await timelockContract.gracePeriod();
    const lowThreatDelay = await timelockContract.lowThreatDelay();
    const mediumThreatDelay = await timelockContract.mediumThreatDelay();
    const highThreatDelay = await timelockContract.highThreatDelay();
    const criticalThreatDelay = await timelockContract.criticalThreatDelay();
    const minExecutorTokenThreshold = await timelockContract.minExecutorTokenThreshold();
    
    // Convert BigInts to strings for better readability
    const params = {
      generalDelays: {
        minDelay: minDelay.toString(),
        maxDelay: maxDelay.toString(),
        gracePeriod: gracePeriod.toString()
      },
      threatLevelDelays: {
        lowThreatDelay: lowThreatDelay.toString(),
        mediumThreatDelay: mediumThreatDelay.toString(),
        highThreatDelay: highThreatDelay.toString(),
        criticalThreatDelay: criticalThreatDelay.toString()
      },
      executorTokenThreshold: minExecutorTokenThreshold.toString()
    };
    
    // Print human-readable values
    console.log('\nCurrent Parameter Values:');
    console.log('------------------------');
    console.log('General Delays:');
    console.log(`  Minimum Delay: ${formatSeconds(minDelay)}`);
    console.log(`  Maximum Delay: ${formatSeconds(maxDelay)}`);
    console.log(`  Grace Period: ${formatSeconds(gracePeriod)}`);
    
    console.log('\nThreat Level Delays:');
    console.log(`  Low Threat: ${formatSeconds(lowThreatDelay)}`);
    console.log(`  Medium Threat: ${formatSeconds(mediumThreatDelay)}`);
    console.log(`  High Threat: ${formatSeconds(highThreatDelay)}`);
    console.log(`  Critical Threat: ${formatSeconds(criticalThreatDelay)}`);
    
    console.log('\nExecutor Token Threshold:');
    console.log(`  Minimum Tokens: ${formatTokenAmount(minExecutorTokenThreshold)}`);
    
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

// Prompt the user for parameter updates
async function promptForUpdates(currentParams) {
  try {
    console.log('\nParameter Update Options:');
    console.log('------------------------');
    console.log('1. Update General Delays (minDelay, maxDelay, gracePeriod)');
    console.log('2. Update Threat Level Delays (low, medium, high, critical)');
    console.log('3. Update Executor Token Threshold');
    console.log('4. Exit');
    
    const choice = await question('\nSelect an option (1-4): ');
    
    switch (choice) {
      case '1':
        return await promptForGeneralDelays(currentParams.generalDelays);
      case '2':
        return await promptForThreatLevelDelays(currentParams.threatLevelDelays);
      case '3':
        return await promptForExecutorThreshold(currentParams.executorTokenThreshold);
      case '4':
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

// Prompt for general delay updates
async function promptForGeneralDelays(currentValues) {
  console.log('\nUpdating General Delays:');
  console.log('Current values:');
  console.log(`- Minimum Delay: ${formatSeconds(currentValues.minDelay)}`);
  console.log(`- Maximum Delay: ${formatSeconds(currentValues.maxDelay)}`);
  console.log(`- Grace Period: ${formatSeconds(currentValues.gracePeriod)}`);
  
  // Convert to seconds for easier input
  const secInDay = 86400;
  const currentMinInDays = parseInt(currentValues.minDelay) / secInDay;
  const currentMaxInDays = parseInt(currentValues.maxDelay) / secInDay;
  const currentGraceInDays = parseInt(currentValues.gracePeriod) / secInDay;
  
  console.log('\nEnter new values in days (leave blank to keep current values):');
  let minDelayInput = await question(`New Minimum Delay (currently ~${currentMinInDays.toFixed(2)} days): `);
  let maxDelayInput = await question(`New Maximum Delay (currently ~${currentMaxInDays.toFixed(2)} days): `);
  let gracePeriodInput = await question(`New Grace Period (currently ~${currentGraceInDays.toFixed(2)} days): `);
  
  // Convert inputs to seconds, keeping current values if no input
  const newMinDelay = minDelayInput ? Math.floor(parseFloat(minDelayInput) * secInDay) : parseInt(currentValues.minDelay);
  const newMaxDelay = maxDelayInput ? Math.floor(parseFloat(maxDelayInput) * secInDay) : parseInt(currentValues.maxDelay);
  const newGracePeriod = gracePeriodInput ? Math.floor(parseFloat(gracePeriodInput) * secInDay) : parseInt(currentValues.gracePeriod);
  
  // Validate inputs
  if (newMinDelay <= 0) {
    console.error('Minimum delay must be greater than 0.');
    return await promptForGeneralDelays(currentValues);
  }
  
  if (newMaxDelay < newMinDelay) {
    console.error('Maximum delay must be greater than or equal to minimum delay.');
    return await promptForGeneralDelays(currentValues);
  }
  
  if (newGracePeriod <= 0) {
    console.error('Grace period must be greater than 0.');
    return await promptForGeneralDelays(currentValues);
  }
  
  console.log('\nNew values:');
  console.log(`- Minimum Delay: ${formatSeconds(newMinDelay.toString())}`);
  console.log(`- Maximum Delay: ${formatSeconds(newMaxDelay.toString())}`);
  console.log(`- Grace Period: ${formatSeconds(newGracePeriod.toString())}`);
  
  const confirm = await question('\nConfirm these values? (y/n): ');
  if (confirm.toLowerCase() !== 'y') {
    return await promptForGeneralDelays(currentValues);
  }
  
  return {
    type: 'generalDelays',
    values: {
      minDelay: newMinDelay.toString(),
      maxDelay: newMaxDelay.toString(),
      gracePeriod: newGracePeriod.toString()
    }
  };
}

// Prompt for threat level delay updates
async function promptForThreatLevelDelays(currentValues) {
  console.log('\nUpdating Threat Level Delays:');
  console.log('Current values:');
  console.log(`- Low Threat Delay: ${formatSeconds(currentValues.lowThreatDelay)}`);
  console.log(`- Medium Threat Delay: ${formatSeconds(currentValues.mediumThreatDelay)}`);
  console.log(`- High Threat Delay: ${formatSeconds(currentValues.highThreatDelay)}`);
  console.log(`- Critical Threat Delay: ${formatSeconds(currentValues.criticalThreatDelay)}`);
  
  // Convert to days for easier input
  const secInDay = 86400;
  const currentLowInDays = parseInt(currentValues.lowThreatDelay) / secInDay;
  const currentMediumInDays = parseInt(currentValues.mediumThreatDelay) / secInDay;
  const currentHighInDays = parseInt(currentValues.highThreatDelay) / secInDay;
  const currentCriticalInDays = parseInt(currentValues.criticalThreatDelay) / secInDay;
  
  console.log('\nEnter new values in days (leave blank to keep current values):');
  let lowDelayInput = await question(`New Low Threat Delay (currently ~${currentLowInDays.toFixed(2)} days): `);
  let mediumDelayInput = await question(`New Medium Threat Delay (currently ~${currentMediumInDays.toFixed(2)} days): `);
  let highDelayInput = await question(`New High Threat Delay (currently ~${currentHighInDays.toFixed(2)} days): `);
  let criticalDelayInput = await question(`New Critical Threat Delay (currently ~${currentCriticalInDays.toFixed(2)} days): `);
  
  // Convert inputs to seconds, keeping current values if no input
  const newLowDelay = lowDelayInput ? Math.floor(parseFloat(lowDelayInput) * secInDay) : parseInt(currentValues.lowThreatDelay);
  const newMediumDelay = mediumDelayInput ? Math.floor(parseFloat(mediumDelayInput) * secInDay) : parseInt(currentValues.mediumThreatDelay);
  const newHighDelay = highDelayInput ? Math.floor(parseFloat(highDelayInput) * secInDay) : parseInt(currentValues.highThreatDelay);
  const newCriticalDelay = criticalDelayInput ? Math.floor(parseFloat(criticalDelayInput) * secInDay) : parseInt(currentValues.criticalThreatDelay);
  
  // Validate hierarchy
  if (newMediumDelay < newLowDelay) {
    console.error('Medium threat delay must be greater than or equal to low threat delay.');
    return await promptForThreatLevelDelays(currentValues);
  }
  
  if (newHighDelay < newMediumDelay) {
    console.error('High threat delay must be greater than or equal to medium threat delay.');
    return await promptForThreatLevelDelays(currentValues);
  }
  
  if (newCriticalDelay < newHighDelay) {
    console.error('Critical threat delay must be greater than or equal to high threat delay.');
    return await promptForThreatLevelDelays(currentValues);
  }
  
  console.log('\nNew values:');
  console.log(`- Low Threat Delay: ${formatSeconds(newLowDelay.toString())}`);
  console.log(`- Medium Threat Delay: ${formatSeconds(newMediumDelay.toString())}`);
  console.log(`- High Threat Delay: ${formatSeconds(newHighDelay.toString())}`);
  console.log(`- Critical Threat Delay: ${formatSeconds(newCriticalDelay.toString())}`);
  
  const confirm = await question('\nConfirm these values? (y/n): ');
  if (confirm.toLowerCase() !== 'y') {
    return await promptForThreatLevelDelays(currentValues);
  }
  
  return {
    type: 'threatLevelDelays',
    values: {
      lowThreatDelay: newLowDelay.toString(),
      mediumThreatDelay: newMediumDelay.toString(),
      highThreatDelay: newHighDelay.toString(),
      criticalThreatDelay: newCriticalDelay.toString()
    }
  };
}

// Prompt for executor token threshold updates
async function promptForExecutorThreshold(currentValue) {
  console.log('\nUpdating Executor Token Threshold:');
  console.log('Current value:');
  console.log(`- Minimum Tokens: ${formatTokenAmount(currentValue)}`);
  
  // Get new threshold
  const thresholdInput = await question('\nNew Executor Token Threshold (leave blank to keep current value): ');
  
  // If no input, keep current value
  if (!thresholdInput) {
    return {
      type: 'executorTokenThreshold',
      values: {
        threshold: currentValue
      }
    };
  }
  
  // Parse input
  let newThreshold;
  try {
    // Check if the input contains a decimal point
    if (thresholdInput.includes('.')) {
      const [whole, fraction] = thresholdInput.split('.');
      const decimals = 18; // Assuming 18 decimals
      const paddedFraction = fraction.padEnd(decimals, '0').substr(0, decimals);
      newThreshold = whole === '' ? paddedFraction : whole + paddedFraction;
    } else {
      // Whole number, convert to wei
      newThreshold = ethers.parseEther(thresholdInput).toString();
    }
  } catch (error) {
    console.error('Invalid token amount. Please try again.');
    return await promptForExecutorThreshold(currentValue);
  }
  
  console.log('\nNew value:');
  console.log(`- Minimum Tokens: ${formatTokenAmount(newThreshold)}`);
  
  const confirm = await question('\nConfirm this value? (y/n): ');
  if (confirm.toLowerCase() !== 'y') {
    return await promptForExecutorThreshold(currentValue);
  }
  
  return {
    type: 'executorTokenThreshold',
    values: {
      threshold: newThreshold
    }
  };
}

// Execute direct update transaction
async function executeDirectUpdate(timelockContract, updateData, config) {
  try {
    console.log('\nExecuting direct update transaction...');
    
    // Get gas price and estimate gas cost
    const wallet = timelockContract.runner;
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
      case 'generalDelays':
        console.log('Updating general delays...');
        tx = await timelockContract.updateDelays(
          updateData.values.minDelay,
          updateData.values.maxDelay,
          updateData.values.gracePeriod,
          options
        );
        break;
        
      case 'threatLevelDelays':
        console.log('Updating threat level delays...');
        tx = await timelockContract.updateThreatLevelDelays(
          updateData.values.lowThreatDelay,
          updateData.values.mediumThreatDelay,
          updateData.values.highThreatDelay,
          updateData.values.criticalThreatDelay,
          options
        );
        break;
        
      case 'executorTokenThreshold':
        console.log('Updating executor token threshold...');
        tx = await timelockContract.updateExecutorTokenThreshold(
          updateData.values.threshold,
          options
        );
        break;
        
      default:
        throw new Error(`Unknown update type: ${updateData.type}`);
    }
    
    // Wait for transaction to be mined
    console.log('Transaction sent. Waiting for confirmation...');
    console.log(`Transaction hash: ${tx.hash}`);
    const receipt = await tx.wait();
    
    console.log(`\nTransaction executed successfully in block ${receipt.blockNumber}!`);
    
    // Verify the update was successful
    await verifyUpdate(timelockContract, updateData);
    
    return receipt;
  } catch (error) {
    console.error('Error executing transaction:', error);
    throw error;
  }
}

// Verify update was successful
async function verifyUpdate(timelockContract, updateData) {
  console.log('\nVerifying update...');
  
  try {
    switch (updateData.type) {
      case 'generalDelays':
        const minDelay = await timelockContract.minDelay();
        const maxDelay = await timelockContract.maxDelay();
        const gracePeriod = await timelockContract.gracePeriod();
        
        console.log('Updated values:');
        console.log(`- Minimum Delay: ${formatSeconds(minDelay)}`);
        console.log(`- Maximum Delay: ${formatSeconds(maxDelay)}`);
        console.log(`- Grace Period: ${formatSeconds(gracePeriod)}`);
        
        // Check if values match
        if (minDelay.toString() !== updateData.values.minDelay ||
            maxDelay.toString() !== updateData.values.maxDelay ||
            gracePeriod.toString() !== updateData.values.gracePeriod) {
          console.warn('⚠️ Warning: Some values may not have updated correctly.');
        } else {
          console.log('✅ Update verified successfully!');
        }
        break;
        
      case 'threatLevelDelays':
        const lowThreatDelay = await timelockContract.lowThreatDelay();
        const mediumThreatDelay = await timelockContract.mediumThreatDelay();
        const highThreatDelay = await timelockContract.highThreatDelay();
        const criticalThreatDelay = await timelockContract.criticalThreatDelay();
        
        console.log('Updated values:');
        console.log(`- Low Threat Delay: ${formatSeconds(lowThreatDelay)}`);
        console.log(`- Medium Threat Delay: ${formatSeconds(mediumThreatDelay)}`);
        console.log(`- High Threat Delay: ${formatSeconds(highThreatDelay)}`);
        console.log(`- Critical Threat Delay: ${formatSeconds(criticalThreatDelay)}`);
        
        // Check if values match
        if (lowThreatDelay.toString() !== updateData.values.lowThreatDelay ||
            mediumThreatDelay.toString() !== updateData.values.mediumThreatDelay ||
            highThreatDelay.toString() !== updateData.values.highThreatDelay ||
            criticalThreatDelay.toString() !== updateData.values.criticalThreatDelay) {
          console.warn('⚠️ Warning: Some values may not have updated correctly.');
        } else {
          console.log('✅ Update verified successfully!');
        }
        break;
        
      case 'executorTokenThreshold':
        const minExecutorTokenThreshold = await timelockContract.minExecutorTokenThreshold();
        
        console.log('Updated value:');
        console.log(`- Minimum Tokens: ${formatTokenAmount(minExecutorTokenThreshold)}`);
        
        // Check if value matches
        if (minExecutorTokenThreshold.toString() !== updateData.values.threshold) {
          console.warn('⚠️ Warning: Value may not have updated correctly.');
        } else {
          console.log('✅ Update verified successfully!');
        }
        break;
    }
  } catch (error) {
    console.error('Error verifying update:', error);
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
    const { timelockContract } = await setupEthers(config);
    
    // Get current parameters
    const currentParams = await getCurrentParameters(timelockContract);
    
    // Main update loop
    let continueUpdating = true;
    
    while (continueUpdating) {
      // Prompt for updates
      const updateData = await promptForUpdates(currentParams);
      
      try {
        // Execute the direct update transaction
        await executeDirectUpdate(timelockContract, updateData, config);
        
        // Ask if user wants to perform another update
        const anotherUpdate = await question('\nWould you like to perform another update? (y/n): ');
        continueUpdating = anotherUpdate.toLowerCase() === 'y';
        
        // If continuing, refresh the parameters
        if (continueUpdating) {
          console.log('\nRefreshing contract parameters...');
          Object.assign(currentParams, await getCurrentParameters(timelockContract));
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