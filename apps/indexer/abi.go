package indexer

import (
	"strings"

	"github.com/ethereum/go-ethereum/accounts/abi"
)

// eventABI contains only endpoint-cp-v3 launch, transfer, and graduation events.
const eventABI = `[
{"type":"event","name":"Transfer","inputs":[{"indexed":true,"name":"from","type":"address"},{"indexed":true,"name":"to","type":"address"},{"indexed":false,"name":"value","type":"uint256"}]},
{"type":"event","name":"TokenLaunchedV3","inputs":[{"indexed":true,"name":"creator","type":"address"},{"indexed":true,"name":"token","type":"address"},{"indexed":true,"name":"curve","type":"address"},{"indexed":false,"name":"protocolVersion","type":"string"},{"indexed":false,"name":"totalSupply","type":"uint256"},{"indexed":false,"name":"curveAllocation","type":"uint256"},{"indexed":false,"name":"lpAllocation","type":"uint256"},{"indexed":false,"name":"initialCreatorPayout","type":"address"},{"indexed":false,"name":"canonicalPool","type":"address"},{"indexed":false,"name":"launchSeed","type":"bytes32"},{"indexed":false,"name":"candidateSalt","type":"bytes32"},{"indexed":false,"name":"attemptIndex","type":"uint16"}]},
{"type":"event","name":"Graduated","inputs":[{"indexed":true,"name":"token","type":"address"},{"indexed":true,"name":"graduationManager","type":"address"},{"indexed":false,"name":"tokenAmount","type":"uint256"},{"indexed":false,"name":"ethAmount","type":"uint256"},{"indexed":false,"name":"soldSupply","type":"uint256"}]}
]`

var contractABI = mustABI()
var v3TradeABI = mustV3TradeABI()
var v3GraduationABI = mustV3GraduationABI()

func mustV3GraduationABI() abi.ABI {
	a, err := abi.JSON(strings.NewReader(`[
{"type":"event","name":"GraduatedV3","inputs":[{"indexed":true,"name":"token","type":"address"},{"indexed":true,"name":"custodian","type":"address"},{"indexed":true,"name":"tokenId","type":"uint256"},{"indexed":false,"name":"liquidity","type":"uint128"}]}
]`))
	if err != nil {
		panic(err)
	}
	return a
}

func mustV3TradeABI() abi.ABI {
	a, err := abi.JSON(strings.NewReader(`[
{"type":"event","name":"TokensBought","inputs":[{"indexed":true,"name":"token","type":"address"},{"indexed":true,"name":"buyer","type":"address"},{"indexed":false,"name":"submittedGross","type":"uint256"},{"indexed":false,"name":"acceptedGross","type":"uint256"},{"indexed":false,"name":"netCurveInput","type":"uint256"},{"indexed":false,"name":"tokensOut","type":"uint256"},{"indexed":false,"name":"protocolFee","type":"uint256"},{"indexed":false,"name":"creatorFee","type":"uint256"},{"indexed":false,"name":"refund","type":"uint256"}]},
{"type":"event","name":"TokensSold","inputs":[{"indexed":true,"name":"token","type":"address"},{"indexed":true,"name":"seller","type":"address"},{"indexed":false,"name":"tokensIn","type":"uint256"},{"indexed":false,"name":"grossCurveOutput","type":"uint256"},{"indexed":false,"name":"netSellerOutput","type":"uint256"},{"indexed":false,"name":"protocolFee","type":"uint256"},{"indexed":false,"name":"creatorFee","type":"uint256"}]}
]`))
	if err != nil {
		panic(err)
	}
	return a
}

func mustABI() abi.ABI {
	a, err := abi.JSON(strings.NewReader(eventABI))
	if err != nil {
		panic(err)
	}
	return a
}
