// SPDX-License-Identifier: MIT
// JustGovernanceUpgradeable.sol - Optimized for proxy compatibility and reduced bytecode size

pragma solidity 0.8.20;

import "@openzeppelin/contracts-upgradeable/access/AccessControlEnumerableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/security/PausableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/security/ReentrancyGuardUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC20/utils/SafeERC20Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/AddressUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC20/IERC20Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";

/**
 * @title JustGovernanceUpgradeable
 * @notice Interface for the JustToken contract
 */
interface JustTokenUpgradeable {
    function getEffectiveVotingPower(address voter, uint256 snapshotId) external view returns (uint256);
    function balanceOf(address account) external view returns (uint256);
    function createSnapshot() external returns (uint256);
    function governanceTransfer(address from, address to, uint256 amount) external returns (bool);
    function governanceMint(address to, uint256 amount) external returns (bool);
    function governanceBurn(address from, uint256 amount) external returns (bool);
    function emergency(bool isPause, address tokenAddress) external;
}

/**
 * @title JustTimelockUpgradeable
 * @notice Interface for the JustTimelock contract
 */
interface JustTimelockUpgradeable {
    function queueTransaction(address target, uint256 value, bytes calldata data, uint256 delay) external returns (bytes32 txHash);
    function executeTransaction(bytes32 txHash) external returns (bytes memory);
    function executeExpiredTransaction(bytes32 txHash) external returns (bytes memory); // New function
    function cancelTransaction(bytes32 txHash) external;
    function queuedTransactions(bytes32 txHash) external view returns (bool);
    function getTransaction(bytes32 txHash) external view returns (address target, uint256 value, bytes memory data, uint256 eta, bool executed);
    function gracePeriod() external view returns (uint256);
    function minDelay() external view returns (uint256);
}

/**
 * @title ProposalLib
 * @notice Library for proposal flags to efficiently track proposal states
 */
library ProposalLib {
    uint8 constant EXECUTED_FLAG = 1;      // 00000001
    uint8 constant CANCELED_FLAG = 2;      // 00000010
    uint8 constant STAKE_REFUNDED_FLAG = 4; // 00000100
    uint8 constant QUEUED_FLAG = 8;        // 00001000
    
    function isExecuted(uint8 flags) internal pure returns (bool) { return (flags & EXECUTED_FLAG) != 0; }
    function isCanceled(uint8 flags) internal pure returns (bool) { return (flags & CANCELED_FLAG) != 0; }
    function isStakeRefunded(uint8 flags) internal pure returns (bool) { return (flags & STAKE_REFUNDED_FLAG) != 0; }
    function isQueued(uint8 flags) internal pure returns (bool) { return (flags & QUEUED_FLAG) != 0; }
    
    function setExecuted(uint8 flags) internal pure returns (uint8) { return flags | EXECUTED_FLAG; }
    function setCanceled(uint8 flags) internal pure returns (uint8) { return flags | CANCELED_FLAG; }
    function setStakeRefunded(uint8 flags) internal pure returns (uint8) { return flags | STAKE_REFUNDED_FLAG; }
    function setQueued(uint8 flags) internal pure returns (uint8) { return flags | QUEUED_FLAG; }
}

/**
 * @title JustGovernanceUpgradeable
 * @notice Optimized governance contract for Indiana Legal Aid DAO with external timelock
 * @dev Modified for proxy compatibility with initializer pattern
 */
