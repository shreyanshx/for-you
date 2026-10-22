#!/usr/bin/env node
"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { createServer } = require("../server");

async function listen(server) {
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  return `http://127.0.0.1:${server.address().port}`;
}

async function close(server) {
  if (!server.listening) return;
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  await server.drain();
}

async function main() {
  const temporaryDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "for-you-check-"));
  const responseFile = path.join(temporaryDirectory, "nested", "responses.jsonl");
  const audioFile = path.join(temporaryDirectory, "licensed-test-audio.mp3");
  const audioBytes = Buffer.from([0x49, 0x44, 0x33, 0x04, 0x00, 0x00, 0x7f, 0x80, 0xfe, 0xff]);
  await fs.writeFile(audioFile, audioBytes);

  const username = "dashboard-admin";
  const password = "integration-only-secret";
  const server = createServer({ adminUser: username, adminPassword: password, responseFile, backgroundAudioFile: audioFile });
  const savedAdminEnvironment = {
    user: process.env.ADMIN_USER,
    password: process.env.ADMIN_PASSWORD,
    passwordBase64: process.env.ADMIN_PASSWORD_BASE64
  };
  let base64Server;

  try {
    const base = await listen(server);
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

    const audio = await fetch(`${base}/assets/background-music.mp3`);
    assert.equal(audio.status, 200);
    assert.equal(audio.headers.get("content-type"), "audio/mpeg");
    assert.equal(audio.headers.get("accept-ranges"), "bytes");
    assert.equal(audio.headers.get("cache-control"), "private, no-cache");
    assert.equal(Number(audio.headers.get("content-length")), audioBytes.length);
    assert.deepEqual(Buffer.from(await audio.arrayBuffer()), audioBytes);

    const audioHead = await fetch(`${base}/assets/background-music.mp3`, { method: "HEAD" });
    assert.equal(audioHead.status, 200);
    assert.equal(Number(audioHead.headers.get("content-length")), audioBytes.length);
    assert.equal((await audioHead.arrayBuffer()).byteLength, 0);

    const oneByte = await fetch(`${base}/assets/background-music.mp3`, { headers: { Range: "bytes=2-2" } });
    assert.equal(oneByte.status, 206);
    assert.equal(oneByte.headers.get("content-range"), `bytes 2-2/${audioBytes.length}`);
    assert.equal(oneByte.headers.get("content-length"), "1");
    assert.deepEqual(Buffer.from(await oneByte.arrayBuffer()), audioBytes.subarray(2, 3));

    const suffix = await fetch(`${base}/assets/background-music.mp3`, { headers: { Range: "bytes=-2" } });
    assert.equal(suffix.status, 206);
    assert.equal(suffix.headers.get("content-range"), `bytes ${audioBytes.length - 2}-${audioBytes.length - 1}/${audioBytes.length}`);
    assert.deepEqual(Buffer.from(await suffix.arrayBuffer()), audioBytes.subarray(-2));

    const rangeHead = await fetch(`${base}/assets/background-music.mp3`, { method: "HEAD", headers: { Range: "bytes=1-3" } });
    assert.equal(rangeHead.status, 206);
    assert.equal(rangeHead.headers.get("content-range"), `bytes 1-3/${audioBytes.length}`);
    assert.equal(rangeHead.headers.get("content-length"), "3");

    for (const range of [`bytes=${audioBytes.length}-`, "bytes=0-1,4-5", "items=0-1", "bytes=-0"]) {
      const invalidRange = await fetch(`${base}/assets/background-music.mp3`, { headers: { Range: range } });
      assert.equal(invalidRange.status, 416, `${range} must be rejected`);
      assert.equal(invalidRange.headers.get("content-range"), `bytes */${audioBytes.length}`);
    }

    const attendeeIndex = await fetch(`${base}/`);
    assert.equal(attendeeIndex.status, 200);
    assert.match(attendeeIndex.headers.get("content-security-policy"), /media-src 'self'/);
    const attendeeHtml = await attendeeIndex.text();
    const attendeeScript = await fs.readFile(path.join(__dirname, "..", "public", "script.js"), "utf8");
    assert.doesNotMatch(attendeeHtml, /\/response|admin(?:istrator)?\s+(?:url|link)/i);
    assert.doesNotMatch(attendeeScript, /\/response|admin(?:istrator)?\s+(?:url|link)/i);

    for (const privatePath of ["/server.js", "/README.md", "/data/responses.jsonl", "/views/response.html", "/%2e%2e/server.js", "/assets/other.mp3"]) {
      const response = await fetch(`${base}${privatePath}`);
      assert.equal(response.status, 404, `${privatePath} must not be served`);
    }

    await fs.unlink(audioFile);
    const missingAudio = await fetch(`${base}/assets/background-music.mp3`);
    assert.equal(missingAudio.status, 404);

    const health = await fetch(`${base}/health`);
    assert.equal(health.status, 200);
    assert.deepEqual(await health.json(), { status: "ok" });

    const encodedPassword = Buffer.from("base64-only-secret", "utf8").toString("base64");
    process.env.ADMIN_USER = "encoded-admin";
    delete process.env.ADMIN_PASSWORD;
    process.env.ADMIN_PASSWORD_BASE64 = encodedPassword;
    base64Server = createServer({ responseFile: path.join(temporaryDirectory, "base64", "responses.jsonl") });
    const base64Base = await listen(base64Server);
    const encodedAuthorization = `Basic ${Buffer.from("encoded-admin:base64-only-secret").toString("base64")}`;
    const encodedDashboard = await fetch(`${base64Base}/response`, { headers: { Authorization: encodedAuthorization } });
    assert.equal(encodedDashboard.status, 200);

    process.env.ADMIN_PASSWORD = "conflicting-direct-secret";
    assert.throws(() => createServer({
      responseFile: path.join(temporaryDirectory, "conflicting", "responses.jsonl")
    }), /only one of ADMIN_PASSWORD/);
    delete process.env.ADMIN_PASSWORD;

    for (const malformed of ["", "%%%not-base64%%%", "c2VjcmU", "====", "wA=="]) {
      assert.throws(() => createServer({
        adminUser: "encoded-admin",
        adminPasswordBase64: malformed,
        responseFile: path.join(temporaryDirectory, "invalid", "responses.jsonl")
      }), /ADMIN_PASSWORD_BASE64/);
    }

    console.log("Integration check passed: persistence, direct and Base64 auth, audio GET/HEAD/ranges/missing behavior, CSP, attendee isolation, escaping, and health.");
  } finally {
    for (const [name, value] of [
      ["ADMIN_USER", savedAdminEnvironment.user],
      ["ADMIN_PASSWORD", savedAdminEnvironment.password],
      ["ADMIN_PASSWORD_BASE64", savedAdminEnvironment.passwordBase64]
    ]) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
    await close(base64Server).catch(() => {});
    await close(server).catch(() => {});
    await fs.rm(temporaryDirectory, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
