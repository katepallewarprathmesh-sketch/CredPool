import { Signer, TypedDataDomain, keccak256, toUtf8Bytes } from "ethers";
export type Attestation = {subject:string;tier:number;credentialHash:string;expiry:number;nonce:bigint};
export const types={Attestation:[{name:"subject",type:"address"},{name:"tier",type:"uint8"},{name:"credentialHash",type:"bytes32"},{name:"expiry",type:"uint64"},{name:"nonce",type:"uint256"}]};
export function hash(label:string){return keccak256(toUtf8Bytes(label));}
export async function sign(signer:Signer,badge:string,chainId:bigint,att:Attestation, override:Partial<TypedDataDomain>={}){
 const domain={name:"GatedAccess",version:"1",chainId,verifyingContract:badge,...override}; return signer.signTypedData(domain,types,att);
}