contract JustGovernanceUpgradeable is 
    Initializable,
    AccessControlEnumerableUpgradeable, 
    ReentrancyGuardUpgradeable, 
    PausableUpgradeable,
    UUPSUpgradeable
{
    using SafeERC20Upgradeable for IERC20Upgradeable;
    using AddressUpgradeable for address;
    using AddressUpgradeable for address payable;
    using ProposalLib for uint8;

    // ==================== CUSTOM ERRORS ====================
    error ZeroAddress();
    error InvalidAmount();
    error InvalidProposalId();
    error ProposalCanceled();
    error ProposalExecuted();
    error InvalidCalldata();
    error InvalidSelector();
    error NotAuthorized();
    error AlreadyVoted();
    error VotingEnded();
    error InvalidVoteType();
    error InvalidDuration(uint256 provided, uint256 min, uint256 max);
    error InsufficientBalance(uint256 available, uint256 required);
    error InvalidPercentage();
    error NoValidChange();
    error InvalidLockIndex();
    error TransferFailed();
    error CallFailed();
    error NotSucceeded();
    error NotQueued();
    error NoTxHash();
    error NotInTimelock();
    error AlreadyRefunded();
    error NotProposer();
    error NotDefeated();
    error NoVotingPower();
    error LastAdminRole(); 
    error TimelockExecutionFailed();
    error ProposalNotExpired();


    // ==================== CONSTANTS ====================
    // Role-based access control
    bytes32 public constant ADMIN_ROLE = keccak256("ADMIN_ROLE");
    bytes32 public constant GUARDIAN_ROLE = keccak256("GUARDIAN_ROLE");
    
    // Event constants
    uint8 constant STATUS_CREATED = 0;
    uint8 constant STATUS_CANCELED = 1;
    uint8 constant STATUS_QUEUED = 2;
    uint8 constant STATUS_EXECUTED = 3;
    uint8 constant STATUS_EXPIRED = 4;
    
    uint8 constant REFUND_FULL = 0;
    uint8 constant REFUND_PARTIAL = 1;
    
    uint8 constant PARAM_VOTING_DURATION = 0;
    uint8 constant PARAM_QUORUM = 1;
    uint8 constant PARAM_TIMELOCK_DELAY = 2;
    uint8 constant PARAM_PROPOSAL_THRESHOLD = 3;
    uint8 constant PARAM_PROPOSAL_STAKE = 4;
    uint8 constant PARAM_DEFEATED_REFUND_PERCENTAGE = 5;
    uint8 constant PARAM_CANCELED_REFUND_PERCENTAGE = 6;
    uint8 constant PARAM_EXPIRED_REFUND_PERCENTAGE = 7;
    
    // ==================== STORAGE VARIABLES ====================
    // Reference to the JustToken contract
    JustTokenUpgradeable public justToken;
    
    // Reference to the JustTimelock contract
    JustTimelockUpgradeable public timelock;

    // Proposal types - enhanced with new types
    enum ProposalType { 
    General,              // 0
    Withdrawal,           // 1
    TokenTransfer,        // 2
    GovernanceChange,     // 3
    ExternalERC20Transfer,// 4
    TokenMint,            // 5
    TokenBurn             // 6
}
    
    enum ProposalState { Active, Canceled, Defeated, Succeeded, Queued, Executed, Expired }

    // Consolidated Proposal Data
    struct ProposalData {
        // Common base data
        uint8 flags;
        ProposalType pType;
        uint48 deadline;
        uint48 createdAt;
        uint256 yesVotes;
        uint256 noVotes;
        uint256 abstainVotes;
        address proposer;
        uint256 snapshotId;
        uint256 stakedAmount;
        bytes32 timelockTxHash;
        string description;
        
        // Type-specific fields - only the relevant ones are used based on proposal type
        address target;       // General
        bytes callData;       // General
        address recipient;    // Used by most types
        uint256 amount;       // Used by most types
        address token;        // ExternalERC20
        
        // GovernanceChange specific fields
        uint256 newThreshold;
        uint256 newQuorum;
        uint256 newVotingDuration;
        uint256 newTimelockDelay;
    }
    
    // Array to maintain proposal data
    ProposalData[] private _proposals;
    
    // Mapping to track proposal voting
    mapping(uint256 => mapping(address => uint256)) public proposalVoterInfo;
    
    // Governance parameters
    struct GovParams {
        uint256 votingDuration;
        uint256 quorum;
        uint256 timelockDelay;
        uint256 proposalCreationThreshold;
        uint256 proposalStake;

        uint256 defeatedRefundPercentage;
        uint256 canceledRefundPercentage;
        uint256 expiredRefundPercentage;
    }
    
    GovParams public govParams;
    
    // Governance constraints
    uint256 public minVotingDuration;
    uint256 public maxVotingDuration;
    
    // Security mappings
    mapping(bytes4 => bool) public allowedFunctionSelectors;
    mapping(address => bool) public allowedTargets;
    
    // ==================== EVENTS ====================
    // Super-consolidated event - handles all proposal-related events
    event ProposalEvent(
        uint256 indexed proposalId, 
        uint8 indexed eventType,   // 0=created, 1=canceled, 2=queued, 3=executed, 4=expired, 5=stake, 6=vote
        address indexed actor,
        bytes data                 // Packed event-specific data
    );
    
    // Parameter change event
    event GovParamChange(uint8 pType, uint256 oldVal, uint256 newVal);
    event SecuritySettingUpdated(bytes4 selector, bool selectorAllowed, address target, bool targetAllowed);
    event RoleChange(bytes32 indexed role, address indexed account, bool isGranted);
    event ContractPaused(address indexed pauser);
    event ContractUnpaused(address indexed unpauser);
    event ETHRescued(address indexed recipient, uint256 amount);
    event ERC20Rescued(address indexed token, address indexed recipient, uint256 amount);
    event ContractInitialized(address indexed token, address indexed timelock, address indexed admin);
    event VoteCast(uint256 indexed proposalId, address indexed voter, uint8 support, uint256 votingPower);
    event TimelockTransactionSubmitted(uint256 indexed proposalId, bytes32 indexed txHash);
    
    // ==================== MODIFIERS ====================
    /**
     * @dev Only allows admin or timelock to call function
     */
    modifier onlyAdminOrTimelock() {
        if (!hasRole(ADMIN_ROLE, msg.sender) && msg.sender != address(timelock)) revert NotAuthorized();
        _;
    }
    
    /**
     * @dev Checks if proposal ID is valid and proposal is active
     */
    modifier validActiveProposal(uint256 proposalId) {
        if (proposalId >= _proposals.length) revert InvalidProposalId();
        if (_proposals[proposalId].flags.isCanceled()) revert ProposalCanceled();
        if (_proposals[proposalId].flags.isExecuted()) revert ProposalExecuted();
        _;
    }
    
    // ==================== INITIALIZATION ====================

    /*
     * @notice Initializer function that replaces constructor for proxy pattern
     * @dev This function can only be called once
     * @param name Token name (not used, kept for backward compatibility)
     * @param tokenAddress Address of the JustToken contract
     * @param timelockAddress Address of the JustTimelock contract
     * @param admin Address of the initial admin
     * @param proposalThreshold Minimum votes required to create a proposal
     * @param votingDelay Delay before voting begins
     * @param votingPeriod Duration of voting period
     * @param quorumNumerator Not used, kept for backward compatibility
     * @param successfulRefund Not used, kept for backward compatibility
     * @param cancelledRefund Percentage of stake refunded when proposal is cancelled
     * @param defeatedRefund Percentage of stake refunded when proposal is defeated
     * @param expiredRefund Percentage of stake refunded when proposal expires
     */
    function initialize(
        string memory name,
        address tokenAddress,
        address timelockAddress,
        address admin,
        uint256 proposalThreshold,
        uint256 votingDelay,
        uint256 votingPeriod,
        uint256 quorumNumerator,
        uint256 successfulRefund,
        uint256 cancelledRefund,
        uint256 defeatedRefund,
        uint256 expiredRefund
    ) public initializer {
        if (admin == address(0) || tokenAddress == address(0) || timelockAddress == address(0)) 
            revert ZeroAddress();
        
        // Initialize inherited contracts
        __AccessControlEnumerable_init();
        __ReentrancyGuard_init();
        __Pausable_init();
        __UUPSUpgradeable_init();
        
        _setupRole(DEFAULT_ADMIN_ROLE, admin);
        _setupRole(ADMIN_ROLE, admin);
        _setupRole(GUARDIAN_ROLE, admin);
        
        justToken = JustTokenUpgradeable(tokenAddress);
        timelock = JustTimelockUpgradeable(timelockAddress);
        
        // Set governance constraints
        minVotingDuration = 600;
        maxVotingDuration = 365 days;
        
        // Initialize governance parameters
        govParams.votingDuration = votingPeriod;
        govParams.quorum = proposalThreshold;
        govParams.timelockDelay = votingDelay;
        govParams.proposalCreationThreshold = proposalThreshold;
        govParams.proposalStake = proposalThreshold / 100; // 1% of threshold as stake
        
        // Set the separate refund percentages
        govParams.defeatedRefundPercentage = defeatedRefund;
        govParams.canceledRefundPercentage = cancelledRefund;
        govParams.expiredRefundPercentage = expiredRefund;
        
        // Add basic allowed function selectors
        allowedFunctionSelectors[bytes4(keccak256("transfer(address,uint256)"))] = true;
        allowedFunctionSelectors[bytes4(keccak256("approve(address,uint256)"))] = true;
        
        emit ContractInitialized(tokenAddress, timelockAddress, admin);
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
     * @notice Pause the contract
     * @dev Can be called by guardian, admin, or timelock
     */
    function pause() external {
        if (!hasRole(GUARDIAN_ROLE, msg.sender) && 
            !hasRole(ADMIN_ROLE, msg.sender) && 
            msg.sender != address(timelock))
            revert NotAuthorized();
        _pause();
        emit ContractPaused(msg.sender);
    }

    /**
     * @notice Unpause the contract
     * @dev Can only be called by admin or timelock
     */
    function unpause() external {
        if (!hasRole(ADMIN_ROLE, msg.sender) && msg.sender != address(timelock))
            revert NotAuthorized();
        _unpause();
        emit ContractUnpaused(msg.sender);
    }

    /**
     * @notice Rescue ETH trapped in the contract
     * @dev Can only be called by admin
     */
    function rescueETH() external onlyRole(ADMIN_ROLE) nonReentrant {
        uint256 balance = address(this).balance;
        if (balance == 0) revert InvalidAmount();
        
        // Set a gas limit for the transfer to prevent potential reentrancy
        (bool success, ) = payable(msg.sender).call{value: balance, gas: 30000}("");
        if (!success) revert TransferFailed();
        
        emit ETHRescued(msg.sender, balance);
        
        emit ProposalEvent(
            0, // No specific proposal ID
            5, // Using stake event type for simplicity
            msg.sender,
            abi.encode("ETH_RESCUED", balance)
        );
    }

    /**
     * @notice Rescue ERC20 tokens trapped in the contract
     * @dev Can only be called by admin
     * @param tokenAddress The address of the token to rescue
     */
    function rescueERC20(address tokenAddress) external onlyRole(ADMIN_ROLE) nonReentrant {
        if (tokenAddress == address(0)) revert ZeroAddress();
        IERC20Upgradeable token = IERC20Upgradeable(tokenAddress);
        
        uint256 balance = token.balanceOf(address(this));
        if (balance == 0) revert InvalidAmount();
        
        token.safeTransfer(msg.sender, balance);
        
        emit ERC20Rescued(tokenAddress, msg.sender, balance);
        
        emit ProposalEvent(
            0, // No specific proposal ID
            5, // Using stake event type for simplicity
            msg.sender,
            abi.encode("ERC20_RESCUED", tokenAddress, balance)
        );
    }
    
    /**
     * @notice Revokes a role from an account with safety checks
     * @dev Callable by admin or timelock contract
     * @param role The role to revoke
     * @param account The account to revoke the role from
     */
    function revokeContractRole(bytes32 role, address account) external onlyAdminOrTimelock {
        if (account == address(0)) revert ZeroAddress();
        
        // Prevent removing the last admin to avoid locking the contract
        if (role == ADMIN_ROLE) {
            if (!(getRoleMemberCount(ADMIN_ROLE) > 1 || account != msg.sender)) 
                revert LastAdminRole();
        }
        
        // Revoke the role
        revokeRole(role, account);
        emit RoleChange(role, account, false);
    }
    
    /**
     * @notice Grants a role to an account
     * @dev Callable by admin or timelock contract
     * @param role The role to grant
     * @param account The account to grant the role to
     */
    function grantContractRole(bytes32 role, address account) external onlyAdminOrTimelock {
        if (account == address(0)) revert ZeroAddress();
        
        // Grant the role
        grantRole(role, account);
        emit RoleChange(role, account, true);
    }
    
    /**
     * @notice Updates a guardian address by granting or revoking the GUARDIAN_ROLE
     * @dev Callable by admin or timelock contract
     * @param guardian The address to update
     * @param isAdding True to add the guardian, false to remove
     */
    function updateGuardian(address guardian, bool isAdding) external onlyAdminOrTimelock {
        if (guardian == address(0)) revert ZeroAddress();
        
        if (isAdding) {
            grantRole(GUARDIAN_ROLE, guardian);
        } else {
            revokeRole(GUARDIAN_ROLE, guardian);
        }
        
        emit RoleChange(GUARDIAN_ROLE, guardian, isAdding);
    }

    /**
     * @notice Update security settings for allowed function selectors and targets
     * @param selector The function selector to update permissions for
     * @param selectorAllowed Whether the selector is allowed
     * @param target The target address to update permissions for
     * @param targetAllowed Whether the target is allowed
     */
    function updateSecurity(
        bytes4 selector, 
        bool selectorAllowed, 
        address target, 
        bool targetAllowed
    ) external onlyRole(ADMIN_ROLE) {
        if (selector != bytes4(0)) {
            allowedFunctionSelectors[selector] = selectorAllowed;
        }
        
        if (target != address(0)) {
            allowedTargets[target] = targetAllowed;
        }
        
        emit SecuritySettingUpdated(selector, selectorAllowed, target, targetAllowed);
    }
    
    // ==================== GOVERNANCE PARAMETERS MANAGEMENT ====================
    /**
     * @notice Consolidated parameter update function - reduces bytecode significantly
     * @param paramType Type of parameter to update
     * @param newValue New value for the parameter
     */
    function updateGovParam(uint8 paramType, uint256 newValue) external onlyAdminOrTimelock {
        // Validate based on parameter type
        if (paramType == PARAM_VOTING_DURATION) {
            if (newValue < minVotingDuration || newValue > maxVotingDuration)
                revert InvalidDuration(newValue, minVotingDuration, maxVotingDuration);
        } 
        else if (paramType == PARAM_DEFEATED_REFUND_PERCENTAGE || 
                paramType == PARAM_CANCELED_REFUND_PERCENTAGE || 
                paramType == PARAM_EXPIRED_REFUND_PERCENTAGE) {
            if (newValue > 100) revert InvalidPercentage();
        }
        else {
            // All other parameters must be positive
            if (newValue == 0) revert InvalidAmount();
        }
        
        _updateGovParam(paramType, newValue);
    }
    
    /**
     * @notice Unified function to update governance parameters
     * @param paramType Type of parameter to update
     * @param newValue New value for the parameter
     */
    function _updateGovParam(uint8 paramType, uint256 newValue) internal {
        uint256 oldValue;
        
        if (paramType == PARAM_VOTING_DURATION) {
            oldValue = govParams.votingDuration;
            govParams.votingDuration = newValue;
        } else if (paramType == PARAM_QUORUM) {
            oldValue = govParams.quorum;
            govParams.quorum = newValue;
        } else if (paramType == PARAM_TIMELOCK_DELAY) {
            oldValue = govParams.timelockDelay;
            govParams.timelockDelay = newValue;
        } else if (paramType == PARAM_PROPOSAL_THRESHOLD) {
            oldValue = govParams.proposalCreationThreshold;
            govParams.proposalCreationThreshold = newValue;
        } else if (paramType == PARAM_PROPOSAL_STAKE) {
            oldValue = govParams.proposalStake;
            govParams.proposalStake = newValue;
        } else if (paramType == PARAM_DEFEATED_REFUND_PERCENTAGE) {
            oldValue = govParams.defeatedRefundPercentage;
            govParams.defeatedRefundPercentage = newValue;
        } else if (paramType == PARAM_CANCELED_REFUND_PERCENTAGE) {
            oldValue = govParams.canceledRefundPercentage;
            govParams.canceledRefundPercentage = newValue;
        } else if (paramType == PARAM_EXPIRED_REFUND_PERCENTAGE) {
            oldValue = govParams.expiredRefundPercentage;
            govParams.expiredRefundPercentage = newValue;
        }
        
        emit GovParamChange(paramType, oldValue, newValue);
    }
    
    // ==================== PROPOSAL MANAGEMENT ====================
    /**
     * @notice Get the current state of a proposal
     * @param proposalId The ID of the proposal to check
     * @return The current state of the proposal
     */
    function getProposalState(uint256 proposalId) public view returns (ProposalState) {
        if (proposalId >= _proposals.length) revert InvalidProposalId();
        ProposalData storage proposal = _proposals[proposalId];

        if (proposal.flags.isCanceled()) {
            return ProposalState.Canceled;
        } else if (proposal.flags.isExecuted()) {
            return ProposalState.Executed;
        } else if (block.timestamp < proposal.deadline) { 
            return ProposalState.Active;
        } else if (
            proposal.yesVotes <= proposal.noVotes ||
            proposal.yesVotes + proposal.noVotes + proposal.abstainVotes < govParams.quorum
        ) {
            return ProposalState.Defeated;
        } else if (!proposal.flags.isQueued()) {
            return ProposalState.Succeeded;
        } else {
            // Check if it's expired in the timelock
            if (proposal.timelockTxHash != bytes32(0)) {
                (,, , uint256 eta, bool executed) = timelock.getTransaction(proposal.timelockTxHash);
                if (!executed && block.timestamp > eta + timelock.gracePeriod()) {
                    return ProposalState.Expired;
                }
            }
            return ProposalState.Queued;
        }
    }

    /**
     * @notice Create a new proposal
     * @dev Creates a proposal based on the specified type with appropriate data storage
     * @param description Description of the proposal
     * @param proposalType Type of proposal (General, Withdrawal, etc.)
     * @param target Target address for general proposals
     * @param callData Call data for general proposals
     * @param amount Amount of tokens/ETH for various proposal types
     * @param recipient Recipient address for various proposal types
     * @param externalToken Token address for ERC20 transfer proposals
     * @param newThreshold New threshold for governance change proposals
     * @param newQuorum New quorum for governance change proposals
     * @param newVotingDuration New voting duration for governance change proposals
     * @param newTimelockDelay New timelock delay for governance change proposals
     * @return ID of the created proposal
     */
    function createProposal(
        string calldata description,
        ProposalType proposalType,
        address target,
        bytes calldata callData,
        uint256 amount,
        address payable recipient,
        address externalToken,
        uint256 newThreshold,
        uint256 newQuorum,
        uint256 newVotingDuration,
        uint256 newTimelockDelay
    ) external whenNotPaused nonReentrant returns (uint256) {
        // Validate based on proposal type
        if (proposalType == ProposalType.General) {
            if (target == address(0)) revert ZeroAddress();
            if (callData.length < 4) revert InvalidCalldata();
            
            bytes4 selector = bytes4(callData[:4]);
            if (!allowedFunctionSelectors[selector]) revert InvalidSelector();
        } 
        else if (proposalType == ProposalType.Withdrawal) {
            if (recipient == address(0)) revert ZeroAddress();
            if (amount == 0) revert InvalidAmount();
        } 
        else if (proposalType == ProposalType.TokenTransfer) {
            if (recipient == address(0)) revert ZeroAddress();
            if (amount == 0) revert InvalidAmount();
        } 
        else if (proposalType == ProposalType.ExternalERC20Transfer) {
            if (recipient == address(0)) revert ZeroAddress();
            if (amount == 0) revert InvalidAmount();
            if (externalToken == address(0)) revert ZeroAddress();
        } 
        else if (proposalType == ProposalType.GovernanceChange) {
            // Allow any single parameter to be changed
            bool hasValidChange = false;
            
            if (newThreshold > 0) { hasValidChange = true; }
            if (newQuorum > 0) { hasValidChange = true; }
            if (newVotingDuration >= minVotingDuration && newVotingDuration <= maxVotingDuration) { hasValidChange = true; }
            if (newTimelockDelay > 0) { hasValidChange = true; }
            
            if (!hasValidChange) revert NoValidChange();
        }
        else if (proposalType == ProposalType.TokenMint || proposalType == ProposalType.TokenBurn) {
            if (recipient == address(0)) revert ZeroAddress();
            if (amount == 0) revert InvalidAmount();
        }

        // Check token balance - NOTE: We no longer check for PROPOSER_ROLE
        if (justToken.balanceOf(msg.sender) < govParams.proposalCreationThreshold)
            revert InsufficientBalance(justToken.balanceOf(msg.sender), govParams.proposalCreationThreshold);
        
        // Take stake from the proposer
        if (!justToken.governanceTransfer(msg.sender, address(this), govParams.proposalStake))
            revert TransferFailed();

        // Create new proposal
        uint256 proposalId = _proposals.length;
        
        // Initialize new proposal with all fields
        ProposalData memory newProposal;
        newProposal.proposer = msg.sender;
        newProposal.pType = proposalType;
        newProposal.deadline = uint48(block.timestamp + govParams.votingDuration);
        newProposal.createdAt = uint48(block.timestamp);
        newProposal.stakedAmount = govParams.proposalStake;
        newProposal.description = description;
        newProposal.snapshotId = justToken.createSnapshot();
        
        // Set type-specific data
        if (proposalType == ProposalType.General) {
            newProposal.target = target;
            newProposal.callData = callData;
        } 
        else if (proposalType == ProposalType.GovernanceChange) {
            newProposal.newThreshold = newThreshold;
            newProposal.newQuorum = newQuorum;
            newProposal.newVotingDuration = newVotingDuration;
            newProposal.newTimelockDelay = newTimelockDelay;
        }
        else {
            // For all other types that use recipient and amount
            newProposal.recipient = recipient;
            newProposal.amount = amount;
            
            // For ERC20 transfer, store token address
            if (proposalType == ProposalType.ExternalERC20Transfer) {
                newProposal.token = externalToken;
            }
        }

        // Store the proposal
        _proposals.push(newProposal);

        // Emit the proposal creation event
        emit ProposalEvent(
            proposalId, 
            STATUS_CREATED, 
            msg.sender, 
            abi.encode(proposalType, newProposal.snapshotId)
        );
        
        return proposalId;
    }

    /**
     * @notice Cancel an active proposal
     * @param proposalId The ID of the proposal to cancel
     */
    function cancelProposal(uint256 proposalId) external
        validActiveProposal(proposalId)
        nonReentrant
    {
        ProposalData storage proposal = _proposals[proposalId];

        // Check if authorized to cancel
        if (msg.sender == proposal.proposer) {
            if (proposal.yesVotes != 0 || proposal.noVotes != 0 || proposal.abstainVotes != 0)
                revert AlreadyVoted();
            if (block.timestamp >= proposal.deadline) revert VotingEnded();
        } else {
            if (!hasRole(GUARDIAN_ROLE, msg.sender)) revert NotAuthorized();
        }

        // If queued in timelock, cancel there too
        if (proposal.flags.isQueued() && proposal.timelockTxHash != bytes32(0)) {
            timelock.cancelTransaction(proposal.timelockTxHash);
        }

        // Update flags - just set it as canceled without automatic refund
        proposal.flags = proposal.flags.setCanceled();

        // Emit the proposal cancellation event
        emit ProposalEvent(proposalId, STATUS_CANCELED, msg.sender, "");
    }

    /**
     * @notice Cast a vote on a proposal
     * @param proposalId The ID of the proposal to vote on
     * @param support 0 = against, 1 = for, 2 = abstain
     * @return The voting power used
     */
    function castVote(uint256 proposalId, uint8 support) external
        whenNotPaused
        validActiveProposal(proposalId)
        returns (uint256)
    {
        if (support > 2) revert InvalidVoteType();
        if (proposalVoterInfo[proposalId][msg.sender] != 0) revert AlreadyVoted();
        
        ProposalData storage proposal = _proposals[proposalId];
        if (uint48(block.timestamp) > proposal.deadline) revert VotingEnded();
        
        uint256 votingPower = justToken.getEffectiveVotingPower(msg.sender, proposal.snapshotId);
        if (votingPower == 0) revert NoVotingPower();
        
        // Record the vote
        proposalVoterInfo[proposalId][msg.sender] = votingPower;
        
        // Update vote tallies
        if (support == 0) {
            proposal.noVotes += votingPower;
        } else if (support == 1) {
            proposal.yesVotes += votingPower;
        } else {
            proposal.abstainVotes += votingPower;
        }
        
        // Emit vote cast event
        emit VoteCast(proposalId, msg.sender, support, votingPower);
        
        emit ProposalEvent(
            proposalId, 
            6, // Vote event 
            msg.sender, 
            abi.encode(support, votingPower)
        );
        
        return votingPower;
    }
    
    /**
     * @notice Queue a successful proposal for execution
     * @param proposalId The ID of the proposal to queue
     */

    function queueProposal(uint256 proposalId) external
    whenNotPaused
    validActiveProposal(proposalId)
    nonReentrant
{
    if (getProposalState(proposalId) != ProposalState.Succeeded) revert NotSucceeded();
    
    ProposalData storage proposal = _proposals[proposalId];
    
    // The critical line: we encode a call to *this* contract's executeProposalLogic(uint256)
    bytes memory data = abi.encodeWithSelector(
        this.executeProposalLogic.selector,
        proposalId
    );
    
    // Then the timelock is instructed to call address(this) with that data.
    bytes32 txHash = timelock.queueTransaction(
        address(this),
        0, // No ETH
        data,
        govParams.timelockDelay
    );
    
    proposal.timelockTxHash = txHash;
    proposal.flags = proposal.flags.setQueued();
    
    emit TimelockTransactionSubmitted(proposalId, txHash);
    emit ProposalEvent(proposalId, STATUS_QUEUED, msg.sender, abi.encode(txHash));
}
    
    /**
     * @notice Execute a queued proposal
     * @param proposalId The ID of the proposal to execute
     */
    function executeProposal(uint256 proposalId) external
        whenNotPaused
        validActiveProposal(proposalId)
        nonReentrant
    {
        ProposalData storage proposal = _proposals[proposalId];
        
        if (getProposalState(proposalId) != ProposalState.Queued) revert NotQueued();
        if (proposal.timelockTxHash == bytes32(0)) revert NoTxHash();
        
        // Check if the transaction is still queued in the timelock
        if (!timelock.queuedTransactions(proposal.timelockTxHash)) revert NotInTimelock();
        
        // Execute the transaction via timelock
        timelock.executeTransaction(proposal.timelockTxHash);
        
        // Note: The actual status updates happen in executeProposalLogic
    }
    
    /**
     * @notice Internal execution function called by timelock
     * @dev This function handles the actual execution of proposal actions
     * @param proposalId The ID of the proposal to execute
     */
     
function executeProposalLogic(uint256 proposalId) external {
    // Only callable by timelock
    if (msg.sender != address(timelock)) revert NotAuthorized();
    if (proposalId >= _proposals.length) revert InvalidProposalId();
    
    ProposalData storage proposal = _proposals[proposalId];
    if (proposal.flags.isExecuted()) revert ProposalExecuted();
    if (!proposal.flags.isQueued()) revert NotQueued();
    
    // Execute using consolidated function
    _executeProposal(proposalId);
    
    // Mark as executed and handle stake refund
    proposal.flags = proposal.flags.setExecuted();
    
    if (!proposal.flags.isStakeRefunded()) {
        // Check if the governance contract has enough tokens first
        uint256 balance = justToken.balanceOf(address(this));
        if (balance < proposal.stakedAmount) {
            // Log this issue for debugging
            emit ProposalEvent(
                proposalId, 
                5, // Stake event 
                proposal.proposer, 
                abi.encode("INSUFFICIENT_BALANCE", balance, proposal.stakedAmount)
            );
            return; // Don't revert, just log and continue
        }
        
        // Use a try/catch to handle potential failure
        try justToken.governanceTransfer(address(this), proposal.proposer, proposal.stakedAmount) {
            proposal.flags = proposal.flags.setStakeRefunded();
            
            // Emit stake refund event
            emit ProposalEvent(
                proposalId, 
                5, // Stake event 
                proposal.proposer, 
                abi.encode(REFUND_FULL, proposal.stakedAmount)
            );
        } catch (bytes memory reason) {
            // Log the failure but don't revert
            emit ProposalEvent(
                proposalId, 
                5, // Stake event 
                proposal.proposer, 
                abi.encode("REFUND_FAILED", reason)
            );
        }
    }
    
    // Emit the proposal executed event
    emit ProposalEvent(
        proposalId, 
        STATUS_EXECUTED, 
        msg.sender, 
        abi.encode(proposal.pType)
    );
}
    // ==================== PROPOSAL EXECUTION ====================
    /**
     * @notice Consolidated execution function for all proposal types
     * @param proposalId The ID of the proposal to execute
     */
    function _executeProposal(uint256 proposalId) internal {
        ProposalData storage proposal = _proposals[proposalId];
        
        // Handle execution based on proposal type
        if (proposal.pType == ProposalType.Withdrawal) {
            if (proposal.recipient == address(0)) revert ZeroAddress();
            if (proposal.amount == 0) revert InvalidAmount();
            if (address(this).balance < proposal.amount)
                revert InsufficientBalance(address(this).balance, proposal.amount);
            
            (bool success, ) = proposal.recipient.call{value: proposal.amount}("");
            if (!success) revert TransferFailed();
        } 
        else if (proposal.pType == ProposalType.TokenTransfer) {
            if (proposal.recipient == address(0)) revert ZeroAddress();
            if (proposal.amount == 0) revert InvalidAmount();
            if (!justToken.governanceTransfer(address(this), proposal.recipient, proposal.amount))
                revert TransferFailed();
        } 
        else if (proposal.pType == ProposalType.ExternalERC20Transfer) {
            if (proposal.recipient == address(0)) revert ZeroAddress();
            if (proposal.amount == 0) revert InvalidAmount();
            if (proposal.token == address(0)) revert ZeroAddress();
            
            IERC20Upgradeable(proposal.token).safeTransfer(proposal.recipient, proposal.amount);
        } 
        else if (proposal.pType == ProposalType.General) {
            if (proposal.target == address(0)) revert ZeroAddress();
            
            // Direct call for General proposals, skip the timelock since we've already gone through
            // the voting and timelock process in the governance system
            (bool success, bytes memory result) = proposal.target.call(proposal.callData);
            if (!success) {
                emit ProposalEvent(
                    proposalId,
                    STATUS_EXECUTED,
                    address(0),
                    abi.encodePacked("Failed: ", result)
                );
                revert CallFailed();
            }
        }
        else if (proposal.pType == ProposalType.GovernanceChange) {
            if (proposal.newQuorum > 0) {
                _updateGovParam(PARAM_QUORUM, proposal.newQuorum);
            }
            
            if (proposal.newVotingDuration >= minVotingDuration && 
                proposal.newVotingDuration <= maxVotingDuration) {
                _updateGovParam(PARAM_VOTING_DURATION, proposal.newVotingDuration);
            }
            
            if (proposal.newTimelockDelay > 0) {
                _updateGovParam(PARAM_TIMELOCK_DELAY, proposal.newTimelockDelay);
            }
            
            if (proposal.newThreshold > 0) {
                _updateGovParam(PARAM_PROPOSAL_THRESHOLD, proposal.newThreshold);
            }
        } 
        else if (proposal.pType == ProposalType.TokenMint) {
            if (proposal.recipient == address(0)) revert ZeroAddress();
            if (proposal.amount == 0) revert InvalidAmount();
            if (!justToken.governanceMint(proposal.recipient, proposal.amount))
                revert TransferFailed();
        } 
        else if (proposal.pType == ProposalType.TokenBurn) {
            if (proposal.recipient == address(0)) revert ZeroAddress();
            if (proposal.amount == 0) revert InvalidAmount();
            if (!justToken.governanceBurn(proposal.recipient, proposal.amount))
                revert TransferFailed();
        }
    }
    
    // ==================== STAKE REFUND FUNCTION ====================
    /**
     * @notice Claim stake refund for defeated or canceled proposals
     * @param proposalId The ID of the proposal to claim a refund for
     */
    function claimPartialStakeRefund(uint256 proposalId) external nonReentrant {
        if (proposalId >= _proposals.length) revert InvalidProposalId();
        ProposalData storage proposal = _proposals[proposalId];
        
        // Ensure only the proposer can claim
        if (msg.sender != proposal.proposer) revert NotProposer();
        
        // Check if already refunded
        if (proposal.flags.isStakeRefunded()) revert AlreadyRefunded();
        
        // Get the current state to determine refund amount
        ProposalState state = getProposalState(proposalId);
        
        uint256 refundAmount;
        uint8 refundType;
        
        if (state == ProposalState.Defeated) {
            // Use the specific percentage for defeated proposals
            refundAmount = (proposal.stakedAmount * govParams.defeatedRefundPercentage) / 100;
            refundType = REFUND_PARTIAL;
        } 
        else if (state == ProposalState.Canceled) {
            // Use the specific percentage for canceled proposals
            refundAmount = (proposal.stakedAmount * govParams.canceledRefundPercentage) / 100;
            refundType = REFUND_PARTIAL;
        }
        else if (state == ProposalState.Expired) {
            // Use the specific percentage for expired proposals
            refundAmount = (proposal.stakedAmount * govParams.expiredRefundPercentage) / 100;
            refundType = REFUND_PARTIAL;
        }
        else {
            // Only defeated, expired, or canceled proposals can claim refunds through this function
            revert NotDefeated();
        }
        
        // Mark as refunded and send tokens
        proposal.flags = proposal.flags.setStakeRefunded();
        if (!justToken.governanceTransfer(address(this), proposal.proposer, refundAmount))
            revert TransferFailed();
        
        // Emit stake refund event
        emit ProposalEvent(
            proposalId, 
            5, // Stake event 
            proposal.proposer, 
            abi.encode(refundType, refundAmount)
        );
    }
    
    /**
     * @notice Simplified function for receiving ETH
     */
    receive() external payable {}
    
    /**
     * @dev This empty reserved space is put in place to allow future versions to add new
     * variables without shifting down storage in the inheritance chain.
     * See https://docs.openzeppelin.com/contracts/4.x/upgradeable#storage_gaps
     */
    uint256[50] private __gap;
}