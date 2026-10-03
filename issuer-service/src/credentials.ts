import { keccak256, toUtf8Bytes } from "ethers";
import canonicalize from "canonicalize";
import { EnvSigner, type IssuerSigner } from "./signer";
export const attestationTypes = {
  Attestation: [
    { name: "subject", type: "address" },
    { name: "tier", type: "uint8" },
    { name: "credentialHash", type: "bytes32" },
    { name: "expiry", type: "uint64" },
    { name: "nonce", type: "uint256" },
  ],
};
export const holderDid = (
  chainId: bigint,
  address: string,
  method = process.env.DID_METHOD || "pkh",
) =>
  method === "ethr"
    ? `did:ethr:${process.env.DID_ETHR_NETWORK || chainId}:${address.toLowerCase()}`
    : `did:pkh:eip155:${chainId}:${address.toLowerCase()}`;
export const issuerDid = (
  chainId: bigint,
  address: string,
  method = process.env.DID_METHOD || "pkh",
) => holderDid(chainId, address, method);
export async function signCredentialJwt(
  signerOrKey: IssuerSigner | string,
  chainId: bigint,
  payload: unknown,
) {
  const signer = typeof signerOrKey === "string" ? new EnvSigner(signerOrKey) : signerOrKey;
  return signer.signCredentialJwt(chainId, payload);
}
export async function issueCredential(
  signerOrKey: IssuerSigner | string,
  address: string,
  tier: number,
  chainId: bigint,
  badgeAddress: string,
  nonce: bigint,
  validitySeconds = 86400,
  credentialStatus?: {
    id: string;
    type: string;
    statusPurpose: string;
    statusListIndex: string;
    statusListCredential: string;
  },
) {
  if (![1, 2, 3].includes(tier)) throw new Error("tier must be 1, 2, or 3");
  const signer = typeof signerOrKey === "string" ? new EnvSigner(signerOrKey) : signerOrKey;
  const signerAddress = await signer.getAddress();
  const now = Math.floor(Date.now() / 1000),
    expiry = now + validitySeconds;
  const subject = holderDid(chainId, address),
    issuer = issuerDid(chainId, signerAddress);
  const vcPayload = {
    sub: subject,
    nbf: now,
    exp: expiry,
    vc: {
      "@context": ["https://www.w3.org/2018/credentials/v1"],
      type: ["VerifiableCredential", "KycCredential"],
      issuer,
      issuanceDate: new Date(now * 1000).toISOString(),
      expirationDate: new Date(expiry * 1000).toISOString(),
      credentialSubject: { id: subject, tier },
      ...(credentialStatus ? { credentialStatus } : {}),
    },
  };
  const canonical = canonicalize(vcPayload);
  if (!canonical) throw new Error("canonicalization failed");
  const credentialHash = keccak256(toUtf8Bytes(canonical));
  const vcJwt = await signer.signCredentialJwt(chainId, vcPayload);
  const attestation = { subject: address, tier, credentialHash, expiry, nonce };
  const signature = await signer.signTypedData(
    {
      name: "GatedAccess",
      version: "1",
      chainId,
      verifyingContract: badgeAddress,
    },
    attestationTypes,
    attestation,
  );
  return { vcJwt, vcPayload, attestation, signature, credentialHash };
}
