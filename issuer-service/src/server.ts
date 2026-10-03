import express, { type Response } from "express";
import cors from "cors";
import rateLimit, { ipKeyGenerator } from "express-rate-limit";
import "dotenv/config";
import { Contract, JsonRpcProvider, Wallet, getAddress } from "ethers";
import { Resolver } from "did-resolver";
import { getResolver as getPkhResolver } from "pkh-did-resolver";
import { getResolver as getEthrResolver } from "ethr-did-resolver";
import { z, ZodError } from "zod";
import { holderDid, issuerDid, issueCredential } from "./credentials";
import { uploadEncrypted, downloadEncrypted } from "./storage";
import { BitstringStatusStore } from "./statusList";
import { signerFromEnv } from "./signer";
import { IssuerRequestAuthenticator } from "./auth";
import { verifyCredPoolCredential } from "./verification";

const app = express();
app.set("trust proxy", 1);
app.use(cors());
app.use(express.json({ limit: "2mb" }));

const limit = Number(process.env.API_RATE_LIMIT || 30),
  ipLimiter = rateLimit({
    windowMs: 60_000,
    limit,
    standardHeaders: "draft-8",
    legacyHeaders: false,
  }),
  addressLimiter = rateLimit({
    windowMs: 60_000,
    limit,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    keyGenerator: (req) =>
      String(
        req.body?.address || req.query.address || req.params.hash || ipKeyGenerator(req.ip || ""),
      )
        .toLowerCase()
        .slice(0, 128),
  });

const port = Number(process.env.PORT || 4000),
  chainId = BigInt(process.env.CHAIN_ID || 31337),
  statusList = new BitstringStatusStore(),
  statusListEnabled = process.env.STATUS_LIST_ENABLED === "true",
  requestAuthenticator = new IssuerRequestAuthenticator();

const address = z.string().regex(/^0x[a-fA-F0-9]{40}$/),
  bytes32 = z.string().regex(/^0x[a-fA-F0-9]{64}$/),
  issueSchema = z.object({
    address,
    tier: z.number().int().min(1).max(3),
    kycPayload: z.object({ passcode: z.string().min(1).max(128) }),
    nonce: z.union([z.string(), z.number().int().nonnegative()]).default(0),
  }),
  uploadSchema = z.object({ ciphertextBase64: z.string().min(1).max(1_500_000) }),
  verifySchema = z.object({
    vcJwt: z.string().min(1).max(100_000),
    holder: z.string().optional(),
    issuerDid: z.string().startsWith("did:").optional(),
    credentialHash: bytes32.optional(),
  });

function sendError(res: Response, status: number, code: string, error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return res.status(status).json({ error: message, code });
}

function handleError(res: Response, error: unknown, status = 400) {
  return sendError(
    res,
    error instanceof ZodError ? 422 : status,
    error instanceof ZodError ? "VALIDATION_ERROR" : "REQUEST_FAILED",
    error,
  );
}

function resolver() {
  const ethr = process.env.RPC_URL
    ? getEthrResolver({
        networks: [
          {
            name: process.env.ETHR_NETWORK || "development",
            chainId: Number(chainId),
            rpcUrl: process.env.RPC_URL,
          },
        ],
      })
    : {};
  return new Resolver({ ...getPkhResolver(), ...ethr } as any);
}

app.post("/credentials/request", ipLimiter, addressLimiter, async (req, res) => {
  try {
    const input = issueSchema.parse(req.body);
    if (input.kycPayload.passcode !== "DEMO-PASS")
      return sendError(res, 403, "KYC_FAILED", "mock KYC failed");
    const badge = process.env.ACCESS_BADGE_ADDRESS;
    if (!badge) throw new Error("ACCESS_BADGE_ADDRESS is required");
    const signer = signerFromEnv(),
      statusIndex = statusListEnabled ? await statusList.reserve() : undefined,
      issued = await issueCredential(
        signer,
        getAddress(input.address),
        input.tier,
        chainId,
        badge,
        BigInt(input.nonce),
        86400,
        statusIndex === undefined ? undefined : statusList.entry(statusIndex),
      );
    if (statusIndex !== undefined) await statusList.bind(issued.credentialHash, statusIndex);
    res.json({ ...issued, holderDid: holderDid(chainId, input.address) });
  } catch (error) {
    handleError(res, error);
  }
});

app.post("/storage/upload", ipLimiter, async (req, res) => {
  try {
    const { ciphertextBase64 } = uploadSchema.parse(req.body),
      ciphertext = Buffer.from(ciphertextBase64, "base64");
    if (ciphertext.length < 29) throw new Error("encrypted credential is too short");
    const cid = await uploadEncrypted(ciphertext);
    res.status(201).json({
      cid,
      adapter: process.env.STORAGE_BACKEND || process.env.STORAGE_ADAPTER || "local",
    });
  } catch (error) {
    handleError(res, error);
  }
});

app.get("/credentials/:cid/download", ipLimiter, async (req, res) => {
  try {
    res.type("application/octet-stream").send(await downloadEncrypted(String(req.params.cid)));
  } catch (error) {
    handleError(res, error, 404);
  }
});

