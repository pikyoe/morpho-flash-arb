// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test, console} from "forge-std/Test.sol";
import {Vm} from "forge-std/Vm.sol";
import {FlashLoanArbitrage} from "../src/FlashLoanArbitrage.sol";
import {IMorpho, IMorphoFlashLoanCallback} from "../src/interfaces/IMorpho.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {BaseAddresses} from "../src/Base