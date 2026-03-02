// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/**
 * @title InvestorShareToken
 * @dev ERC-20 representing fractional ownership of a single RWA's cashflows.
 * One token contract MUST correspond to exactly one assetId in RWAAssetRegistry.
 */
interface IRWAAssetRegistry {
    function isWhitelisted(address recipient) external view returns (bool);
    function isAssetPaused(uint256 assetId) external view returns (bool);
    function isAssetActive(uint256 assetId) external view returns (bool);
}

contract InvestorShareToken is ERC20 {

    uint256 public immutable assetId;
    address public immutable registry;
    uint256 public immutable maxSupply;

    constructor(
        uint256 _assetId,
        string memory _name,
        string memory _symbol,
        uint256 _maxSupply,
        address _registry,
        address _initialHolder,
        uint256 _initialSupply
    ) ERC20(_name, _symbol) {
        require(_assetId > 0, "Invalid assetId");
        require(_maxSupply > 0, "Max supply must be > 0");
        require(_registry != address(0), "Invalid registry");
        require(_initialHolder != address(0), "Invalid holder");
        require(_initialSupply > 0, "Initial supply must be > 0");
        require(_initialSupply <= _maxSupply, "Initial supply exceeds max");

        assetId = _assetId;
        registry = _registry;
        maxSupply = _maxSupply;
        require(
            IRWAAssetRegistry(_registry).isWhitelisted(_initialHolder),
            "Initial holder not whitelisted"
        );
        _mint(_initialHolder, _initialSupply);
    }

    /**
     * Transfers are allowed only if:
     * - Asset is ACTIVE
     * - Asset is not PAUSED
     * - Sender and recipient are whitelisted
     */
    function _update(address from, address to, uint256 amount) internal override {
        // Only gate transfers (not mint/burn)
        if (from != address(0) && to != address(0)) {
            IRWAAssetRegistry reg = IRWAAssetRegistry(registry);
            require(reg.isAssetActive(assetId), "Asset not active");
            require(!reg.isAssetPaused(assetId), "Asset paused");
            require(reg.isWhitelisted(from), "Sender not whitelisted");
            require(reg.isWhitelisted(to), "Recipient not whitelisted");
        }

        super._update(from, to, amount);
    }

    function ownershipBps(address investor) external view returns (uint256) {
        uint256 supply = totalSupply();
        if (supply == 0) return 0;
        return (balanceOf(investor) * 10_000) / supply;
    }
}
