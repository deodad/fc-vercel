import { NeynarAPIClient } from "@neynar/nodejs-sdk";

export const NEYNAR_API_KEY = process.env.NEYNAR_API_KEY as string;
export const NEYNAR_CLIENT_ID = process.env.NEYNAR_CLIENT_ID as string;

export const neynar = new NeynarAPIClient(NEYNAR_API_KEY);
