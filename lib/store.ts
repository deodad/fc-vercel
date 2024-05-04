import { kv } from "@vercel/kv";
import { Hex, bytesToHex, hexToBytes } from "viem";
import { EncryptedBlob, decrypt, encrypt } from "./encryption.js";

export const setOauthState = ({ state, fid }: { state: string; fid: number }) =>
  kv.set(`linear:state:${state}`, fid, { ex: 300 });

export const getOauthState = ({ state }: { state: string }) =>
  kv.get<number>(`linear:state:${state}`);

export const delOauthState = ({ state }: { state: string }) =>
  kv.del(`linear:state:${state}`);

export const setOauthToken = ({
  fid,
  token,
  expires,
}: {
  fid: number;
  token: string;
  expires: number;
}) =>
  kv.set<string>(`linear:tokens:${fid}`, token, {
    ex: expires,
  });

export const getOauthToken = ({ fid }: { fid: number }) =>
  kv.get<string>(`linear:tokens:${fid}`);

export type WorkspaceConfig = {
  fid: number;
  signer: string;
};

export const setPrivateKey = ({
  token,
  privateKey,
}: {
  token: string;
  privateKey: string;
}) => kv.set(`linear:tmp:signer:${token}`, encrypt(hexToBytes(privateKey as Hex)), { ex: 60 * 60 * 5 });

export const getdelPrivateKey = async ({ token }: { token: string }) => {
  const key = await kv.getdel<EncryptedBlob>(`linear:tmp:signer:${token}`);
  return key ? bytesToHex(decrypt(key)) : null;
}

export const setWorkspaceConfig = ({
  workspaceId,
  config,
}: {
  workspaceId: string;
  config: WorkspaceConfig;
}) => kv.set(`linear:workspace:config:${workspaceId}`, {
  ...config,
  signer: encrypt(hexToBytes(config.signer as Hex))
});

export const getWorkspaceConfig = async ({ workspaceId }: { workspaceId: string }) => {
  const config = await kv.get<{ fid: number; signer: EncryptedBlob }>(`linear:workspace:config:${workspaceId}`);
  if (config) {
    return {
      ...config,
      signer: bytesToHex(decrypt(config.signer as EncryptedBlob))
    }
  }

  return null;
}

export type CastId = {
  fid: number;
  hash: string;
};

export const setLinearIssueCast = ({
  issueId,
  cast,
}: {
  issueId: string;
  cast: CastId;
}) =>
  kv.set(`linear:issues:${issueId}`, cast, {
    ex: 60 * 60 * 24 * 365,
  });

export const getDelLinearIssueCast = ({ issueId }: { issueId: string }) =>
  kv.getdel<CastId>(`linear:issues:${issueId}`);
