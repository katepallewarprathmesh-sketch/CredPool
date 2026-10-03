import { getAddress, verifyMessage } from "ethers";
import { z } from "zod";

export const signedRequestSchema = z.object({
  issuer: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
  nonce: z.string().min(8).max(128),
  timestamp: z.number().int().positive(),
  signature: z.string().regex(/^0x[a-fA-F0-9]{130}$/),
});

export type SignedIssuerRequest = z.infer<typeof signedRequestSchema>;

export function revocationMessage(hash: string, nonce: string, timestamp: number) {
  return `CredPool revoke\nhash:${hash.toLowerCase()}\nnonce:${nonce}\ntimestamp:${timestamp}`;
}

export class IssuerRequestAuthenticator {
  private readonly used = new Set<string>();

  constructor(private readonly maxAgeSeconds = 300) {}

  async verify(
    hash: string,
    input: unknown,
    isActive: (issuer: string) => Promise<boolean>,
    now = Math.floor(Date.now() / 1000),
  ) {
    const request = signedRequestSchema.parse(input),
      issuer = getAddress(request.issuer),
      replayKey = `${issuer.toLowerCase()}:${request.nonce}`;
    if (Math.abs(now - request.timestamp) > this.maxAgeSeconds)
      throw new Error("signed request timestamp is stale");
    if (this.used.has(replayKey)) throw new Error("signed request nonce was already used");
    const recovered = verifyMessage(
      revocationMessage(hash, request.nonce, request.timestamp),
      request.signature,
    );
    if (getAddress(recovered) !== issuer) throw new Error("invalid issuer signature");
    if (!(await isActive(issuer))) throw new Error("issuer is not active");
    this.used.add(replayKey);
    return issuer;
  }
}