app.post("/credentials/verify", ipLimiter, async (req, res) => {
  try {
    const input = verifySchema.parse(req.body),
      verified = await verifyCredPoolCredential(input.vcJwt, resolver(), {
        issuerDid: input.issuerDid,
        holder: input.holder,
        chainId,
        credentialHash: input.credentialHash,
      });
    if (input.credentialHash) {
      if (!process.env.RPC_URL || !process.env.CREDENTIAL_REGISTRY_ADDRESS)
        throw new Error(
          "RPC_URL and CREDENTIAL_REGISTRY_ADDRESS are required for on-chain verification",
        );
      const registry = new Contract(
          process.env.CREDENTIAL_REGISTRY_ADDRESS,
          [
            "function get(bytes32) view returns(address issuer,address subject,uint8 tier,uint64 expiry,bool revoked)",
          ],
          new JsonRpcProvider(process.env.RPC_URL),
        ),
        record = await registry.get(input.credentialHash);
      if (
        record.issuer === ethersZeroAddress ||
        record.subject.toLowerCase() !== input.holder?.toLowerCase()
      )
        throw new Error("on-chain credential does not match holder");
    }
    res.json({ valid: true, ...verified });
  } catch (error) {
    handleError(res, error);
  }
});

const ethersZeroAddress = "0x0000000000000000000000000000000000000000";

app.post("/credentials/:hash/revoke", ipLimiter, addressLimiter, async (req, res) => {
  try {
    const hash = bytes32.parse(req.params.hash);
    if (!req.body?.signature) return sendError(res, 401, "UNAUTHORIZED", "unauthorized");
    if (!process.env.RPC_URL || !process.env.ISSUER_REGISTRY_ADDRESS)
      throw new Error("RPC_URL and ISSUER_REGISTRY_ADDRESS are required");
    const provider = new JsonRpcProvider(process.env.RPC_URL),
      issuerRegistry = new Contract(
        process.env.ISSUER_REGISTRY_ADDRESS,
        ["function isActive(address) view returns(bool)"],
        provider,
      );
    await requestAuthenticator.verify(hash, req.body, (issuer) => issuerRegistry.isActive(issuer));
    const signer = signerFromEnv(),
      registry = new Contract(
        process.env.CREDENTIAL_REGISTRY_ADDRESS!,
        ["function revoke(bytes32)"],
        await signer.transactionSigner(provider),
      ),
      tx = await registry.revoke(hash);
    res.json({ txHash: tx.hash });
  } catch (error) {
    handleError(res, error);
  }
});

app.get("/credentials/:hash/status", ipLimiter, addressLimiter, async (req, res) => {
  try {
    const hash = bytes32.parse(req.params.hash),
      provider = new JsonRpcProvider(process.env.RPC_URL),
      registry = new Contract(
        process.env.CREDENTIAL_REGISTRY_ADDRESS!,
        [
          "function isValid(bytes32) view returns(bool)",
          "function get(bytes32) view returns(address issuer,address subject,uint8 tier,uint64 expiry,bool revoked)",
        ],
        provider,
      ),
      [valid, credential] = await Promise.all([registry.isValid(hash), registry.get(hash)]);
    res.json({
      status: valid
        ? "valid"
        : credential.revoked
          ? "revoked"
          : Number(credential.expiry) <= Date.now() / 1000
            ? "expired"
            : "invalid",
    });
  } catch (error) {
    handleError(res, error);
  }
});

app.get("/status-lists/1", ipLimiter, async (_req, res) => {
  try {
    if (!statusListEnabled) return sendError(res, 404, "NOT_FOUND", "status list is disabled");
    const signer = signerFromEnv(),
      issuer = issuerDid(chainId, await signer.getAddress()),
      credential = await statusList.credential(issuer);
    res.json({ credential, vcJwt: await signer.signCredentialJwt(chainId, credential) });
  } catch (error) {
    handleError(res, error, 500);
  }
});

app.post("/status-lists/:hash/revoke", ipLimiter, addressLimiter, async (req, res) => {
  try {
    const hash = bytes32.parse(req.params.hash);
    if (!req.body?.signature) return sendError(res, 401, "UNAUTHORIZED", "unauthorized");
    if (!statusListEnabled) return sendError(res, 404, "NOT_FOUND", "status list is disabled");
    if (!process.env.RPC_URL || !process.env.ISSUER_REGISTRY_ADDRESS)
      throw new Error("RPC_URL and ISSUER_REGISTRY_ADDRESS are required");
    const registry = new Contract(
      process.env.ISSUER_REGISTRY_ADDRESS,
      ["function isActive(address) view returns(bool)"],
      new JsonRpcProvider(process.env.RPC_URL),
    );
    await requestAuthenticator.verify(hash, req.body, (issuer) => registry.isActive(issuer));
    const index = await statusList.revoke(hash);
    res.json({ revoked: true, index, statusList: statusList.publicUrl, scope: "off-chain only" });
  } catch (error) {
    handleError(res, error);
  }
});

app.get("/.well-known/did.json", async (_req, res) => {
  try {
    const signer = signerFromEnv(),
      signerAddress = await signer.getAddress(),
      did = issuerDid(chainId, signerAddress);
    res.json({
      "@context": ["https://www.w3.org/ns/did/v1"],
      id: did,
      verificationMethod: [
        {
          id: `${did}#controller`,
          type: "EcdsaSecp256k1RecoveryMethod2020",
          controller: did,
          blockchainAccountId: `eip155:${chainId}:${signerAddress}`,
        },
      ],
      authentication: [`${did}#controller`],
    });
  } catch (error) {
    handleError(res, error, 503);
  }
});

if (require.main === module)
  app.listen(port, "0.0.0.0", () => console.log(`CredPool issuer service on :${port}`));
export default app;
