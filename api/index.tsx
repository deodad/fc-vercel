import {
  LINEAR_WEBHOOK_SIGNATURE_HEADER,
  LINEAR_WEBHOOK_TS_FIELD,
  LinearClient,
  LinearWebhooks,
} from "@linear/sdk";
import { Button, Frog, TextInput } from "frog";
import { devtools } from "frog/dev";
import { neynar as neynarHub } from "frog/hubs";
import { neynar as neynarMw } from "frog/middlewares";
import { serveStatic } from "frog/serve-static";
import { handle } from "frog/vercel";
import { createSystem } from "frog/ui";
import {
  Message,
  makeCastAdd,
  NobleEd25519Signer,
  FarcasterNetwork,
} from "@farcaster/hub-nodejs";
import qrcode from "qrcode";
import { Hex, bytesToHex, hexToBytes } from "viem";
import {
  WorkspaceConfig,
  delOauthState,
  getDelLinearIssueCast,
  getOauthState,
  getOauthToken,
  getWorkspaceConfig,
  getdelPrivateKey,
  setLinearIssueCast,
  setOauthState,
  setOauthToken,
  setPrivateKey,
  setWorkspaceConfig,
} from "../lib/store.js";
import { NEYNAR_API_KEY, neynar } from "../lib/neynar.js";
import { APP_FID, APP_SIGNER_KEY } from "../lib/env.js";
import { checkSignerReqeust, generateSignerRequest } from "../lib/signer.js";
import { kv } from "@vercel/kv";

const { Box, Heading, VStack, Text, vars, Image } = createSystem();

// @ts-ignore
const isEdgeFunction = typeof EdgeFunction !== "undefined";
const isProduction = isEdgeFunction || import.meta.env?.MODE !== "development";

const LINEAR_CLIENT_ID = process.env.LINEAR_CLIENT_ID ?? "";
const LINEAR_CLIENT_SECRET = process.env.LINEAR_CLIENT_SECRET ?? "";
const LINEAR_WEBHOOK_SECRET = process.env.LINEAR_WEBHOOK_SECRET ?? "";

const ed25519Signer = new NobleEd25519Signer(hexToBytes(APP_SIGNER_KEY));

const dataOptions = {
  fid: APP_FID,
  network: FarcasterNetwork.MAINNET,
};

type State = {
  signerRequest?: {
    token: string;
    deeplinkUrl: string;
  };
};

export const app = new Frog<{ State: State }>({
  ui: { vars },
  assetsPath: "/",
  basePath: "/api",
  hub: neynarHub({ apiKey: NEYNAR_API_KEY }),
  verify: isProduction,
  initialState: {},
}).use(neynarMw({ apiKey: NEYNAR_API_KEY, features: ["cast"] }));

const redirectUri =
  "https://fc.deodad.xyz/api/create-linear-issue/oauth-callback";

app.castAction(
  "/create-linear-issue",
  async (c) => {
    const token = await getOauthToken({ fid: c.actionData.fid });
    if (!token) {
      return c.res({ type: "frame", path: "/create-linear-issue/settings" });
    } else {
      return c.res({ type: "frame", path: "/create-linear-issue/input" });
    }
  },
  {
    name: "Create Linear issue",
    description: "Creates an issue in Linear from a cast",
    icon: "bug",
  },
);

