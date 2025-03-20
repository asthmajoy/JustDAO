const { ethers } = require("hardhat");
const { expect } = require("chai");

describe("JustToken Delegation Loop Detection Tests", function () {
  let justToken;
  let timelock;
  let admin, alice, bob, charlie, dave, eve, frank, grace, henry;
  let accounts;
  const initialMintAmount = ethers.parseEther("10000");
  
  // Min and max lock durations
  const MIN_LOCK_DURATION = 60 * 60 * 24; // 1 day
  const MAX_LOCK_DURATION = 60 * 60 * 24 * 90; // 90 days

  before(async function () {
    // Get signers
    accounts = await ethers.getSigners();
    [admin, alice, bob, charlie, dave, eve, frank, grace, henry] = accounts;

    // Deploy contracts
    const JustTimelockUpgradeable = await ethers.getContractFactory("contracts/JustTimelockUpgradeable.sol:JustTimelockUpgradeable");
    const JustTokenUpgradeable = await ethers.getContractFactory("contracts/JustTokenUpgradeable.sol:JustTokenUpgradeable");
    
    // Deploy proxy and implementation
    const JustTokenImplementation = await JustTokenUpgradeable.deploy();
    
    // Deploy timelock contract (needed for the token)
    timelock = await ethers.deployContract("contracts/JustTimelockUpgradeable.sol:JustTimelockUpgradeable");
    await timelock.initialize(
      3600, // 1 hour min delay
      [admin.address], // proposers
      [admin.address], // executors
      admin.address
    );
    
    // Deploy token through proxy pattern
    const JustTokenProxy = await ethers.deployContract("ERC1967Proxy", [
      JustTokenImplementation.target,
      JustTokenImplementation.interface.encodeFunctionData("initialize", [
        "JUST Token",
        "JUST",
        admin.address,
        MIN_LOCK_DURATION,
        MAX_LOCK_DURATION
      ])
    ]);
    
    // Get contract instance at proxy address
    justToken = JustTokenUpgradeable.attach(JustTokenProxy.target);
    
    // Set the timelock
    await justToken.connect(admin).setTimelock(timelock.target);
    
    // Mint initial tokens to accounts for testing
    for (let i = 0; i < 8; i++) {
      await justToken.connect(admin).mint(accounts[i].address, initialMintAmount);
    }
    
    console.log("Test setup complete with all accounts funded");
  });

  describe("Direct Delegation Loop Tests", function () {
    it("should detect and reject a direct A → B → A loop", async function () {
      // Alice delegates to Bob
      await justToken.connect(alice).delegate(bob.address);
      
      // Bob tries to delegate to Alice - should fail with DelegCycle error
      await expect(
        justToken.connect(bob).delegate(alice.address)
      ).to.be.revertedWithCustomError(justToken, "DC");
      
      // Reset by self-delegating
      await justToken.connect(bob).resetDelegation();
      await justToken.connect(alice).resetDelegation();
    });
    
    it("should allow different accounts to delegate to the same address (star pattern)", async function () {
      // Multiple users delegate to Alice
      await justToken.connect(bob).delegate(alice.address);
      await justToken.connect(charlie).delegate(alice.address);
      
      // This should be allowed
      expect(await justToken.getDelegate(bob.address)).to.equal(alice.address);
      expect(await justToken.getDelegate(charlie.address)).to.equal(alice.address);
      
      // Reset
      await justToken.connect(bob).resetDelegation();
      await justToken.connect(charlie).resetDelegation();
    });
    
    it("should always allow self-delegation", async function () {
      // Self-delegation should always be allowed
      await justToken.connect(alice).delegate(alice.address);
      expect(await justToken.getDelegate(alice.address)).to.equal(alice.address);
    });
  });
  
  describe("Longer Delegation Chain Loop Tests", function () {
    it("should detect and reject a longer A → B → C → A loop", async function () {
      // Alice delegates to Bob
      await justToken.connect(alice).delegate(bob.address);
      
      // Bob delegates to Charlie
      await justToken.connect(bob).delegate(charlie.address);
      
      // Charlie tries to delegate to Alice, creating a loop - should fail
      await expect(
        justToken.connect(charlie).delegate(alice.address)
      ).to.be.revertedWithCustomError(justToken, "DC");
      
      // Reset everyone
      await justToken.connect(alice).resetDelegation();
      await justToken.connect(bob).resetDelegation();
      await justToken.connect(charlie).resetDelegation();
    });
    
    it("should detect and reject a complex longer loop A → B → C → D → A", async function () {
      // Setup a longer delegation chain
      await justToken.connect(alice).delegate(bob.address);
      await justToken.connect(bob).delegate(charlie.address);
      await justToken.connect(charlie).delegate(dave.address);
      
      // Dave tries to delegate to Alice - should fail
      await expect(
        justToken.connect(dave).delegate(alice.address)
      ).to.be.revertedWithCustomError(justToken, "DC");
      
      // Reset everyone
      await justToken.connect(alice).resetDelegation();
      await justToken.connect(bob).resetDelegation();
      await justToken.connect(charlie).resetDelegation();
      await justToken.connect(dave).resetDelegation();
    });
    
    it("should handle delegation chains up to the maximum depth", async function () {
      // Create a deep but valid delegation chain
      await justToken.connect(alice).delegate(bob.address);
      await justToken.connect(bob).delegate(charlie.address);
      await justToken.connect(charlie).delegate(dave.address);
      await justToken.connect(dave).delegate(eve.address);
      await justToken.connect(eve).delegate(frank.address);
      await justToken.connect(frank).delegate(grace.address);
      
      // Add henry to complete a very long chain without a cycle
      await justToken.connect(grace).delegate(henry.address);
      
      // Verify the entire chain
      expect(await justToken.getDelegate(alice.address)).to.equal(bob.address);
      expect(await justToken.getDelegate(bob.address)).to.equal(charlie.address);
      expect(await justToken.getDelegate(charlie.address)).to.equal(dave.address);
      expect(await justToken.getDelegate(dave.address)).to.equal(eve.address);
      expect(await justToken.getDelegate(eve.address)).to.equal(frank.address);
      expect(await justToken.getDelegate(frank.address)).to.equal(grace.address);
      expect(await justToken.getDelegate(grace.address)).to.equal(henry.address);
      
      // Henry tries to delegate to Alice - would create a loop
      await expect(
        justToken.connect(henry).delegate(alice.address)
      ).to.be.revertedWithCustomError(justToken, "DC");
      
      // Reset all accounts
      for (const account of [alice, bob, charlie, dave, eve, frank, grace, henry]) {
        await justToken.connect(account).resetDelegation();
      }
    });
  });
  
  describe("Complex Multi-Path Delegation Loop Tests", function () {
    it("should detect a cycle with multiple delegators of the same account", async function () {
      // Setup a more direct cycle with multiple delegators
      
      // Alice delegates to Bob
      await justToken.connect(alice).delegate(bob.address);
      
      // Dave delegates to Bob (Bob now has two delegators)
      await justToken.connect(dave).delegate(bob.address);
      
      // Bob delegates to Charlie
      await justToken.connect(bob).delegate(charlie.address);
      
      // Charlie tries to delegate to Alice (who already delegated to Bob)
      // This creates the cycle: charlie -> alice -> bob -> charlie
      await expect(
        justToken.connect(charlie).delegate(alice.address)
      ).to.be.revertedWithCustomError(justToken, "DC");
      
      // Reset
      await justToken.connect(alice).resetDelegation();
      await justToken.connect(bob).resetDelegation();
      await justToken.connect(charlie).resetDelegation();
      await justToken.connect(dave).resetDelegation();
    });
    
    it("should prevent cycles through delegator relationships", async function () {
      // Alice delegates to Bob
      await justToken.connect(alice).delegate(bob.address);
      
      // Charlie delegates to Bob - now Bob has two delegators
      await justToken.connect(charlie).delegate(bob.address);
      
      // Dave delegates to Charlie
      await justToken.connect(dave).delegate(charlie.address);
      
      // Now Bob tries to delegate to Dave
      // This would create: bob -> dave -> charlie -> bob (cycle)
      await expect(
        justToken.connect(bob).delegate(dave.address)
      ).to.be.revertedWithCustomError(justToken, "DC");
      
      // Reset everyone
      await justToken.connect(alice).resetDelegation();
      await justToken.connect(bob).resetDelegation();
      await justToken.connect(charlie).resetDelegation();
      await justToken.connect(dave).resetDelegation();
    });
    
    it("should handle complex chains with multiple legs properly", async function () {
      // Setup a complex but valid delegation structure
      // Alice and Bob both delegate to Charlie
      await justToken.connect(alice).delegate(charlie.address);
      await justToken.connect(bob).delegate(charlie.address);
      
      // Dave delegates to Eve
      await justToken.connect(dave).delegate(eve.address);
      
      // Charlie delegates to Frank
      await justToken.connect(charlie).delegate(frank.address);
      
      // Frank delegates to Grace
      await justToken.connect(frank).delegate(grace.address);
      
      // Valid: Eve delegates to Grace
      await justToken.connect(eve).delegate(grace.address);
      
      // Invalid: Grace tries to delegate to Alice - creates a cycle
      await expect(
        justToken.connect(grace).delegate(alice.address)
      ).to.be.revertedWithCustomError(justToken, "DC");
      
      // Invalid: Grace tries to delegate to Bob - also creates a cycle
      await expect(
        justToken.connect(grace).delegate(bob.address)
      ).to.be.revertedWithCustomError(justToken, "DC");
      
      // Valid: Grace delegates to Henry (no cycle)
      await justToken.connect(grace).delegate(henry.address);
      
      // Reset all accounts
      for (const account of [alice, bob, charlie, dave, eve, frank, grace, henry]) {
        await justToken.connect(account).resetDelegation();
      }
    });
  });
  
  describe("Edge Cases in Delegation Loop Detection", function () {
    it("should handle redelegate to previous delegatee", async function () {
      // Alice delegates to Bob
      await justToken.connect(alice).delegate(bob.address);
      
      // Alice changes to delegate to Charlie
      await justToken.connect(alice).delegate(charlie.address);
      
      // Alice should be able to go back to delegating to Bob
      await justToken.connect(alice).delegate(bob.address);
      expect(await justToken.getDelegate(alice.address)).to.equal(bob.address);
      
      await justToken.connect(alice).resetDelegation();
      await justToken.connect(bob).resetDelegation();
      await justToken.connect(charlie).resetDelegation();
    });
    
    it("should handle attempting to create a cycle after removing delegation", async function () {
      // Setup: Alice delegates to Bob, Bob delegates to Charlie
      await justToken.connect(alice).delegate(bob.address);
      await justToken.connect(bob).delegate(charlie.address);
      
      // This would create a cycle: Charlie -> Alice
      await expect(
        justToken.connect(charlie).delegate(alice.address)
      ).to.be.revertedWithCustomError(justToken, "DC");
      
      // Bob removes delegation
      await justToken.connect(bob).resetDelegation();
      
      // Now Charlie should be able to delegate to Alice (no longer a cycle)
      await justToken.connect(charlie).delegate(alice.address);
      expect(await justToken.getDelegate(charlie.address)).to.equal(alice.address);
      
      // Reset
      await justToken.connect(alice).resetDelegation();
      await justToken.connect(charlie).resetDelegation();
    });
    
    it("should handle chain reorganization attempts", async function () {
      // Create a simple chain A -> B -> C
      await justToken.connect(alice).delegate(bob.address);
      await justToken.connect(bob).delegate(charlie.address);
      
      // Dave delegates to Eve
      await justToken.connect(dave).delegate(eve.address);
      
      // Eve tries to delegate to Alice (valid)
      await justToken.connect(eve).delegate(alice.address);
      
      // Now Dave tries to delegate to Charlie, which would create a loop
      // dave -> eve -> alice -> bob -> charlie -> dave
      await expect(
        justToken.connect(charlie).delegate(dave.address)
      ).to.be.revertedWithCustomError(justToken, "DC");
      
      // Reset
      await justToken.connect(alice).resetDelegation();
      await justToken.connect(bob).resetDelegation();
      await justToken.connect(charlie).resetDelegation();
      await justToken.connect(dave).resetDelegation();
      await justToken.connect(eve).resetDelegation();
    });
    describe("Maximum Delegation Depth Test", function () {
      it("should throw a 'DDL()' error when exceeding maximum delegation depth", async function() {
          // Define our maximum delegation depth constant (same as in the contract)
          const MAX_DELEGATION_DEPTH = 8;
          
          // We need MAX_DELEGATION_DEPTH + 2 accounts to test properly
          const neededAccounts = MAX_DELEGATION_DEPTH + 2;
          let testAccounts = [...accounts];
          
          // Create more accounts if needed
          if (testAccounts.length < neededAccounts) {
              console.log(`Creating ${neededAccounts - testAccounts.length} additional accounts...`);
              for (let i = testAccounts.length; i < neededAccounts; i++) {
                  const wallet = ethers.Wallet.createRandom().connect(ethers.provider);
                  // Fund the wallet so it can perform transactions
                  await admin.sendTransaction({
                      to: wallet.address,
                      value: ethers.parseEther("0.1")
                  });
                  // Mint tokens to the new account
                  await justToken.connect(admin).mint(wallet.address, initialMintAmount);
                  testAccounts.push(wallet);
              }
          }
          
          console.log(`Testing with ${testAccounts.length} accounts`);
          
          // Reset all existing delegations to start clean
          for (let i = 0; i < testAccounts.length; i++) {
              await justToken.connect(testAccounts[i]).resetDelegation();
          }
          
          // Create a delegation chain: account[0] -> account[1] -> ... -> account[MAX_DEPTH-1]
          console.log("Creating delegation chain...");
          for (let i = 0; i < MAX_DELEGATION_DEPTH; i++) {
              await justToken.connect(testAccounts[i]).delegate(testAccounts[i+1].address);
              console.log(`Account ${i} delegated to Account ${i+1}`);
          }
          
          // Verify the last valid delegation
          expect(await justToken.getDelegate(testAccounts[MAX_DELEGATION_DEPTH-1].address))
              .to.equal(testAccounts[MAX_DELEGATION_DEPTH].address);
  
          console.log(`Account ${MAX_DELEGATION_DEPTH} attempting to delegate to Account ${MAX_DELEGATION_DEPTH+1}...`);
  
          // Expect the next delegation to fail with the exact custom error `DDL()`
          await expect(
              justToken.connect(testAccounts[MAX_DELEGATION_DEPTH]).delegate(testAccounts[MAX_DELEGATION_DEPTH+1].address)
          ).to.be.revertedWithCustomError(justToken, "DDL()");
  
          console.log("Delegation correctly failed with 'DDL()' error beyond max depth");
  
          // Reset all delegations for cleanup
          for (let i = 0; i < testAccounts.length; i++) {
              await justToken.connect(testAccounts[i]).resetDelegation();
          }
      });
  });
  });
});
