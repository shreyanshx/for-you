#!/usr/bin/env node
"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { createServer } = require("../server");

async function main() {
  const temporaryDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "for-you-check-"));
  const responseFile = path.join(temporaryDirectory, "nested", "responses.jsonl");
  const username = "dashboard-admin";
  const password = "integration-only-secret";
  const server = createServer({ adminUser: username, adminPassword: password, responseFile });

  try {
    await new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolve);
    });
    const { port } = server.address();
    const base = `http://127.0.0.1:${port}`;
    const requestId = crypto.randomUUID();
    const name = "<b>Rose & Co</b>";
    const submit = () => fetch(`${base}/api/responses`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: base },
      body: JSON.stringify({ name, requestId })
    });

    const created = await submit();
    assert.equal(created.status, 201);
    assert.deepEqual(await created.json(), { accepted: true, duplicate: false });

    const duplicate = await submit();
    assert.equal(duplicate.status, 200);
    assert.deepEqual(await duplicate.json(), { accepted: true, duplicate: true });

    const persistedLines = (await fs.readFile(responseFile, "utf8")).trim().split("\n");
    assert.equal(persistedLines.length, 1);
    const persisted = JSON.parse(persistedLines[0]);
    assert.deepEqual(Object.keys(persisted).sort(), ["accepted", "name", "requestId", "timestamp"]);
    assert.equal(persisted.accepted, true);
    assert.equal(persisted.name, name);

    const unauthorized = await fetch(`${base}/response`);
    assert.equal(unauthorized.status, 401);
    assert.match(unauthorized.headers.get("www-authenticate"), /^Basic /);

    const authorization = `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}`;
    const dashboard = await fetch(`${base}/response/`, { headers: { Authorization: authorization } });
    assert.equal(dashboard.status, 200);
    assert.equal(dashboard.headers.get("cache-control"), "no-store");
    assert.equal(dashboard.headers.get("x-robots-tag"), "noindex, nofollow");
    const dashboardHtml = await dashboard.text();
    assert.match(dashboardHtml, /&lt;b&gt;Rose &amp; Co&lt;\/b&gt;/);
    assert.doesNotMatch(dashboardHtml, /<b>Rose & Co<\/b>/);

    for (const privatePath of ["/server.js", "/README.md", "/data/responses.jsonl", "/views/response.html", "/%2e%2e/server.js"]) {
      const response = await fetch(`${base}${privatePath}`);
      assert.equal(response.status, 404, `${privatePath} must not be served`);
    }

    const health = await fetch(`${base}/health`);
    assert.equal(health.status, 200);
    assert.deepEqual(await health.json(), { status: "ok" });
    console.log("Integration check passed: persistence, idempotency, auth, escaping, private-file isolation, traversal handling, and health.");
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await fs.rm(temporaryDirectory, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