app.frame("/create-linear-issue/settings", async (c) => {
  if (!c.frameData) {
    throw new Error(`No frame data`);
  }

  let workspaceConfig: WorkspaceConfig | null = null;
  let workspaceName: string | null = null;
  let connectedAccount: string | null = null;

  const userFid = c.frameData.fid;

  const token = await getOauthToken({ fid: userFid });
  const state = crypto.randomUUID();
  await setOauthState({ state, fid: userFid });

  const oauthUrl = new URL("https://linear.app/oauth/authorize");
  oauthUrl.searchParams.set("response_type", "code");
  oauthUrl.searchParams.set("client_id", LINEAR_CLIENT_ID);
  oauthUrl.searchParams.set("client_secret", LINEAR_CLIENT_SECRET);
  oauthUrl.searchParams.set("redirect_uri", redirectUri);
  oauthUrl.searchParams.set("state", state);
  oauthUrl.searchParams.set("scope", "read,issues:create");

  if (token) {
    const client = new LinearClient({ accessToken: token });
    const user = await client.viewer;
    const organization = await user.organization;

    workspaceName = organization.name;
    workspaceConfig = await getWorkspaceConfig({
      workspaceId: organization.id,
    });


    if (workspaceConfig) {
      const bulkUsers = await neynar.fetchBulkUsers([workspaceConfig.fid]);
      if (bulkUsers.users.length) {
        connectedAccount = bulkUsers.users[0].username;
      }
    }
  }

  return c.res({
    image: (
      <Box
        grow
        alignVertical="center"
        backgroundColor="background"
        justifyContent="space-around"
        padding="32"
      >
          <VStack gap="4">
            <Heading size="24">Connect to Linear</Heading>
            <Text color="text200" size="18">
              After authorizing, return here and refresh.
            </Text>
            {!!workspaceName && (
              <Text color="text200" size="18">
                Connected to {workspaceName} Linear workspace.
              </Text>
            )}
          </VStack>
          <VStack gap="4">
            <Heading size="24">Connect to Farcaster</Heading>
            <Text color="text200" size="18">
              Add a signer to have replies come from your account.
            </Text>
            {!!workspaceConfig && (
              <Text color="text200" size="18">
                Connected to @{connectedAccount} Farcaster account.
              </Text>
            )}
          </VStack>
      </Box>
    ),
    intents: [
      <Button.Link href={oauthUrl.href}>Connect Linear</Button.Link>,
      <Button action="/create-linear-issue/connect-farcaster">
        Connect Farcaster
      </Button>,
      <Button action="/create-linear-issue/settings">Refresh</Button>,
      <Button action="/create-linear-issue/input">Back</Button>,
    ],
  });
});

app.frame("/create-linear-issue/connect-farcaster", async (c) => {
  if (!c.frameData) {
    throw new Error(`No frame data`);
  }

  let signerRequest = c.previousState.signerRequest;
  let state = c.previousState;

  if (signerRequest) {
    const result = await checkSignerReqeust(signerRequest.token);

    if (result) {
      const privateKey = await getdelPrivateKey({ token: signerRequest.token });
      if (!privateKey) {
        return c.error({ message: "Error, try again" });
      }

      const token = await getOauthToken({ fid: c.frameData.fid });
      if (!token) {
        return c.error({ message: "Connect to Linear first" });
      }

      const client = new LinearClient({ accessToken: token });
      const user = await client.viewer;
      const organization = await user.organization;

      c.deriveState((previousState) => {
        previousState.signerRequest = undefined;
      });

      await setWorkspaceConfig({
        workspaceId: organization.id,
        config: {
          fid: result.fid,
          signer: privateKey,
        },
      });

      return c.res({
        image: (
          <Box
            grow
            alignVertical="center"
            backgroundColor="background"
            padding="32"
          >
            <Heading>Account connected</Heading>
          </Box>
        ),
        intents: [
          <Button action="/create-linear-issue/settings">Continue</Button>,
        ],
      });
    }
  } else {
    const { privateKey, token, deeplinkUrl } = await generateSignerRequest();
    await setPrivateKey({ token, privateKey });
    state = c.deriveState((previousState) => {
      previousState.signerRequest = {
        token,
        deeplinkUrl,
      };
    });
  }

  return c.res({
    image: (
      <Box
        grow
        alignVertical="center"
        backgroundColor="background"
        padding="32"
      >
        <Box flexDirection="row" justifyContent="space-between">
          <Box>
            <VStack gap="4">
              <Heading>Connect</Heading>
              <Text color="text200" size="18">
                Scan the QR code 
              </Text>
            </VStack>
          </Box>
          <Box paddingLeft="32">
            <Image
              src={await qrcode.toDataURL(state.signerRequest?.deeplinkUrl ?? '')}
              width="256"
              height="256"
            />
          </Box>
        </Box>
      </Box>
    ),
    intents: [
      <Button action="/create-linear-issue/connect-farcaster">Refresh</Button>,
    ],
  });
});

