package indexer

import (
	"github.com/ethereum/go-ethereum/accounts/abi"
	"strings"
)

const eventABI = `[
{"type":"event","name":"TokenCreated","inputs":[{"indexed":true,"name":"token","type":"address"},{"indexed":true,"name":"creator","type":"address"},{"indexed":false,"name":"name","type":"string"},{"indexed":false,"name":"symbol","type":"string"},{"indexed":false,"name":"initialSupply","type":"uint256"}]},
{"type":"event","name":"CurveCreated","inputs":[{"indexed":true,"name":"token","type":"address"},{"indexed":true,"name":"creator","type":"address"},{"indexed":false,"name":"curveSupply","type":"uint256"},{"indexed":false,"name":"startingPrice","type":"uint256"},{"indexed":false,"name":"slope","type":"uint256"},{"indexed":false,"name":"graduationThreshold","type":"uint256"}]},
{"type":"event","name":"TokensBought","inputs":[{"indexed":true,"name":"token","type":"address"},{"indexed":true,"name":"buyer","type":"address"},{"indexed":false,"name":"tokenAmount","type":"uint256"},{"indexed":false,"name":"reserveIn","type":"uint256"},{"indexed":false,"name":"curveCost","type":"uint256"},{"indexed":false,"name":"protocolFee","type":"uint256"},{"indexed":false,"name":"creatorFee","type":"uint256"}]},
{"type":"event","name":"TokensSold","inputs":[{"indexed":true,"name":"token","type":"address"},{"indexed":true,"name":"seller","type":"address"},{"indexed":false,"name":"tokenAmount","type":"uint256"},{"indexed":false,"name":"reserveOut","type":"uint256"},{"indexed":false,"name":"curveValue","type":"uint256"},{"indexed":false,"name":"protocolFee","type":"uint256"},{"indexed":false,"name":"creatorFee","type":"uint256"}]},
{"type":"event","name":"GraduationPending","inputs":[{"indexed":true,"name":"token","type":"address"},{"indexed":false,"name":"soldSupply","type":"uint256"},{"indexed":false,"name":"reserveBalance","type":"uint256"},{"indexed":false,"name":"tokenLiquidityAmount","type":"uint256"}]},
{"type":"event","name":"Graduated","inputs":[{"indexed":true,"name":"token","type":"address"},{"indexed":true,"name":"liquidityToken","type":"address"},{"indexed":false,"name":"tokenAmount","type":"uint256"},{"indexed":false,"name":"quoteAmount","type":"uint256"},{"indexed":false,"name":"liquidityAmount","type":"uint256"},{"indexed":false,"name":"lockId","type":"uint256"},{"indexed":false,"name":"unlockTimestamp","type":"uint64"}]},
{"type":"event","name":"FeesAccrued","inputs":[{"indexed":true,"name":"token","type":"address"},{"indexed":true,"name":"curve","type":"address"},{"indexed":true,"name":"creator","type":"address"},{"indexed":false,"name":"isBuy","type":"bool"},{"indexed":false,"name":"protocolFee","type":"uint256"},{"indexed":false,"name":"creatorFee","type":"uint256"}]},
{"type":"event","name":"LiquidityCreated","inputs":[{"indexed":true,"name":"token","type":"address"},{"indexed":true,"name":"curve","type":"address"},{"indexed":true,"name":"liquidityToken","type":"address"},{"indexed":false,"name":"tokenAmount","type":"uint256"},{"indexed":false,"name":"quoteAmount","type":"uint256"},{"indexed":false,"name":"liquidityAmount","type":"uint256"},{"indexed":false,"name":"lockId","type":"uint256"},{"indexed":false,"name":"unlockTimestamp","type":"uint64"}]},
{"type":"event","name":"LiquidityLocked","inputs":[{"indexed":true,"name":"lockId","type":"uint256"},{"indexed":true,"name":"liquidityToken","type":"address"},{"indexed":true,"name":"beneficiary","type":"address"},{"indexed":false,"name":"amount","type":"uint256"},{"indexed":false,"name":"unlockTimestamp","type":"uint64"}]},
{"type":"event","name":"LiquidityClaimed","inputs":[{"indexed":true,"name":"lockId","type":"uint256"},{"indexed":true,"name":"liquidityToken","type":"address"},{"indexed":true,"name":"beneficiary","type":"address"},{"indexed":false,"name":"amount","type":"uint256"}]}
,{"type":"event","name":"TokenFeeAccountRegistered","inputs":[{"indexed":true,"name":"token","type":"address"},{"indexed":true,"name":"curve","type":"address"},{"indexed":true,"name":"creator","type":"address"}]}
,{"type":"event","name":"TokenLiquidityRegistered","inputs":[{"indexed":true,"name":"token","type":"address"},{"indexed":true,"name":"curve","type":"address"},{"indexed":true,"name":"creator","type":"address"}]}
,{"type":"event","name":"ProtocolFeesClaimed","inputs":[{"indexed":true,"name":"treasury","type":"address"},{"indexed":false,"name":"amount","type":"uint256"}]}
,{"type":"event","name":"CreatorFeesClaimed","inputs":[{"indexed":true,"name":"token","type":"address"},{"indexed":true,"name":"creator","type":"address"},{"indexed":false,"name":"amount","type":"uint256"}]}
,{"type":"event","name":"DexAdapterConfigured","inputs":[{"indexed":true,"name":"adapter","type":"address"},{"indexed":true,"name":"configuredBy","type":"address"}]}
,{"type":"event","name":"FeeConfigurationUpdated","inputs":[{"indexed":false,"name":"previousProtocolFeeBps","type":"uint16"},{"indexed":false,"name":"previousCreatorFeeBps","type":"uint16"},{"indexed":false,"name":"newProtocolFeeBps","type":"uint16"},{"indexed":false,"name":"newCreatorFeeBps","type":"uint16"},{"indexed":true,"name":"configuredBy","type":"address"}]}
,{"type":"event","name":"TreasuryUpdated","inputs":[{"indexed":false,"name":"previousTreasury","type":"address"},{"indexed":false,"name":"newTreasury","type":"address"},{"indexed":true,"name":"configuredBy","type":"address"}]}
]`

var contractABI = mustABI()

func mustABI() abi.ABI {
	a, err := abi.JSON(strings.NewReader(eventABI))
	if err != nil {
		panic(err)
	}
	return a
}
