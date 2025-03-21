// SPDX-License-Identifier: MIT
pragma solidity 0.8.20;

import "@openzeppelin/contracts-upgradeable/token/ERC20/extensions/ERC20SnapshotUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC20/utils/SafeERC20Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC20/IERC20Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/AccessControlEnumerableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/security/ReentrancyGuardUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/security/PausableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/AddressUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";

/**
 * @title JustTimelockUpgradeable
 * @notice Interface for the JustTimelockUpgradeable contract
 */
interface JustTimelockUpgradeable {
    function queueTransaction(address target, uint256 value, bytes calldata data, uint256 delay) external returns (bytes32 txHash);
    function executeTransaction(bytes32 txHash) external returns (bytes memory);
    function cancelTransaction(bytes32 txHash) external;
    function queuedTransactions(bytes32 txHash) external view returns (bool);
    function getTransaction(bytes32 txHash) external view returns (address target, uint256 value, bytes memory data, uint256 eta, bool executed);
    function gracePeriod() external view returns (uint256);
    function minDelay() external view returns (uint256);
}

/**
 * @title JUST Token with Locked Delegation
 * @notice Token contract for Indiana Legal Aid DAO with delegation that locks tokens
 * when delegated to another address, adapted for proxy compatibility
 */
contract JustTokenUpgradeable is 
    Initializable,
    ERC20SnapshotUpgradeable, 
    AccessControlEnumerableUpgradeable, 
    ReentrancyGuardUpgradeable, 
    PausableUpgradeable,
    UUPSUpgradeable
{
    using SafeERC20Upgradeable for IERC20Upgradeable;
    using AddressUpgradeable for address;
    using AddressUpgradeable for address payable;

    // Custom errors with ultra-shortened names
    error ZA(); // ZeroAdmAddr
    error NA(); // NotAuth
    error NE(); // NoETHDeposit
    error EMS(); // ExceedsMaxSupply
    error ANP(); // AmountNotPos
    error NDZ(); // NoDelegZeroAddr
    error DC(); // DelegCycle
    error DDL(); // DelegationDepthLimit
    error TEU(); // TransferExceedsUnlocked
    error NEU(); // NotEnoughUnlocked
    error NAT(); // NotAdminOrTimelock
    error LCS(); // LessThanCurrSupply
    error TZA(); // TimelockZeroAddr
    error ZAd(); // ZeroAddr
    error RZA(); // RevokeZeroAddr
    error RLA(); // RevokeLastAdmin
    error GBR(); // GrantBeforeRevoke
    error GZA(); // GrantZeroAddr
    error NGA(); // NotGuardOrAdmin
    error NO(); // NoETH
    error ETF(); // ETHTransferFail
    error IT(); // InvalidToken
    error NT(); // NoTokens

    // Role-based access control
    bytes32 public constant ADMIN_ROLE = keccak256("ADMIN_ROLE");
    bytes32 public constant GUARDIAN_ROLE = keccak256("GUARDIAN_ROLE");
    bytes32 public constant GOVERNANCE_ROLE = keccak256("GOVERNANCE_ROLE");
    bytes32 public constant MINTER_ROLE = keccak256("MINTER_ROLE");
    bytes32 public constant PROPOSER_ROLE = keccak256("PROPOSER_ROLE");
    
    // Timelock reference
    JustTimelockUpgradeable public timelock;
    
    // Token parameters
    uint256 public maxTokenSupply;
    uint256 public minLockDuration;
    uint256 public maxLockDuration;
    uint8 public constant MAX_DELEGATION_DEPTH = 8;

    // Delegation mapping - who is this account delegating to
    mapping(address => address) private _delegates;

    // Who have you visited before?
    mapping(address => bool) private _visitedDelegation;
    
    // Track all delegates for snapshot purposes
    address[] private _allDelegates;
    mapping(address => bool) private _isDelegate;
    
    // Track locked tokens for delegation
    mapping(address => uint256) private _lockedTokens;
    
    // Track tokens delegated to each delegate
    mapping(address => uint256) private _delegatedToAddress;
    
    // Track who has delegated tokens to an address
    mapping(address => address[]) private _delegatorsOf;
    mapping(address => mapping(address => bool)) private _isDelegatorOf;
    
    // Track snapshot timestamps for accurate calculations
    mapping(uint256 => uint256) private _snapshotTimestamps;
    
    // Track delegate assignments by snapshot
    mapping(uint256 => mapping(address => address)) private _delegateAtSnapshot;
    
    // Track locked tokens at snapshot
    mapping(uint256 => mapping(address => uint256)) private _lockedTokensAtSnapshot;
    
    // Track delegated tokens at snapshot - explicitly defined
    mapping(uint256 => mapping(address => uint256)) private _delegatedToAddressAtSnapshot;
    
    // Enhanced snapshot metrics
    struct SnapshotMetrics {
        uint256 totalSupply;
        uint256 activeHolders;
        uint256 activeDelegates;
        uint256 totalDelegatedTokens;
        uint256 percentageDelegated;
        uint256 topDelegateTokens;
        address topDelegate;
    }
    
    // Mapping to store metrics for each snapshot
    mapping(uint256 => SnapshotMetrics) private _snapshotMetrics;
    
    // Events
    event DelegateChanged(address indexed delegator, address indexed fromDelegate, address indexed toDelegate);
    event TokensLocked(address indexed delegator, address indexed delegatee, uint256 amount);
    event TokensUnlocked(address indexed delegator, uint256 amount);
    event Deposit(address indexed user, uint256 amount, uint256 newTotalSupply);
    event TokensBurned(address indexed user, uint256 amount, uint256 newTotalSupply);
    event GuardianAdded(address guardian);
    event GuardianRemoved(address guardian);
    event TokensMinted(address indexed recipient, uint256 amount, uint256 newTotalSupply);
    event DirectDeposit(address indexed sender, uint256 amount);
    event ETHRescued(address indexed recipient, uint256 amount);
    event ERC20Rescued(address indexed token, address indexed recipient, uint256 amount);
    event SnapshotCreated(uint256 indexed id, uint256 timestamp);
    event GovernanceRoleTransferred(address indexed oldGovernance, address indexed newGovernance);
    event GovernanceRoleChanged(address indexed account, bool isGranted);
    event TimelockUpdated(address indexed oldTimelock, address indexed newTimelock);
    event MaxTokenSupplyUpdated(uint256 oldSupply, uint256 newSupply);
    event LockDurationsUpdated(uint256 oldMinDuration, uint256 oldMaxDuration, uint256 newMinDuration, uint256 newMaxDuration);
    event SnapshotMetricsUpdated(uint256 indexed snapshotId, uint256 totalSupply, uint256 activeDelegates);
    
    /**
     * @dev Instead of using a modifier, use an internal function to save bytecode
     */
    function _checkAdminOrTimelock() internal view {
        if (!hasRole(ADMIN_ROLE, msg.sender) && msg.sender != address(timelock))
            revert NAT();
    }

    /**
     * @dev Check if account has sufficient unlocked tokens - internal function
     */
    function _checkUnlockedTokens(address account, uint256 amount) internal view {
        if (balanceOf(account) < amount + _lockedTokens[account])
            revert NEU();
    }
    
    /**
     * @notice Initializer that replaces constructor for proxy pattern
     */
    function initialize(
        string memory name,
        string memory symbol,
        address admin,
        uint256 minLockDurationParam,
        uint256 maxLockDurationParam
    ) public initializer {
        if (admin == address(0)) revert ZA();
        
        // Initialize base contracts
        __ERC20_init(name, symbol);
        __ERC20Snapshot_init();
        __AccessControlEnumerable_init();
        __ReentrancyGuard_init();
        __Pausable_init();
        __UUPSUpgradeable_init();
        
        _setupRole(DEFAULT_ADMIN_ROLE, admin);
        _setupRole(ADMIN_ROLE, admin);
        _setupRole(GUARDIAN_ROLE, admin);
        _setupRole(GOVERNANCE_ROLE, admin);
        _setupRole(MINTER_ROLE, admin);
        _setupRole(PROPOSER_ROLE, admin);
        
        // Initialize with safe defaults
        maxTokenSupply = 1000000 * 10**18; // 1 million tokens
        minLockDuration = minLockDurationParam;
        maxLockDuration = maxLockDurationParam;
    }
    
    /**
     * @notice Function that authorizes an upgrade to a new implementation
     */
    function _authorizeUpgrade(address newImplementation) internal override onlyRole(ADMIN_ROLE) {}
    
    // Token Operations
    function deposit() external payable whenNotPaused nonReentrant {
        _processDeposit();
    }
    
    function _processDeposit() internal {
        if (msg.value == 0) revert NE();
        uint256 amount = msg.value;
        if (totalSupply() + amount > maxTokenSupply) revert EMS();
        _mint(msg.sender, amount);
        
        // Auto self-delegate for new recipients
        if (_delegates[msg.sender] == address(0)) {
            _delegates[msg.sender] = msg.sender;
            _addToAllDelegates(msg.sender);
        }
        
        emit Deposit(msg.sender, msg.value, totalSupply());
    }
    
    function mint(address to, uint256 amount) external onlyRole(MINTER_ROLE) nonReentrant {
        if (totalSupply() + amount > maxTokenSupply) revert EMS();
        _mint(to, amount);
        
        // Auto self-delegate for new recipients
        if (_delegates[to] == address(0)) {
            _delegates[to] = to;
            _addToAllDelegates(to);
        }
        
        emit TokensMinted(to, amount, totalSupply());
    }
    
    function burnTokens(uint256 amount) external whenNotPaused nonReentrant {
        _checkUnlockedTokens(msg.sender, amount);
        if (amount == 0) revert ANP();
        _burn(msg.sender, amount);
        emit TokensBurned(msg.sender, amount, totalSupply());
    }
    
    // Delegation System with Token Locking
    function _addToAllDelegates(address delegatee) internal {
        if (!_isDelegate[delegatee] && delegatee != address(0)) {
            _allDelegates.push(delegatee);
            _isDelegate[delegatee] = true;
        }
    }
    
    /**
     * @notice Add delegator to the delegatee's list of delegators
     */
    function _addDelegatorOf(address delegator, address delegatee) internal {
        if (!_isDelegatorOf[delegatee][delegator]) {
            _delegatorsOf[delegatee].push(delegator);
            _isDelegatorOf[delegatee][delegator] = true;
        }
    }
    
    /**
     * @notice Get list of addresses that have delegated to a specific address
     */
    function getDelegatorsOf(address delegatee) public view returns (address[] memory) {
        return _delegatorsOf[delegatee];
    }

    /**
     * @notice Propagate delegation changes through the delegation chain
     */function _propagateDelegationChange(
    address delegatee,
    uint256 amount,
    uint256 previousAmount,
    uint8 depth
) internal {
    // Reset all visited flags first
    for (uint i = 0; i < _allDelegates.length; i++) {
        _visitedDelegation[_allDelegates[i]] = false;
    }
    
    // Then call a helper function to do the actual propagation
    _propagateDelegationChangeRecursive(delegatee, amount, previousAmount, depth);
}


    /**
     * @notice Propagate delegation removals through the delegation chain
     */
    function _propagateDelegationRemoval(
        address delegatee,
        uint256 amount,
        uint8 depth
    ) internal {
        if (depth >= MAX_DELEGATION_DEPTH || _visitedDelegation[delegatee]) return;
        
        _visitedDelegation[delegatee] = true;

        address nextDelegatee = _delegates[delegatee];
        
        if (nextDelegatee != address(0) && nextDelegatee != delegatee) {
            _delegatedToAddress[nextDelegatee] = _safeSub(
                _delegatedToAddress[nextDelegatee],
                amount
            );
            
            _propagateDelegationRemoval(nextDelegatee, amount, depth + 1);
        }
    }

    function _propagateDelegationChangeRecursive(
    address delegatee,
    uint256 amount,
    uint256 previousAmount,
    uint8 depth
) internal {
    // Early exit if we've reached max depth or already visited this node
    if (depth >= MAX_DELEGATION_DEPTH || _visitedDelegation[delegatee]) return;
    
    // Mark as visited to prevent cycles
    _visitedDelegation[delegatee] = true;

    // Get the delegate of the current delegatee
    address nextDelegatee = _delegates[delegatee];
    
    // Only propagate if there's a valid next delegatee (not null and not self)
    if (nextDelegatee != address(0) && nextDelegatee != delegatee) {
        // Adjust delegation amount
        if (previousAmount > 0) {
            _delegatedToAddress[nextDelegatee] = _safeSub(
                _delegatedToAddress[nextDelegatee],
                previousAmount
            );
        }
        
        // Add new delegation amount
        _delegatedToAddress[nextDelegatee] += amount;
        
        // Continue propagation
        _propagateDelegationChangeRecursive(nextDelegatee, amount, previousAmount, depth + 1);
    }
}

    /**
     * @notice Check if delegating would exceed the maximum delegation depth
     * @dev New function to prevent delegation chains that exceed MAX_DELEGATION_DEPTH
     * @param delegator The account that would delegate
     * @param delegatee The account that would be delegated to
     * @return True if the delegation would exceed the maximum depth
     */
    function _wouldExceedMaxDepth(address delegator, address delegatee) internal view returns (bool) {
        // Self-delegation is always allowed
        if (delegator == delegatee) return false;
        
        // Step 1: Find the longest chain containing delegator
        uint8 longestChainLength = 0;
        
        // Iterate through all accounts
        for (uint256 i = 0; i < _allDelegates.length; i++) {
            address leaf = _allDelegates[i];
            
            // For each account, follow its delegation chain
            address current = leaf;
            uint8 chainLength = 0;
            bool containsDelegator = false;
            
            while (current != address(0) && chainLength <= MAX_DELEGATION_DEPTH) {
                if (current == delegator) {
                    containsDelegator = true;
                    break;
                }
                
                address next = _delegates[current];
                if (next == address(0) || next == current) break;
                
                chainLength++;
                current = next;
            }
            
            // If chain contains delegator, record its length to delegator
            if (containsDelegator && chainLength > longestChainLength) {
                longestChainLength = chainLength;
            }
        }
        
        // Step 2: Calculate depth from delegatee to end of its chain
        uint8 delegateeChainDepth = 0;
        address current = delegatee;
        
        while (current != address(0)) {
            address next = _delegates[current];
            if (next == address(0) || next == current) break;
            
            delegateeChainDepth++;
            current = next;
        }
        
        // Step 3: Calculate total chain depth if we add delegator -> delegatee link
        uint8 totalChainDepth = longestChainLength + 1 + delegateeChainDepth;
        
        return totalChainDepth > MAX_DELEGATION_DEPTH;
    }
   
/**
 * @notice Delegate voting power to another address, locking the tokens
 */function delegate(address delegatee) public whenNotPaused nonReentrant {
    if (delegatee == address(0)) revert NDZ();
    
    // Always call _selfDelegate() for self-delegation to ensure tokens are unlocked
    if (delegatee == msg.sender) {
        return _selfDelegate();
    }
    
    // Check for delegation cycles
    if (_wouldCreateDelegationCycle(msg.sender, delegatee)) {
        revert DC();
    }
    
    // Check if the delegation would exceed the maximum depth
    if (_wouldExceedMaxDepth(msg.sender, delegatee)) {
        revert DDL();
    }
    
    address currentDelegate = _delegates[msg.sender];
    uint256 fullBalance = balanceOf(msg.sender);
    
    if (currentDelegate != address(0)) {
        if (currentDelegate == msg.sender) {
            uint256 previouslyLockedAmount = _lockedTokens[msg.sender];
            if (previouslyLockedAmount > 0) {
                _delegatedToAddress[msg.sender] = _safeSub(
                    _delegatedToAddress[msg.sender],
                    previouslyLockedAmount
                );
            }
        } else {
            uint256 previouslyLockedAmount = _lockedTokens[msg.sender];
            
            if (previouslyLockedAmount > 0) {
                _delegatedToAddress[currentDelegate] = _safeSub(
                    _delegatedToAddress[currentDelegate],
                    previouslyLockedAmount
                );
                
                // Reset visited flags - this is important!
                for (uint i = 0; i < _allDelegates.length; i++) {
                    _visitedDelegation[_allDelegates[i]] = false;
                }
                
                _propagateDelegationRemoval(currentDelegate, previouslyLockedAmount, 0);
            }
            
            _removeDelegatorOf(msg.sender, currentDelegate);
        }
    }
    
    _delegates[msg.sender] = delegatee;
    _addToAllDelegates(delegatee);
    
    _lockedTokens[msg.sender] = fullBalance;
    
    _delegatedToAddress[delegatee] += fullBalance;
    
    // Reset visited flags again before propagation
    for (uint i = 0; i < _allDelegates.length; i++) {
        _visitedDelegation[_allDelegates[i]] = false;
    }
    
    _propagateDelegationChange(delegatee, fullBalance, 0, 0);
    
    _addDelegatorOf(msg.sender, delegatee);
    
    emit DelegateChanged(msg.sender, currentDelegate, delegatee);
    emit TokensLocked(msg.sender, delegatee, fullBalance);
}
    
    /**
     * @notice Simplified cycle detection function for delegation
     */
    function _wouldCreateDelegationCycle(address delegator, address delegatee) internal view returns (bool) {
        if (delegator == delegatee) return false;
        if (_delegates[delegatee] == delegator) return true;
        
        address current = delegatee;
        for (uint8 i = 0; i < MAX_DELEGATION_DEPTH; i++) {
            address next = _delegates[current];
            if (next == address(0) || next == current) break;
            if (next == delegator) return true;
            current = next;
        }
        
        address[] storage delegatorsOfDelegatee = _delegatorsOf[delegatee];
        
        for (uint i = 0; i < delegatorsOfDelegatee.length; i++) {
            if (_delegates[delegatorsOfDelegatee[i]] == delegator) {
                return true;
            }
        }
        
        return false;
    }
    
    /**
     * @notice Handle self-delegation (resets delegation)
     */
     function _selfDelegate() internal {
    address currentDelegate = _delegates[msg.sender];
    uint256 accountBalance = balanceOf(msg.sender);
    uint256 lockedAmount = _lockedTokens[msg.sender];
    
    // Always update delegation state, even if already self-delegated
    if (currentDelegate != address(0) && currentDelegate != msg.sender) {
        _delegatedToAddress[currentDelegate] = _safeSub(
            _delegatedToAddress[currentDelegate],
            lockedAmount
        );
        
        _removeDelegatorOf(msg.sender, currentDelegate);
    }
    
    // Always unlock tokens for self-delegation
    _lockedTokens[msg.sender] = 0;
    
    // Set delegate to self
    _delegates[msg.sender] = msg.sender;
    _delegatedToAddress[msg.sender] = accountBalance;
    
    _addToAllDelegates(msg.sender);
    
    emit DelegateChanged(msg.sender, currentDelegate, msg.sender);
    
    if (lockedAmount > 0) {
        emit TokensUnlocked(msg.sender, lockedAmount);
    }
}
    /**
     * @notice Hook that is called before any transfer of tokens
     */
    function _beforeTokenTransfer(
        address from,
        address to,
        uint256 amount
    ) internal override {
        if (from != address(0) && to != address(0)) {
            if (balanceOf(from) - _lockedTokens[from] < amount)
                revert TEU();
        }
        
        super._beforeTokenTransfer(from, to, amount);
        
        if (from == address(0) || to == address(0)) {
            if (to != address(0) && _delegates[to] == address(0)) {
                _delegates[to] = to;
                _addToAllDelegates(to);
            }
        }
    }

    /**
     * @notice Updates the delegate voting power when delegation changes occur after minting
     */
    function _afterTokenTransfer(
        address from,
        address to,
        uint256 amount
    ) internal override {
        super._afterTokenTransfer(from, to, amount);
    }

    /**
     * @notice Enhanced snapshot data creation that captures important metrics
     */
    function captureSnapshotMetrics(uint256 snapshotId) internal {
        SnapshotMetrics memory metrics;
        metrics.totalSupply = totalSupply();
        
        for (uint256 i = 0; i < _allDelegates.length; i++) {
            address account = _allDelegates[i];
            _delegatedToAddressAtSnapshot[snapshotId][account] = 0;
            _delegateAtSnapshot[snapshotId][account] = _delegates[account];
            
            uint256 balance = balanceOfAt(account, snapshotId);
            if (balance > 0) {
                metrics.activeHolders++;
            }
        }
        
        for (uint256 i = 0; i < _allDelegates.length; i++) {
            address delegator = _allDelegates[i];
            address delegatee = _delegates[delegator];
            
            if (delegatee == delegator || delegatee == address(0)) continue;
            
            uint256 balance = balanceOfAt(delegator, snapshotId);
            if (balance > 0) {
                _delegatedToAddressAtSnapshot[snapshotId][delegatee] += balance;
                metrics.totalDelegatedTokens += balance;
                _lockedTokensAtSnapshot[snapshotId][delegator] = balance;
            }
        }
        
        uint8 remainingPasses = 10;
        bool changed;
        
        do {
            changed = false;
            for (uint256 i = 0; i < _allDelegates.length; i++) {
                address middleman = _allDelegates[i];
                address finalDelegatee = _delegates[middleman];
                
                if (finalDelegatee == middleman || finalDelegatee == address(0)) continue;
                
                uint256 receivedPower = _delegatedToAddressAtSnapshot[snapshotId][middleman];
                if (receivedPower > 0) {
                    _delegatedToAddressAtSnapshot[snapshotId][finalDelegatee] += receivedPower;
                    _delegatedToAddressAtSnapshot[snapshotId][middleman] = 0;
                    changed = true;
                }
            }
            remainingPasses--;
        } while (changed && remainingPasses > 0);
        
        for (uint256 i = 0; i < _allDelegates.length; i++) {
            address account = _allDelegates[i];
            
            if (_delegatorsOf[account].length > 0) {
                metrics.activeDelegates++;
                
                uint256 delegatedPower = _delegatedToAddressAtSnapshot[snapshotId][account];
                if (delegatedPower > metrics.topDelegateTokens) {
                    metrics.topDelegateTokens = delegatedPower;
                    metrics.topDelegate = account;
                }
            }
        }
        
        if (metrics.totalSupply > 0) {
            metrics.percentageDelegated = (metrics.totalDelegatedTokens * 10000) / metrics.totalSupply;
        }
        
        _snapshotMetrics[snapshotId] = metrics;
        
        emit SnapshotMetricsUpdated(snapshotId, metrics.totalSupply, metrics.activeDelegates);
    }
    
    /**
     * @notice Reset delegation to self, unlocking all tokens
     */
    function resetDelegation() public whenNotPaused nonReentrant {
        address currentDelegate = _delegates[msg.sender];
        uint256 fullBalance = balanceOf(msg.sender);
        
        if (currentDelegate == msg.sender && _lockedTokens[msg.sender] == 0) return;
        
        uint256 ownLockedTokens = _lockedTokens[msg.sender];
        
        if (currentDelegate != address(0) && currentDelegate != msg.sender) {
            if (ownLockedTokens > 0) {
                _delegatedToAddress[currentDelegate] = _safeSub(
                    _delegatedToAddress[currentDelegate],
                    ownLockedTokens
                );
            }
            
            _removeDelegatorOf(msg.sender, currentDelegate);
        }
        
        uint256 amountToUnlock = _lockedTokens[msg.sender];
        _lockedTokens[msg.sender] = 0;
        
        _delegates[msg.sender] = msg.sender;
        _addToAllDelegates(msg.sender);
        
        _delegatedToAddress[msg.sender] += fullBalance;
        
        emit DelegateChanged(msg.sender, currentDelegate, msg.sender);
        
        if (amountToUnlock > 0) {
            emit TokensUnlocked(msg.sender, amountToUnlock);
        }
    }

    /**
     * @notice Get the current delegate for an account
     */
    function getDelegate(address account) public view returns (address) {
        return _delegates[account];
    }
    
    /**
     * @notice Get the amount of tokens locked for delegation
     */
    function getLockedTokens(address account) public view returns (uint256) {
        return _lockedTokens[account];
    }
    
    /**
     * @notice Get the amount of tokens delegated to an address
     */
    function getDelegatedToAddress(address account) public view returns (uint256) {
        return _delegatedToAddress[account];
    }
    
    /**
     * @notice Get the delegated votes for an account (alias for getDelegatedToAddress)
     */
    function getCurrentDelegatedVotes(address account) public view returns (uint256) {
        return _delegatedToAddress[account];
    }

    /**
     * @notice Helper to safely subtract amounts in delegation calculations
     */
    function _safeSub(uint256 a, uint256 b) internal pure returns (uint256) {
        return a >= b ? a - b : 0;
    }

    /**
     * @notice Remove delegator from the delegatee's list of delegators
     */
    function _removeDelegatorOf(address delegator, address delegatee) internal {
        if (_isDelegatorOf[delegatee][delegator]) {
            _isDelegatorOf[delegatee][delegator] = false;
            
            uint256 length = _delegatorsOf[delegatee].length;
            for (uint256 i = 0; i < length; i++) {
                if (_delegatorsOf[delegatee][i] == delegator) {
                    if (i < length - 1) {
                        _delegatorsOf[delegatee][i] = _delegatorsOf[delegatee][length - 1];
                    }
                    _delegatorsOf[delegatee].pop();
                    break;
                }
            }
        }
    }

    /**
     * @notice Get the effective voting power of an account at a specific snapshot
     */
    function getEffectiveVotingPower(address voter, uint256 snapshotId) public view returns (uint256) {
        uint256 ownBalance = balanceOfAt(voter, snapshotId);
        
        address delegateAtSnapshot = _delegateAtSnapshot[snapshotId][voter];
        
        if (delegateAtSnapshot == address(0)) {
            delegateAtSnapshot = _delegates[voter];
        }
        
        if (delegateAtSnapshot != voter && delegateAtSnapshot != address(0)) {
            return 0;
        }
        
        return ownBalance + _delegatedToAddressAtSnapshot[snapshotId][voter];
    }

    /**
     * @notice Get the locked tokens at a specific snapshot
     */
    function getLockedTokensAtSnapshot(address account, uint256 snapshotId) public view returns (uint256) {
        return _lockedTokensAtSnapshot[snapshotId][account];
    }
    
    /**
     * @notice Get delegated tokens at a specific snapshot
     */
    function getDelegatedToAddressAtSnapshot(address account, uint256 snapshotId) public view returns (uint256) {
        return _delegatedToAddressAtSnapshot[snapshotId][account];
    }
    
    /**
     * @notice Get metrics for a specific snapshot
     */
    function getSnapshotMetrics(uint256 snapshotId) public view returns (
        uint256 totalSupply,
        uint256 activeHolders,
        uint256 activeDelegates,
        uint256 totalDelegatedTokens,
        uint256 percentageDelegated,
        address topDelegate,
        uint256 topDelegateTokens
    ) {
        SnapshotMetrics storage metrics = _snapshotMetrics[snapshotId];
        return (
            metrics.totalSupply,
            metrics.activeHolders,
            metrics.activeDelegates,
            metrics.totalDelegatedTokens,
            metrics.percentageDelegated,
            metrics.topDelegate,
            metrics.topDelegateTokens
        );
    }
    
    // Token Snapshot Management
    function createSnapshot() external onlyRole(GOVERNANCE_ROLE) returns (uint256) {
        uint256 snapshotId = _snapshot();
        return snapshotId;
    }

    /**
     * @notice Get the current snapshot ID
     */
    function getCurrentSnapshotId() public view returns (uint256) {
        return _getCurrentSnapshotId();
    }

    /**
     * @notice Get the snapshot timestamp
     */
    function getSnapshotTimestamp(uint256 snapshotId) public view returns (uint256) {
        return _snapshotTimestamps[snapshotId];
    }

    /**
     * @notice Enhanced snapshot function that captures delegation state and metrics
     */
    function _snapshot() internal override returns (uint256) {
        uint256 snapshotId = super._snapshot();
        
        // Store current timestamp with this snapshot
        _snapshotTimestamps[snapshotId] = block.timestamp;
        
        // Capture metrics and delegation state
        captureSnapshotMetrics(snapshotId);
        
        emit SnapshotCreated(snapshotId, block.timestamp);
        
        return snapshotId;
    }

    function _transfer(address sender, address recipient, uint256 amount) internal override whenNotPaused {
        super._transfer(sender, recipient, amount);
    }
    
    // GOVERNANCE FUNCTIONS
    /**
     * @notice Mint tokens via governance
     */
    function governanceMint(address to, uint256 amount) external 
    onlyRole(GOVERNANCE_ROLE) 
    whenNotPaused 
    returns (bool) {
        if (to == address(0)) revert ZAd();
        if (amount == 0) revert ANP();
        if (totalSupply() + amount > maxTokenSupply) revert EMS();
        
        _mint(to, amount);
        
        // Auto self-delegate for new recipients
        if (_delegates[to] == address(0)) {
            _delegates[to] = to;
            _addToAllDelegates(to);
        }
        
        emit TokensMinted(to, amount, totalSupply());
        return true;
    }
    
    /**
     * @notice Burn tokens via governance
     */
    function governanceBurn(address from, uint256 amount) external onlyRole(GOVERNANCE_ROLE) whenNotPaused returns (bool) {
        if (from == address(0)) revert ZAd();
        if (amount == 0) revert ANP();
        
        // Check if token holder has enough unlocked tokens
        if (balanceOf(from) - _lockedTokens[from] < amount)
            revert TEU();
        
        _burn(from, amount);
        emit TokensBurned(from, amount, totalSupply());
        return true;
    }
    
    /**
     * @notice Transfer tokens via governance
     */
    function governanceTransfer(address from, address to, uint256 amount) external 
    onlyRole(GOVERNANCE_ROLE) 
    whenNotPaused 
    nonReentrant 
    returns (bool) 
{
    // For governance transfers, we also need to check locked tokens
    if (balanceOf(from) - _lockedTokens[from] < amount)
        revert TEU();
    
    _transfer(from, to, amount);
    return true;
}
    
    // Admin Functions
    /**
     * @notice Update the maximum token supply
     */
    function setMaxTokenSupply(uint256 newMaxSupply) external {
        _checkAdminOrTimelock();
        if (newMaxSupply < totalSupply()) revert LCS();
        uint256 oldMaxSupply = maxTokenSupply;
        maxTokenSupply = newMaxSupply;
        emit MaxTokenSupplyUpdated(oldMaxSupply, newMaxSupply);
    }
    
    /**
     * @notice Set the timelock contract address
     */
    function setTimelock(address timelockAddress) external onlyRole(ADMIN_ROLE) {
        if (timelockAddress == address(0)) revert TZA();
        address oldTimelock = address(timelock);
        timelock = JustTimelockUpgradeable(timelockAddress);
        emit TimelockUpdated(oldTimelock, timelockAddress);
    }
    
    /**
     * @notice Add a guardian role to an address
     */
    function addGuardian(address guardian) external {
        if (!hasRole(ADMIN_ROLE, msg.sender) && msg.sender != address(timelock))
            revert NAT();
        if (guardian == address(0)) revert ZAd();
        grantRole(GUARDIAN_ROLE, guardian);
        emit GuardianAdded(guardian);
    }

    /**
     * @notice Remove a guardian role from an address
     */
    function removeGuardian(address guardian) external {
        if (!hasRole(ADMIN_ROLE, msg.sender) && msg.sender != address(timelock))
            revert NAT();
        revokeRole(GUARDIAN_ROLE, guardian);
        emit GuardianRemoved(guardian);
    }
    
    /**
     * @notice Revokes a role from an account with safety checks
     */
    function revokeContractRole(bytes32 role, address account) external {
        _checkAdminOrTimelock();
        if (account == address(0)) revert RZA();
        
        // Prevent removing the last admin to avoid locking the contract
        if (role == ADMIN_ROLE) {
            if (getRoleMemberCount(ADMIN_ROLE) <= 1 && account == msg.sender)
                revert RLA();
        }
        
        // Prevent removing critical role assignments
        if (role == GOVERNANCE_ROLE) {
            // Ensure governance role is being transferred, not just removed
            if (getRoleMemberCount(GOVERNANCE_ROLE) <= 1)
                revert GBR();
            
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
        
        // Revoke the role
        revokeRole(role, account);
    }

    /**
     * @notice Grants a role to an account
     */
    function grantContractRole(bytes32 role, address account) external {
        _checkAdminOrTimelock();
        if (account == address(0)) revert GZA();
        
        // Grant the role
        grantRole(role, account);
        
        // If granting governance role, emit event for transparency
        if (role == GOVERNANCE_ROLE) {
            emit GovernanceRoleChanged(account, true);
        }
    }
    
    // Emergency Functions
    /**
     * @notice Pause the contract
     */
    function pause() external {
        if (!hasRole(GUARDIAN_ROLE, msg.sender) && 
            !hasRole(ADMIN_ROLE, msg.sender) && 
            msg.sender != address(timelock))
            revert NGA();
        _pause();
    }

    /**
     * @notice Unpause the contract
     */
    function unpause() external {
        if (!hasRole(ADMIN_ROLE, msg.sender) && msg.sender != address(timelock))
            revert NAT();
        _unpause();
    }
    
    // Safety Functions
    function rescueETH() external onlyRole(ADMIN_ROLE) nonReentrant {
        uint256 balance = address(this).balance;
        if (balance == 0) revert NO();
        
        // Set a gas limit for the transfer to prevent potential reentrancy attack vectors
        (bool success, ) = payable(msg.sender).call{value: balance, gas: 30000}("");
        if (!success) revert ETF();
        
        emit ETHRescued(msg.sender, balance);
    }
    
    function rescueERC20(address tokenAddress) external onlyRole(ADMIN_ROLE) nonReentrant {
        if (tokenAddress == address(0)) revert IT();
        IERC20Upgradeable token = IERC20Upgradeable(tokenAddress);
        
        uint256 balance = token.balanceOf(address(this));
        if (balance == 0) revert NT();
        
        token.safeTransfer(msg.sender, balance);
        emit ERC20Rescued(tokenAddress, msg.sender, balance);
    }
    
    // Support receiving ETH
    receive() external payable whenNotPaused {
        if (msg.value > 0) {
            emit DirectDeposit(msg.sender, msg.value);
            _processDeposit();
        }
    }
    
    fallback() external payable whenNotPaused {
        if (msg.value > 0) {
            emit DirectDeposit(msg.sender, msg.value);
            _processDeposit();
        }
    }
    
    /**
     * @dev Reserved space for future upgrades
     */
    uint256[50] private __gap;
}