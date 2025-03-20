// SPDX-License-Identifier: MIT
// JustTimelockUpgradeable.sol - Modified for proxy compatibility with threat level delays

pragma solidity 0.8.20;

import "@openzeppelin/contracts-upgradeable/access/AccessControlEnumerableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/security/PausableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/security/ReentrancyGuardUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/AddressUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";

/**
 * @title JustTokenInterface
 * @notice Minimal interface needed to check token balances
 */
interface JustTokenInterface {
    function balanceOf(address account) external view returns (uint256);
}

/**
 * @title JustTimelockUpgradeable
 * @notice Complete timelock contract for the JustGovernance system, modified for proxy compatibility
 * @dev Implements a delay mechanism with variable timeouts based on threat levels
 */
contract JustTimelockUpgradeable is 
    Initializable, 
    AccessControlEnumerableUpgradeable, 
    PausableUpgradeable, 
    ReentrancyGuardUpgradeable,
    UUPSUpgradeable
{
    using AddressUpgradeable for address;
    
    // ==================== CUSTOM ERRORS ====================
    error ZeroAddress(string param);
    error ZeroDelay();
    error DelayTooShort(uint256 provided, uint256 minimum);
    error DelayTooLong(uint256 provided, uint256 maximum);
    error TxNotQueued(bytes32 txHash);
    error TxAlreadyQueued(bytes32 txHash);
    error TxAlreadyExecuted(bytes32 txHash);
    error TxNotReady(bytes32 txHash, uint256 eta, uint256 currentTime);
    error TxExpired(bytes32 txHash, uint256 eta, uint256 gracePeriod, uint256 currentTime);
    error CallFailed(address target, bytes data);
    error NotAuthorized(address caller, bytes32 role);
    error InvalidParams();
    error NoTokenHolding(address caller);
    error AlreadyCanceled(bytes32 txHash);
    error DelayHierarchyViolation();
    error TransactionNotExpired(bytes32 txHash, uint256 eta, uint256 gracePeriod, uint256 currentTime);
    error TransactionNotPreviouslyFailed(bytes32 txHash);

    // ==================== CONSTANTS ====================
    // Role-based access control
    bytes32 public constant ADMIN_ROLE = keccak256("ADMIN_ROLE");
    bytes32 public constant PROPOSER_ROLE = keccak256("PROPOSER_ROLE");
    bytes32 public constant EXECUTOR_ROLE = keccak256("EXECUTOR_ROLE");
    bytes32 public constant CANCELLER_ROLE = keccak256("CANCELLER_ROLE");
    bytes32 public constant GUARDIAN_ROLE = keccak256("GUARDIAN_ROLE");
    bytes32 public constant GOVERNANCE_ROLE = keccak256("GOVERNANCE_ROLE");
    bytes32 public constant MINTER_ROLE = keccak256("MINTER_ROLE");
    bytes32 public constant TIMELOCK_ADMIN_ROLE = keccak256("TIMELOCK_ADMIN_ROLE");

    // ==================== ENUMS ====================
    // Threat level enum for categorizing proposal risk
    enum ThreatLevel { LOW, MEDIUM, HIGH, CRITICAL }
    
    // ==================== STORAGE VARIABLES ====================
    // Timelock parameters
    uint256 public minDelay;
    uint256 public maxDelay;
    uint256 public gracePeriod;
    
    uint256 public minExecutorTokenThreshold;

    // Threat level specific delays
    uint256 public lowThreatDelay;
    uint256 public mediumThreatDelay;
    uint256 public highThreatDelay;
    uint256 public criticalThreatDelay;
    
    // Mappings for threat level assignments
    mapping(bytes4 => ThreatLevel) public functionThreatLevels;
    mapping(address => ThreatLevel) public addressThreatLevels;
    
    // Reference to the JustToken contract
    JustTokenInterface public justToken;
    
    // Transaction storage structure
    struct TimelockTransaction {
        address target;
        uint256 value;
        bytes data;
        uint256 eta;
        bool executed;
        bool canceled;
    }

    // Mapping for timelock transactions
    mapping(bytes32 => TimelockTransaction) private _timelockTransactions;
    mapping(bytes32 => bool) public queuedTransactions;

    // Mapping to track failed transactions
    mapping(bytes32 => bool) private _failedTransactions;

    // ==================== EVENTS ====================
    event TransactionQueued(bytes32 indexed txHash, address indexed target, uint256 value, bytes data, uint256 eta, ThreatLevel threatLevel);
    event TransactionExecuted(bytes32 indexed txHash, address indexed target, uint256 value, bytes data);
    event TransactionCanceled(bytes32 indexed txHash);
    event DelaysUpdated(uint256 newMinDelay, uint256 newMaxDelay, uint256 newGracePeriod);
    event GovernanceRoleTransferred(address indexed oldGovernance, address indexed newGovernance);
    event GovernanceRoleChanged(address indexed account, bool isGranted);
    event JustTokenSet(address indexed tokenAddress);
    event ThreatLevelDelaysUpdated(uint256 lowDelay, uint256 mediumDelay, uint256 highDelay, uint256 criticalDelay);
    event FunctionThreatLevelSet(bytes4 indexed selector, ThreatLevel level);
    event AddressThreatLevelSet(address indexed target, ThreatLevel level);
    event RoleGranted(bytes32 indexed role, address indexed account);
    event RoleRevoked(bytes32 indexed role, address indexed account);
    event ContractPaused(address indexed guardian);
    event ContractUnpaused(address indexed guardian);
    event ContractInitialized(address indexed admin, uint256 minDelay);
    event TransactionExecutionFailed(bytes32 indexed txHash, address indexed target, string reason);
    event TransactionSubmitted(bytes32 indexed txHash, address indexed proposer);
    event ExecutorThresholdUpdated(uint256 newThreshold);
    event ExpiredTransactionExecuted(bytes32 indexed txHash, address indexed target, uint256 value, bytes data);
    event FailedTransactionRetried(bytes32 indexed txHash, address indexed target, uint256 value, bytes data);


    // ==================== INITIALIZATION ====================
    /**
     * @notice Initializes the JustTimelockUpgradeable contract
     * @param initialMinDelay Minimum delay for all transactions
     * @param proposers Array of addresses that can queue transactions
     * @param executors Array of addresses that can execute transactions
     * @param admin Initial admin address
     */
    function initialize(
        uint256 initialMinDelay,
        address[] memory proposers,
        address[] memory executors,
        address admin
    ) public initializer {
        if (initialMinDelay == 0) revert ZeroDelay();
        if (admin == address(0)) revert ZeroAddress("admin");
        
        __AccessControlEnumerable_init();
        __Pausable_init();
        __ReentrancyGuard_init();
        __UUPSUpgradeable_init();
        
        // Set up base timelock parameters
        minDelay = initialMinDelay;
        maxDelay = 2592000;       // 30 days in seconds
        gracePeriod = 14 days;    // Default grace period
        
        // Set up default threat level delays
        lowThreatDelay = 1 days;        // 1 day for low threat
        mediumThreatDelay = 3 days;     // 3 days for medium threat
        highThreatDelay = 7 days;       // 7 days for high threat
        criticalThreatDelay = 14 days;  // 14 days for critical threat
        minExecutorTokenThreshold = 10**16; // Initially set to .01

        // Set up default threat levels for common operations
        
        // LOW THREAT - Basic operations
        functionThreatLevels[bytes4(keccak256("transfer(address,uint256)"))] = ThreatLevel.LOW;
        functionThreatLevels[bytes4(keccak256("approve(address,uint256)"))] = ThreatLevel.LOW;
        
        // MEDIUM THREAT - Parameter changes
        functionThreatLevels[bytes4(keccak256("updateDelays(uint256,uint256,uint256)"))] = ThreatLevel.MEDIUM;
        functionThreatLevels[bytes4(keccak256("updateThreatLevelDelays(uint256,uint256,uint256,uint256)"))] = ThreatLevel.MEDIUM;
        functionThreatLevels[bytes4(keccak256("updateGovParam(uint8,uint256)"))] = ThreatLevel.MEDIUM;
        
        // HIGH THREAT - Role changes and upgradeability
        functionThreatLevels[bytes4(keccak256("grantContractRole(bytes32,address)"))] = ThreatLevel.HIGH;
        functionThreatLevels[bytes4(keccak256("revokeContractRole(bytes32,address)"))] = ThreatLevel.HIGH;
        
        // CRITICAL THREAT - Core system changes
        functionThreatLevels[bytes4(keccak256("upgradeTo(address)"))] = ThreatLevel.CRITICAL;
        functionThreatLevels[bytes4(keccak256("upgradeToAndCall(address,bytes)"))] = ThreatLevel.CRITICAL;
        
        // Token operations threat levels based on impact
        functionThreatLevels[bytes4(keccak256("governanceMint(address,uint256)"))] = ThreatLevel.HIGH;
        functionThreatLevels[bytes4(keccak256("governanceBurn(address,uint256)"))] = ThreatLevel.HIGH;
        
        _setupRole(DEFAULT_ADMIN_ROLE, admin);
        _setupRole(ADMIN_ROLE, admin);
        _setupRole(TIMELOCK_ADMIN_ROLE, admin);
        
        // Setup proposers
        for (uint256 i = 0; i < proposers.length; i++) {
            if (proposers[i] != address(0)) {
                _setupRole(PROPOSER_ROLE, proposers[i]);
            }
        }
        
        // Setup executors
        for (uint256 i = 0; i < executors.length; i++) {
            if (executors[i] != address(0)) {
                _setupRole(EXECUTOR_ROLE, executors[i]);
            }
        }
        
        _setupRole(CANCELLER_ROLE, admin);
        _setupRole(GUARDIAN_ROLE, admin);
        _setupRole(GOVERNANCE_ROLE, admin);
        
        emit ContractInitialized(admin, initialMinDelay);
    }
    
    /**
     * @notice Function that authorizes an upgrade to a new implementation
     * @dev Can only be called by an account with ADMIN_ROLE
     * @param newImplementation Address of the new implementation
     */
    function _authorizeUpgrade(address newImplementation) internal override onlyRole(ADMIN_ROLE) {
        // Authorization is handled by the onlyRole modifier
    }

    // ==================== ADMIN FUNCTIONS ====================
    /**
     * @notice Set the JustToken contract address
     * @param tokenAddress The address of the JustToken contract
     */
    function setJustToken(address tokenAddress) external onlyRole(ADMIN_ROLE) {
        if (tokenAddress == address(0)) revert ZeroAddress("tokenAddress");
        justToken = JustTokenInterface(tokenAddress);
        emit JustTokenSet(tokenAddress);
    }


    function executeExpiredTransaction(bytes32 txHash) 
    external 
    whenNotPaused
    nonReentrant
    returns (bytes memory returnData) 
{
    if (!queuedTransactions[txHash]) revert TxNotQueued(txHash);
    
    TimelockTransaction storage transaction = _timelockTransactions[txHash];
    
    if (transaction.executed) revert TxAlreadyExecuted(txHash);
    if (transaction.canceled) revert AlreadyCanceled(txHash);
    
    // Check that the transaction is expired (past the grace period)
    if (block.timestamp <= transaction.eta + gracePeriod) 
        revert TransactionNotExpired(txHash, transaction.eta, gracePeriod, block.timestamp);
    
    // Only ADMIN_ROLE or GOVERNANCE_ROLE can execute expired transactions
    if (!hasRole(ADMIN_ROLE, msg.sender) && !hasRole(GOVERNANCE_ROLE, msg.sender)) 
        revert NotAuthorized(msg.sender, bytes32(0));
    
    // Save values to local variables before updating state
    address target = transaction.target;
    uint256 value = transaction.value;
    bytes memory data = transaction.data;
    
    // Update state before external interaction
    transaction.executed = true;
    
    emit ExpiredTransactionExecuted(txHash, target, value, data);
    
    // Execute the transaction only after all state changes
    bool success;
    (success, returnData) = target.call{value: value}(data);
    
    if (!success) {
        // Mark as failed but don't revert
        _failedTransactions[txHash] = true;
        emit TransactionExecutionFailed(txHash, target, string(returnData));
    }
    
    return returnData;
}

    /**
    * @notice Update the minimum token threshold required for execution
    * @param newThreshold New minimum token amount required
    */
    function updateExecutorTokenThreshold(uint256 newThreshold) external {
        // Allow either ADMIN_ROLE or GOVERNANCE_ROLE to update this parameter
        if (!hasRole(ADMIN_ROLE, msg.sender) && 
            !hasRole(GOVERNANCE_ROLE, msg.sender) && 
            msg.sender != address(this)) {
            revert NotAuthorized(msg.sender, bytes32(0));
        }
        
        minExecutorTokenThreshold = newThreshold;
        emit ExecutorThresholdUpdated(minExecutorTokenThreshold);
    }

    /**
     * @notice Revokes a role from an account with safety checks
     * @dev Only callable by admin
     * @param role The role to revoke
     * @param account The account to revoke the role from
     */
    function revokeContractRole(bytes32 role, address account) external onlyRole(ADMIN_ROLE) {
        if (account == address(0)) revert ZeroAddress("account");
        
        // Prevent removing the last admin to avoid locking the contract
        if (role == ADMIN_ROLE) {
            if (!(getRoleMemberCount(ADMIN_ROLE) > 1 || account != msg.sender)) 
                revert NotAuthorized(msg.sender, role);
        }
        
        // Prevent removing critical role assignments
        if (role == GOVERNANCE_ROLE) {
            // Ensure governance role is being transferred, not just removed
            if (getRoleMemberCount(GOVERNANCE_ROLE) <= 1) 
                revert NotAuthorized(msg.sender, role);
            
            // Find the remaining governance address to record in the event
            address newGovernance;
            for (uint256 i = 0; i < getRoleMemberCount(GOVERNANCE_ROLE); i++) {
                address member = getRoleMember(GOVERNANCE_ROLE, i);
                if (member != account) {
                    newGovernance = member;
                    break;
                }
            }
            
            emit GovernanceRoleTransferred(account, newGovernance);
        }
        
        // Additional protection for essential roles
        if (role == PROPOSER_ROLE || role == EXECUTOR_ROLE) {
            if (getRoleMemberCount(role) <= 1)
                revert NotAuthorized(msg.sender, role);
        }
        
        // Revoke the role
        revokeRole(role, account);
        emit RoleRevoked(role, account);
    }

    /**
     * @notice Grants a role to an account
     * @dev Only callable by admin
     * @param role The role to grant
     * @param account The account to grant the role to
     */
    function grantContractRole(bytes32 role, address account) external onlyRole(ADMIN_ROLE) {
        if (account == address(0)) revert ZeroAddress("account");
        
        // Grant the role
        grantRole(role, account);
        emit RoleGranted(role, account);
        
        // If granting governance role, emit event for transparency
        if (role == GOVERNANCE_ROLE) {
            emit GovernanceRoleChanged(account, true);
        }
    }

    // ==================== TRANSACTION QUEUE/EXECUTION FUNCTIONS ====================
    /**
     * @notice Determines the threat level of a transaction based on target and function selector
     * @param target Target address
     * @param data Call data
     * @return The appropriate threat level
     */
    function getThreatLevel(address target, bytes memory data) public view returns (ThreatLevel) {
        // First check if the target address has a specific threat level
        ThreatLevel addressLevel = addressThreatLevels[target];
        if (addressLevel != ThreatLevel.LOW) {
            return addressLevel;
        }
        
        // Then check if the function selector has a specific threat level
        if (data.length >= 4) {
            // Extract the function selector (first 4 bytes)
            bytes4 selector;
            assembly {
                // Load the first 32 bytes of data, then mask to get only first 4 bytes
                selector := and(mload(add(data, 32)), 0xFFFFFFFF00000000000000000000000000000000000000000000000000000000)
            }
            
            ThreatLevel functionLevel = functionThreatLevels[selector];
            if (functionLevel != ThreatLevel.LOW) {
                return functionLevel;
            }
        }
        
        // Default to LOW if no specific level is set
        return ThreatLevel.LOW;
    }
    
    /**
     * @notice Gets the delay for a specific threat level
     * @param level The threat level
     * @return The delay in seconds
     */
    function getDelayForThreatLevel(ThreatLevel level) public view returns (uint256) {
        if (level == ThreatLevel.CRITICAL) {
            return criticalThreatDelay;
        } else if (level == ThreatLevel.HIGH) {
            return highThreatDelay;
        } else if (level == ThreatLevel.MEDIUM) {
            return mediumThreatDelay;
        } else {
            return lowThreatDelay;
        }
    }

    /**
     * @notice Check if a user is authorized based on token holdings
     * @param user The address to check for authorization
     * @return True if authorized by token holdings, false otherwise
     */
    function isAuthorizedByTokens(address user) public view returns (bool) {
    // First check if the token contract is set
    if (address(justToken) == address(0)) {
        return false;
    }
    
    // Then safely check the balance
    try justToken.balanceOf(user) returns (uint256 balance) {
        return balance >= minExecutorTokenThreshold;
    } catch {
        // If the call fails, return false
        return false;
    }
}

    /**
     * @notice Queue a transaction using the appropriate threat level delay
     * @param target Target address
     * @param value ETH value
     * @param data Call data
     * @return txHash The hash of the transaction
     */
     
function queueTransactionWithThreatLevel(
    address target,
    uint256 value,
    bytes memory data
) public whenNotPaused returns (bytes32) {
    // Check if user is authorized either by token holdings OR by having the PROPOSER_ROLE
    bool isAuthorizedByTokens = this.isAuthorizedByTokens(msg.sender);
    bool isAuthorizedByRole = hasRole(PROPOSER_ROLE, msg.sender);
    
    // User must have either sufficient tokens OR the PROPOSER_ROLE
    if (!isAuthorizedByTokens && !isAuthorizedByRole) {
        // For debugging - uncomment these lines:
        // revert("Not authorized. Token auth: " + 
        //      (isAuthorizedByTokens ? "true" : "false") + 
        //      ", Role auth: " + 
        //      (isAuthorizedByRole ? "true" : "false"));
        revert NotAuthorized(msg.sender, PROPOSER_ROLE);
    }
    
    ThreatLevel level = getThreatLevel(target, data);
    uint256 delay = getDelayForThreatLevel(level);
    return _queueTransaction(target, value, data, delay, level);
}


    /**
     * @notice Queue a transaction with a custom delay
     * @param target Target address
     * @param value ETH value
     * @param data Call data
     * @param delay Execution delay
     * @return txHash The hash of the transaction
     */
    function queueTransaction(
        address target,
        uint256 value,
        bytes memory data,
        uint256 delay
    ) public whenNotPaused returns (bytes32) {
        if (target == address(0)) revert ZeroAddress("target");
        if (delay < minDelay) revert DelayTooShort(delay, minDelay);
        if (delay > maxDelay) revert DelayTooLong(delay, maxDelay);
        
        // Custom delay can only be set by users with PROPOSER_ROLE
        // Token holders without this role cannot use custom delays
        if (!hasRole(PROPOSER_ROLE, msg.sender))
            revert NotAuthorized(msg.sender, PROPOSER_ROLE);
        
        // Determine threat level but use the custom delay
        ThreatLevel level = getThreatLevel(target, data);
        return _queueTransaction(target, value, data, delay, level);
    }
    
    /**
     * @notice Internal function to queue a transaction
     * @param target Target address
     * @param value ETH value
     * @param data Call data
     * @param delay Execution delay
     * @param level Threat level
     * @return txHash The hash of the transaction
     */
    function _queueTransaction(
        address target,
        uint256 value,
        bytes memory data,
        uint256 delay,
        ThreatLevel level
    ) internal returns (bytes32) {
        if (target == address(0)) revert ZeroAddress("target");
        if (delay < minDelay) revert DelayTooShort(delay, minDelay);
        if (delay > maxDelay) revert DelayTooLong(delay, maxDelay);
        
        bytes32 txHash = keccak256(abi.encode(target, value, data, block.timestamp + delay));
        uint256 eta = block.timestamp + delay;
        
        if (queuedTransactions[txHash]) revert TxAlreadyQueued(txHash);
        
        _timelockTransactions[txHash] = TimelockTransaction({
            target: target,
            value: value,
            data: data,
            eta: eta,
            executed: false,
            canceled: false
        });
        
        queuedTransactions[txHash] = true;
        
        emit TransactionQueued(txHash, target, value, data, eta, level);
        emit TransactionSubmitted(txHash, msg.sender);
        
        return txHash;
    }

     /**
     * @notice Execute a queued transaction after the delay has passed
     * @dev This reverts if the transaction fails - needed for governance refund mechanism
     * @param txHash The hash of the transaction to execute
     * @return returnData Data returned from the executed transaction
     */
     function executeTransaction(bytes32 txHash) 
        external 
        whenNotPaused
        nonReentrant
        returns (bytes memory returnData) 
    {
        
        if (!queuedTransactions[txHash]) revert TxNotQueued(txHash);
        
        TimelockTransaction storage transaction = _timelockTransactions[txHash];
        
        if (transaction.executed) revert TxAlreadyExecuted(txHash);
        if (transaction.canceled) revert AlreadyCanceled(txHash);
        if (block.timestamp < transaction.eta) revert TxNotReady(txHash, transaction.eta, block.timestamp);
        if (block.timestamp > transaction.eta + gracePeriod) 
            revert TxExpired(txHash, transaction.eta, gracePeriod, block.timestamp);
        
        // Check if user holds JST tokens first
        // This allows a token holder to execute transactions
        bool isAuthorized = isAuthorizedByTokens(msg.sender);

        // If not holding tokens, fall back to role check
        if (!isAuthorized) {
            if (!hasRole(EXECUTOR_ROLE, msg.sender))
                revert NotAuthorized(msg.sender, EXECUTOR_ROLE);
        }
        
        // Save values to local variables before updating state
        address target = transaction.target;
        uint256 value = transaction.value;
        bytes memory data = transaction.data;
        
        // Update state before external interaction
        transaction.executed = true;
        
        emit TransactionExecuted(txHash, target, value, data);
        
        // Execute the transaction after state changes - IMPORTANT: Revert on failure for proper token refunds
        bool success;
        (success, returnData) = target.call{value: value}(data);
        
        if (!success) {
            // Mark as failed before reverting - this state will be rolled back but is needed for executeAndMarkFailed
            _markTransactionAsFailed(txHash);
            emit TransactionExecutionFailed(txHash, target, string(returnData));
            
            // We need to revert here to ensure the governance contract's stake refund works properly
            revert CallFailed(target, data);
        }
        
        return returnData;
    }
    
    /**
     * @notice Explicitly mark a transaction as failed without executing it
     * @dev This is useful for marking transactions that have been executed and failed,
     *      since the executeTransaction function reverts on failure and doesn't update state
     * @param txHash The hash of the transaction to mark as failed
     */
    function markTransactionAsFailed(bytes32 txHash) external {
        // Only allow admin or governance roles
        if (!hasRole(ADMIN_ROLE, msg.sender) && !hasRole(GOVERNANCE_ROLE, msg.sender)) 
            revert NotAuthorized(msg.sender, bytes32(0));
        
        // Verify the transaction exists and is executed but not canceled
        if (!queuedTransactions[txHash]) revert TxNotQueued(txHash);
        
        TimelockTransaction storage transaction = _timelockTransactions[txHash];
        if (!transaction.executed) revert("Transaction not executed yet");
        if (transaction.canceled) revert AlreadyCanceled(txHash);
        
        // Mark as failed using the internal function
        _markTransactionAsFailed(txHash);
        
        emit TransactionExecutionFailed(
            txHash, 
            transaction.target, 
            "Manually marked as failed"
        );
    }
    
/**
 * @notice Execute a transaction that previously failed in the timelock
 * @param txHash The hash of the transaction to execute
 * @return returnData The data returned from the transaction execution
 */
function executeFailedTransaction(bytes32 txHash) 
    external 
    whenNotPaused
    nonReentrant
    returns (bytes memory returnData) 
{
    // Ensure the transaction exists in the timelock
    if (!queuedTransactions[txHash]) revert TxNotQueued(txHash);
    
    TimelockTransaction storage transaction = _timelockTransactions[txHash];
    
    // Check that the transaction has been executed
    if (!transaction.executed) revert TransactionNotPreviouslyFailed(txHash);
    if (transaction.canceled) revert AlreadyCanceled(txHash);
    
    // Verify the transaction was previously attempted and failed
    if (!_failedTransactions[txHash]) {
        revert TransactionNotPreviouslyFailed(txHash);
    }
    
    // Check time constraints
    if (block.timestamp > transaction.eta + gracePeriod) 
        revert TxExpired(txHash, transaction.eta, gracePeriod, block.timestamp);
    
    // Verify authorization
    bool isAuthorized = (
        hasRole(ADMIN_ROLE, msg.sender) || 
        hasRole(GOVERNANCE_ROLE, msg.sender)
    );
    if (!isAuthorized) {
        revert NotAuthorized(msg.sender, bytes32(0));
    }
    
    // Save transaction details
    address target = transaction.target;
    uint256 value = transaction.value;
    bytes memory data = transaction.data;
    
    // Clear the failed status BEFORE execution
    _failedTransactions[txHash] = false;
    
    // Emit event for the retry
    emit FailedTransactionRetried(txHash, target, value, data);
    
    // Execute the transaction
    bool success;
    (success, returnData) = target.call{value: value}(data);
    
    if (!success) {
        // If it fails again, mark as failed using the internal function
        _markTransactionAsFailed(txHash);
        emit TransactionExecutionFailed(txHash, target, string(returnData));
        revert CallFailed(target, data);
    } else {
        // Success case is already handled (failed flag already cleared)
        emit TransactionExecuted(txHash, target, value, data);
    }
    
    return returnData;
}

    /**
     * @notice Internal function to check if a transaction was previously failed
     * @param txHash The hash of the transaction to check
     * @return Whether the transaction was previously failed
     */
    function _wasTransactionPreviouslyFailed(bytes32 txHash) internal view returns (bool) {
        return _failedTransactions[txHash];
    }
    
    /**
     * @notice Public function to check if a transaction was previously failed
     * @param txHash The hash of the transaction to check
     * @return Whether the transaction was previously failed
     */
    function wasTransactionFailed(bytes32 txHash) external view returns (bool) {
        return _failedTransactions[txHash];
    }

    /**
     * @notice Internal function to mark a transaction as failed
     * @dev This can be called to mark a transaction as failed without executing it
     * @param txHash The hash of the failed transaction
     */
    function _markTransactionAsFailed(bytes32 txHash) internal {
        _failedTransactions[txHash] = true;
    }

    /**
     * @notice Cancel a queued transaction
     * @param txHash The hash of the transaction to cancel
     */
    function cancelTransaction(bytes32 txHash) 
    external 
    whenNotPaused 
{
    if (!queuedTransactions[txHash]) revert TxNotQueued(txHash);
    
    TimelockTransaction storage transaction = _timelockTransactions[txHash];
    
    if (transaction.executed) revert TxAlreadyExecuted(txHash);
    if (transaction.canceled) revert AlreadyCanceled(txHash);
    
    // Check for role-based authorization only (no token authorization)
    if (!hasRole(GUARDIAN_ROLE, msg.sender) && 
        !hasRole(CANCELLER_ROLE, msg.sender) &&
        !hasRole(PROPOSER_ROLE, msg.sender)) {
        revert NotAuthorized(msg.sender, bytes32(0));
    }
    
    transaction.canceled = true;
    queuedTransactions[txHash] = false;
    
    emit TransactionCanceled(txHash);
}
    /**
     * @notice Get the details of a queued transaction
     * @param txHash The hash of the transaction
     * @return target The target address
     * @return value The ETH value
     * @return data The call data
     * @return eta The time after which the transaction can be executed
     * @return executed Whether the transaction has been executed
     */
    function getTransaction(bytes32 txHash) 
        external 
        view 
        returns (
            address target,
            uint256 value,
            bytes memory data,
            uint256 eta,
            bool executed
        ) 
    {
        TimelockTransaction storage txn = _timelockTransactions[txHash];
        return (
            txn.target, 
            txn.value, 
            txn.data, 
            txn.eta, 
            txn.executed
        );
    }

    // ==================== TIMELOCK CONFIGURATION FUNCTIONS ====================
    /**
     * @notice Update timelock delays
     * @param newMinDelay New minimum delay
     * @param newMaxDelay New maximum delay
     * @param newGracePeriod New grace period
     */
    function updateDelays(
        uint256 newMinDelay,
        uint256 newMaxDelay,
        uint256 newGracePeriod
    ) external {
        // Allow either ADMIN_ROLE, GOVERNANCE_ROLE, or the contract itself (for timelock execution)
        if (!hasRole(ADMIN_ROLE, msg.sender) && 
            !hasRole(GOVERNANCE_ROLE, msg.sender) && 
            msg.sender != address(this)) {
            revert NotAuthorized(msg.sender, bytes32(0));
        }
        
        // Validate parameter values
        if (newMinDelay == 0) revert ZeroDelay();
        if (newMaxDelay < newMinDelay) revert InvalidParams();
        if (newGracePeriod == 0) revert InvalidParams();
        
        // Update the values
        minDelay = newMinDelay;
        maxDelay = newMaxDelay;
        gracePeriod = newGracePeriod;
        
        emit DelaysUpdated(newMinDelay, newMaxDelay, newGracePeriod);
    }

    /**
     * @notice Update threat level delays
     * @param newLowDelay New delay for low threat transactions 
     * @param newMediumDelay New delay for medium threat transactions
     * @param newHighDelay New delay for high threat transactions
     * @param newCriticalDelay New delay for critical threat transactions
     */
    function updateThreatLevelDelays(
        uint256 newLowDelay,
        uint256 newMediumDelay,
        uint256 newHighDelay,
        uint256 newCriticalDelay
    ) external {
        // Allow either ADMIN_ROLE, GOVERNANCE_ROLE, or the contract itself (for timelock execution)
        if (!hasRole(ADMIN_ROLE, msg.sender) && 
            !hasRole(GOVERNANCE_ROLE, msg.sender) && 
            msg.sender != address(this)) {
            revert NotAuthorized(msg.sender, bytes32(0));
        }
        
        // Validate parameter values
        if (newLowDelay < minDelay) revert DelayTooShort(newLowDelay, minDelay);
        if (newMediumDelay < newLowDelay) revert DelayHierarchyViolation();
        if (newHighDelay < newMediumDelay) revert DelayHierarchyViolation();
        if (newCriticalDelay < newHighDelay) revert DelayHierarchyViolation();
        if (newCriticalDelay > maxDelay) revert DelayTooLong(newCriticalDelay, maxDelay);
        
        // Update the values
        lowThreatDelay = newLowDelay;
        mediumThreatDelay = newMediumDelay;
        highThreatDelay = newHighDelay;
        criticalThreatDelay = newCriticalDelay;
        
        emit ThreatLevelDelaysUpdated(newLowDelay, newMediumDelay, newHighDelay, newCriticalDelay);
    }
    
    /**
     * @notice Set threat level for a function selector
     * @param selector Function selector
     * @param level Threat level to assign
     */
    function setFunctionThreatLevel(bytes4 selector, ThreatLevel level) external onlyRole(ADMIN_ROLE) {
        functionThreatLevels[selector] = level;
        emit FunctionThreatLevelSet(selector, level);
    }
    
    /**
     * @notice Set threat level for multiple function selectors
     * @param selectors Array of function selectors
     * @param levels Array of threat levels to assign
     */
    function setBatchFunctionThreatLevels(bytes4[] calldata selectors, ThreatLevel[] calldata levels) external onlyRole(ADMIN_ROLE) {
        if(selectors.length != levels.length) revert InvalidParams();
        
        for (uint256 i = 0; i < selectors.length; i++) {
            functionThreatLevels[selectors[i]] = levels[i];
            emit FunctionThreatLevelSet(selectors[i], levels[i]);
        }
    }
    
    /**
     * @notice Set threat level for an address
     * @param target Target address
     * @param level Threat level to assign
     */
    function setAddressThreatLevel(address target, ThreatLevel level) external onlyRole(ADMIN_ROLE) {
        addressThreatLevels[target] = level;
        emit AddressThreatLevelSet(target, level);
    }
    
    /**
     * @notice Set threat level for multiple addresses
     * @param targets Array of target addresses
     * @param levels Array of threat levels to assign
     */
    function setBatchAddressThreatLevels(address[] calldata targets, ThreatLevel[] calldata levels) external onlyRole(ADMIN_ROLE) {
        if(targets.length != levels.length) revert InvalidParams();
        
        for (uint256 i = 0; i < targets.length; i++) {
            addressThreatLevels[targets[i]] = levels[i];
            emit AddressThreatLevelSet(targets[i], levels[i]);
        }
    }

    /**
     * @notice Queue a transaction to update timelock delays
     * @param newMinDelay New minimum delay
     * @param newMaxDelay New maximum delay
     * @param newGracePeriod New grace period
     * @return txHash The hash of the transaction
     */
    function queueDelayUpdate(
        uint256 newMinDelay, 
        uint256 newMaxDelay, 
        uint256 newGracePeriod
    ) external whenNotPaused returns (bytes32) {
        if (newMinDelay == 0) revert ZeroDelay();
        if (newMaxDelay < newMinDelay) revert InvalidParams();
        if (newGracePeriod == 0) revert InvalidParams();
        
        // System parameter updates can only be queued by users with PROPOSER_ROLE
        // Token holders without this role cannot update system parameters
        if (!hasRole(PROPOSER_ROLE, msg.sender))
            revert NotAuthorized(msg.sender, PROPOSER_ROLE);
        
        // Prepare call data for updateDelays
        bytes memory data = abi.encodeWithSelector(
            this.updateDelays.selector,
            newMinDelay,
            newMaxDelay,
            newGracePeriod
        );
        
        // Queue the transaction using the appropriate threat level
        return queueTransactionWithThreatLevel(
            address(this),
            0, // No ETH value
            data
        );
    }
    
    /**
     * @notice Queue a transaction to update threat level delays
     * @param newLowDelay New delay for low threat transactions
     * @param newMediumDelay New delay for medium threat transactions
     * @param newHighDelay New delay for high threat transactions
     * @param newCriticalDelay New delay for critical threat transactions
     * @return txHash The hash of the transaction
     */
    function queueThreatLevelDelaysUpdate(
        uint256 newLowDelay,
        uint256 newMediumDelay,
        uint256 newHighDelay,
        uint256 newCriticalDelay
    ) external whenNotPaused returns (bytes32) {
        if (newLowDelay < minDelay) revert DelayTooShort(newLowDelay, minDelay);
        if (newMediumDelay < newLowDelay) revert DelayHierarchyViolation();
        if (newHighDelay < newMediumDelay) revert DelayHierarchyViolation();
        if (newCriticalDelay < newHighDelay) revert DelayHierarchyViolation();
        if (newCriticalDelay > maxDelay) revert DelayTooLong(newCriticalDelay, maxDelay);
        
        // System parameter updates can only be queued by users with PROPOSER_ROLE
        // Token holders without this role cannot update system parameters
        if (!hasRole(PROPOSER_ROLE, msg.sender))
            revert NotAuthorized(msg.sender, PROPOSER_ROLE);
        
        // Prepare call data
        bytes memory data = abi.encodeWithSelector(
            this.updateThreatLevelDelays.selector,
            newLowDelay,
            newMediumDelay,
            newHighDelay,
            newCriticalDelay
        );
        
        // Queue the transaction using the appropriate threat level
        return queueTransactionWithThreatLevel(
            address(this),
            0, // No ETH value
            data
        );
    }

    /**
     * @notice Pause or unpause the timelock
     * @param isPaused Whether to pause or unpause
     */
    function setPaused(bool isPaused) external onlyRole(GUARDIAN_ROLE) {
        if (isPaused) {
            _pause();
            emit ContractPaused(msg.sender);
        } else {
            _unpause();
            emit ContractUnpaused(msg.sender);
        }
    }
    
    /**
     * @dev This empty reserved space is put in place to allow future versions to add new
     * variables without shifting down storage in the inheritance chain.
     * See https://docs.openzeppelin.com/contracts/4.x/upgradeable#storage_gaps
     */
    uint256[50] private __gap;
}