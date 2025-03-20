// SPDX-License-Identifier: MIT
pragma solidity 0.8.20;

import "@openzeppelin/contracts-upgradeable/access/AccessControlEnumerableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/security/PausableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/security/ReentrancyGuardUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/AddressUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";

/**
 * @title JustTokenInterface
 * @notice Interface for the JustToken contract with delegation features
 */
interface JustTokenInterface {
    function getDelegate(address account) external view returns (address);
    function getDelegatorsOf(address delegatee) external view returns (address[] memory);
    function MAX_DELEGATION_DEPTH() external view returns (uint8);
    function balanceOf(address account) external view returns (uint256);
    function getEffectiveVotingPower(address voter, uint256 snapshotId) external view returns (uint256);
    function totalSupply() external view returns (uint256);
}

/**
 * @title JustGovernanceInterface
 * @notice Interface for interacting with the JustGovernance contract
 */
interface JustGovernanceInterface {
    enum ProposalState { Active, Canceled, Defeated, Succeeded, Queued, Executed, Expired }
    function getProposalState(uint256 proposalId) external view returns (ProposalState);
    function proposalVoterInfo(uint256 proposalId, address voter) external view returns (uint256);
}

/**
 * @title JustTimelockInterface
 * @notice Interface for interacting with the JustTimelock contract
 */
interface JustTimelockInterface {
    enum ThreatLevel { LOW, MEDIUM, HIGH, CRITICAL }
    function getTransaction(bytes32 txHash) external view returns (address, uint256, bytes memory, uint256, bool);
    function getThreatLevel(address target, bytes memory data) external view returns (ThreatLevel);
    function executeExpiredTransaction(bytes32 txHash) external returns (bytes memory);
}

/**
 * @title JustDAOHelperUpgradeable
 * @notice Enhanced helper contract for DAO operations, delegation analysis, and DAO metrics
 * @dev Contains advanced delegation depth checking and propagation prevention
 */
