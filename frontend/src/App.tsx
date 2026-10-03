import { useEffect, useState } from "react";
import {
  BrowserProvider,
  Contract,
  Signature,
  formatUnits,
  parseUnits,
  type Eip1193Provider,
} from "ethers";
import { badgeAbi, erc20Abi, env, expectedChain, issuerUrl, poolAbi } from "./config";
import { decryptForHolder, encryptForHolder } from "./credentialCrypto";

declare global {
  interface Window {
    ethereum?: Eip1193Provider;
  }
}

type TxStatus = "idle" | "pending" | "confirmed" | "failed";

function friendlyError(error: any) {
  const message = String(error?.revert?.name || error?.shortMessage || error?.message || error);
  if (message.includes("NotVerified")) return "A valid credential is required for this action.";
  if (message.includes("Expired"))
    return "The transaction or credential has expired. Please retry.";
  if (message.includes("LimitExceeded"))
    return "Your tier allowance for this rolling window is exhausted.";
  return message;
}

type CredentialRecord = {
  credentialHash: string;
  cid: string;
  expiry: number;
  tier: number;
  status: string;
};

export default function App() {
  const [provider, setProvider] = useState<BrowserProvider>();
  const [account, setAccount] = useState("");
  const [chain, setChain] = useState<bigint>();
  const [wrongNetwork, setWrongNetwork] = useState(false);
  const [tier, setTier] = useState(0);
  const [tab, setTab] = useState("swap");
  const [msg, setMsg] = useState("");
  const [amount, setAmount] = useState("");
  const [quote, setQuote] = useState("");
  const [slippage, setSlip] = useState("0.5");
  const [remaining, setRemaining] = useState("");
  const [loadingIdentity, setLoadingIdentity] = useState(false);
  const [txStatus, setTxStatus] = useState<TxStatus>("idle");
  const [creds, setCreds] = useState<CredentialRecord[]>(() =>
    JSON.parse(localStorage.getItem("credentials") || "[]"),
  );
  const badge = (): any => new Contract(env.VITE_ACCESS_BADGE_ADDRESS, badgeAbi, provider);
  const pool = (): any => new Contract(env.VITE_POOL_ADDRESS, poolAbi, provider);
  async function refreshAllowance(p: BrowserProvider, a: string) {
    const value = await new Contract(env.VITE_POOL_ADDRESS, poolAbi, p).remainingVolume(a);
    setRemaining(value === (1n << 256n) - 1n ? "Unlimited" : `${formatUnits(value, 18)} Token A`);
  }
  async function connect() {
    if (!window.ethereum) return setMsg("Install MetaMask to continue");
    setLoadingIdentity(true);
    try {
      const p = new BrowserProvider(window.ethereum),
        [a] = await p.send("eth_requestAccounts", []);
      setProvider(p);
      setAccount(a);
      const connectedChain = (await p.getNetwork()).chainId;
      setChain(connectedChain);
      setWrongNetwork(connectedChain !== expectedChain);
      if (connectedChain !== expectedChain) {
        setTier(0);
        return;
      }
      setTier(Number(await new Contract(env.VITE_ACCESS_BADGE_ADDRESS, badgeAbi, p).tierOf(a)));
      await refreshAllowance(p, a);
    } catch (error) {
      setMsg(friendlyError(error));
    } finally {
      setLoadingIdentity(false);
    }
  }
  async function switchNetwork() {
    if (!window.ethereum) return;
    try {
      await window.ethereum.request({
        method: "wallet_switchEthereumChain",
        params: [{ chainId: `0x${expectedChain.toString(16)}` }],
      });
      await connect();
    } catch (error) {
      setMsg(friendlyError(error));
    }
  }
  useEffect(() => localStorage.setItem("credentials", JSON.stringify(creds)), [creds]);
  useEffect(() => {
    if (!creds.length) return;
    const poll = async () => {
      const next = await Promise.all(
        creds.map(async (c) => {
          try {
            const r = await fetch(
              `${env.VITE_ISSUER_URL || "http://localhost:4000"}/credentials/${c.credentialHash}/status`,
            );
            const x = await r.json();
            return { ...c, status: x.status || c.status };
          } catch {
            return c;
          }
        }),
      );
      setCreds(next);
    };
    const id = setInterval(poll, 15000);
    return () => clearInterval(id);
  }, [creds.length]);
  async function download(c: CredentialRecord) {
    try {
      setMsg("Sign to decrypt your credential…");
      const r = await fetch(`${issuerUrl}/credentials/${c.cid}/download`);
      if (!r.ok) throw Error("Credential download failed");
      const plaintext = await decryptForHolder(
          await provider!.getSigner(),
          new Uint8Array(await r.arrayBuffer()),
          account,
          chain!,
        ),
        u = URL.createObjectURL(new Blob([plaintext], { type: "application/json" })),
        a = document.createElement("a");
      a.href = u;
      a.download = `${c.credentialHash}.vc.json`;
      a.click();
      URL.revokeObjectURL(u);
      setMsg("Credential decrypted locally");
    } catch (e: any) {
      setMsg(e.message);
    }
  }
  useEffect(() => {
    if (!provider || !amount) return setQuote("");
    const id = setTimeout(async () => {
      try {
        setQuote(
          formatUnits(
            await pool().getAmountOut(env.VITE_TOKEN0_ADDRESS, parseUnits(amount, 18)),
            18,
          ),
        );
      } catch {
        setQuote("");
      }
    }, 250);
    return () => clearTimeout(id);
  }, [amount, provider]);
  async function verify(t: number) {
    try {
      setMsg("Requesting credential…");
      const signer = await provider!.getSigner(),
        nonce = await badge().nonces(account),
        r = await fetch(`${issuerUrl}/credentials/request`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            address: account,
            tier: t,
            nonce: nonce.toString(),
            kycPayload: { passcode: "DEMO-PASS" },
          }),
        }),
        x = await r.json();
      if (!r.ok) throw Error(x.error);
      setMsg("Verifying VC signature and DID…");
      const verification = await fetch(`${issuerUrl}/credentials/verify`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          vcJwt: x.vcJwt,
          holder: account,
        }),
      });
      if (!verification.ok)
        throw Error((await verification.json()).error || "VC verification failed");
      setMsg("Sign once to encrypt your credential…");
      const ciphertextBase64 = await encryptForHolder(signer, x.vcPayload, account, chain!);
      const upload = await fetch(`${issuerUrl}/storage/upload`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ ciphertextBase64 }),
        }),
        stored = await upload.json();
      if (!upload.ok) throw Error(stored.error);
      setMsg("Confirm badge claim…");
      await (await badge().connect(signer).claim(x.attestation, x.signature)).wait();
      setTier(t);
      setCreds((c) => [
        {
          credentialHash: x.credentialHash,
          cid: stored.cid,
          expiry: x.attestation.expiry,
          tier: t,
          status: "valid",
        },
        ...c,
      ]);
      setMsg("Verification complete — encrypted by your wallet");
    } catch (e: any) {
      setMsg(friendlyError(e));
    }
  }
  async function swap() {
    setTxStatus("pending");
    try {
      const signer = await provider!.getSigner(),
        a = parseUnits(amount, 18),
        q = await pool().getAmountOut(env.VITE_TOKEN0_ADDRESS, a),
        min = (q * (10000n - BigInt(Math.round(Number(slippage) * 100)))) / 10000n,
        deadline = Math.floor(Date.now() / 1000) + 1200,
        token = new Contract(env.VITE_TOKEN0_ADDRESS, erc20Abi, provider),
        nonce = await token.nonces(account),
        name = await token.name();
      setMsg("Sign gasless token permit…");
      const signature = await signer.signTypedData(
          {
            name,
            version: "1",
            chainId: chain!,
            verifyingContract: env.VITE_TOKEN0_ADDRESS,
          },
          {
            Permit: [
              { name: "owner", type: "address" },
              { name: "spender", type: "address" },
              { name: "value", type: "uint256" },
              { name: "nonce", type: "uint256" },
              { name: "deadline", type: "uint256" },
            ],
          },
          {
            owner: account,
            spender: env.VITE_POOL_ADDRESS,
            value: a,
            nonce,
            deadline,
          },
        ),
        sig = Signature.from(signature);
      setMsg("Confirm atomic permit swap…");
      await (
        await pool()
          .connect(signer)
          .swapWithPermit(env.VITE_TOKEN0_ADDRESS, a, min, deadline, sig.v, sig.r, sig.s)
      ).wait();
      setTxStatus("confirmed");
      setMsg("Swap confirmed");
      await refreshAllowance(provider!, account);
    } catch (e: any) {
      setTxStatus("failed");
      setMsg(friendlyError(e));
    }
  }
  async function liquidity(add = true) {
    try {
      const signer = await provider!.getSigner(),
        a = parseUnits(amount || "0", 18);
      if (add) {
        for (const token of [env.VITE_TOKEN0_ADDRESS, env.VITE_TOKEN1_ADDRESS])
          await (
            await new Contract(token, erc20Abi, signer).approve(env.VITE_POOL_ADDRESS, a)
          ).wait();
        await (
          await pool()
            .connect(signer)
            .addLiquidity(a, a, 0, 0, Math.floor(Date.now() / 1000) + 1200)
        ).wait();
      } else
        await (
          await pool()
            .connect(signer)
            .removeLiquidity(a, 0, 0, Math.floor(Date.now() / 1000) + 1200)
        ).wait();
      setMsg(add ? "Liquidity added" : "Liquidity removed");
    } catch (e: any) {
      setMsg(e.shortMessage || e.message);
    }
  }
  const did =
    account &&
    (env.VITE_DID_METHOD === "ethr"
      ? `did:ethr:${env.VITE_ETHR_NETWORK || chain}:${account.toLowerCase()}`
      : `did:pkh:eip155:${chain}:${account.toLowerCase()}`);
  return (
    <>
      <header>
        <div className="brand">
          <i>◆</i> Cred<span>Pool</span>
        </div>
        <nav>
          {["swap", "liquidity", "credentials"].map((x) => (
            <button key={x} className={tab === x ? "on" : ""} onClick={() => setTab(x)}>
              {x}
            </button>
          ))}
        </nav>
        <button className="wallet" onClick={connect}>
          {account ? `${account.slice(0, 6)}…${account.slice(-4)}` : "Connect wallet"}
        </button>
      </header>
      <main>
        {wrongNetwork && (
          <div className="network-error">
            <b>Wrong network</b>
            <span>Switch your wallet to chain {expectedChain.toString()} to use CredPool.</span>
            <button className="secondary" onClick={switchNetwork}>
              Switch network
            </button>
          </div>
        )}
        <section className="hero">
          <div className="eyebrow">INSTITUTIONAL DEFI · CREDENTIAL-GATED</div>
          <h1>
            Permissioned liquidity,
            <br />
            <em>without compromise.</em>
          </h1>
          <p>Trade and provide liquidity using privacy-preserving verifiable credentials.</p>
        </section>
        {loadingIdentity && <div className="identity skeleton">Loading wallet identity…</div>}
        {account && !loadingIdentity && (
          <div className="identity">
            <div>
              <small>CONNECTED IDENTITY</small>
              <b>{did}</b>
            </div>
            <span className={`tier t${tier}`}>
              {tier ? ["", "Basic", "Pro", "Institutional"][tier] : "Unverified"}
            </span>
          </div>
        )}
        {tab === "swap" && (
          <section className="card">
            <div className="title">
              <h2>Swap</h2>
              <label>
                Slippage <input value={slippage} onChange={(e) => setSlip(e.target.value)} />%
              </label>
            </div>
            <div className="token">
              <small>YOU PAY</small>
              <input placeholder="0.0" value={amount} onChange={(e) => setAmount(e.target.value)} />
              <b>Token A</b>
            </div>
            <div className="arrow">↓</div>
            <div className="token">
              <small>YOU RECEIVE</small>
              <input disabled value={quote} />
              <b>Token B</b>
            </div>
            {account && tier > 0 && (
              <p className="muted" data-testid="remaining-allowance">
                Rolling-window allowance: {remaining || "Loading…"}
              </p>
            )}
            <button
              className="primary"
              data-status={txStatus}
              disabled={!account || wrongNetwork || tier < 1 || !amount || txStatus === "pending"}
              onClick={swap}
            >
              {!account
                ? "Connect wallet"
                : tier < 1
                  ? "Basic credential required"
                  : txStatus === "pending"
                    ? "Transaction pending…"
                    : "Review swap"}
            </button>
          </section>
        )}
        {tab === "liquidity" && (
          <section className="card">
            <h2>Liquidity</h2>
            {tier < 2 ? (
              <Gate onVerify={() => verify(2)} />
            ) : (
              <>
                <p className="muted">Supply equal values of both tokens, or burn GLP shares.</p>
                <div className="token">
                  <small>AMOUNT / SHARES</small>
                  <input
                    placeholder="0.0"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                  />
                </div>
                <div className="row">
                  <button className="primary" onClick={() => liquidity(true)}>
                    Add liquidity
                  </button>
                  <button className="secondary" onClick={() => liquidity(false)}>
                    Remove
                  </button>
                </div>
              </>
            )}
          </section>
        )}
        {tab === "credentials" && (
          <section className="card wide">
            <div className="title">
              <h2>Your credentials</h2>
              {tier < 3 && (
                <button
                  className="secondary"
                  onClick={() => verify(tier ? Math.min(3, tier + 1) : 1)}
                >
                  {tier ? "Upgrade tier" : "Get verified"}
                </button>
              )}
            </div>
            {!creds.length ? (
              <Gate onVerify={() => verify(1)} />
            ) : (
              creds.map((c) => (
                <div className="credential" key={c.credentialHash}>
                  <span className="seal">✓</span>
                  <div>
                    <b>Tier {c.tier} KYC Credential</b>
                    <small>
                      {c.credentialHash.slice(0, 22)}… · IPFS {c.cid.slice(0, 16)}…
                    </small>
                  </div>
                  <button className="download" onClick={() => download(c)}>
                    Download
                  </button>
                  <span className="valid">
                    {Date.now() / 1000 < c.expiry ? c.status : "expired"}
                  </span>
                </div>
              ))
            )}
          </section>
        )}
        {msg && (
          <div className="toast" onClick={() => setMsg("")}>
            {msg}
          </div>
        )}
      </main>
      <footer>Non-custodial · Soulbound access · Encrypted credentials</footer>
    </>
  );
}
function Gate({ onVerify }: { onVerify: () => void }) {
  return (
    <div className="gate">
      <div className="lock">◇</div>
      <h3>Credential required</h3>
      <p>Complete mock KYC to unlock this action. Personal data never goes on-chain.</p>
      <button className="primary" onClick={onVerify}>
        Get verified
      </button>
    </div>
  );
}
