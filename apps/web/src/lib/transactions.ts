export type TransactionStatus = "idle" | "preparing" | "awaiting_wallet" | "submitted" | "confirming" | "confirmed" | "failed" | "rejected";
export type TransactionState = { status: TransactionStatus; hash?: `0x${string}`; error?: string };
export const idleTransaction: TransactionState = { status: "idle" };

export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
export const ACCEPTED_IMAGE_TYPES = ["image/png","image/jpeg","image/webp","image/gif"] as const;
const MAX_UINT256 = (BigInt(1) << BigInt(256)) - BigInt(1);
export type CreateTokenInput={name:string;symbol:string;description:string;supply:string;image:File|null};
export function validateCreateToken(input:CreateTokenInput):Record<string,string>{
  const errors:Record<string,string>={};const name=input.name.trim(),symbol=input.symbol.trim(),description=input.description.trim();
  if(!name||new TextEncoder().encode(name).length>64)errors.name="Name must be between 1 and 64 bytes.";
  if(!symbol||new TextEncoder().encode(symbol).length>16)errors.symbol="Symbol must be between 1 and 16 bytes.";
  if(!description||new TextEncoder().encode(description).length>1000)errors.description="Description must be between 1 and 1000 bytes.";
  if(!/^\d+(\.\d{1,18})?$/.test(input.supply)||Number(input.supply)<=0)errors.supply="Supply must be a positive number with at most 18 decimals.";
  else { const [whole,fraction=""]=input.supply.split(".");const baseUnits=BigInt(whole+fraction.padEnd(18,"0"));if(baseUnits>MAX_UINT256)errors.supply="Supply exceeds the uint256 limit."; }
  if(!input.image)errors.image="Select a token image.";else if(!ACCEPTED_IMAGE_TYPES.includes(input.image.type as typeof ACCEPTED_IMAGE_TYPES[number]))errors.image="Use PNG, JPEG, WebP, or GIF.";else if(input.image.size>MAX_IMAGE_BYTES)errors.image="Image must be at most 5 MB.";
  return errors;
}
export const canCreateToken=(chainId:number|undefined,authenticated:boolean,pending:boolean)=>chainId===84532&&authenticated&&!pending;
