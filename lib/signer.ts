import { sha512 } from "@noble/hashes/sha512";
ed.etc.sha512Sync = (...m) => sha512(ed.etc.concatBytes(...m));

import { webcrypto } from "node:crypto";
// @ts-ignore
if (!globalThis.crypto) globalThis.crypto = webcrypto;

import * as ed from "@noble/ed25519";
import { Hex, bytesToHex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import got from "got";
import { APP_FID } from "./env.js";

const SIGNED_KEY_REQUEST_VALIDATOR_EIP_712_DOMAIN = {
  name: "Farcaster SignedKeyRequestValidator",
  version: "1",
  chainId: 10,
  verifyingContract: "0x00000000fc700472606ed4fa22623acf62c60553",
} as const;

const SIGNED_KEY_REQUEST_TYPE = [
  { name: "requestFid", type: "uint256" },
  { name: "key", type: "bytes" },
  { name: "deadline", type: "uint256" },
] as const;

const account = privateKeyToAccount(process.env.APP_PK as Hex);
const warpcastApi = "https://api.warpcast.com";

export const generateSignerRequest = async () => {
  const privateKey = ed.utils.randomPrivateKey();
  const publicKeyBytes = ed.getPublicKey(privateKey);
  const publicKey = "0x" + Buffer.from(publicKeyBytes).toString("hex");
  const deadline = Math.floor(Date.now() / 1000) + 60 * 60 * 1;
  const signature = await account.signTypedData({
    domain: SIGNED_KEY_REQUEST_VALIDATOR_EIP_712_DOMAIN,
    types: {
      SignedKeyRequest: SIGNED_KEY_REQUEST_TYPE,
    },
    primaryType: "SignedKeyRequest",
    message: {
      requestFid: BigInt(APP_FID),
      key: publicKey as Hex,
      deadline: BigInt(deadline),
    },
  });

  const res = await got
    .post(`${warpcastApi}/v2/signed-key-requests`, {
      json: {
        key: publicKey,
        requestFid: APP_FID,
        signature,
        deadline,
      },
    })
    .json<{
      result: { signedKeyRequest: { token: string; deeplinkUrl: string } };
    }>();

  const { token, deeplinkUrl } = res.result.signedKeyRequest;
  return { token, deeplinkUrl, privateKey: bytesToHex(privateKey) };
};

export const checkSignerReqeust = async (token: string) => {
  const res = await got
    .get(`${warpcastApi}/v2/signed-key-request`, {
      searchParams: {
        token,
      },
    })
    .json<{ result: { signedKeyRequest: { userFid?: number } } }>();

  if (res.result.signedKeyRequest.userFid) {
    return {
      fid: res.result.signedKeyRequest.userFid,
    };
  }
};
