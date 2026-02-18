// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

import "./UnderwritingRegistry.sol";
import "./NAVOracle.sol";
import "./interface/ICashFlowLogic.sol";

contract RWALendingPool is ReentrancyGuard, Ownable {

    // ------------------------------------------------------------
    // Core Dependencies
    // ------------------------------------------------------------

    IERC20 public immutable stablecoin;
    UnderwritingRegistry public immutable registry;
    NAVOracle public immutable navOracle;

    // ------------------------------------------------------------
    // Storage
    // ------------------------------------------------------------

    // user => assetId => collateral shares
    mapping(address => mapping(uint256 => uint256)) public collateral;

    // user => assetId => debt in stablecoin units
    mapping(address => mapping(uint256 => DebtPosition)) public debt;

    // assetId => share token address
    mapping(uint256 => address) public assetIdToToken;

    // assetId => cashflow logic
    mapping(uint256 => address) public assetIdToLogic;

    // 10500 = 105% (5% bonus)
    uint256 public liquidationBonusBps = 10500;

    // health factor < 0.95e18 → liquidatable
    uint256 public constant LIQUIDATION_THRESHOLD = 0.95e18;

    uint256 public constant YEAR = 365 days;

    struct DebtPosition {
        uint256 principal;
        uint256 lastAccrued;
    }

    uint256 public protocolLiquidationFeeBps = 200; // 2%
    address public treasury;


    // ------------------------------------------------------------
    // Events
    // ------------------------------------------------------------

    event CollateralDeposited(address indexed user, uint256 indexed assetId, uint256 amount);
    event CollateralWithdrawn(address indexed user, uint256 indexed assetId, uint256 amount);
    event Borrowed(address indexed user, uint256 indexed assetId, uint256 amount);
    event Repaid(address indexed user, uint256 indexed assetId, uint256 amount);
    event Liquidated(
        address indexed user,
        uint256 indexed assetId,
        uint256 debtRepaid,
        uint256 collateralSeized
    );

    event AssetTokenSet(uint256 indexed assetId, address token);
    event AssetLogicSet(uint256 indexed assetId, address logic);
    event LiquidationBonusUpdated(uint256 oldBonus, uint256 newBonus);

    // ------------------------------------------------------------
    // Constructor
    // ------------------------------------------------------------

    constructor(
        address _stable,
        address _registry,
        address _navOracle
    ) Ownable(msg.sender) {
        require(_stable != address(0), "Invalid stable");
        require(_registry != address(0), "Invalid registry");
        require(_navOracle != address(0), "Invalid oracle");

        stablecoin = IERC20(_stable);
        registry = UnderwritingRegistry(_registry);
        navOracle = NAVOracle(_navOracle);
        treasury = msg.sender;
    }

    // ============================================================
    // Collateral
    // ============================================================

    function depositCollateral(
        uint256 assetId,
        uint256 amount
    ) external nonReentrant {
        require(amount > 0, "Invalid amount");

        address token = assetIdToToken[assetId];
        require(token != address(0), "Asset not configured");

        IERC20(token).transferFrom(msg.sender, address(this), amount);

        collateral[msg.sender][assetId] += amount;

        emit CollateralDeposited(msg.sender, assetId, amount);
    }

    function withdrawCollateral(
        uint256 assetId,
        uint256 amount
    ) external nonReentrant {
        require(amount > 0, "Invalid amount");
        require(collateral[msg.sender][assetId] >= amount, "Insufficient collateral");

        collateral[msg.sender][assetId] -= amount;

        require(
            healthFactor(msg.sender, assetId) >= 1e18,
            "Would become unhealthy"
        );

        address token = assetIdToToken[assetId];
        IERC20(token).transfer(msg.sender, amount);

        emit CollateralWithdrawn(msg.sender, assetId, amount);
    }

    // ============================================================
    // Borrow / Repay
    // ============================================================

    function borrow(
        uint256 assetId,
        uint256 amount
    ) external nonReentrant {
        require(amount > 0, "Invalid borrow");
        require(registry.isApproved(msg.sender, assetId), "Not approved");

        _accrue(msg.sender, assetId);

        uint256 maxBorrow = _maxBorrowable(msg.sender, assetId);

        DebtPosition storage position = debt[msg.sender][assetId];

        require(
            position.principal + amount <= maxBorrow,
            "Exceeds LTV"
        );

        
        position.principal += amount;

        stablecoin.transfer(msg.sender, amount);

        if (position.lastAccrued == 0) {
            position.lastAccrued = block.timestamp;
        }


        emit Borrowed(msg.sender, assetId, amount);
    }

    function repay(
        uint256 assetId,
        uint256 amount
    ) external nonReentrant {
        require(amount > 0, "Invalid repay");

        _accrue(msg.sender, assetId);

        DebtPosition storage position = debt[msg.sender][assetId];

        uint256 userDebt = position.principal;
        require(userDebt > 0, "No debt");

        stablecoin.transferFrom(msg.sender, address(this), amount);

        if (amount >= userDebt) {
            position.principal = 0;
            position.lastAccrued = block.timestamp;
        } else {
            position.principal -= amount;
        }

        emit Repaid(msg.sender, assetId, amount);
    }

    // ============================================================
    // Liquidation
    // ============================================================

    function liquidate(
        address user,
        uint256 assetId,
        uint256 repayAmount
    ) external nonReentrant {

        _accrue(user, assetId);

        require(
            healthFactor(user, assetId) < LIQUIDATION_THRESHOLD,
            "Healthy position"
        );

        DebtPosition storage position = debt[user][assetId];

        uint256 userDebt = position.principal;
        require(userDebt > 0, "No debt");

        uint256 nav = _getFreshNAV(assetId);

        uint256 maxUsdRecoverable =
            (collateral[user][assetId] * nav) / 1e18;

        uint256 maxRepayPossible =
            (maxUsdRecoverable * 10_000) / liquidationBonusBps;

        if (repayAmount > maxRepayPossible) {
            repayAmount = maxRepayPossible;
        }

        if (repayAmount > userDebt) {
            repayAmount = userDebt;
        }


        // Liquidator repays debt
        stablecoin.transferFrom(msg.sender, address(this), repayAmount);

        position.principal -= repayAmount;

        if (position.principal == 0) {
            position.lastAccrued = block.timestamp;
        }

        uint256 liquidatorUSD =
            (repayAmount * liquidationBonusBps) / 10_000;

        uint256 protocolUSD =
            (repayAmount * protocolLiquidationFeeBps) / 10_000;

        uint256 totalUSDSeized = liquidatorUSD + protocolUSD;

        uint256 totalShares =
            (totalUSDSeized * 1e18) / nav;


        uint256 userCollateral = collateral[user][assetId];

        if (totalShares > userCollateral) {
            totalShares = userCollateral;
        }

        uint256 liquidatorShares =
            (liquidatorUSD * 1e18) / nav;

        uint256 protocolShares =
            (protocolUSD * 1e18) / nav;

        if (liquidatorShares + protocolShares > totalShares) {
            // adjust in case of rounding
            liquidatorShares = (liquidatorShares * totalShares) /
                (liquidatorShares + protocolShares);
            protocolShares = totalShares - liquidatorShares;
        }


        collateral[user][assetId] -= totalShares;

        address token = assetIdToToken[assetId];
        IERC20(token).transfer(msg.sender, liquidatorShares);
        IERC20(token).transfer(treasury, protocolShares);

        emit Liquidated(user, assetId, repayAmount, totalShares);
    }

    // ============================================================
    // View Logic
    // ============================================================

    function healthFactor(
        address user,
        uint256 assetId
    ) public view returns (uint256) {

        uint256 currentDebt = _debtWithAccrual(user, assetId);
        if (currentDebt == 0) return type(uint256).max;

        uint256 maxBorrow = _maxBorrowable(user, assetId);

        return (maxBorrow * 1e18) / currentDebt;
    }


    function isLiquidatable(
        address user,
        uint256 assetId
    ) external view returns (bool) {
        return healthFactor(user, assetId) < LIQUIDATION_THRESHOLD;
    }

    function _collateralValue(
        address user,
        uint256 assetId
    ) internal view returns (uint256) {
        uint256 nav = _getFreshNAV(assetId);
        uint256 shares = collateral[user][assetId];

        return (shares * nav) / 1e18;
    }

    function _maxBorrowable(
        address user,
        uint256 assetId
    ) internal view returns (uint256) {
        (, uint16 underwritingLtv,,,) =
            registry.getTerms(user, assetId);

        if (!registry.isApproved(user, assetId)) {
            return 0;
        }


        uint256 effectiveLTV =
            _effectiveLTV(assetId, underwritingLtv);

        uint256 value = _collateralValue(user, assetId);

        return (value * effectiveLTV) / 10_000;
    }

    function _effectiveLTV(
        uint256 assetId,
        uint16 underwritingLtv
    ) internal view returns (uint256) {
        uint256 healthCap = _assetHealthCap(assetId);

        return underwritingLtv < healthCap
            ? underwritingLtv
            : healthCap;
    }

    function _assetHealthCap(
        uint256 assetId
    ) internal view returns (uint256) {
        address logic = assetIdToLogic[assetId];

        if (logic == address(0)) return 10_000;

        try ICashFlowLogic(logic).getCashflowHealth()
            returns (CashflowHealth health)
        {
            if (health == CashflowHealth.PERFORMING) return 10_000;
            if (health == CashflowHealth.GRACE_PERIOD) return 8_000;
            if (health == CashflowHealth.LATE) return 5_000;
            if (health == CashflowHealth.DEFAULTED) return 0;
            return 10_000;
        } catch {
            return 10_000;
        }
    }

    function _getFreshNAV(uint256 assetId)
        internal
        view
        returns (uint256)
    {
        require(navOracle.isFresh(assetId), "Stale NAV");

        (uint256 nav,,) = navOracle.getNAVData(assetId);
        require(nav > 0, "No NAV");

        return nav;
    }

    function _accrue(address user, uint256 assetId) internal {
        DebtPosition storage position = debt[user][assetId];

        if (position.principal == 0) {
            position.lastAccrued = block.timestamp;
            return;
        }

        ( , , uint16 rateBps, , ) = registry.getTerms(user, assetId);

        uint256 timeElapsed = block.timestamp - position.lastAccrued;
        if (timeElapsed == 0) return;

        uint256 interest =
            (position.principal * rateBps * timeElapsed)
            / (10_000 * YEAR);

        position.principal += interest;
        position.lastAccrued = block.timestamp;
    }

    function _debtWithAccrual(address user, uint256 assetId)
        internal view returns (uint256)
    {
        DebtPosition memory position = debt[user][assetId];
        if (position.principal == 0) return 0;

        ( , , uint16 rateBps, , ) = registry.getTerms(user, assetId);

        uint256 timeElapsed = block.timestamp - position.lastAccrued;

        uint256 interest =
            (position.principal * rateBps * timeElapsed)
            / (10_000 * YEAR);

        return position.principal + interest;
    }



    // ============================================================
    // Admin
    // ============================================================

    function setAssetToken(
        uint256 assetId,
        address token
    ) external onlyOwner {
        require(token != address(0), "Invalid token");
        assetIdToToken[assetId] = token;

        emit AssetTokenSet(assetId, token);
    }

    function setAssetLogic(
        uint256 assetId,
        address logic
    ) external onlyOwner {
        require(logic != address(0), "Invalid logic");
        assetIdToLogic[assetId] = logic;

        emit AssetLogicSet(assetId, logic);
    }

    function setLiquidationBonus(
        uint256 newBonus
    ) external onlyOwner {
        require(newBonus >= 10_000, "Must be >=100%");

        uint256 old = liquidationBonusBps;
        liquidationBonusBps = newBonus;

        emit LiquidationBonusUpdated(old, newBonus);
    }

    function setProtocolLiquidationFee(uint256 newFeeBps)
        external
        onlyOwner
    {
        require(newFeeBps <= 2000, "Fee too high"); // cap at 20%
        protocolLiquidationFeeBps = newFeeBps;
    }

    function setTreasury(address _treasury) external onlyOwner {
        require(treasury != address(0), "No treasury");

        treasury = _treasury;
    }

}
