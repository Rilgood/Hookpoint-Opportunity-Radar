// Side-effect import: sets RADAR_CONFIG_DIR before the radar-core imports
// below are evaluated. Keep it first.
import "./radarConfigDir";
import express, { type Express } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import { clerkMiddleware, getAuth } from "@clerk/express";
import { publishableKeyFromHost } from "@clerk/shared/keys";
import router from "./routes";
import { logger } from "./lib/logger";
import {
  CLERK_PROXY_PATH,
  clerkProxyMiddleware,
  getClerkProxyHost,
} from "./middlewares/clerkProxyMiddleware";
// The imported application is the audited, dependency-free JavaScript core
// supplied with the original Hookpoint Opportunity Radar.
// @ts-expect-error The uploaded JavaScript core intentionally has no TS declarations.
import { createApp as createRadarApp } from "../radar-core/src/app.js";
// @ts-expect-error The uploaded JavaScript core intentionally has no TS declarations.
import { getDb as getRadarDb } from "../radar-core/src/db/index.js";
// @ts-expect-error The uploaded JavaScript core intentionally has no TS declarations.
import { setTrustedPrincipal } from "../radar-core/src/http/security.js";

const app: Express = express();
const radarHandler = createRadarApp(getRadarDb(), { serveStaticAssets: false });

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);

app.use(CLERK_PROXY_PATH, clerkProxyMiddleware());

const allowedOrigins = (process.env.ALLOWED_ORIGINS ?? "")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);
app.use(
  cors({
    credentials: true,
    origin: allowedOrigins.length > 0 ? allowedOrigins : false,
  }),
);

app.use(
  clerkMiddleware((req) => ({
    publishableKey: publishableKeyFromHost(
      getClerkProxyHost(req) ?? "",
      process.env.CLERK_PUBLISHABLE_KEY,
    ),
  })),
);

app.use((req, res, next) => {
  const isRadarRoute =
    req.path.startsWith("/api/v1") ||
    req.path === "/api/health" ||
    req.path === "/api/ready";
  if (!isRadarRoute) {
    next();
    return;
  }

  if (req.path.startsWith("/api/v1")) {
    // Direct API clients are authenticated by the radar core. Never attach a
    // browser principal when an API key is present, even if a Clerk cookie is
    // also sent.
    if (req.headers["x-api-key"] !== undefined) {
      void radarHandler(req, res).catch(next);
      return;
    }

    const auth = getAuth(req);
    const userId = auth?.sessionClaims?.userId || auth?.userId;
    if (!userId) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    setTrustedPrincipal(req, { userId });
  }

  void radarHandler(req, res).catch(next);
});

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use("/api", router);

export default app;
