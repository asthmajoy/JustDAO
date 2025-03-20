// Governance Parameter Checker and Updater
// Using ethers v6 to check and update all parameters in the JustGovernanceUpgradeable contract
// Updated for proper Hardhat network detection

const { ethers } = require('ethers');
require('dotenv').config();

// Governance parameter constants based on the contract
const PARAM_VOTING_DURATION = 0;
const PARAM_QUORUM = 1;
const PARAM_TIMELOCK_DELAY = 2;
const PARAM_PROPOSAL_THRESHOLD = 3;
const PARAM_PROPOSAL_STAKE = 4;
const PARAM_DEFEATED_REFUND_PERCENTAGE = 5;
const PARAM_CANCELED_REFUND_PERCENTAGE = 6;
const PARAM_EXPIRED_REFUND_PERCENTAGE = 7;

// Enhanced ABI fragment with all needed functions
const governanceAbi = [
  // Governance parameter getter
  "function govParams() external view returns (uint256 votingDuration, uint256 quorum, uint256 timelockDelay, uint256 proposalCreationThreshold, uint256 proposalStake, uint256 defeatedRefundPercentage, uint256 canceledRefundPercentage, uint256 expiredRefundPercentage)",
  
  // Governance parameter updater
  "function updateGovParam(uint8 paramType, uint256 newValue) external",
  
  // Constraints
  "function minVotingDuration() external view returns (uint256)",
  "function maxVotingDuration() external view returns (uint256)",
  
  // Role checking
  "function hasRole(bytes32 role, address account) external view returns (bool)"
];

// Function names for better user experience
const paramNames = {
  [PARAM_VOTING_DURATION]: "Voting Duration",
  [PARAM_QUORUM]: "Quorum",
  [PARAM_TIMELOCK_DELAY]: "Timelock Delay",
  [PARAM_PROPOSAL_THRESHOLD]: "Proposal Threshold",
  [PARAM_PROPOSAL_STAKE]: "Proposal Stake",
  [PARAM_DEFEATED_REFUND_PERCENTAGE]: "Defeated Refund Percentage",
  [PARAM_CANCELED_REFUND_PERCENTAGE]: "Canceled Refund Percentage",
  [PARAM_EXPIRED_REFUND_PERCENTAGE]: "Expired Refund Percentage"
};

// ADMIN_ROLE constant
const ADMIN_ROLE = ethers.keccak256(ethers.toUtf8Bytes("ADMIN_ROLE"));

