export const env = import.meta.env;

export const issuerUrl = env.VITE_ISSUER_URL || "http://localhost:4000";
export const expectedChain = BigInt(env.VITE_CHAIN_ID || "11155111");

export const badgeAbi = [
  "function claim((address subject,uint8 tier,bytes32 credentialHash,uint64 expiry,uint256 nonce),bytes signature)",
  "function tierOf(address) view returns(uint8)",
  "function nonces(address) view returns(uint256)",
] as const;

export const poolAbi = [
  "function getAmountOut(address,uint256) view returns(uint256)",
  "function swap(address,uint256,uint256,uint256) returns(uint256)",
  "function swapWithPermit(address,uint256,uint256,uint256,uint8,bytes32,bytes32) returns(uint256)",
  "function addLiquidity(uint256,uint256,uint256,uint256,uint256) returns(uint256)",
  "function removeLiquidity(uint256,uint256,uint256,uint256) returns(uint256,uint256)",
] as const;

export const erc20Abi = [
  "function approve(address,uint256) returns(bool)",
  "function name() view returns(string)",
  "function nonces(address) view returns(uint256)",
] as const;
