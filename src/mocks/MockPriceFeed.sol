// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice Minimal Chainlink-aggregator-compatible mock that always returns a
///         fixed price. Used ONLY for local anvil-fork testing — we swap this
///         in place of a real Chainlink feed's bytecode (via `anvil_setCode`)
///         so we can force a specific price without touching real state or
///         real oracles. Never deploy or reference this outside local testing.
contract MockPriceFeed {
    int256 public price;
    uint8 public constant decimals = 8;

    constructor(int256 _price) {
        price = _price;
    }

    /// @dev Legacy Chainlink interface, still called by some integrations.
    function latestAnswer() external view returns (int256) {
        return price;
    }

    /// @dev Modern Chainlink AggregatorV3Interface — this is what Moonwell's
     ///      ChainlinkOracle calls for price updates.
    function latestRoundData()
        external
        view
        returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound)
    {
        return (1, price, block.timestamp, block.timestamp, 1);
    }
}