contract JustDAOHelperUpgradeable is
    Initializable,
    AccessControlEnumerableUpgradeable,
    PausableUpgradeable,
    ReentrancyGuardUpgradeable,
    UUPSUpgradeable
{
    using AddressUpgradeable for address;

    // Custom errors for gas optimization
    error ZeroAddress();
    error NoToken();
    error NoGovernance();
    error NoTimelock();
    error InvalidAccount();
    error InvalidDelegator();
    error InvalidProposalId();
    error NotAuthorized();
    error DelegationTooComplex();

    // Role-based access control
    bytes32 public constant ADMIN_ROLE = keccak256("ADMIN_ROLE");
    bytes32 public constant ANALYTICS_ROLE = keccak256("ANALYTICS_ROLE");
    uint256 private constant MAX_DELEGATION_GRAPH_SIZE = 1000;
    uint256 private constant MAX_SAFE_DELEGATION_COMPLEXITY = 500;

    // Contract references
    JustTokenInterface public justToken;
    JustGovernanceInterface public justGovernance;
    JustTimelockInterface public justTimelock;

    // Delegation tracking
    struct DelegationInfo {
        address delegate;
        uint256 votingPower;
        uint8 chainDepth;
        bool active;
    }

    // Delegation mapping
    mapping(address => DelegationInfo) public delegationInfo;
    
    // Addresses list for enumeration
    address[] public allAddresses;
    mapping(address => uint256) private addressIndex;

    // Analytics storage
    struct AnalyticsData {
        uint256 timestamp;
        uint256 totalDelegated;
        uint256 avgChainDepth;
        uint256 maxObservedChainDepth;
        uint256 totalAddresses;
        uint256 activeDelegations;
    }
    AnalyticsData[] public dailyAnalytics;

    // To track visited nodes during delegation chain traversal
    mapping(address => bool) private _visitedDelegation;
    
    // Events
    event DelegationDepthWarning(address indexed delegator, address indexed proposedDelegatee, uint8 currentChainDepth, uint8 maxDepth);
    event DelegationDepthExceeded(address indexed delegator, address indexed proposedDelegatee, uint8 resultingChainDepth, uint8 maxDepth);
    event DelegationRecorded(address indexed delegator, address indexed delegatee, uint256 votingPower);
    event DelegationRemoved(address indexed delegator);
    event AnalyticsUpdated(uint256 indexed timestamp, uint256 totalDelegated, uint256 avgChainDepth);
    event ContractAddressUpdated(string indexed contractType, address indexed newAddress);

    /**
     * @notice Initializes the contract with required addresses
     * @param tokenAddress Address of the JustToken contract
     * @param governanceAddress Address of the JustGovernance contract (optional)
     * @param timelockAddress Address of the JustTimelock contract (optional)
     * @param admin Initial admin address
     */
    function initialize(
        address tokenAddress,
        address governanceAddress,
        address timelockAddress,
        address admin
    ) public initializer {
        if(tokenAddress == address(0)) revert ZeroAddress();
        
        __AccessControlEnumerable_init();
        __Pausable_init();
        __ReentrancyGuard_init();
        __UUPSUpgradeable_init();
        
        justToken = JustTokenInterface(tokenAddress);
        
        if (governanceAddress != address(0)) {
            justGovernance = JustGovernanceInterface(governanceAddress);
        }
        
        if (timelockAddress != address(0)) {
            justTimelock = JustTimelockInterface(timelockAddress);
        }
        
        // If admin is not provided, use msg.sender
        address adminAddress = admin != address(0) ? admin : msg.sender;
        
        _setupRole(DEFAULT_ADMIN_ROLE, adminAddress);
        _setupRole(ADMIN_ROLE, adminAddress);
        _setupRole(ANALYTICS_ROLE, adminAddress);
    }

    /**
     * @notice Function that authorizes an upgrade to a new implementation
     * @dev Can only be called by an account with ADMIN_ROLE
     * @param newImplementation Address of the new implementation
     */
    function _authorizeUpgrade(address newImplementation) internal override onlyRole(ADMIN_ROLE) {
        // Authorization is handled by the onlyRole modifier
    }
    
    /**
     * @notice Updates contract addresses for integration
     * @param tokenAddress Address of the JustToken contract
     * @param governanceAddress Address of the JustGovernance contract
     * @param timelockAddress Address of the JustTimelock contract
     */
    function updateContractAddresses(
        address tokenAddress,
        address governanceAddress,
        address timelockAddress
    ) external onlyRole(ADMIN_ROLE) {
        if (tokenAddress != address(0)) {
            justToken = JustTokenInterface(tokenAddress);
            emit ContractAddressUpdated("Token", tokenAddress);
        }
        
        if (governanceAddress != address(0)) {
            justGovernance = JustGovernanceInterface(governanceAddress);
            emit ContractAddressUpdated("Governance", governanceAddress);
        }
        
        if (timelockAddress != address(0)) {
            justTimelock = JustTimelockInterface(timelockAddress);
            emit ContractAddressUpdated("Timelock", timelockAddress);
        }
    }
    
    /**
     * @notice Pause or unpause the contract
     * @param isPaused Whether to pause or unpause
     */
    function setPaused(bool isPaused) external onlyRole(ADMIN_ROLE) {
        if (isPaused) {
            _pause();
        } else {
            _unpause();
        }
    }

    /**
     * @notice Checks the current delegation depth for an account
     * @param account The account to check delegation depth for
     * @return depth The current depth of the delegation chain
     */
    function getDelegationDepth(address account) public view returns (uint8) {
        if (account == address(0)) return 0;
        
        address current = account;
        uint8 depth = 0;
        uint8 maxDepth = justToken.MAX_DELEGATION_DEPTH();
        
        // Use a memory array to track visited nodes (cycle detection)
        address[] memory visited = new address[](maxDepth + 1);
        uint8 visitedCount = 0;
        
        while (depth < maxDepth) {
            address next = justToken.getDelegate(current);
            
            // If no delegation or self-delegation, we've reached the end
            if (next == address(0) || next == current) break;
            
            // Check for cycles by looking for the address in our visited list
            bool foundCycle = false;
            for (uint8 i = 0; i < visitedCount; i++) {
                if (visited[i] == next) {
                    foundCycle = true;
                    break;
                }
            }
            
            if (foundCycle) break;
            
            // Store visited node
            visited[visitedCount++] = current;
            
            // Move to the next account in the chain
            current = next;
            depth++;
        }
        
        return depth;
    }

    /**
     * @notice Get delegation paths for all accounts delegating to this account
     * @param account The account to check
     * @return maxBackwardDepth The maximum backward chain depth
     */
    function getBackwardDelegationDepth(address account) public view returns (uint8) {
        if (account == address(0)) return 0;
        
        // Get all direct delegators
        address[] memory directDelegators = justToken.getDelegatorsOf(account);
        
        if (directDelegators.length == 0) return 0;
        
        uint8 maxBackwardDepth = 1; // Start with depth of 1 for direct delegators
        
        // For each direct delegator, check if they have delegators too
        for (uint i = 0; i < directDelegators.length; i++) {
            address delegator = directDelegators[i];
            address[] memory subDelegators = justToken.getDelegatorsOf(delegator);
            
            if (subDelegators.length > 0) {
                uint8 subDepth = 2; // 1 (direct) + 1 (sub)
                
                // Check for further delegation depth
                for (uint j = 0; j < subDelegators.length; j++) {
                    address subDelegator = subDelegators[j];
                    address[] memory subSubDelegators = justToken.getDelegatorsOf(subDelegator);
                    
                    if (subSubDelegators.length > 0) {
                        uint8 subSubDepth = 3; // 1 (direct) + 1 (sub) + 1 (sub-sub)
                        
                        if (subSubDepth > maxBackwardDepth) {
                            maxBackwardDepth = subSubDepth;
                        }
                    }
                }
                
                if (subDepth > maxBackwardDepth) {
                    maxBackwardDepth = subDepth;
                }
            }
        }
        
        return maxBackwardDepth;
    }
    
    /**
     * @notice Calculate the total chain depth if delegator delegates to delegatee
     * @param delegator The account that would delegate
     * @param delegatee The account that would be delegated to
     * @return totalDepth The total depth that would result
     */
    function calculateResultingChainDepth(address delegator, address delegatee) public view returns (uint8) {
        // Self-delegation doesn't increase depth
        if (delegator == delegatee) return 0;
        
        // Get forward chain depth (delegatee to end of chain)
        uint8 forwardDepth = getDelegationDepth(delegatee);
        
        // Get backward chain depth (accounts delegating to delegator)
        uint8 backwardDepth = getBackwardDelegationDepth(delegator);
        
        // Total depth would be backward + new delegation + forward
        return backwardDepth + 1 + forwardDepth;
    }
    
 /**
 * @notice Improved cycle detection for diamond patterns and complex delegation structures
 * @param delegator The account that would delegate
 * @param delegatee The account that would be delegated to
 * @return wouldCreateCycle True if delegation would create a cycle
 */
function wouldCreateDelegationCycle(address delegator, address delegatee) public view returns (bool) {
    // Quick checks first
    if (delegator == delegatee) return false;
    if (justToken.getDelegate(delegatee) == delegator) return true;
    
    // Check if the delegation graph is too complex for on-chain analysis
    uint256 delegationComplexity = _estimateDelegationComplexity(delegatee);
    if (delegationComplexity > MAX_SAFE_DELEGATION_COMPLEXITY) {
        // For very complex structures, require off-chain analysis
        revert DelegationTooComplex();
    }
    
    return _isInUpstreamChain(delegatee, delegator);
}

function _estimateDelegationComplexity(address node) internal view returns (uint256) {
    // Simple heuristic to estimate the complexity of analyzing a delegation structure
    uint256 directDelegators = justToken.getDelegatorsOf(node).length;
    uint256 chainDepth = getDelegationDepth(node);
    
    return directDelegators * (chainDepth + 1);
}

/**
 * @notice Check if target is in the upstream delegation chain of any node
 * @param node The starting node to check from
 * @param target The address we're looking for in the upstream chain
 * @return isInChain True if target is in the upstream chain
 */
function _isInUpstreamChain(address node, address target) internal view returns (bool) {
    // Max depth to prevent infinite loops
    uint8 maxDepth = justToken.MAX_DELEGATION_DEPTH();
    
    // Set of visited nodes to avoid cycles
    address[] memory visited = new address[](50);
    uint256 visitedCount = 0;
    
    // Start with initial node
    address[] memory queue = new address[](50);
    uint256 queueStart = 0;
    uint256 queueEnd = 0;
    
    // Add starting node to queue
    queue[queueEnd++] = node;
    visited[visitedCount++] = node;
    
    // Use BFS to traverse the delegation graph
    while (queueStart < queueEnd) {
        address current = queue[queueStart++];
        
        // Check direct delegate
        address currentDelegate = justToken.getDelegate(current);
        if (currentDelegate != address(0) && currentDelegate != current) {
            // If we found our target, return true
            if (currentDelegate == target) return true;
            
            // Check if we've visited this node before
            bool alreadyVisited = false;
            for (uint256 i = 0; i < visitedCount; i++) {
                if (visited[i] == currentDelegate) {
                    alreadyVisited = true;
                    break;
                }
            }
            
            // If not visited and queue not full, add to queue
            if (!alreadyVisited && queueEnd < queue.length) {
                queue[queueEnd++] = currentDelegate;
                visited[visitedCount++] = currentDelegate;
            }
        }
        
        // Now check all delegators of the current node
        // This is critical for detecting diamond patterns
        address[] memory delegators = justToken.getDelegatorsOf(current);
        for (uint256 i = 0; i < delegators.length; i++) {
            address delegator = delegators[i];
            
            // Skip self-references
            if (delegator == current) continue;
            
            // If we found our target, return true
            if (delegator == target) return true;
            
            // Check if the delegator's delegate is our target
            // This specifically checks the diamond pattern case
            address delegatorDelegate = justToken.getDelegate(delegator);
            if (delegatorDelegate == target) return true;
            
            // Check if we've visited this node before
            bool alreadyVisited = false;
            for (uint256 j = 0; j < visitedCount; j++) {
                if (visited[j] == delegator) {
                    alreadyVisited = true;
                    break;
                }
            }
            
            // If not visited and queue not full, add to queue
            if (!alreadyVisited && queueEnd < queue.length) {
                queue[queueEnd++] = delegator;
                visited[visitedCount++] = delegator;
            }
        }
    }
    
    return false;
}

/**
 * @notice Fast check for specifically diamond pattern cycles
 * @param delegator The account that would delegate
 * @param delegatee The account that would be delegated to
 * @return wouldCreateCycle True if delegation would create a diamond pattern cycle
 */
function checkDiamondPatternCycle(address delegator, address delegatee) public view returns (bool) {
    // Self-delegation doesn't create a cycle
    if (delegator == delegatee) return false;
    
    // Get current delegate of delegatee
    address delegateeDelegate = justToken.getDelegate(delegatee);
    
    // If delegatee doesn't delegate or delegates to self, no diamond pattern
    if (delegateeDelegate == address(0) || delegateeDelegate == delegatee) return false;
    
    // Follow the chain from delegatee until we reach a node that doesn't delegate
    address current = delegatee;
    uint8 depth = 0;
    
    while (depth < justToken.MAX_DELEGATION_DEPTH()) {
        address next = justToken.getDelegate(current);
        
        // Reached end of chain
        if (next == address(0) || next == current) break;
        
        // For each node in the chain, check if delegator has delegated to it
        // This is specifically checking if delegator → next creates a diamond
        if (justToken.getDelegate(delegator) == next) return true;
        
        // Check all accounts that delegate to this node
        address[] memory nodeDelegators = justToken.getDelegatorsOf(next);
        for (uint256 i = 0; i < nodeDelegators.length; i++) {
            // If delegator delegates to any of these accounts, we have a diamond pattern
            if (justToken.getDelegate(delegator) == nodeDelegators[i]) return true;
        }
        
        current = next;
        depth++;
    }
    
    return false;
}
    
    /**
     * @notice Checks if delegating would get close to or exceed the max depth
     * @param delegator The account that would delegate
     * @param delegatee The account that would be delegated to
     * @return warningLevel 0=no warning, 1=close to limit, 2=at limit, 3=exceeds limit
     */
    function checkDelegationDepthWarning(address delegator, address delegatee) 
        public view returns (uint8) 
    {
        uint8 maxDepth = justToken.MAX_DELEGATION_DEPTH();
        
        // Self-delegation is always fine
        if (delegator == delegatee) return 0;
        
        // Check for cycles first
        if (wouldCreateDelegationCycle(delegator, delegatee)) {
            return 3; // Exceeds limit (would create cycle)
        }
        
        // Calculate the resulting chain depth
        uint8 resultingDepth = calculateResultingChainDepth(delegator, delegatee);
        
        if (resultingDepth > maxDepth) {
            return 3; // Exceeds limit
        } else if (resultingDepth == maxDepth) {
            return 2; // At limit
        } else if (resultingDepth >= maxDepth - 2) {
            return 1; // Close to limit
        }
        
        return 0; // No warning
    }
    
    /**
     * @notice Check and emit a warning if delegation would approach max depth
     * @dev This should be called before delegating
     * @param delegator The account that would delegate
     * @param delegatee The account that would be delegated to
     * @return canProceed False if delegation would exceed max depth
     */
    function checkAndWarnDelegationDepth(address delegator, address delegatee) 
        external whenNotPaused nonReentrant returns (bool) 
    {
        uint8 warningLevel = checkDelegationDepthWarning(delegator, delegatee);
        uint8 maxDepth = justToken.MAX_DELEGATION_DEPTH();
        
        if (warningLevel == 3) {
            // Exceeds limit
            uint8 resultingDepth = calculateResultingChainDepth(delegator, delegatee);
            emit DelegationDepthExceeded(delegator, delegatee, resultingDepth, maxDepth);
            return false;
        } else if (warningLevel > 0) {
            // Warning but not exceeding
            uint8 currentDepth = getDelegationDepth(delegatee);
            emit DelegationDepthWarning(delegator, delegatee, currentDepth, maxDepth);
            return true;
        }
        
        return true; // No warning, can proceed
    }
    
    /**
     * @notice Record delegation information for analytics
     * @param delegator The account delegating
     * @param delegatee The account receiving delegation
     */
    function recordDelegation(address delegator, address delegatee) 
        external whenNotPaused nonReentrant onlyRole(ANALYTICS_ROLE) 
    {
        if (delegator == address(0)) revert InvalidDelegator();
        
        // If delegatee is zero, it means removing delegation
        if (delegatee == address(0)) {
            if (delegationInfo[delegator].active) {
                delegationInfo[delegator].active = false;
                delegationInfo[delegator].delegate = address(0);
                emit DelegationRemoved(delegator);
            }
            return;
        }
        
        // Record or update delegation info
        uint256 votingPower = justToken.balanceOf(delegator);
        uint8 chainDepth = getDelegationDepth(delegatee);
        
        // If first time, add to address list
        if (!delegationInfo[delegator].active && addressIndex[delegator] == 0) {
            allAddresses.push(delegator);
            addressIndex[delegator] = allAddresses.length;
        }
        
        delegationInfo[delegator] = DelegationInfo({
            delegate: delegatee,
            votingPower: votingPower,
            chainDepth: chainDepth,
            active: true
        });
        
        emit DelegationRecorded(delegator, delegatee, votingPower);
    }
    
    /**
     * @notice Get analytics for delegations with pagination
     * @param startIndex The starting index for pagination
     * @param count Maximum number of items to return
     * @return addresses List of addresses
     * @return delegates List of delegate addresses
     * @return votingPowers List of voting powers
     * @return depths List of chain depths
     */
    function getDelegationAnalytics(uint256 startIndex, uint256 count)
        external view returns (
            address[] memory addresses,
            address[] memory delegates,
            uint256[] memory votingPowers,
            uint8[] memory depths
        )
    {
        // Determine actual count based on available data
        uint256 availableCount = 0;
        if (startIndex < allAddresses.length) {
            availableCount = allAddresses.length - startIndex;
        }
        uint256 actualCount = availableCount < count ? availableCount : count;
        
        addresses = new address[](actualCount);
        delegates = new address[](actualCount);
        votingPowers = new uint256[](actualCount);
        depths = new uint8[](actualCount);
        
        for (uint256 i = 0; i < actualCount; i++) {
            address addr = allAddresses[startIndex + i];
            DelegationInfo memory info = delegationInfo[addr];
            
            addresses[i] = addr;
            delegates[i] = info.delegate;
            votingPowers[i] = info.votingPower;
            depths[i] = info.chainDepth;
        }
        
        return (addresses, delegates, votingPowers, depths);
    }
    
    /**
     * @notice Get historical analytics data with pagination
     * @param startIndex The starting index for pagination
     * @param count Maximum number of items to return
     * @return The requested analytics data
     */
    function getHistoricalAnalytics(uint256 startIndex, uint256 count) 
        external view returns (AnalyticsData[] memory) 
    {
        // Determine actual count based on available data
        uint256 availableCount = 0;
        if (startIndex < dailyAnalytics.length) {
            availableCount = dailyAnalytics.length - startIndex;
        }
        uint256 actualCount = availableCount < count ? availableCount : count;
        
        AnalyticsData[] memory result = new AnalyticsData[](actualCount);
        
        for (uint256 i = 0; i < actualCount; i++) {
            result[i] = dailyAnalytics[startIndex + i];
        }
        
        return result;
    }
    
    /**
     * @notice Get the voting power concentrated in top delegates
     * @param count Number of top delegates to analyze
     * @return topDelegates Array of top delegate addresses
     * @return delegatedPower Array of voting power delegated to each
     * @return percentage Array of percentage of total supply delegated to each
     */
    function getTopDelegateConcentration(uint256 count)
        external view returns (
            address[] memory topDelegates,
            uint256[] memory delegatedPower,
            uint256[] memory percentage
        )
    {
        // Get unique delegates and powers
        (address[] memory uniqueDelegates, uint256[] memory powers, uint256 uniqueCount) = _collectDelegatePowers();
        
        // Sort by power
        _sortDelegatesByPower(uniqueDelegates, powers, uniqueCount);
        
        // Prepare return data
        return _prepareTopDelegatesResult(uniqueDelegates, powers, uniqueCount, count);
    }
    
    /**
     * @notice Collect all unique delegates and their power
     * @return delegates Array of delegate addresses
     * @return powers Array of voting powers
     * @return count Number of unique delegates found
     */
    function _collectDelegatePowers() 
        internal view returns (
            address[] memory delegates,
            uint256[] memory powers,
            uint256 count
        ) 
    {
        uint256 maxAddresses = allAddresses.length;
        delegates = new address[](maxAddresses);
        powers = new uint256[](maxAddresses);
        count = 0;
        
        for (uint256 i = 0; i < allAddresses.length; i++) {
            address addr = allAddresses[i];
            DelegationInfo memory info = delegationInfo[addr];
            
            if (!info.active || info.delegate == address(0)) continue;
            
            // Check if we've seen this delegate before
            bool found = false;
            for (uint256 j = 0; j < count; j++) {
                if (delegates[j] == info.delegate) {
                    powers[j] += info.votingPower;
                    found = true;
                    break;
                }
            }
            
            // If not found, add as new delegate
            if (!found) {
                delegates[count] = info.delegate;
                powers[count] = info.votingPower;
                count++;
            }
        }
        
        return (delegates, powers, count);
    }
    
    /**
     * @notice Sort delegates by power (bubble sort)
     * @param delegates Array of delegate addresses
     * @param powers Array of voting powers
     * @param count Number of delegates to sort
     */
    function _sortDelegatesByPower(
        address[] memory delegates,
        uint256[] memory powers,
        uint256 count
    ) internal pure {
        for (uint256 i = 0; i < count; i++) {
            for (uint256 j = i + 1; j < count; j++) {
                if (powers[i] < powers[j]) {
                    // Swap delegates
                    (delegates[i], delegates[j]) = (delegates[j], delegates[i]);
                    
                    // Swap powers
                    (powers[i], powers[j]) = (powers[j], powers[i]);
                }
            }
        }
    }
    
    /**
     * @notice Prepare the result arrays for top delegates
     * @param delegates Array of sorted delegate addresses
     * @param powers Array of sorted voting powers
     * @param uniqueCount Number of unique delegates
     * @param requestedCount Number of delegates requested
     * @return topDelegates Array of top delegate addresses
     * @return delegatedPower Array of voting power delegated to each
     * @return percentage Array of percentage of total supply delegated to each
     */
    function _prepareTopDelegatesResult(
        address[] memory delegates,
        uint256[] memory powers,
        uint256 uniqueCount,
        uint256 requestedCount
    ) internal view returns (
        address[] memory topDelegates,
        uint256[] memory delegatedPower,
        uint256[] memory percentage
    ) {
        // Get total supply for percentage calculations
        uint256 totalSupply = justToken.totalSupply();
        
        // Determine how many delegates to return
        uint256 returnCount = requestedCount < uniqueCount ? requestedCount : uniqueCount;
        
        // Prepare return arrays
        topDelegates = new address[](returnCount);
        delegatedPower = new uint256[](returnCount);
        percentage = new uint256[](returnCount);
        
        for (uint256 i = 0; i < returnCount; i++) {
            topDelegates[i] = delegates[i];
            delegatedPower[i] = powers[i];
            percentage[i] = totalSupply > 0 ? (powers[i] * 10000) / totalSupply : 0; // Basis points (1/100 of a percent)
        }
        
        return (topDelegates, delegatedPower, percentage);
    }
    
    
    /**
     * @notice Update the power for a delegate, adding a new entry if needed
     * @param delegates Array of unique delegates
     * @param powers Array of powers for each delegate
     * @param count Current count of unique delegates
     * @param delegate The delegate to update
     * @param power The power to add to this delegate
     */
    function _updateDelegatePower(
        address[] memory delegates,
        uint256[] memory powers,
        uint256 count,
        address delegate,
        uint256 power
    ) internal pure returns (uint256) {
        // If delegate is zero or self, skip
        if (delegate == address(0)) {
            return count;
        }
        
        // Check if we've seen this delegate before
        for (uint256 j = 0; j < count; j++) {
            if (delegates[j] == delegate) {
                powers[j] += power;
                return count;
            }
        }
        
        // If not found, add as new delegate
        delegates[count] = delegate;
        powers[count] = power;
        
        return count + 1;
    }
    
    /**
     * @notice Analyze transaction risk based on timelock threat level
     * @param target Target address for the transaction
     * @param data Call data for the transaction
     * @return riskLevel The timelock threat level (0=LOW, 1=MEDIUM, 2=HIGH, 3=CRITICAL)
     * @return delayPeriod The delay period required based on the risk level
     */
    function analyzeTransactionRisk(address target, bytes calldata data) 
        external view returns (uint8 riskLevel, uint256 delayPeriod) 
    {
        if (address(justTimelock) == address(0)) revert NoTimelock();
        
        // Query the timelock for threat level
        JustTimelockInterface.ThreatLevel level = justTimelock.getThreatLevel(target, data);
        
        // Convert to expected format
        riskLevel = uint8(level);
        
        // Get delay info from timelock transaction data
        // This is an approximation - in a real implementation we would query actual delay values
        if (level == JustTimelockInterface.ThreatLevel.LOW) {
            delayPeriod = 1 days;
        } else if (level == JustTimelockInterface.ThreatLevel.MEDIUM) {
            delayPeriod = 3 days;
        } else if (level == JustTimelockInterface.ThreatLevel.HIGH) {
            delayPeriod = 7 days;
        } else {
            delayPeriod = 14 days;
        }
        
        return (riskLevel, delayPeriod);
    }
    
    /**
     * @notice Check the status of a timelock transaction
     * @param txHash The hash of the timelock transaction
     * @return target Target address
     * @return value ETH value
     * @return data Call data
     * @return eta Execution time
     * @return executed Whether the transaction has been executed
     * @return expired Whether the transaction has expired
     * @return timeRemaining Time remaining until execution possible (0 if executable or expired)
     */
    function checkTimelockTransaction(bytes32 txHash)
        external view returns (
            address target,
            uint256 value,
            bytes memory data,
            uint256 eta,
            bool executed,
            bool expired,
            uint256 timeRemaining
        )
    {
        if (address(justTimelock) == address(0)) revert NoTimelock();
        
        (target, value, data, eta, executed) = justTimelock.getTransaction(txHash);
        
        uint256 gracePeriod = 14 days; // Default grace period
        
        expired = !executed && block.timestamp > eta + gracePeriod;
        
        if (block.timestamp < eta) {
            timeRemaining = eta - block.timestamp;
        } else {
            timeRemaining = 0;
        }
        
        return (target, value, data, eta, executed, expired, timeRemaining);
    }
    
    /**
     * @notice Get account delegation statistics
     * @param account The account to analyze
     * @return delegateAddress The address this account delegates to
     * @return isDelegating Whether this account is delegating
     * @return delegatorCount Number of accounts delegating to this account
     * @return totalDelegatedPower Total voting power delegated to this account
     * @return percentOfTotalSupply Percentage of total supply controlled (basis points)
     */
    function getAccountDelegationStats(address account)
        external view returns (
            address delegateAddress,
            bool isDelegating,
            uint256 delegatorCount,
            uint256 totalDelegatedPower,
            uint256 percentOfTotalSupply
        )
    {
        if (account == address(0)) revert InvalidAccount();
        
        // Get current delegation
        delegateAddress = justToken.getDelegate(account);
        isDelegating = delegateAddress != address(0) && delegateAddress != account;
        
        // Get delegators
        address[] memory delegators = justToken.getDelegatorsOf(account);
        delegatorCount = delegators.length;
        
        // Calculate delegated power
        totalDelegatedPower = 0;
        for (uint256 i = 0; i < delegators.length; i++) {
            totalDelegatedPower += justToken.balanceOf(delegators[i]);
        }
        
        // Add account's own balance
        uint256 totalPower = totalDelegatedPower + justToken.balanceOf(account);
        
        // Calculate percentage
        uint256 totalSupply = justToken.totalSupply();
        percentOfTotalSupply = totalSupply > 0 ? (totalPower * 10000) / totalSupply : 0;
        
        return (delegateAddress, isDelegating, delegatorCount, totalDelegatedPower, percentOfTotalSupply);
    }
    
    /**
     * @notice Check if an account participated in a specific proposal
     * @param account The account to check
     * @param proposalId The ID of the proposal
     * @return voted Whether the account voted
     * @return votingPower The voting power used
     */
    function checkProposalParticipation(address account, uint256 proposalId)
        external view returns (bool voted, uint256 votingPower)
    {
        if (address(justGovernance) == address(0)) revert NoGovernance();
        if (account == address(0)) revert InvalidAccount();
        
        votingPower = justGovernance.proposalVoterInfo(proposalId, account);
        voted = votingPower > 0;
        
        return (voted, votingPower);
    }
    
    /**
     * @notice Calculate DAO participation metrics
     * @param lastNProposals Number of most recent proposals to analyze
     * @return uniqueVoters Total unique voters across proposals
     * @return averageParticipation Average participation rate (basis points of total token supply)
     * @return delegateParticipation Rate of participation via delegates (basis points)
     */
    function calculateDAOParticipationMetrics(uint256 lastNProposals)
        external view returns (
            uint256 uniqueVoters,
            uint256 averageParticipation,
            uint256 delegateParticipation
        )
    {
        // This is a placeholder implementation that would be replaced with actual logic
        // In a real implementation we would need to:
        // 1. Get the last N proposal IDs from the governance contract
        // 2. For each proposal, calculate participation metrics
        // 3. Aggregate and return stats
        
        // For now, return dummy values
        uniqueVoters = 250;
        averageParticipation = 7500; // 75% in basis points
        delegateParticipation = 4000; // 40% in basis points
        
        return (uniqueVoters, averageParticipation, delegateParticipation);
    }
    
    /**
     * @notice Get all delegators in a delegation tree (recursive delegations) - first level
     * @dev Entry point that handles initial setup and avoids stack-too-deep errors
     * @param account The root account
     * @param maxDepth Maximum tree depth to search
     * @return List of all delegator addresses in the tree
     */
    function getAllDelegatorsInTree(address account, uint8 maxDepth) 
        external view returns (address[] memory) 
    {
        if (account == address(0)) return new address[](0);
        
        // Get direct delegators first
        address[] memory directDelegators = justToken.getDelegatorsOf(account);
        if (directDelegators.length == 0 || maxDepth == 0) {
            return directDelegators;
        }
        
        // Use 10000 as maximum capacity to prevent excessive gas usage
        address[] memory result = new address[](10000);
        uint256 resultCount = 0;
        
        // Add direct delegators first (depth 1)
        for (uint256 i = 0; i < directDelegators.length && resultCount < 10000; i++) {
            result[resultCount++] = directDelegators[i];
        }
        
        // Process deeper levels separately if needed
        if (maxDepth > 1 && resultCount < 10000) {
            resultCount = _processDeepDelegators(result, resultCount, directDelegators, maxDepth);
        }
        
        // Create correctly sized result array
        address[] memory trimmedResult = new address[](resultCount);
        for (uint256 i = 0; i < resultCount; i++) {
            trimmedResult[i] = result[i];
        }
        
        return trimmedResult;
    }
    
    /**
     * @notice Process deeper levels of the delegation tree to avoid stack-too-deep errors
     * @dev Internal helper that handles the BFS traversal of the delegation tree
     * @param result The array to store results in
     * @param resultCount The current count of results
     * @param currentLevel The current level of delegators to process
     * @param maxDepth Maximum depth to search
     * @return Updated result count
     */
    function _processDeepDelegators(
        address[] memory result, 
        uint256 resultCount,
        address[] memory currentLevel,
        uint8 maxDepth
    ) internal view returns (uint256) {
        // Queue for breadth-first traversal
        address[] memory queue = new address[](10000);
        
        // Copy initial level to queue
        uint256 queueStart = 0;
        uint256 queueEnd = currentLevel.length;
        for (uint256 i = 0; i < currentLevel.length; i++) {
            queue[i] = currentLevel[i];
        }
        
        // BFS traversal
        uint8 currentDepth = 1;
        while (currentDepth < maxDepth && queueStart < queueEnd && resultCount < 10000) {
            // Get the size of the current level
            uint256 levelSize = queueEnd - queueStart;
            currentDepth++;
            
            // Process each node at the current level
            for (uint256 i = 0; i < levelSize && resultCount < 10000; i++) {
                address addr = queue[queueStart++];
                
                // Get next level delegators
                address[] memory nextLevel = justToken.getDelegatorsOf(addr);
                
                // Add to queue and result
                for (uint256 j = 0; j < nextLevel.length && resultCount < 10000 && queueEnd < 10000; j++) {
                    address delegator = nextLevel[j];
                    queue[queueEnd++] = delegator;
                    result[resultCount++] = delegator;
                }
            }
        }
        
        return resultCount;
    }
    
    /**
     * @notice Get the delegation path from one address to its ultimate delegate
     * @param account The starting account
     * @return path Array of addresses in the delegation path
     * @return depth Depth of the delegation chain
     */
    function getDelegationPath(address account) 
        external view returns (address[] memory path, uint8 depth) 
    {
        if (account == address(0)) return (new address[](0), 0);
        
        // First pass to determine length
        address current = account;
        uint8 length = 1; // Start with the account itself
        uint8 maxDepth = justToken.MAX_DELEGATION_DEPTH();
        
        while (length <= maxDepth) {
            address next = justToken.getDelegate(current);
            if (next == address(0) || next == current) break;
            current = next;
            length++;
        }
        
        // Second pass to fill array
        path = new address[](length);
        current = account;
        path[0] = current;
        
        for (uint8 i = 1; i < length; i++) {
            current = justToken.getDelegate(current);
            path[i] = current;
        }
        
        return (path, length - 1); // Depth is length - 1
    }

    
    /**
     * @notice Calculate the effective voting power controlled by an address
     * @param account The account to check
     * @return votingPower Total voting power controlled (own + delegated)
     */
    function calculateEffectiveVotingPower(address account) 
        external view returns (uint256 votingPower) 
    {
        if (account == address(0)) return 0;
        
        // Start with the account's own balance
        votingPower = justToken.balanceOf(account);
        
        // Get all direct delegators
        address[] memory delegators = justToken.getDelegatorsOf(account);
        
        // Add up the voting power of all delegators
        for (uint256 i = 0; i < delegators.length; i++) {
            votingPower += justToken.balanceOf(delegators[i]);
        }
        
        return votingPower;
    }
    
    /**
     * @notice Detect delegation loops
     * @return loopExists Whether a delegation loop was found
     * @return loopAccounts The accounts in the loop (if found)
     */
    function detectDelegationLoops() external view returns (bool loopExists, address[] memory loopAccounts) {
        // Initialize with capacity for 100 accounts in a loop
        address[] memory path = new address[](100);
        uint256 pathLength = 0;
        
        // Analyze each address
        for (uint256 i = 0; i < allAddresses.length && !loopExists; i++) {
            address start = allAddresses[i];
            
            // Reset the path for this starting point
            pathLength = 0;
            
            // Trace the delegation path
            address current = start;
            while (current != address(0) && pathLength < 100) {
                // Check if we've already seen this address in the current path (loop detection)
                for (uint256 j = 0; j < pathLength; j++) {
                    if (path[j] == current) {
                        // Found a loop
                        loopExists = true;
                        
                        // Extract the loop - from position j to pathLength
                        uint256 loopSize = pathLength - j;
                        loopAccounts = new address[](loopSize);
                        for (uint256 k = 0; k < loopSize; k++) {
                            loopAccounts[k] = path[j + k];
                        }
                        break;
                    }
                }
                
                if (loopExists) break; // Exit the while loop if we found a loop
                
                // Add to path
                path[pathLength++] = current;
                
                // Move to the next delegate
                current = justToken.getDelegate(current);
                
                // If self-delegation or no delegation, we're done
                if (current == address(0) || (pathLength > 0 && current == path[pathLength-1])) {
                    break;
                }
            }
            
            if (loopExists) break; // Exit the for loop if we found a loop
        }
        
        // If no loop found, return empty array
        if (!loopExists) {
            loopAccounts = new address[](0);
        }
        
        return (loopExists, loopAccounts);
    }
    
    /**
     * @notice Validate a delegation before it happens
     * @param delegator The account that wants to delegate
     * @param delegatee The account that would be delegated to
     * @return isValid Whether the delegation is valid
     * @return reason Reason code if invalid (0=valid, 1=cycle, 2=max depth)
     */
    function validateDelegation(address delegator, address delegatee) 
        external view returns (bool isValid, uint8 reason) 
    {
        // Self-delegation is always valid
        if (delegator == delegatee || delegatee == address(0)) {
            return (true, 0);
        }
        
        // Check for cycles
        if (wouldCreateDelegationCycle(delegator, delegatee)) {
            return (false, 1);
        }
        
        // Check for max depth
        uint8 resultingDepth = calculateResultingChainDepth(delegator, delegatee);
        uint8 maxDepth = justToken.MAX_DELEGATION_DEPTH();
        
        if (resultingDepth > maxDepth) {
            return (false, 2);
        }
        
        return (true, 0);
    }
    
    /**
     * @dev This empty reserved space is put in place to allow future versions to add new
     * variables without shifting down storage in the inheritance chain.
     * See https://docs.openzeppelin.com/contracts/4.x/upgradeable#storage_gaps
     */
    uint256[50] private __gap;
}