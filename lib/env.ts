import { Hex } from "viem";

export const APP_FID = Number(process.env.APP_FID as string);
export const APP_SECRET_ENCRYPTION_KEY = process.env.APP_SECRET_ENCRYPTION_KEY as string;
export const APP_SECRET_ENCRYPTION_SALT = process.env.APP_SECRET_ENCRYPTION_SALT as string;
export const APP_SIGNER_KEY = process.env.APP_SIGNER_KEY as Hex;
