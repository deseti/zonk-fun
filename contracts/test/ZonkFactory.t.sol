// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test} from "forge-std/Test.sol";
import {Vm} from "forge-std/Vm.sol";
import {IZonkFactory} from "../src/interfaces/IZonkFactory.sol";
import {IZonkToken} from "../src/interfaces/IZonkToken.sol";
import {ZonkFactory} from "../src/ZonkFactory.sol";
import {ZonkToken} from "../src/ZonkToken.sol";

contract ZonkFactoryTest is Test {
    ZonkFactory internal factory;
    address internal creator = makeAddr("creator");
    address internal recipient = makeAddr("recipient");
    address internal spender = makeAddr("spender");
    uint256 internal constant INITIAL_SUPPLY = 1_000_000 ether;

    function setUp() public {
        factory = new ZonkFactory();
    }

    function testCreateTokenRegistersCreatorAndInitialState() public {
        vm.prank(creator);
        address token = factory.createToken("Zonk", "ZONK", INITIAL_SUPPLY);

        (address registeredCreator, IZonkFactory.LaunchState state) = factory.tokenInfo(token);
        assertTrue(factory.isToken(token));
        assertEq(registeredCreator, creator);
        assertEq(uint8(state), uint8(IZonkFactory.LaunchState.Created));
        assertEq(factory.definitionToken(keccak256(abi.encode(creator, "Zonk", "ZONK", INITIAL_SUPPLY))), token);

        address[] memory creatorTokens = factory.tokensByCreator(creator);
        assertEq(creatorTokens.length, 1);
        assertEq(creatorTokens[0], token);
    }

    function testCreateTokenEmitsCanonicalEvent() public {
        vm.recordLogs();
        vm.prank(creator);
        address token = factory.createToken("Zonk", "ZONK", INITIAL_SUPPLY);

        Vm.Log[] memory logs = vm.getRecordedLogs();
        bytes32 eventSignature = keccak256("TokenCreated(address,address,string,string,uint256)");
        bool found;
        for (uint256 i; i < logs.length; ++i) {
            if (logs[i].topics[0] != eventSignature) continue;

            found = true;
            assertEq(address(uint160(uint256(logs[i].topics[1]))), token);
            assertEq(address(uint160(uint256(logs[i].topics[2]))), creator);
            (string memory name, string memory symbol, uint256 supply) =
                abi.decode(logs[i].data, (string, string, uint256));
            assertEq(name, "Zonk");
            assertEq(symbol, "ZONK");
            assertEq(supply, INITIAL_SUPPLY);
        }
        assertTrue(found);
    }

    function testInitialTokenStateAndMetadata() public {
        vm.prank(creator);
        ZonkToken token = ZonkToken(factory.createToken("Zonk", "ZONK", INITIAL_SUPPLY));

        assertEq(token.name(), "Zonk");
        assertEq(token.symbol(), "ZONK");
        assertEq(token.decimals(), 18);
        assertEq(token.totalSupply(), INITIAL_SUPPLY);
        assertEq(token.balanceOf(creator), INITIAL_SUPPLY);
        assertEq(token.creator(), creator);
        assertEq(token.initialSupply(), INITIAL_SUPPLY);
        assertTrue(token.initialized());
        assertEq(token.factory(), address(factory));
    }

    function testERC20TransferApproveAndTransferFrom() public {
        vm.prank(creator);
        ZonkToken token = ZonkToken(factory.createToken("Zonk", "ZONK", INITIAL_SUPPLY));

        vm.prank(creator);
        assertTrue(token.transfer(recipient, 100 ether));
        assertEq(token.balanceOf(recipient), 100 ether);

        vm.prank(creator);
        assertTrue(token.approve(spender, 50 ether));
        vm.prank(spender);
        assertTrue(token.transferFrom(creator, recipient, 50 ether));
        assertEq(token.balanceOf(recipient), 150 ether);
        assertEq(token.allowance(creator, spender), 0);
    }

    function testCreateTokenRejectsInvalidParameters() public {
        vm.expectRevert(IZonkFactory.InvalidTokenName.selector);
        factory.createToken("", "ZONK", INITIAL_SUPPLY);

        vm.expectRevert(IZonkFactory.InvalidTokenSymbol.selector);
        factory.createToken("Zonk", "", INITIAL_SUPPLY);

        vm.expectRevert(IZonkFactory.InvalidInitialSupply.selector);
        factory.createToken("Zonk", "ZONK", 0);

        vm.expectRevert(IZonkFactory.InvalidTokenName.selector);
        factory.createToken(_stringOfLength(65), "ZONK", INITIAL_SUPPLY);

        vm.expectRevert(IZonkFactory.InvalidTokenSymbol.selector);
        factory.createToken("Zonk", _stringOfLength(17), INITIAL_SUPPLY);
    }

    function testCreateTokenRejectsDuplicateDefinitionForCreator() public {
        vm.prank(creator);
        factory.createToken("Zonk", "ZONK", INITIAL_SUPPLY);

        vm.prank(creator);
        vm.expectRevert(IZonkFactory.DuplicateToken.selector);
        factory.createToken("Zonk", "ZONK", INITIAL_SUPPLY);
    }

    function testDifferentCreatorsMayCreateSameDefinition() public {
        vm.prank(creator);
        address first = factory.createToken("Zonk", "ZONK", INITIAL_SUPPLY);

        vm.prank(recipient);
        address second = factory.createToken("Zonk", "ZONK", INITIAL_SUPPLY);

        assertTrue(first != second);
        assertEq(ZonkToken(first).creator(), creator);
        assertEq(ZonkToken(second).creator(), recipient);
    }

    function testTokenInitializationIsFactoryControlledAndOneTime() public {
        ZonkToken token = new ZonkToken(address(this), "Zonk", "ZONK");

        vm.prank(creator);
        vm.expectRevert(IZonkToken.OnlyFactory.selector);
        token.initialize(creator, INITIAL_SUPPLY);

        token.initialize(creator, INITIAL_SUPPLY);
        assertEq(token.balanceOf(creator), INITIAL_SUPPLY);

        vm.expectRevert(IZonkToken.AlreadyInitialized.selector);
        token.initialize(creator, INITIAL_SUPPLY);
    }

    function testTokenRejectsInvalidConstructorParameters() public {
        vm.expectRevert(IZonkToken.InvalidFactory.selector);
        new ZonkToken(address(0), "Zonk", "ZONK");

        vm.expectRevert(IZonkToken.InvalidTokenName.selector);
        new ZonkToken(address(this), "", "ZONK");

        vm.expectRevert(IZonkToken.InvalidTokenSymbol.selector);
        new ZonkToken(address(this), "Zonk", "");
    }

    function testTokenInitializationRejectsInvalidArguments() public {
        ZonkToken token = new ZonkToken(address(this), "Zonk", "ZONK");

        vm.expectRevert(IZonkToken.InvalidCreator.selector);
        token.initialize(address(0), INITIAL_SUPPLY);

        vm.expectRevert(IZonkToken.InvalidInitialSupply.selector);
        token.initialize(creator, 0);
    }

    function testNoPostInitializationMintSurface() public {
        vm.prank(creator);
        ZonkToken token = ZonkToken(factory.createToken("Zonk", "ZONK", INITIAL_SUPPLY));

        (bool success,) = address(token).call(abi.encodeWithSignature("mint(address,uint256)", creator, 1));
        assertFalse(success);
        assertEq(token.totalSupply(), INITIAL_SUPPLY);
    }

    function _stringOfLength(uint256 length) private pure returns (string memory) {
        bytes memory value = new bytes(length);
        for (uint256 i; i < length; ++i) {
            value[i] = "a";
        }
        return string(value);
    }
}
