import { Wallet, keccak256, toUtf8Bytes, getBytes } from "ethers";
import canonicalize from "canonicalize";
import { createVerifiableCredentialJwt } from "did-jwt-vc";
import { ES256KSigner } from "did-jwt";
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
export async function signCredentialJwt(privateKey: string, chainId: bigint, payload: unknown) {
  const wallet = new Wallet(privateKey);
  return createVerifiableCredentialJwt(
    payload as any,
    {
      did: issuerDid(chainId, wallet.address),
      signer: ES256KSigner(getBytes(privateKey)),
    } as any,
    { removeOriginalFields: false },
  );
}
export async function issueCredential(
  privateKey: string,
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
  const wallet = new Wallet(privateKey);
  const now = Math.floor(Date.now() / 1000),
    expiry = now + validitySeconds;
  const subject = holderDid(chainId, address),
    issuer = issuerDid(chainId, wallet.address);
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
  const vcJwt = await createVerifiableCredentialJwt(
    vcPayload as any,
    { did: issuer, signer: ES256KSigner(getBytes(privateKey)) } as any,
    { removeOriginalFields: false },
  );
  const attestation = { subject: address, tier, credentialHash, expiry, nonce };
  const signature = await wallet.signTypedData(
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