async function main() {
  try {
    console.log("=".repeat(60));
    console.log("JustGovernance Parameter Checker and Updater");
    console.log("=".repeat(60));
    
    // Initialize variables
    let provider, wallet, signer, network, governanceContract, governanceAddress;
    
    // *************************************************************
    // IMPROVED HARDHAT DETECTION - Check if we're running in Hardhat
    // *************************************************************
    if (typeof hre !== 'undefined') {
      console.log(`Detected Hardhat environment using network: ${hre.network.name}`);
      network = hre.network.name;
      
      // Use Hardhat's provider
      provider = hre.ethers.provider;
      
      // Get first signer from Hardhat
      [signer] = await hre.ethers.getSigners();
      wallet = signer;
      
      console.log(`Using Hardhat provider for network: ${network}`);
      console.log(`Using signer account: ${wallet.address}`);
      
      try {
        // Try to get contract from deployments if available
        if (hre.deployments) {
          try {
            const deployment = await hre.deployments.get("JustGovernanceUpgradeable");
            governanceAddress = deployment.address;
            console.log(`Found contract from deployments: ${governanceAddress}`);
          } catch (e) {
            console.log("No deployment found, will check .env file");
          }
        }
      } catch (e) {
        console.log("Hardhat deployments not available");
      }
    }
    // Standalone mode - not running through Hardhat
    else {
      console.log("Running in standalone mode (not via Hardhat)");
      
      // Get network argument if provided
      const networkArg = process.argv.find((arg, index) => 
        arg === '--network' && index < process.argv.length - 1
      );
      
      network = networkArg ? 
        process.argv[process.argv.indexOf('--network') + 1] : 
        'sepolia';
      
      console.log(`Using network: ${network}`);
      
      // Initialize provider based on network
      if (network === 'localhost' || network === 'local' || network === 'hardhat') {
        provider = new ethers.JsonRpcProvider('http://127.0.0.1:8545');
        console.log(`Using localhost provider at http://127.0.0.1:8545`);
      }
      else if (network === 'sepolia') {
        if (process.env.SEPOLIA_RPC_URL) {
          provider = new ethers.JsonRpcProvider(process.env.SEPOLIA_RPC_URL);
          console.log(`Using Sepolia RPC URL from .env`);
        } 
        else if (process.env.INFURA_PROJECT_ID) {
          provider = new ethers.InfuraProvider('sepolia', process.env.INFURA_PROJECT_ID);
          console.log('Using Infura for Sepolia network');
        }
        else {
          throw new Error('No Sepolia provider configuration found. Add SEPOLIA_RPC_URL or INFURA_PROJECT_ID to .env file');
        }
      }
      else if (network === 'mainnet') {
        if (process.env.MAINNET_RPC_URL) {
          provider = new ethers.JsonRpcProvider(process.env.MAINNET_RPC_URL);
          console.log(`Using Mainnet RPC URL from .env`);
        } 
        else if (process.env.INFURA_PROJECT_ID) {
          provider = new ethers.InfuraProvider('mainnet', process.env.INFURA_PROJECT_ID);
          console.log('Using Infura for Mainnet');
        }
        else {
          throw new Error('No Mainnet provider configuration found. Add MAINNET_RPC_URL or INFURA_PROJECT_ID to .env file');
        }
      }
      else {
        throw new Error(`Unsupported network: ${network}`);
      }
      
      // Setup wallet from private key
      const privateKey = process.env.PRIVATE_KEY;
      if (!privateKey) {
        throw new Error('PRIVATE_KEY not found in .env file');
      }
      
      const formattedPrivateKey = privateKey.startsWith('0x') ? privateKey : `0x${privateKey}`;
      wallet = new ethers.Wallet(formattedPrivateKey, provider);
      console.log(`Using wallet address: ${wallet.address}`);
    }
    
    // Get network details and check balance
    try {
      const chainId = (await provider.getNetwork()).chainId;
      console.log(`Connected to chain ID: ${chainId}`);
      
      const balance = await provider.getBalance(wallet.address);
      console.log(`Wallet balance: ${ethers.formatEther(balance)} ETH`);
      
      // Only check balance for non-localhost networks
      if (balance === 0n && network !== 'localhost' && network !== 'local' && network !== 'hardhat') {
        throw new Error(`Wallet has 0 ETH. Please fund this wallet on ${network} before continuing.`);
      }
    } catch (error) {
      console.log(`Error checking network or balance: ${error.message}`);
      console.log("Continuing anyway - this might be normal for localhost development chains");
    }
    
    // Get governance contract address if not already set from deployments
    if (!governanceAddress) {
      governanceAddress = process.env.GOVERNANCE_ADDRESS;
      if (!governanceAddress) {
        throw new Error('GOVERNANCE_ADDRESS not found in .env file and no deployment found');
      }
      console.log(`Using governance contract from .env: ${governanceAddress}`);
    }
    
    // Check if contract exists
    try {
      const code = await provider.getCode(governanceAddress);
      if (code === '0x' || code === '0x0') {
        if (network === 'localhost' || network === 'local' || network === 'hardhat') {
          console.log(`⚠️ No contract code found at ${governanceAddress} on ${network}.`);
          console.log("This might be normal if you're on a fresh local chain. Attempting to continue...");
        } else {
          throw new Error(`No contract code found at address ${governanceAddress} on ${network}. Please verify the contract is deployed.`);
        }
      } else {
        console.log(`✅ Contract code verified at ${governanceAddress}`);
      }
    } catch (error) {
      if (network === 'localhost' || network === 'local' || network === 'hardhat') {
        console.log(`⚠️ Error checking contract code: ${error.message}`);
        console.log("This might be normal on local networks. Attempting to continue...");
      } else {
        throw error;
      }
    }
    
    // Create contract instance - use different approaches based on environment
    if (typeof hre !== 'undefined' && hre.ethers && hre.ethers.getContractAt) {
      try {
        // Try to get the contract using Hardhat's helper
        governanceContract = await hre.ethers.getContractAt("JustGovernanceUpgradeable", governanceAddress);
        console.log("Using Hardhat contract instance");
      } catch (error) {
        console.log(`Error getting contract via Hardhat: ${error.message}`);
        console.log("Falling back to direct ethers instantiation...");
        governanceContract = new ethers.Contract(governanceAddress, governanceAbi, wallet);
      }
    } else {
      // Direct instantiation for standalone mode
      governanceContract = new ethers.Contract(governanceAddress, governanceAbi, wallet);
      console.log("Using direct ethers contract instance");
    }
    
    // Check role and governance parameters
    try {
      // Check if wallet has ADMIN_ROLE
      const hasAdminRole = await governanceContract.hasRole(ADMIN_ROLE, wallet.address);
      if (!hasAdminRole) {
        console.log(`⚠️ WARNING: The wallet ${wallet.address} does not have ADMIN_ROLE in the governance contract.`);
        console.log("You may not be able to update parameters.");
      } else {
        console.log(`✅ Wallet has ADMIN_ROLE - can update governance parameters`);
      }
      
      // Get voting duration constraints
      const minVotingDuration = await governanceContract.minVotingDuration();
      const maxVotingDuration = await governanceContract.maxVotingDuration();
      console.log(`Voting duration constraints: min=${minVotingDuration.toString()} seconds, max=${maxVotingDuration.toString()} seconds (${Math.floor(Number(maxVotingDuration) / 86400)} days)`);
      
      // Get current parameters
      const currentParams = await governanceContract.govParams();
      
      console.log("\nCurrent Governance Parameters:");
      console.log("-".repeat(40));
      
      // Format and display current params with indexes
      console.log(`[${PARAM_VOTING_DURATION}] ${paramNames[PARAM_VOTING_DURATION]}: ${currentParams.votingDuration.toString()} seconds (${(Number(currentParams.votingDuration) / 3600).toFixed(2)} hours)`);
      console.log(`[${PARAM_QUORUM}] ${paramNames[PARAM_QUORUM]}: ${ethers.formatUnits(currentParams.quorum, 18)} tokens`);
      console.log(`[${PARAM_TIMELOCK_DELAY}] ${paramNames[PARAM_TIMELOCK_DELAY]}: ${currentParams.timelockDelay.toString()} seconds (${(Number(currentParams.timelockDelay) / 60).toFixed(2)} minutes)`);
      console.log(`[${PARAM_PROPOSAL_THRESHOLD}] ${paramNames[PARAM_PROPOSAL_THRESHOLD]}: ${ethers.formatUnits(currentParams.proposalCreationThreshold, 18)} tokens`);
      console.log(`[${PARAM_PROPOSAL_STAKE}] ${paramNames[PARAM_PROPOSAL_STAKE]}: ${ethers.formatUnits(currentParams.proposalStake, 18)} tokens`);
      console.log(`[${PARAM_DEFEATED_REFUND_PERCENTAGE}] ${paramNames[PARAM_DEFEATED_REFUND_PERCENTAGE]}: ${currentParams.defeatedRefundPercentage.toString()}%`);
      console.log(`[${PARAM_CANCELED_REFUND_PERCENTAGE}] ${paramNames[PARAM_CANCELED_REFUND_PERCENTAGE]}: ${currentParams.canceledRefundPercentage.toString()}%`);
      console.log(`[${PARAM_EXPIRED_REFUND_PERCENTAGE}] ${paramNames[PARAM_EXPIRED_REFUND_PERCENTAGE]}: ${currentParams.expiredRefundPercentage.toString()}%`);
      
      // Ask for parameter updates
      console.log("\nDo you want to update parameters? (y/n)");
      const readline = require('readline');
      const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
      });
      
      rl.question("Enter 'y' to update parameters or 'n' to exit: ", async (answer) => {
        if (answer.toLowerCase() === 'y') {
          await updateParameters(governanceContract, minVotingDuration, maxVotingDuration, currentParams, rl, network);
        } else {
          console.log("Exiting without updates");
          rl.close();
          process.exit(0);
        }
      });
    } catch (error) {
      console.error(`\n❌ Error checking contract parameters: ${error.message}`);
      if (error.data) {
        console.error("Contract error data:", error.data);
      }
      console.log("This may indicate the contract is not properly deployed or initialized on this network.");
      process.exit(1);
    }
    
  } catch (error) {
    console.error("\n❌ Fatal error:", error.message);
    if (error.data) {
      console.error("Contract error data:", error.data);
    }
    process.exit(1);
  }
}

