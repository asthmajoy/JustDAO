/**
 * Script to withdraw (rescue) ETH from the JustTokenUpgradeable contract
 * 
 * Usage:
 *   npx hardhat run scripts/withdraw-eth.js --network sepolia
 */

const hre = require("hardhat");

async function main() {
  // Retrieve the deployer or owner account from Hardhat's runtime environment.
  // Make sure this is the account with ADMIN_ROLE in JustToken.
  const [owner] = await hre.ethers.getSigners();
  console.log("Using account:", owner.address);
  console.log("Account balance before withdrawal:", hre.ethers.formatEther(await hre.ethers.provider.getBalance(owner.address)), "ETH");

  // Get the JustTokenUpgradeable contract factory and attach to your deployed contract
  const JustToken = await hre.ethers.getContractFactory("contracts/JustTokenUpgradeable.sol:JustTokenUpgradeable");
  const justToken = JustToken.attach("0x98F92661d5899D8F3df620CaD87f6Cae735Fe8cF");

  // Verify the contract exists
  const code = await hre.ethers.provider.getCode(justToken.target);
  if (code === "0x" || code === "") {
    throw new Error("No contract deployed at the specified address");
  }

  // Check contract ETH balance
  const balance = await hre.ethers.provider.getBalance(justToken.target);
  console.log("JustToken contract balance:", hre.ethers.formatEther(balance), "ETH");

  if (balance === 0n) {
    console.log("No ETH to withdraw from the contract.");
    return;
  }

  // Check if caller has ADMIN_ROLE
  const ADMIN_ROLE = await justToken.ADMIN_ROLE();
  const hasAdminRole = await justToken.hasRole(ADMIN_ROLE, owner.address);
  
  if (!hasAdminRole) {
    console.error("Error: Your account does not have the ADMIN_ROLE required to call rescueETH()");
    console.log("Please use an account with ADMIN_ROLE or grant this role to your current account.");
    return;
  }

  console.log("Withdrawing (rescuing) ETH from the JustToken contract...");

  // Estimate gas for the transaction
  let gasEstimate;
  try {
    gasEstimate = await justToken.rescueETH.estimateGas();
    console.log("Estimated gas:", gasEstimate.toString());
  } catch (error) {
    console.log("Gas estimation failed:", error.message);
    console.log("Using default gas limit of 100,000");
    gasEstimate = 100000;
  }

  // Call the rescueETH function, which is restricted to ADMIN_ROLE
  const tx = await justToken.rescueETH({
    gasLimit: gasEstimate * BigInt(130) / BigInt(100) // Add 30% buffer
  });

  console.log("Transaction submitted:", tx.hash);
  console.log(`Etherscan link: https://${hre.network.name}.etherscan.io/tx/${tx.hash}`);

  // Wait for the transaction to be confirmed
  console.log("Waiting for transaction confirmation...");
  const receipt = await tx.wait(1);
  
  if (receipt.status === 1) {
    console.log("✅ Withdrawal successful!");
    
    // Check new balances
    const newOwnerBalance = await hre.ethers.provider.getBalance(owner.address);
    const newContractBalance = await hre.ethers.provider.getBalance(justToken.target);
    
    console.log("Account balance after withdrawal:", hre.ethers.formatEther(newOwnerBalance), "ETH");
    console.log("JustToken contract balance after withdrawal:", hre.ethers.formatEther(newContractBalance), "ETH");
    
    // Try to find ETHRescued event
    try {
      const rescuedEvent = receipt.logs.find(log => {
        try {
          const parsedLog = justToken.interface.parseLog(log);
          return parsedLog && parsedLog.name === "ETHRescued";
        } catch (e) {
          return false;
        }
      });
      
      if (rescuedEvent) {
        const parsedEvent = justToken.interface.parseLog(rescuedEvent);
        console.log(`ETH Rescued event: ${hre.ethers.formatEther(parsedEvent.args.amount)} ETH sent to ${parsedEvent.args.recipient}`);
      }
    } catch (e) {
      // Ignore errors in event parsing
    }
  } else {
    console.log("❌ Transaction failed");
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("Error withdrawing ETH:", error);
    process.exit(1);
  });