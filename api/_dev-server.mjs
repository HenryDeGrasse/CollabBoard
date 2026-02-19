/**
 * Local development server for testing API routes.
 * Mimics Vercel's serverless function invocation.
 * Usage: node api/_dev-server.mjs
 */
import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { register } from "node:module";

const __dirname = dirname(fileURLToPath(import.meta.url));

// Load env files — .env.local overrides .env (matches Vite's behavior)
for (const envFile of [".env.local", ".env"]) {
  const envPath = resolve(__dirname, "..", envFile);
  try {
    const envContent = readFileSync(envPath, "utf-8");
    for (const line of envContent.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eqIdx = trimmed.indexOf("=");
      if (eqIdx === -1) continue;
      const key = trimmed.slice(0, eqIdx);
      const val = trimmed.slice(eqIdx + 1);
      if (!process.env[key]) {
        process.env[key] = val;
      }
    }
  } catch { /* file doesn't exist — skip */ }
}

// Dynamic import of the handler (tsx not needed — we'll use a build step)
// For local dev, use tsx to run this file: npx tsx api/_dev-server.mjs
const PORT = parseInt(process.env.API_PORT || "3000", 10);

async function loadModule(route) {
  try {
    return await import(`./${route}.ts`);
  } catch {
    return null;
  }
}

const server = createServer(async (req, res) => {
  // CORS preflight
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, PATCH, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

  if (req.method === "OPTIONS") {
    res.writeHead(200);
    res.end();
    return;
  }

  const url = new URL(req.url, `http://localhost:${PORT}`);
  const route = url.pathname.replace(/^\/api\//, "").replace(/\/$/, "");

  const mod = await loadModule(route);
  if (!mod?.default) {
    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: `Route not found: ${url.pathname}` }));
    return;
  }

  const handler = mod.default;
  const isEdge = mod.config?.runtime === "edge";

  // Collect body
  let body = "";
  for await (const chunk of req) body += chunk;

  if (isEdge) {
    // ── Edge-style handler ─────────────────────────────────────────────
    // Expects a Web API Request, returns a Web API Response.
    // We build a real Request so req.headers.get() / req.json() work.
    const webReq = new Request(
      `http://localhost:${PORT}${req.url}`,
      {
        method: req.method,
        headers: new Headers(req.headers),
        // GET/HEAD cannot have a body per the Fetch spec
        body: ["GET", "HEAD"].includes(req.method) ? undefined : (body || undefined),
      }
    );

    try {
      const response = await handler(webReq);

      // Copy status + headers then stream the body
      const nodeHeaders = {};
      response.headers.forEach((v, k) => { nodeHeaders[k] = v; });
      res.writeHead(response.status, nodeHeaders);

      if (response.body) {
        const reader = response.body.getReader();
        const pump = async () => {
          const { done, value } = await reader.read();
          if (done) { res.end(); return; }
          res.write(value);
          await pump();
        };
        await pump();
      } else {
        res.end();
      }
    } catch (err) {
      console.error("Edge handler error:", err);
      if (!res.headersSent) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: err.message }));
      }
    }
  } else {
    // ── Vercel-style handler ───────────────────────────────────────────
    // Called as handler(req, res); mutates the response object directly.
    const vercelReq = {
      method: req.method,
      url: req.url,
      headers: req.headers,
      body: body ? JSON.parse(body) : undefined,
      query: Object.fromEntries(url.searchParams),
    };

    const vercelRes = {
      _statusCode: 200,
      _headers: {},
      _headersSent: false,
      setHeader(k, v) { this._headers[k] = v; res.setHeader(k, v); return this; },
      status(code) { this._statusCode = code; return this; },
      json(data) {
        res.writeHead(this._statusCode, { "Content-Type": "application/json", ...this._headers });
        this._headersSent = true;
        res.end(JSON.stringify(data));
        return this;
      },
      write(data) {
        if (!this._headersSent) {
          res.writeHead(this._statusCode, this._headers);
          this._headersSent = true;
        }
        res.write(data);
        return this;
      },
      end(data) {
        if (!this._headersSent) {
          res.writeHead(this._statusCode, this._headers);
          this._headersSent = true;
        }
        res.end(data);
        return this;
      },
    };

    try {
      await handler(vercelReq, vercelRes);
    } catch (err) {
      console.error("Handler error:", err);
      if (!res.headersSent) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: err.message }));
      }
    }
  }
});

server.listen(PORT, () => {
  const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "(not set)";
  const isLocal = supabaseUrl.includes("127.0.0.1") || supabaseUrl.includes("localhost");
  console.log(`API dev server running at http://localhost:${PORT}`);
  console.log(`   Supabase: ${supabaseUrl} ${isLocal ? "local" : "PRODUCTION"}`);
  if (!isLocal) {
    console.warn("   WARNING: API server is using PRODUCTION Supabase.");
    console.warn("            Local browser sessions (127.0.0.1) will get 401.");
    console.warn("            Add SUPABASE_URL=http://127.0.0.1:54321 to .env.local");
  }
});
