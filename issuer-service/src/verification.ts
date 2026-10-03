import canonicalize from "canonicalize";
import { decodeJWT } from "did-jwt";
import { verifyCredential } from "did-jwt-vc";
import type { Resolver } from "did-resolver";
import { getAddress, keccak256, toUtf8Bytes } from "ethers";
import { holderDid } from "./credentials";

export type VerificationExpectations = {
  issuerDid?: string;
  holder?: string;
  chainId?: bigint;
  credentialHash?: string;
  now?: number;
};

/** Verifies cryptography plus CredPool's issuer, subject, expiry, and canonical hash rules. */
export async function verifyCredPoolCredential(
  vcJwt: string,
  resolver: Resolver,
  expected: VerificationExpectations = {},
) {
  const verified = await verifyCredential(vcJwt, resolver),
    payload = decodeJWT(vcJwt).payload as any,
    now = expected.now ?? Math.floor(Date.now() / 1000),
    issuer = String(payload.iss || payload.vc?.issuer || ""),
    subject = String(payload.sub || payload.vc?.credentialSubject?.id || "");
  if (!issuer || (expected.issuerDid && issuer !== expected.issuerDid))
    throw new Error("credential issuer DID mismatch");
  if (!Number.isFinite(payload.exp) || Number(payload.exp) <= now)
    throw new Error("credential is expired");
  if (expected.holder) {
    const expectedSubject = expected.holder.startsWith("did:")
      ? expected.holder
      : holderDid(expected.chainId || 1n, getAddress(expected.holder));
    if (subject.toLowerCase() !== expectedSubject.toLowerCase())
      throw new Error("credential subject DID mismatch");
  }
  // did-jwt injects `iss` into the compact JWT. CredPool anchors the canonical
  // VC payload that existed before this transport-only claim was added.
  const anchoredPayload = { ...payload };
  delete anchoredPayload.iss;
  const canonical = canonicalize(anchoredPayload);
  if (!canonical) throw new Error("credential canonicalization failed");
  const credentialHash = keccak256(toUtf8Bytes(canonical));
  if (
    expected.credentialHash &&
    credentialHash.toLowerCase() !== expected.credentialHash.toLowerCase()
  )
    throw new Error("credential hash mismatch");
  return {
    issuer,
    subject,
    credentialHash,
    credential: verified.verifiableCredential,
    payload,
  };
}
