import { createApp, createContext, VERSION } from "./app";
import { refreshTrustedHosts } from "./auth-limit";
import { loadConfig } from "./config";

export { createApp, createContext } from "./app";

if (import.meta.main) {
  const config = loadConfig();
  // Fail closed like writes do: an open library behind a tunnel is readable by anyone who finds the URL.
  if (!config.listenToken && !config.allowOpenReads) {
    console.error("LISTEN_TOKEN is not set: refusing to serve the library to anyone. Set LISTEN_TOKEN, or ALLOW_OPEN_READS=1 on a trusted LAN.");
    process.exit(1);
  }
  // Tokens are the only thing between the internet and the library; guessing is slowed (auth-limit.ts), not stopped.
  for (const [name, token] of [["LISTEN_TOKEN", config.listenToken], ["ADMIN_TOKEN", config.adminToken]] as const)
    if (token && token.length < 16)
      console.warn(`${name} is only ${token.length} characters; use 16+ random characters (e.g. openssl rand -hex 16).`);
  // TRUSTED_PROXIES "dns:" names (the compose tunnel): resolved before the first request, then kept fresh per request.
  const trusted = config.trustedProxies;
  if (trusted.hosts.length) {
    await refreshTrustedHosts(trusted);
    const n = trusted.resolved.v4.size + trusted.resolved.v6.size;
    console.log(
      n
        ? `TRUSTED_PROXIES: ${trusted.hosts.join(", ")} → ${n} address${n === 1 ? "" : "es"}`
        : `TRUSTED_PROXIES: ${trusted.hosts.join(", ")} not resolvable (yet); forwarded addresses are ignored until it is`,
    );
  }
  const ctx = createContext(config);
  const app = createApp(ctx);

  const server = Bun.serve({
    port: config.port,
    fetch: app.fetch,
    // Hard backstop only: the upload route's bodyLimit enforces MAX_UPLOAD_MB with a JSON 413.
    maxRequestBodySize: config.maxUploadBytes * 4,
    idleTimeout: 60,
  });

  console.log(
    `blednify-server ${VERSION} on http://${server.hostname}:${server.port}` +
      ` · music ${config.musicDir} · data ${config.dataDir}` +
      ` · reads ${config.listenToken ? "require LISTEN_TOKEN" : "OPEN (ALLOW_OPEN_READS)"}` +
      ` · writes ${config.adminToken ? "require ADMIN_TOKEN" : config.allowOpenWrites ? "OPEN (ALLOW_OPEN_WRITES)" : "disabled (no ADMIN_TOKEN)"}` +
      ` · search ${ctx.db.fts ? "fts5" : "like"}`,
  );

  ctx.importer.boot();

  // Answer requests immediately; index in the background.
  setTimeout(() => ctx.scanner.scan().catch((err) => console.error("[scan] failed:", err)), 0);

  const shutdown = (signal: string) => {
    console.log(`${signal}: shutting down`);
    // Let in-flight requests finish, but don't let a long-lived audio stream hold shutdown hostage.
    setTimeout(() => process.exit(0), 5000).unref();
    void server.stop().finally(() => {
      ctx.importer.flush();
      ctx.lib.flushAggregates();
      ctx.db.sql.close();
      process.exit(0);
    });
  };
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}