async function updateParameters(contract, minVotingDuration, maxVotingDuration, currentParams, rl, network) {
  console.log("\nParameter Update Menu");
  console.log("-".repeat(40));
  
  // Get parameters to update
  const paramPrompt = () => {
    return new Promise((resolve) => {
      rl.question(`
Enter the number of the parameter you want to update:
[${PARAM_VOTING_DURATION}] ${paramNames[PARAM_VOTING_DURATION]}
[${PARAM_QUORUM}] ${paramNames[PARAM_QUORUM]}
[${PARAM_TIMELOCK_DELAY}] ${paramNames[PARAM_TIMELOCK_DELAY]}
[${PARAM_PROPOSAL_THRESHOLD}] ${paramNames[PARAM_PROPOSAL_THRESHOLD]}
[${PARAM_PROPOSAL_STAKE}] ${paramNames[PARAM_PROPOSAL_STAKE]}
[${PARAM_DEFEATED_REFUND_PERCENTAGE}] ${paramNames[PARAM_DEFEATED_REFUND_PERCENTAGE]}
[${PARAM_CANCELED_REFUND_PERCENTAGE}] ${paramNames[PARAM_CANCELED_REFUND_PERCENTAGE]}
[${PARAM_EXPIRED_REFUND_PERCENTAGE}] ${paramNames[PARAM_EXPIRED_REFUND_PERCENTAGE]}
[9] Done updating
Choice: `, (paramChoice) => {
        if (paramChoice === '9') {
          resolve(null);
          return;
        }
        
        const paramType = parseInt(paramChoice);
        if (isNaN(paramType) || paramType < 0 || paramType > 7) {
          console.log("Invalid parameter choice. Please try again.");
          resolve(paramPrompt());
          return;
        }
        
        rl.question(`Enter new value for ${paramNames[paramType]}: `, async (valueInput) => {
          try {
            let newValue;
            
            // Handle different parameter types
            if (paramType === PARAM_QUORUM || paramType === PARAM_PROPOSAL_THRESHOLD || paramType === PARAM_PROPOSAL_STAKE) {
              // Parse token amounts and convert to wei
              newValue = ethers.parseUnits(valueInput, 18);
            } else {
              // Parse numeric values
              newValue = BigInt(valueInput);
            }
            
            // Validate the inputs
            if (paramType === PARAM_VOTING_DURATION) {
              if (newValue < minVotingDuration || newValue > maxVotingDuration) {
                throw new Error(`Voting duration must be between ${minVotingDuration} and ${maxVotingDuration} seconds`);
              }
            } else if (
              paramType === PARAM_DEFEATED_REFUND_PERCENTAGE || 
              paramType === PARAM_CANCELED_REFUND_PERCENTAGE ||
              paramType === PARAM_EXPIRED_REFUND_PERCENTAGE
            ) {
              if (newValue > 100n) {
                throw new Error("Percentage cannot exceed 100%");
              }
            } else if (newValue <= 0n) {
              throw new Error("Value must be greater than 0");
            }
            
            console.log(`\nUpdating ${paramNames[paramType]}...`);
            
            try {
              // Get gas estimate - with some error handling for local networks
              let gasEstimate;
              try {
                gasEstimate = await contract.updateGovParam.estimateGas(paramType, newValue);
                console.log(`Gas estimate: ${gasEstimate.toString()}`);
              } catch (error) {
                console.log(`Warning: Failed to estimate gas. Using default gas limit. Error: ${error.message}`);
                gasEstimate = 300000n; // Default reasonable gas limit
              }
              
              // Get current gas settings
              let txOptions = {};
              try {
                const feeData = await contract.runner.provider.getFeeData();
                
                // For local dev chains, keep it simple
                if (network === 'localhost' || network === 'local' || network === 'hardhat') {
                  txOptions = {
                    gasLimit: gasEstimate || 300000n
                  };
                } else {
                  // For real networks, add gas buffer and use EIP-1559 if available
                  txOptions = {
                    gasLimit: gasEstimate ? gasEstimate * 120n / 100n : 300000n,
                    maxFeePerGas: feeData.maxFeePerGas ? feeData.maxFeePerGas * 110n / 100n : undefined,
                    maxPriorityFeePerGas: feeData.maxPriorityFeePerGas ? feeData.maxPriorityFeePerGas * 110n / 100n : undefined
                  };
                }
                
                console.log("Using gas settings:", JSON.stringify({
                  gasLimit: txOptions.gasLimit?.toString() || "default",
                  maxFeePerGas: txOptions.maxFeePerGas ? ethers.formatUnits(txOptions.maxFeePerGas, 'gwei') + ' gwei' : 'not set',
                  maxPriorityFeePerGas: txOptions.maxPriorityFeePerGas ? ethers.formatUnits(txOptions.maxPriorityFeePerGas, 'gwei') + ' gwei' : 'not set'
                }, null, 2));
              } catch (error) {
                console.log(`Warning: Error getting fee data. Using default gas settings. Error: ${error.message}`);
                txOptions = { gasLimit: 300000n };
              }
              
              // Execute the transaction
              console.log("Sending transaction...");
              const tx = await contract.updateGovParam(paramType, newValue, txOptions);
              console.log(`Transaction sent: ${tx.hash}`);
              
              // Network-specific explorers
              if (network === 'sepolia') {
                console.log(`Track transaction: https://sepolia.etherscan.io/tx/${tx.hash}`);
              } else if (network === 'mainnet') {
                console.log(`Track transaction: https://etherscan.io/tx/${tx.hash}`);
              } else {
                console.log(`Transaction sent on ${network} network`);
              }
              
              const receipt = await tx.wait();
              console.log(`✅ Transaction confirmed in block ${receipt.blockNumber}`);
              
              // Get updated parameter to verify
              const updatedParams = await contract.govParams();
              let currentValue, formattedNewValue, formattedUpdatedValue;
              
              switch (paramType) {
                case PARAM_VOTING_DURATION:
                  currentValue = currentParams.votingDuration;
                  formattedNewValue = newValue.toString();
                  formattedUpdatedValue = updatedParams.votingDuration.toString();
                  break;
                case PARAM_QUORUM:
                  currentValue = currentParams.quorum;
                  formattedNewValue = ethers.formatUnits(newValue, 18);
                  formattedUpdatedValue = ethers.formatUnits(updatedParams.quorum, 18);
                  break;
                case PARAM_TIMELOCK_DELAY:
                  currentValue = currentParams.timelockDelay;
                  formattedNewValue = newValue.toString();
                  formattedUpdatedValue = updatedParams.timelockDelay.toString();
                  break;
                case PARAM_PROPOSAL_THRESHOLD:
                  currentValue = currentParams.proposalCreationThreshold;
                  formattedNewValue = ethers.formatUnits(newValue, 18);
                  formattedUpdatedValue = ethers.formatUnits(updatedParams.proposalCreationThreshold, 18);
                  break;
                case PARAM_PROPOSAL_STAKE:
                  currentValue = currentParams.proposalStake;
                  formattedNewValue = ethers.formatUnits(newValue, 18);
                  formattedUpdatedValue = ethers.formatUnits(updatedParams.proposalStake, 18);
                  break;
                case PARAM_DEFEATED_REFUND_PERCENTAGE:
                  currentValue = currentParams.defeatedRefundPercentage;
                  formattedNewValue = newValue.toString();
                  formattedUpdatedValue = updatedParams.defeatedRefundPercentage.toString();
                  break;
                case PARAM_CANCELED_REFUND_PERCENTAGE:
                  currentValue = currentParams.canceledRefundPercentage;
                  formattedNewValue = newValue.toString();
                  formattedUpdatedValue = updatedParams.canceledRefundPercentage.toString();
                  break;
                case PARAM_EXPIRED_REFUND_PERCENTAGE:
                  currentValue = currentParams.expiredRefundPercentage;
                  formattedNewValue = newValue.toString();
                  formattedUpdatedValue = updatedParams.expiredRefundPercentage.toString();
                  break;
              }
              
              console.log(`Parameter update summary for ${paramNames[paramType]}:`);
              console.log(`- Previous value: ${currentValue.toString()}`);
              console.log(`- New value set: ${formattedNewValue}`);
              console.log(`- Updated value: ${formattedUpdatedValue}`);
              
              if (formattedNewValue !== formattedUpdatedValue) {
                console.warn("⚠️ New value doesn't match updated value. Verification failed.");
              } else {
                console.log("✅ Parameter successfully updated and verified!");
              }
            } catch (txError) {
              console.error(`❌ Transaction error: ${txError.message}`);
              if (txError.data) {
                console.error("Contract error data:", txError.data);
              }
            }
            
            // Continue updating parameters
            resolve(paramPrompt());
            
          } catch (error) {
            console.error(`❌ Error updating parameter: ${error.message}`);
            if (error.data) {
              console.error("Contract error data:", error.data);
            }
            resolve(paramPrompt());
          }
        });
      });
    });
  };
  
  const result = await paramPrompt();
  if (result === null) {
    // Get final parameters to display
    try {
      const finalParams = await contract.govParams();
      
      console.log("\nFinal Governance Parameters:");
      console.log("-".repeat(40));
      
      console.log(`${paramNames[PARAM_VOTING_DURATION]}: ${finalParams.votingDuration.toString()} seconds (${(Number(finalParams.votingDuration) / 3600).toFixed(2)} hours)`);
      console.log(`${paramNames[PARAM_QUORUM]}: ${ethers.formatUnits(finalParams.quorum, 18)} tokens`);
      console.log(`${paramNames[PARAM_TIMELOCK_DELAY]}: ${finalParams.timelockDelay.toString()} seconds (${(Number(finalParams.timelockDelay) / 60).toFixed(2)} minutes)`);
      console.log(`${paramNames[PARAM_PROPOSAL_THRESHOLD]}: ${ethers.formatUnits(finalParams.proposalCreationThreshold, 18)} tokens`);
      console.log(`${paramNames[PARAM_PROPOSAL_STAKE]}: ${ethers.formatUnits(finalParams.proposalStake, 18)} tokens`);
      console.log(`${paramNames[PARAM_DEFEATED_REFUND_PERCENTAGE]}: ${finalParams.defeatedRefundPercentage.toString()}%`);
      console.log(`${paramNames[PARAM_CANCELED_REFUND_PERCENTAGE]}: ${finalParams.canceledRefundPercentage.toString()}%`);
      console.log(`${paramNames[PARAM_EXPIRED_REFUND_PERCENTAGE]}: ${finalParams.expiredRefundPercentage.toString()}%`);
      
      console.log("\n✅ All governance parameter updates completed!");
    } catch (error) {
      console.error(`Error fetching final parameters: ${error.message}`);
    }
    
    rl.close();
    process.exit(0);
  }
}

// Print instructions and run if called directly
if (require.main === module) {
  console.log(`
`);

  // Run the script
  main().catch(e => {
    console.error(e);
    process.exit(1);
  });
}

// Export for importing in Hardhat
module.exports = { main };