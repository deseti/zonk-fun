import { createConfig, http } from "wagmi";
import { injected } from "wagmi/connectors";
import { selectedZonkChain, selectedZonkRPCURL } from "@/lib/chain";

export const wagmiConfig = createConfig({
  chains: [selectedZonkChain],
  connectors: [injected({ shimDisconnect: true })],
  transports: { [selectedZonkChain.id]: http(selectedZonkRPCURL) },
  ssr: true,
});

export function canUseBrowserWallet(chainId: number | undefined, connected: boolean) {
  return connected && chainId === selectedZonkChain.id;
}
