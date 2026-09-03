import express, { type Express } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import router from "./routes";
import { logger } from "./lib/logger";
// The imported application is the audited, dependency-free JavaScript core
// supplied with the original Hookpoint Opportunity Radar.
// @ts-expect-error The uploaded JavaScript core intentionally has no TS declarations.
import { createApp as createRadarApp } from "../radar-core/src/app.js";
// @ts-expect-error The uploaded JavaScript core intentionally has no TS declarations.
import { getDb as getRadarDb } from "../radar-core/src/db/index.js";

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
app.use(cors());

app.use((req, res, next) => {
  if (!req.path.startsWith("/api/v1")) {
    next();
    return;
  }

  void radarHandler(req, res).catch(next);
});

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use("/api", router);

export default app;
