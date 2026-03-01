// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";

contract PortfolioRiskRegistry is Ownable {
    struct SegmentConfig {
        bool exists;
        bool borrowPaused;
        uint16 ltvHaircutBps;
        uint256 maxExposure;
        uint16 maxDelinquencyBps;
        uint16 maxWatchlistBps;
    }

    struct SegmentState {
        uint256 totalExposure;
        uint256 watchlistExposure;
        uint256 delinquentExposure;
        uint16 delinquencyRateBps;
        uint16 watchlistRateBps;
        bool thresholdBreached;
        bytes32 breachReason;
        uint256 updatedAt;
    }

    mapping(bytes32 => SegmentConfig) private s_segmentConfigs;
    mapping(bytes32 => SegmentState) private s_segmentStates;
    mapping(uint256 => bytes32) private s_assetSegment;
    mapping(address => bool) public riskOperators;

    event RiskOperatorSet(address indexed operator, bool enabled);
    event AssetSegmentAssigned(uint256 indexed assetId, bytes32 indexed segmentId);
    event SegmentConfigured(
        bytes32 indexed segmentId,
        bool borrowPaused,
        uint16 ltvHaircutBps,
        uint256 maxExposure,
        uint16 maxDelinquencyBps,
        uint16 maxWatchlistBps
    );
    event SegmentExposureUpdated(
        bytes32 indexed segmentId,
        uint256 totalExposure,
        uint256 watchlistExposure,
        uint256 delinquentExposure,
        uint16 delinquencyRateBps,
        uint16 watchlistRateBps,
        bool thresholdBreached,
        bytes32 breachReason
    );

    modifier onlyRiskOperator() {
        require(msg.sender == owner() || riskOperators[msg.sender], "Not risk operator");
        _;
    }

    constructor(address admin) Ownable(admin) {
        require(admin != address(0), "Invalid admin");
    }

    function setRiskOperator(address operator, bool enabled) external onlyOwner {
        require(operator != address(0), "Invalid operator");
        riskOperators[operator] = enabled;
        emit RiskOperatorSet(operator, enabled);
    }

    function assignAssetSegment(uint256 assetId, bytes32 segmentId) external onlyRiskOperator {
        require(assetId > 0, "Invalid assetId");
        require(segmentId != bytes32(0), "Invalid segment");
        s_assetSegment[assetId] = segmentId;
        emit AssetSegmentAssigned(assetId, segmentId);
    }

    function configureSegment(
        bytes32 segmentId,
        bool borrowPaused,
        uint16 ltvHaircutBps,
        uint256 maxExposure,
        uint16 maxDelinquencyBps,
        uint16 maxWatchlistBps
    ) external onlyRiskOperator {
        require(segmentId != bytes32(0), "Invalid segment");
        require(ltvHaircutBps <= 10_000, "Invalid ltv haircut");
        require(maxDelinquencyBps <= 10_000, "Invalid delinquency cap");
        require(maxWatchlistBps <= 10_000, "Invalid watchlist cap");

        s_segmentConfigs[segmentId] = SegmentConfig({
            exists: true,
            borrowPaused: borrowPaused,
            ltvHaircutBps: ltvHaircutBps,
            maxExposure: maxExposure,
            maxDelinquencyBps: maxDelinquencyBps,
            maxWatchlistBps: maxWatchlistBps
        });

        emit SegmentConfigured(
            segmentId,
            borrowPaused,
            ltvHaircutBps,
            maxExposure,
            maxDelinquencyBps,
            maxWatchlistBps
        );
    }

    function updateSegmentExposure(
        bytes32 segmentId,
        uint256 totalExposure,
        uint256 watchlistExposure,
        uint256 delinquentExposure
    ) external onlyRiskOperator {
        require(segmentId != bytes32(0), "Invalid segment");
        SegmentConfig storage cfg = s_segmentConfigs[segmentId];
        require(cfg.exists, "Unknown segment");
        require(watchlistExposure <= totalExposure, "Watchlist > total");
        require(delinquentExposure <= totalExposure, "Delinquent > total");

        uint16 delinquencyRateBps = totalExposure == 0
            ? 0
            : uint16((delinquentExposure * 10_000) / totalExposure);
        uint16 watchlistRateBps = totalExposure == 0
            ? 0
            : uint16((watchlistExposure * 10_000) / totalExposure);

        (bool breached, bytes32 reason) = _evaluateThresholds(
            cfg,
            totalExposure,
            delinquencyRateBps,
            watchlistRateBps
        );

        s_segmentStates[segmentId] = SegmentState({
            totalExposure: totalExposure,
            watchlistExposure: watchlistExposure,
            delinquentExposure: delinquentExposure,
            delinquencyRateBps: delinquencyRateBps,
            watchlistRateBps: watchlistRateBps,
            thresholdBreached: breached,
            breachReason: reason,
            updatedAt: block.timestamp
        });

        emit SegmentExposureUpdated(
            segmentId,
            totalExposure,
            watchlistExposure,
            delinquentExposure,
            delinquencyRateBps,
            watchlistRateBps,
            breached,
            reason
        );
    }

    function getSegmentForAsset(uint256 assetId) external view returns (bytes32) {
        return s_assetSegment[assetId];
    }

    function getSegmentConfig(bytes32 segmentId) external view returns (SegmentConfig memory) {
        return s_segmentConfigs[segmentId];
    }

    function getSegmentState(bytes32 segmentId) external view returns (SegmentState memory) {
        return s_segmentStates[segmentId];
    }

    function isBorrowAllowed(uint256 assetId) external view returns (bool) {
        bytes32 segmentId = s_assetSegment[assetId];
        if (segmentId == bytes32(0)) return true;

        SegmentConfig storage cfg = s_segmentConfigs[segmentId];
        if (!cfg.exists) return true;
        if (cfg.borrowPaused) return false;

        SegmentState storage state = s_segmentStates[segmentId];
        if (state.thresholdBreached) return false;

        return true;
    }

    function applySegmentHaircut(uint256 assetId, uint16 baseLtvBps)
        external
        view
        returns (uint16)
    {
        bytes32 segmentId = s_assetSegment[assetId];
        if (segmentId == bytes32(0)) return baseLtvBps;

        SegmentConfig storage cfg = s_segmentConfigs[segmentId];
        if (!cfg.exists) return baseLtvBps;

        uint16 haircut = cfg.ltvHaircutBps;
        SegmentState storage state = s_segmentStates[segmentId];
        if (state.thresholdBreached) {
            // When breached, force hard throttle.
            haircut = 10_000;
        }

        uint256 adjusted = (uint256(baseLtvBps) * (10_000 - haircut)) / 10_000;
        return uint16(adjusted);
    }

    function _evaluateThresholds(
        SegmentConfig storage cfg,
        uint256 totalExposure,
        uint16 delinquencyRateBps,
        uint16 watchlistRateBps
    ) internal view returns (bool breached, bytes32 reason) {
        if (cfg.maxExposure > 0 && totalExposure > cfg.maxExposure) {
            return (true, keccak256("EXPOSURE_LIMIT"));
        }
        if (cfg.maxDelinquencyBps > 0 && delinquencyRateBps > cfg.maxDelinquencyBps) {
            return (true, keccak256("DELINQUENCY_LIMIT"));
        }
        if (cfg.maxWatchlistBps > 0 && watchlistRateBps > cfg.maxWatchlistBps) {
            return (true, keccak256("WATCHLIST_LIMIT"));
        }
        return (false, bytes32(0));
    }
}