app.frame("/create-linear-issue/dev", async (c) => {
  return c.res({
    image: 
      <Box
        grow
        alignVertical="center"
        backgroundColor="background"
        padding="32"
      >
        <Text>Get started</Text>
      </Box>,
    intents: [
      <Button action="/create-linear-issue/input">Get started</Button>,
    ],
  });
});

app.frame("/create-linear-issue/input", async (c) => {
  const warpcastImage = `https://client.warpcast.com/v2/og-image?castHash=${c.var.cast?.hash}`;

  return c.res({
    image: warpcastImage,
    intents: [
      <TextInput placeholder="Issue title" />,
      <Button action="/create-linear-issue/finish">Create issue</Button>,
      <Button action="/create-linear-issue/settings">Settings</Button>,
    ],
  });
});

app.frame("/create-linear-issue/finish", async (c) => {
  if (!c.frameData) {
    return c.res({
      image: <Box><Text>todo</Text></Box>,
    });
  }

  const userFid = c.frameData.fid;
  const token = await getOauthToken({ fid: userFid });
  if (!token) {
    // redirect to auth
    throw new Error(`No frame data`);
  }

  const client = new LinearClient({ accessToken: token });
  const user = await client.viewer;
  const [organization, teams] = await Promise.all([client.organization, user.teams()]);
  const teamId = teams.nodes[0].id;
  const warpcastImage = `https://client.warpcast.com/v2/og-image?castHash=${c.var.cast?.hash}`;
  const warpcastLink = `https://warpcast.com/${c.var.cast?.author.username}/${c.var.cast?.hash.slice(0, 10)}`;
  const createResult = await client.createIssue({
    title: c.inputText,
    description: `![${c.var.cast?.hash}](${warpcastImage})\n\n${c.var.cast?.text}\n\n${warpcastLink}`,
    teamId,
  });
  const issue = await createResult.issue;

  void kv.incr('created_issues:all');
  void kv.incr(`created_issues:${userFid}`);

  if (!issue) {
    return c.error({ message: "Failed to create issue" });
  }

  let dataOpts = dataOptions;
  let signer = ed25519Signer;

  const workspaceConfig = await getWorkspaceConfig({ workspaceId: organization.id });
  if (workspaceConfig) {
    dataOpts = {
      ...dataOptions,
      fid: workspaceConfig.fid
    }
    signer = new NobleEd25519Signer(hexToBytes(workspaceConfig.signer as Hex));
  }

  const castResult = await makeCastAdd(
    {
      text: " created an issue from this cast in Linear",
      embeds: [],
      embedsDeprecated: [],
      mentions: [userFid],
      mentionsPositions: [0], // The position in bytes (not characters)
      parentCastId: {
        fid: c.frameData.castId.fid,
        hash: hexToBytes(c.frameData.castId.hash as Hex),
      },
    },
    dataOpts,
    signer
  );

  if (castResult.isOk()) {
    const result = await fetch("https://api.neynar.com/v2/farcaster/message", {
      method: "post",
      headers: {
        accept: "application/json",
        api_key: NEYNAR_API_KEY,
        "content-type": "application/json",
      },
      body: JSON.stringify(Message.toJSON(castResult.value) as BodyInit),
    });

    await setLinearIssueCast({
      issueId: issue.id,
      cast: {
        fid: castResult.value.data.fid,
        hash: bytesToHex(castResult.value.hash),
      },
    });

    if (!result.ok) {
      console.warn("Failed to create cast", await result.json());
    }
  }

  return c.res({
    image: (
      <Box
        grow
        alignVertical="center"
        backgroundColor="background"
        padding="32"
      >
        <Heading>Issue created</Heading>
      </Box>
    ),
    intents: [
      <Button.Link href={issue?.url ?? ""}>Open in Linear</Button.Link>,
    ],
  });
});

