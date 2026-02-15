// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

interface IUnderwritingRegistry {
    function getTerms(address borrower, uint256 assetId)
        external
        view
        returns (bool, uint16, uint16, uint256, bytes32);
}

interface IRWAAssetRegistryView {
    function assets(uint256 assetId)
        external
        view
        returns (
            uint256,
            uint8,
            address,
            address,
            address,
            address,
            bool,
            bool,
            uint256 assetValue,
            uint256,
            uint256,
            uint256,
            uint256,
            uint256,
            uint256,
            uint256,
            uint256,
            uint256,
            address,
            uint8,
            uint8,
            uint256,
            uint256,
            string memory
        );
}

contract RWALendingPool {
    IERC20 public immutable stable;
    IUnderwritingRegistry public immutable underwriting;
    IRWAAssetRegistryView public immutable registry;

    struct Loan {
        uint256 principal;
        uint256 rateBps;
        uint256 lastAccrual;
    }

    mapping(address => mapping(uint256 => Loan)) public loans;

    event Borrowed(address indexed borrower, uint256 indexed assetId, uint256 amount);
    event Repaid(address indexed borrower, uint256 indexed assetId, uint256 amount);

    constructor(
        address _stable,
        address _underwriting,
        address _registry
    ) {
        stable = IERC20(_stable);
        underwriting = IUnderwritingRegistry(_underwriting);
        registry = IRWAAssetRegistryView(_registry);
    }

    // ------------------------------------------------------------
    // Borrow
    // ------------------------------------------------------------

    function borrow(uint256 assetId, uint256 amount) external {
        require(amount > 0, "Invalid amount");

        (
            bool approved,
            uint16 maxLtvBps,
            uint16 rateBps,
            uint256 expiry
        ) = _getUnderwriting(assetId);

        require(approved, "Not approved");
        require(expiry > block.timestamp, "Underwriting expired");

        uint256 assetValue = _getAssetValue(assetId);
        uint256 maxBorrow = (assetValue * maxLtvBps) / 10_000;

        Loan storage loan = loans[msg.sender][assetId];

        _accrueInterest(loan);

        require(loan.principal + amount <= maxBorrow, "Exceeds LTV");

        loan.principal += amount;
        loan.rateBps = rateBps;
        loan.lastAccrual = block.timestamp;

        require(stable.transfer(msg.sender, amount), "Transfer failed");

        emit Borrowed(msg.sender, assetId, amount);
    }

    // ------------------------------------------------------------
    // Repay
    // ------------------------------------------------------------

    function repay(uint256 assetId, uint256 amount) external {
        Loan storage loan = loans[msg.sender][assetId];
        require(loan.principal > 0, "No loan");

        _accrueInterest(loan);

        require(stable.transferFrom(msg.sender, address(this), amount), "Transfer failed");

        if (amount >= loan.principal) {
            loan.principal = 0;
        } else {
            loan.principal -= amount;
        }

        loan.lastAccrual = block.timestamp;

        emit Repaid(msg.sender, assetId, amount);
    }

    // ------------------------------------------------------------
    // View
    // ------------------------------------------------------------

    function getOutstanding(address borrower, uint256 assetId)
        external
        view
        returns (uint256)
    {
        Loan memory loan = loans[borrower][assetId];

        if (loan.principal == 0) return 0;

        uint256 elapsed = block.timestamp - loan.lastAccrual;
        uint256 interest =
            (loan.principal * loan.rateBps * elapsed)
            / (365 days * 10_000);

        return loan.principal + interest;
    }

    // ------------------------------------------------------------
    // Internal
    // ------------------------------------------------------------

    function _accrueInterest(Loan storage loan) internal {
        if (loan.principal == 0) return;

        uint256 elapsed = block.timestamp - loan.lastAccrual;
        if (elapsed == 0) return;

        uint256 interest =
            (loan.principal * loan.rateBps * elapsed)
            / (365 days * 10_000);

        loan.principal += interest;
    }

    function _getUnderwriting(uint256 assetId)
        internal
        view
        returns (bool, uint16, uint16, uint256)
    {
        (
            bool approved,
            uint16 maxLtvBps,
            uint16 rateBps,
            uint256 expiry,
            /*bytes32 reasoningHash*/
        ) = underwriting.getTerms(msg.sender, assetId);

        return (approved, maxLtvBps, rateBps, expiry);
    }

    function _getAssetValue(uint256 assetId)
        internal
        view
        returns (uint256 assetValue)
    {
        // Store all values in a temporary variable to avoid stack too deep
        (
            uint256 val1,
            uint8 val2,
            address val3,
            address val4,
            address val5,
            address val6,
            bool val7,
            bool val8,
            uint256 _assetValue,
            uint256 val10,
            uint256 val11,
            uint256 val12,
            uint256 val13,
            uint256 val14,
            uint256 val15,
            uint256 val16,
            uint256 val17,
            uint256 val18,
            address val19,
            uint8 val20,
            uint8 val21,
            uint256 val22,
            uint256 val23,
            string memory val24
        ) = registry.assets(assetId);
        
        assetValue = _assetValue;
    }
}
