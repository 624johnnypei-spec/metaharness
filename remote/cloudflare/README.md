# Cloudflare hub

The Worker and D1 database run in your own Cloudflare account. Follow [the Cloudflare setup steps](../README.md#cloudflare-workers--d1): create D1, fill in `database_id` in `wrangler.toml`, apply `schema.sql`, and deploy the Worker. No runtime npm packages are required.

Use the resulting root Worker URL with:

```sh
./mh remote setup --backend cloudflare --url https://metaharness.YOUR_SUBDOMAIN.workers.dev
```

Apply the printed token-hash SQL to your D1 database, then run `./mh tick`. Backend, name, and URL are stored in `state/config.json`; the private raw client token is stored only in `state/remote.json`. The server's `mh_config` contains its SHA-256 hash.

For Claude or ChatGPT phone clients, the Worker URL must be publicly reachable over HTTPS. Configure `/mcp/<token>` as the Claude connector, or import `/openapi.json` as a GPT Action with Bearer authentication. See [client setup and the common protocol](../README.md#claude-web-and-phone).

For local development, `wrangler d1 execute metaharness --local --file schema.sql` initializes a local D1 database; `wrangler dev` runs the Worker locally. Provision a test token hash in that local database before calling private routes. Local development does not make a phone-accessible server.
