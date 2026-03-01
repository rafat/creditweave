// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

import "./UnderwritingRegistry.sol";
import "./NAVOracle.sol";
import "./interface/ICashFlowLogic.sol";

interface IUnderwritingRegistryV2Adapter {
    function isApproved(address borrower, uint256 assetId) external view returns (bool);
    function isBorrowBlocked(address borrower, uint256 assetId) external view returns (bool);
    function getBorrowingTerms(address borrower, uint256 assetId)
        external
        view
        returns (uint16 maxLtvBps, uint16 rateBps, uint256 creditLimit, uint256 expiry);
    function effectiveMaxLtvBps(address borrower, uint256 assetId) external view returns (uint16);
}

interface IPortfolioRiskRegistryAdapter {
    function isBorrowAllowed(uint256 assetId) external view returns (bool);
    function applySegmentHaircut(uint256 assetId, uint16 baseLtvBps) external view returns (uint16);
}

contract RWALendingPool is ReentrancyGuard, Ownable {
    using SafeERC20 for IERC20;

    // ------------------------------------------------------------
    // Core Dependencies
    // ------------------------------------------------------------

    IERC20 public immutable stablecoin;
    UnderwritingRegistry public immutable registry;
    NAVOracle public immutable navOracle;
    address public underwritingRegistryV2;
    address public portfolioRiskRegistry;

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
    uint16 public reserveFactorBps = 1_000; // 10% of interest into reserve
    uint256 public reserveBalance;
    uint256 public totalProtocolLoss;
    address public lossWaterfall;


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
    event UnderwritingRegistryV2Set(address indexed registryV2);
    event PortfolioRiskRegistrySet(address indexed portfolioRiskRegistry);
    event ReserveFactorUpdated(uint16 oldReserveFactorBps, uint16 newReserveFactorBps);
    event InterestAccrued(
        address indexed user,
        uint256 indexed assetId,
        uint256 grossInterest,
        uint256 reserveCut,
        uint256 lenderInterest
    );
    event ReserveWithdrawn(address indexed to, uint256 amount);
    event LossRecorded(
        address indexed user,
        uint256 indexed assetId,
        uint256 badDebt,
        uint256 reserveUsed,
        uint256 outstandingLoss
    );
    event LossWaterfallSet(address indexed lossWaterfall);

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

        IERC20(token).safeTransferFrom(msg.sender, address(this), amount);

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
        IERC20(token).safeTransfer(msg.sender, amount);

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

        if (underwritingRegistryV2 != address(0)) {
            require(
                IUnderwritingRegistryV2Adapter(underwritingRegistryV2).isApproved(msg.sender, assetId),
                "Not approved"
            );
            require(
                !IUnderwritingRegistryV2Adapter(underwritingRegistryV2).isBorrowBlocked(msg.sender, assetId),
                "Borrow blocked by covenants"
            );
        } else {
            require(registry.isApproved(msg.sender, assetId), "Not approved");
        }
        if (portfolioRiskRegistry != address(0)) {
            require(
                IPortfolioRiskRegistryAdapter(portfolioRiskRegistry).isBorrowAllowed(assetId),
                "Segment borrow paused"
            );
        }

        _accrue(msg.sender, assetId);

        uint256 maxBorrow = _maxBorrowable(msg.sender, assetId);

        DebtPosition storage position = debt[msg.sender][assetId];

        require(
            position.principal + amount <= maxBorrow,
            "Exceeds LTV"
        );

        
        position.principal += amount;

        stablecoin.safeTransfer(msg.sender, amount);

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

        uint256 actualRepay = amount > userDebt ? userDebt : amount;
        stablecoin.safeTransferFrom(msg.sender, address(this), actualRepay);

        if (actualRepay >= userDebt) {
            position.principal = 0;
            position.lastAccrued = block.timestamp;
        } else {
            position.principal -= actualRepay;
        }

        emit Repaid(msg.sender, assetId, actualRepay);
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
        stablecoin.safeTransferFrom(msg.sender, address(this), repayAmount);

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
        IERC20(token).safeTransfer(msg.sender, liquidatorShares);
        IERC20(token).safeTransfer(treasury, protocolShares);

        // If collateral is exhausted but debt remains, record bad debt.
        if (
            collateral[user][assetId] == 0 &&
            position.principal > 0 &&
            (reserveBalance > 0 || lossWaterfall != address(0))
        ) {
            _recordBadDebt(user, assetId, position);
        }

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
        if (underwritingRegistryV2 != address(0)) {
            if (!IUnderwritingRegistryV2Adapter(underwritingRegistryV2).isApproved(user, assetId)) {
                return 0;
            }

            (
                ,
                ,
                uint256 creditLimitV2,
                
            ) = IUnderwritingRegistryV2Adapter(underwritingRegistryV2).getBorrowingTerms(user, assetId);

            uint16 effectiveLtvV2 =
                IUnderwritingRegistryV2Adapter(underwritingRegistryV2).effectiveMaxLtvBps(user, assetId);

            uint256 effectiveLtvResolved = _effectiveLTV(assetId, effectiveLtvV2);
            uint256 collateralCapV2 =
                (_collateralValue(user, assetId) * effectiveLtvResolved) / 10_000;
            return collateralCapV2 < creditLimitV2 ? collateralCapV2 : creditLimitV2;
        }

        (, uint16 underwritingLtv, , uint256 creditLimit, , ) = registry.getTerms(user, assetId);
        if (!registry.isApproved(user, assetId)) return 0;

        uint256 effectiveLTV =
            _effectiveLTV(assetId, underwritingLtv);

        uint256 collateralCap = (_collateralValue(user, assetId) * effectiveLTV) / 10_000;
        
        // Return the minimum of the collateral capacity and the hard credit limit
        return collateralCap < creditLimit ? collateralCap : creditLimit;
    }

    function _effectiveLTV(
        uint256 assetId,
        uint16 underwritingLtv
    ) internal view returns (uint256) {
        uint256 healthCap = _assetHealthCap(assetId);

        uint16 baseLtv = underwritingLtv < healthCap
            ? underwritingLtv
            : uint16(healthCap);

        if (portfolioRiskRegistry != address(0)) {
            return IPortfolioRiskRegistryAdapter(portfolioRiskRegistry).applySegmentHaircut(
                assetId,
                baseLtv
            );
        }
        return baseLtv;
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

        uint16 rateBps;
        if (underwritingRegistryV2 != address(0)) {
            (, rateBps, , ) = IUnderwritingRegistryV2Adapter(underwritingRegistryV2).getBorrowingTerms(user, assetId);
        } else {
            ( , , rateBps, , , ) = registry.getTerms(user, assetId);
        }

        uint256 timeElapsed = block.timestamp - position.lastAccrued;
        if (timeElapsed == 0) return;

        uint256 interest =
            (position.principal * rateBps * timeElapsed)
            / (10_000 * YEAR);

        if (interest == 0) {
            position.lastAccrued = block.timestamp;
            return;
        }

        uint256 reserveCut = (interest * reserveFactorBps) / 10_000;
        uint256 lenderInterest = interest - reserveCut;
        reserveBalance += reserveCut;
        position.principal += lenderInterest;
        position.lastAccrued = block.timestamp;

        emit InterestAccrued(user, assetId, interest, reserveCut, lenderInterest);
    }

    function _debtWithAccrual(address user, uint256 assetId)
        internal view returns (uint256)
    {
        DebtPosition memory position = debt[user][assetId];
        if (position.principal == 0) return 0;

        uint16 rateBps;
        if (underwritingRegistryV2 != address(0)) {
            (, rateBps, , ) = IUnderwritingRegistryV2Adapter(underwritingRegistryV2).getBorrowingTerms(user, assetId);
        } else {
            ( , , rateBps, , , ) = registry.getTerms(user, assetId);
        }

        uint256 timeElapsed = block.timestamp - position.lastAccrued;

        uint256 interest =
            (position.principal * rateBps * timeElapsed)
            / (10_000 * YEAR);

        uint256 reserveCut = (interest * reserveFactorBps) / 10_000;
        uint256 lenderInterest = interest - reserveCut;
        return position.principal + lenderInterest;
    }

    function getDebtWithAccrual(address user, uint256 assetId)
        external view returns (uint256)
    {
        return _debtWithAccrual(user, assetId);
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

    function setReserveFactor(uint16 newReserveFactorBps) external onlyOwner {
        require(newReserveFactorBps <= 5_000, "Reserve too high");
        uint16 old = reserveFactorBps;
        reserveFactorBps = newReserveFactorBps;
        emit ReserveFactorUpdated(old, newReserveFactorBps);
    }

    function withdrawReserve(address to, uint256 amount) external onlyOwner {
        require(to != address(0), "Invalid recipient");
        require(amount <= reserveBalance, "Insufficient reserve");
        reserveBalance -= amount;
        stablecoin.safeTransfer(to, amount);
        emit ReserveWithdrawn(to, amount);
    }

    function setTreasury(address _treasury) external onlyOwner {
        require(_treasury != address(0), "No treasury");

        treasury = _treasury;
    }

    function setUnderwritingRegistryV2(address registryV2) external onlyOwner {
        underwritingRegistryV2 = registryV2;
        emit UnderwritingRegistryV2Set(registryV2);
    }

    function setPortfolioRiskRegistry(address _portfolioRiskRegistry) external onlyOwner {
        portfolioRiskRegistry = _portfolioRiskRegistry;
        emit PortfolioRiskRegistrySet(_portfolioRiskRegistry);
    }

    function setLossWaterfall(address _lossWaterfall) external onlyOwner {
        lossWaterfall = _lossWaterfall;
        emit LossWaterfallSet(_lossWaterfall);
    }

    function _recordBadDebt(address user, uint256 assetId, DebtPosition storage position) internal {
        uint256 initialBadDebt = position.principal;
        uint256 badDebt = initialBadDebt;
        if (badDebt == 0) return;

        uint256 reserveUsed = badDebt > reserveBalance ? reserveBalance : badDebt;
        if (reserveUsed > 0) {
            reserveBalance -= reserveUsed;
            badDebt -= reserveUsed;
        }

        if (badDebt > 0 && lossWaterfall != address(0)) {
            (bool ok, bytes memory data) = lossWaterfall.call(
                abi.encodeWithSignature("absorbLoss(uint256)", badDebt)
            );
            if (ok && data.length >= 96) {
                (, , uint256 unresolvedLoss) = abi.decode(data, (uint256, uint256, uint256));
                badDebt = unresolvedLoss;
            }
        }

        totalProtocolLoss += badDebt;
        position.principal = 0;
        position.lastAccrued = block.timestamp;

        emit LossRecorded(user, assetId, initialBadDebt, reserveUsed, badDebt);
    }

}