const webhook = new LinearWebhooks(LINEAR_WEBHOOK_SECRET);

app.hono.post("/create-linear-issue/webhook", async (c) => {
  const rawBody = Buffer.from(await c.req.arrayBuffer());
  const jsonBody = await c.req.json();
  const valid = webhook.verify(
    rawBody,
    c.req.header(LINEAR_WEBHOOK_SIGNATURE_HEADER) as string,
    jsonBody[LINEAR_WEBHOOK_TS_FIELD],
  );

  if (!valid) {
    throw new Error("Unable to validate webhook signature");
  }

  if (
    jsonBody.type === "Issue" &&
    jsonBody.action === "update" &&
    jsonBody.data.completedAt
  ) {
    const castId = await getDelLinearIssueCast({ issueId: jsonBody.data.id });
    if (castId) {
      const workspaceConfig = await getWorkspaceConfig({ workspaceId: jsonBody.organizationId });
      let dataOpts = dataOptions;
      let signer = ed25519Signer;

      if (workspaceConfig) {
        dataOpts = {
          ...dataOptions,
          fid: workspaceConfig.fid
        }
        signer = new NobleEd25519Signer(hexToBytes(workspaceConfig.signer as Hex));
      }

      const { fid, hash } = castId;
      const castResult = await makeCastAdd(
        {
          text: "☝️ this issue was completed",
          embeds: [],
          embedsDeprecated: [],
          mentions: [],
          mentionsPositions: [], // The position in bytes (not characters)
          parentCastId: {
            hash: hexToBytes(hash as Hex),
            fid,
          },
        },
        dataOpts,
        signer,
      );

      if (castResult.isOk()) {
        const result = await fetch(
          "https://api.neynar.com/v2/farcaster/message",
          {
            method: "post",
            headers: {
              accept: "application/json",
              api_key: NEYNAR_API_KEY,
              "content-type": "application/json",
            },
            body: JSON.stringify(Message.toJSON(castResult.value) as BodyInit),
          },
        );

        if (!result.ok) {
          console.warn("Failed to create cast", await result.json());
        }
      }
    }
  }

  return c.text("ok");
});

app.hono.get("/create-linear-issue/oauth-callback", async (c) => {
  const code = c.req.query("code");
  if (!code) {
    return c.text("No code");
  }

  const state = c.req.query("state");
  if (!state) {
    return c.text("No state");
  }

  const fid = await getOauthState({ state });
  if (!fid) {
    return c.text(
      "No request found, try refreshing the frame and trying again.",
    );
  }

  const formData = new URL("https://api.linear.app/oauth/token");
  const tokenParams = new URLSearchParams({
    grant_type: "authorization_code",
    client_id: "42a0843fe7d963be6c596db569bc35f2",
    client_secret: "48154a2ec5d11cc2afcf243d2d41c35f",
    redirect_uri: redirectUri,
    code,
  });

  const response = await fetch(formData.href, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: tokenParams,
  }).then(async (response) => {
    if (!response.ok) {
      throw new Error(
        `Network response was not ok ${JSON.stringify(await response.json())}`,
      );
    }
    return response.json(); // Assuming the response is JSON
  });

  await setOauthToken({
    fid,
    token: response.access_token,
    expires: response.expires_in,
  });
  await delOauthState({ state });

  return c.text("Success! Return to the frame and refresh");
});

devtools(app, isProduction ? { assetsPath: "/.frog" } : { serveStatic });

export const GET = handle(app);
export const POST = handle(app);
