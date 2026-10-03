import {
  AbstractProvider,
  Signer,
  TypedDataDomain,
  TypedDataField,
  Wallet,
  getBytes,
} from "ethers";
import { createVerifiableCredentialJwt } from "did-jwt-vc";
import { ES256KSigner } from "did-jwt";

const issuerDid = (chainId: bigint, address: string) =>
  process.env.DID_METHOD === "ethr"
    ? `did:ethr:${process.env.DID_ETHR_NETWORK || chainId}:${address.toLowerCase()}`
    : `did:pkh:eip155:${chainId}:${address.toLowerCase()}`;

export interface IssuerSigner {
  getAddress(): Promise<string>;
  signTypedData(
    domain: TypedDataDomain,
    types: Record<string, TypedDataField[]>,
    value: Record<string, unknown>,
  ): Promise<string>;
  signCredentialJwt(chainId: bigint, payload: unknown): Promise<string>;
  transactionSigner(provider: AbstractProvider): Promise<Signer>;
}

/** Demo-only signer. Production deployments should inject a KMS/HSM implementation. */
export class EnvSigner implements IssuerSigner {
  private readonly wallet: Wallet;

  constructor(private readonly privateKey: string) {
    if (!privateKey) throw new Error("ISSUER_PK is required");
    this.wallet = new Wallet(privateKey);
    if (process.env.NODE_ENV !== "test")
      console.warn("CredPool warning: EnvSigner is demo-only; use a KMS/HSM signer in production.");
  }

  async getAddress() {
    return this.wallet.address;
  }

  signTypedData(
    domain: TypedDataDomain,
    types: Record<string, TypedDataField[]>,
    value: Record<string, unknown>,
  ) {
    return this.wallet.signTypedData(domain, types, value);
  }

  async transactionSigner(provider: AbstractProvider) {
    return this.wallet.connect(provider);
  }

  signCredentialJwt(chainId: bigint, payload: unknown) {
    return createVerifiableCredentialJwt(
      payload as any,
      {
        did: issuerDid(chainId, this.wallet.address),
        signer: ES256KSigner(getBytes(this.privateKey)),
      } as any,
      { removeOriginalFields: false },
    );
  }
}

/**
 * Integration seam for AWS KMS, CloudHSM, or another remote secp256k1 signer.
 * A production implementation should DER-decode KMS signatures, normalize low-s,
 * and implement a did-jwt compatible signer without exporting key material.
 */
export class KmsSigner implements IssuerSigner {
  constructor(readonly keyId: string) {}
  async getAddress(): Promise<string> {
    throw new Error(`KmsSigner ${this.keyId} is not configured`);
  }
  async signTypedData(): Promise<string> {
    throw new Error(`KmsSigner ${this.keyId} is not configured`);
  }
  async signCredentialJwt(): Promise<string> {
    throw new Error(`KmsSigner ${this.keyId} is not configured`);
  }
  async transactionSigner(): Promise<Signer> {
    throw new Error(`KmsSigner ${this.keyId} transaction adapter is not configured`);
  }
}

export function signerFromEnv(): IssuerSigner {
  if (process.env.KMS_KEY_ID) return new KmsSigner(process.env.KMS_KEY_ID);
  return new EnvSigner(process.env.ISSUER_PK || "");
}
