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
    mapping(address => mapping(uint256 => uint256)) public debt;

    // assetId => share token address
    mapping(uint256 => address) public assetIdToToken;

    // assetId => cashflow logic
    mapping(uint256 => address) public assetIdToLogic;

    // 10500 = 105% (5% bonus)
    uint256 public liquidationBonusBps = 10500;

    // health factor < 0.95e18 → liquidatable
    uint256 public constant LIQUIDATION_THRESHOLD = 0.95e18;

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

        uint256 maxBorrow = _maxBorrowable(msg.sender, assetId);

        require(
            debt[msg.sender][assetId] + amount <= maxBorrow,
            "Exceeds LTV"
        );

        debt[msg.sender][assetId] += amount;

        stablecoin.transfer(msg.sender, amount);

        emit Borrowed(msg.sender, assetId, amount);
    }

    function repay(
        uint256 assetId,
        uint256 amount
    ) external nonReentrant {
        require(amount > 0, "Invalid repay");

        uint256 userDebt = debt[msg.sender][assetId];
        require(userDebt > 0, "No debt");

        stablecoin.transferFrom(msg.sender, address(this), amount);

        if (amount >= userDebt) {
            debt[msg.sender][assetId] = 0;
        } else {
            debt[msg.sender][assetId] = userDebt - amount;
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
        require(
            healthFactor(user, assetId) < LIQUIDATION_THRESHOLD,
            "Healthy position"
        );

        uint256 userDebt = debt[user][assetId];
        require(userDebt > 0, "No debt");

        if (repayAmount > userDebt) {
            repayAmount = userDebt;
        }

        // Liquidator repays debt
        stablecoin.transferFrom(msg.sender, address(this), repayAmount);

        debt[user][assetId] -= repayAmount;

        // Calculate collateral equivalent in shares
        uint256 nav = _getFreshNAV(assetId);

        // USD value with bonus
        uint256 usdWithBonus =
            (repayAmount * liquidationBonusBps) / 10_000;

        // Convert USD → shares
        uint256 sharesToSeize =
            (usdWithBonus * 1e18) / nav;

        uint256 userCollateral = collateral[user][assetId];

        if (sharesToSeize > userCollateral) {
            sharesToSeize = userCollateral;
        }

        collateral[user][assetId] -= sharesToSeize;

        address token = assetIdToToken[assetId];
        IERC20(token).transfer(msg.sender, sharesToSeize);

        emit Liquidated(user, assetId, repayAmount, sharesToSeize);
    }

    // ============================================================
    // View Logic
    // ============================================================

    function healthFactor(
        address user,
        uint256 assetId
    ) public view returns (uint256) {
        uint256 userDebt = debt[user][assetId];
        if (userDebt == 0) return type(uint256).max;

        uint256 maxBorrow = _maxBorrowable(user, assetId);

        return (maxBorrow * 1e18) / userDebt;
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
        (bool approved, uint16 underwritingLtv,,,) =
            registry.getTerms(user, assetId);

        require(approved, "Not approved");

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
}
