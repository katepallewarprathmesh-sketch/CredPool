import express from "express";
import cors from "cors";
import rateLimit from "express-rate-limit";
import { timingSafeEqual } from "node:crypto";
import "dotenv/config";
import { Contract, JsonRpcProvider, Wallet } from "ethers";
import { Resolver } from "did-resolver";
import { getResolver as getPkhResolver } from "pkh-did-resolver";
import { getResolver as getEthrResolver } from "ethr-did-resolver";
import { verifyCredential } from "did-jwt-vc";
import { holderDid, issuerDid, issueCredential, signCredentialJwt } from "./credentials";
import { uploadEncrypted, downloadEncrypted } from "./storage";
import { BitstringStatusStore } from "./statusList";

const app = express();
app.set("trust proxy", 1);
app.use(cors());
app.use(express.json({ limit: "2mb" }));

const sensitiveLimiter = rateLimit({
  windowMs: 60_000,
  limit: Number(process.env.API_RATE_LIMIT || 30),
  standardHeaders: "draft-8",
  legacyHeaders: false,
});
const port = Number(process.env.PORT || 4000);
const chainId = BigInt(process.env.CHAIN_ID || 31337);
const pk = process.env.ISSUER_PK;
const statusList = new BitstringStatusStore();
const statusListEnabled = process.env.STATUS_LIST_ENABLED === "true";

function authenticated(header: string | undefined) {
  const expected = process.env.ISSUER_API_TOKEN;
  const supplied = header?.replace(/^Bearer\s+/i, "");
  if (!expected || !supplied) return false;
  const a = Buffer.from(expected), b = Buffer.from(supplied);
  return a.length === b.length && timingSafeEqual(a, b);
}

app.post("/credentials/request", sensitiveLimiter, async (req, res) => {
  try {
    if (!pk) throw new Error("ISSUER_PK is required (demo key provider; use KMS/HSM in production)");
    const { address, tier, kycPayload, nonce = 0 } = req.body;
    if (kycPayload?.passcode !== "DEMO-PASS") return res.status(403).json({ error: "mock KYC failed" });
    const badge = process.env.ACCESS_BADGE_ADDRESS;
    if (!badge) throw new Error("ACCESS_BADGE_ADDRESS is required");
    // The service returns the credential to the holder but never uploads plaintext.
    // The browser encrypts it with a wallet-signature-derived key, then calls /storage/upload.
    const statusIndex = statusListEnabled ? await statusList.reserve() : undefined;
    const issued = await issueCredential(pk, address, Number(tier), chainId, badge, BigInt(nonce), 86400, statusIndex === undefined ? undefined : statusList.entry(statusIndex));
    if (statusIndex !== undefined) await statusList.bind(issued.credentialHash, statusIndex);
    res.json({ ...issued, holderDid: holderDid(chainId, address) });
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

app.post("/storage/upload", sensitiveLimiter, async (req, res) => {
  try {
    const encoded = String(req.body?.ciphertextBase64 || "");
    if (!encoded || encoded.length > 1_500_000) throw new Error("invalid encrypted credential");
    const ciphertext = Buffer.from(encoded, "base64");
    if (ciphertext.length < 29) throw new Error("encrypted credential is too short");
    const cid = await uploadEncrypted(ciphertext);
    res.status(201).json({ cid, adapter: process.env.STORAGE_ADAPTER || "local" });
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

app.get("/credentials/:cid/download", sensitiveLimiter, async (req, res) => {
  try {
    res.type("application/octet-stream").send(await downloadEncrypted(String(req.params.cid)));
  } catch (error: any) {
    res.status(404).json({ error: error.message });
  }
});

app.post("/credentials/verify", sensitiveLimiter, async (req, res) => {
  try {
    const ethr = process.env.RPC_URL
      ? getEthrResolver({ networks: [{ name: process.env.ETHR_NETWORK || "development", chainId: Number(chainId), rpcUrl: process.env.RPC_URL }] })
      : {};
    const resolver = new Resolver({ ...getPkhResolver(), ...ethr } as any);
    const verified = await verifyCredential(String(req.body?.vcJwt || ""), resolver);
    res.json({
      valid: true,
      issuer: verified.issuer,
      credential: verified.verifiableCredential,
    });
  } catch (error: any) {
    res.status(400).json({ valid: false, error: error.message });
  }
});

app.post("/credentials/:hash/revoke", sensitiveLimiter, async (req, res) => {
  try {
    if (!authenticated(req.headers.authorization)) return res.status(401).json({ error: "unauthorized" });
    if (!pk) throw new Error("ISSUER_PK required");
    const signer = new Wallet(pk, new JsonRpcProvider(process.env.RPC_URL));
    const registry = new Contract(process.env.CREDENTIAL_REGISTRY_ADDRESS!, ["function revoke(bytes32)"], signer);
    const tx = await registry.revoke(req.params.hash);
    res.json({ txHash: tx.hash });
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

app.get("/credentials/:hash/status", sensitiveLimiter, async (req, res) => {
  try {
    const provider = new JsonRpcProvider(process.env.RPC_URL);
    const registry = new Contract(process.env.CREDENTIAL_REGISTRY_ADDRESS!, [
      "function isValid(bytes32) view returns(bool)",
      "function get(bytes32) view returns(address issuer,address subject,uint8 tier,uint64 expiry,bool revoked)",
    ], provider);
    const [valid, credential] = await Promise.all([registry.isValid(req.params.hash), registry.get(req.params.hash)]);
    res.json({ status: valid ? "valid" : credential.revoked ? "revoked" : Number(credential.expiry) <= Date.now() / 1000 ? "expired" : "invalid" });
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

app.get("/status-lists/1", sensitiveLimiter, async (_req, res) => {
  try {
    if (!statusListEnabled || !pk) return res.status(404).json({ error: "status list is disabled" });
    const credential = await statusList.credential(issuerDid(chainId, new Wallet(pk).address));
    res.json({ credential, vcJwt: await signCredentialJwt(pk, chainId, credential) });
  } catch (error: any) { res.status(500).json({ error: error.message }); }
});

app.post("/status-lists/:hash/revoke", sensitiveLimiter, async (req, res) => {
  try {
    if (!authenticated(req.headers.authorization)) return res.status(401).json({ error: "unauthorized" });
    if (!statusListEnabled) return res.status(404).json({ error: "status list is disabled" });
    const index = await statusList.revoke(String(req.params.hash));
    res.json({ revoked: true, index, statusList: statusList.publicUrl, scope: "off-chain VC verification only" });
  } catch (error: any) { res.status(400).json({ error: error.message }); }
});

app.get("/.well-known/did.json", (_req, res) => {
  if (!pk) return res.status(503).json({ error: "issuer not configured" });
  const wallet = new Wallet(pk), did = issuerDid(chainId, wallet.address);
  res.json({
    "@context": ["https://www.w3.org/ns/did/v1"],
    id: did,
    verificationMethod: [{
      id: `${did}#controller`,
      type: "EcdsaSecp256k1RecoveryMethod2020",
      controller: did,
      blockchainAccountId: `eip155:${chainId}:${wallet.address}`,
    }],
    authentication: [`${did}#controller`],
  });
});

if (require.main === module) app.listen(port, "0.0.0.0", () => console.log(`CredPool issuer service on :${port}`));
export default app;
