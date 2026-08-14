import type { ActivityPage, ApiError, CreatorProfile, Token, TokenPage, TradePage } from "@zonk/types";
import { z } from "zod";

const tokenSchema = z.object({ address: z.string(), creator: z.string(), name: z.string(), symbol: z.string(), initial_supply: z.string(), description: z.string().optional(), image_url: z.string().optional(), metadata_url: z.string().optional(), created_at: z.object({ block_number: z.number(), transaction_hash: z.string(), log_index: z.number() }), metrics: z.object({ trade_count: z.number(), buy_count: z.number(), sell_count: z.number(), volume: z.string(), fees: z.string(), unique_trader_count: z.number(), latest_trade_timestamp: z.number().nullable(), current_price: z.string().nullable(), market_cap: z.string().nullable(), holder_count: z.number().nullable() }), curve: z.object({ address: z.string(), sold_supply: z.string(), reserve_balance: z.string() }).passthrough().optional(), graduation: z.object({ phase: z.string() }).passthrough().optional() });
const tokenPageSchema = z.object({ items: z.array(tokenSchema), next_cursor: z.string().optional() });
const errorSchema = z.object({ error: z.object({ code: z.string(), message: z.string() }) });
const serviceSchema = z.object({ status: z.string(), service: z.string(), request_id: z.string().optional() });

export class ApiClientError extends Error {
  constructor(public readonly status: number, public readonly code: string, message: string) { super(message); }
}

const publicApiUrl = (process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000").replace(/\/$/, "");
const internalApiUrl = process.env.INTERNAL_API_URL?.replace(/\/$/, "");
const baseUrl = (typeof window === "undefined" && internalApiUrl ? internalApiUrl : publicApiUrl);

async function request<T>(path: string, schema: z.ZodType<T>): Promise<T> {
  let response: Response;
  try { response = await fetch(`${baseUrl}${path}`, { headers: { Accept: "application/json" }, next: { revalidate: 10 } }); }
  catch { throw new ApiClientError(0, "network_error", "The API could not be reached."); }
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const parsed = errorSchema.safeParse(body);
    throw new ApiClientError(response.status, parsed.success ? parsed.data.error.code : "http_error", parsed.success ? parsed.data.error.message : "The API request failed.");
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) throw new ApiClientError(500, "invalid_response", "The API returned an invalid response.");
  return parsed.data;
}
async function mutation<T>(path: string, init: RequestInit, schema: z.ZodType<T>): Promise<T> {
  let response: Response;
  try { response = await fetch(`${publicApiUrl}${path}`, init); } catch { throw new ApiClientError(0,"network_error","The API could not be reached."); }
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) { const parsed=errorSchema.safeParse(body); throw new ApiClientError(response.status,parsed.success?parsed.data.error.code:"http_error",parsed.success?parsed.data.error.message:"The API request failed."); }
  const parsed=schema.safeParse(body); if(!parsed.success) throw new ApiClientError(500,"invalid_response","The API returned an invalid response."); return parsed.data;
}
const draftSchema=z.object({draft_id:z.string(),name:z.string(),symbol:z.string(),initial_supply:z.string(),description:z.string(),image_url:z.string(),metadata_url:z.string()});
export const apiAssetURL=(path:string|undefined)=>path?.startsWith("/")?`${publicApiUrl}${path}`:path;

export const api = {
  health: () => request<{ status: string; service: string; request_id?: string }>("/health", serviceSchema),
  ready: () => request<{ status: string; service: string; request_id?: string }>("/readyz", serviceSchema),
  listTokens: (query = "") => request<TokenPage>(`/api/v1/tokens${query}`, tokenPageSchema),
  trending: (query = "") => request<TokenPage>(`/api/v1/trending${query}`, tokenPageSchema),
  token: (address: string) => request<Token>(`/api/v1/tokens/${encodeURIComponent(address)}`, tokenSchema),
  creator: (address: string, query = "") => request<CreatorProfile>(`/api/v1/creators/${encodeURIComponent(address)}${query}`, z.object({ address: z.string(), token_count: z.number(), volume: z.string(), tokens: z.array(tokenSchema), next_cursor: z.string().optional() })),
  trades: (address: string, query = "") => request<TradePage>(`/api/v1/tokens/${encodeURIComponent(address)}/trades${query}`, z.object({ items: z.array(z.object({ token_address: z.string(), trader: z.string(), side: z.string(), token_amount: z.string(), reserve_amount: z.string(), curve_value: z.string(), protocol_fee: z.string(), creator_fee: z.string(), block_number: z.number(), transaction_hash: z.string(), log_index: z.number() })), next_cursor: z.string().optional() })),
  activity: (address: string, query = "") => request<ActivityPage>(`/api/v1/tokens/${encodeURIComponent(address)}/activity${query}`, z.object({ items: z.array(z.object({ event_name: z.string(), decoded: z.record(z.string(), z.unknown()), block_number: z.number(), transaction_hash: z.string(), log_index: z.number() })), next_cursor: z.string().optional() })),
  uploadMetadata: (form: FormData) => mutation("/api/v1/token-metadata",{method:"POST",body:form},draftSchema),
  finalizeMetadata: (draft:string,tokenAddress:string,transactionHash:string) => mutation(`/api/v1/token-metadata/${encodeURIComponent(draft)}/finalize`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({token_address:tokenAddress,transaction_hash:transactionHash})},tokenSchema),
};

export type { ActivityPage, ApiError, CreatorProfile, Token, TokenPage, TradePage };
