import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { register } from "node:module";
import test from "node:test";

const projectRoot = new URL("../", import.meta.url);
const publicUrl = new URL("public/", projectRoot);
const builtClientUrl = new URL("dist/client/", projectRoot);
const productionOrigin = "https://munjang-relay-studio.techkwon.chatgpt.site";

register(new URL("./cloudflare-loader.mjs", import.meta.url));

function projectFile(path) {
  return new URL(path, projectRoot);
}

async function readText(path) {
  return readFile(projectFile(path), "utf8");
}

async function readPublicBinary(path) {
  return readFile(new URL(path, publicUrl));
}

function contentTypeFor(pathname) {
  const extension = extname(pathname).toLowerCase();

  if (extension === ".ico") return "image/x-icon";
  if (extension === ".png") return "image/png";
  if (extension === ".svg") return "image/svg+xml";
  if (extension === ".webmanifest") return "application/manifest+json";
  if (extension === ".txt") return "text/plain; charset=utf-8";
  if (extension === ".xml") return "application/xml; charset=utf-8";
  return "application/octet-stream";
}

async function fetchBuiltAsset(request) {
  const url = new URL(request.url);
  const relativePath = normalize(decodeURIComponent(url.pathname).replace(/^\/+/, ""));

  if (relativePath.startsWith("..")) {
    return new Response("Not found", { status: 404 });
  }

  try {
    const body = await readFile(new URL(relativePath, builtClientUrl));
    return new Response(body, {
      headers: { "content-type": contentTypeFor(url.pathname) },
    });
  } catch {
    return new Response("Not found", { status: 404 });
  }
}

async function workerFetch(pathname, accept = "*/*") {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("seo-test", `${process.pid}-${Date.now()}-${Math.random()}`);
  const { default: worker } = await import(workerUrl.href);

  return worker.fetch(
    new Request(`${productionOrigin}${pathname}`, {
      headers: {
        accept,
        host: "munjang-relay-studio.techkwon.chatgpt.site",
        "x-forwarded-host": "munjang-relay-studio.techkwon.chatgpt.site",
        "x-forwarded-proto": "https",
      },
    }),
    {
      ASSETS: { fetch: fetchBuiltAsset },
    },
    {
      waitUntil() {},
      passThroughOnException() {},
    },
  );
}

function assertHtmlIncludes(html, pattern, message) {
  assert.match(html, pattern, message);
}

function parsePngSize(buffer) {
  assert.deepEqual([...buffer.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  return {
    width: buffer.readUInt32BE(16),
    height: buffer.readUInt32BE(20),
  };
}

function parseIcoSizes(buffer) {
  assert.equal(buffer.readUInt16LE(0), 0, "ICO reserved field must be 0");
  assert.equal(buffer.readUInt16LE(2), 1, "ICO image type must be icon");

  const imageCount = buffer.readUInt16LE(4);
  const sizes = [];

  for (let index = 0; index < imageCount; index += 1) {
    const offset = 6 + index * 16;
    sizes.push({
      width: buffer[offset] === 0 ? 256 : buffer[offset],
      height: buffer[offset + 1] === 0 ? 256 : buffer[offset + 1],
    });
  }

  return sizes;
}

test("renders homepage canonical and share metadata for the production URL", async () => {
  const response = await workerFetch("/", "text/html");
  const html = await response.text();

  assert.equal(response.status, 200);
  assertHtmlIncludes(
    html,
    /<link[^>]+rel="canonical"[^>]+href="https:\/\/munjang-relay-studio\.techkwon\.chatgpt\.site\/?"/i,
    "homepage must declare the production canonical URL",
  );
  assertHtmlIncludes(
    html,
    /<meta[^>]+property="og:url"[^>]+content="https:\/\/munjang-relay-studio\.techkwon\.chatgpt\.site\/?"/i,
    "Open Graph URL must be the production homepage",
  );
  assertHtmlIncludes(
    html,
    /<meta[^>]+property="og:image"[^>]+content="https:\/\/munjang-relay-studio\.techkwon\.chatgpt\.site\/og\.png"/i,
    "Open Graph image must be absolute and production-hosted",
  );
  assertHtmlIncludes(
    html,
    /<meta[^>]+name="twitter:image"[^>]+content="https:\/\/munjang-relay-studio\.techkwon\.chatgpt\.site\/og\.png"/i,
    "Twitter image must be absolute and production-hosted",
  );
  assertHtmlIncludes(
    html,
    /<link[^>]+rel="manifest"[^>]+href="(?:https:\/\/munjang-relay-studio\.techkwon\.chatgpt\.site)?\/manifest\.webmanifest"/i,
  );
  assertHtmlIncludes(
    html,
    /<link[^>]+rel="icon"[^>]+href="(?:https:\/\/munjang-relay-studio\.techkwon\.chatgpt\.site)?\/favicon\.ico"/i,
  );
  assertHtmlIncludes(
    html,
    /<link[^>]+rel="apple-touch-icon"[^>]+href="(?:https:\/\/munjang-relay-studio\.techkwon\.chatgpt\.site)?\/apple-touch-icon\.png"/i,
  );
  const jsonLdMatch = html.match(
    /<script[^>]+type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/i,
  );
  assert.ok(jsonLdMatch, "homepage must publish JSON-LD structured data");

  const jsonLd = JSON.parse(jsonLdMatch[1]);
  assert.equal(jsonLd["@context"], "https://schema.org");
  assert.equal(jsonLd["@type"], "WebApplication");
  assert.equal(jsonLd.name, "문장잇기");
  assert.equal(jsonLd.url, `${productionOrigin}/`);
  assert.equal(jsonLd.image, `${productionOrigin}/og.png`);
  assert.equal(jsonLd.inLanguage, "ko-KR");
});

test("marks the student join page as a noindex utility route", async () => {
  const response = await workerFetch("/join", "text/html");
  const html = await response.text();

  assert.equal(response.status, 200);
  assertHtmlIncludes(
    html,
    /<meta[^>]+name="robots"[^>]+content="noindex,\s*nofollow(?:,\s*nocache)?"/i,
  );
});

test("keeps authenticated teacher pages out of search indexes", async () => {
  const teacherPage = await readText("app/teacher/page.tsx");

  assert.match(teacherPage, /robots:\s*\{\s*index:\s*false,\s*follow:\s*false/s);
});

test("publishes robots.txt with the production sitemap", async () => {
  const response = await workerFetch("/robots.txt", "text/plain");
  const body = await response.text();

  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/plain\b/i);
  assert.match(body, /User-agent:\s*\*/i);
  assert.match(body, new RegExp(`Sitemap:\\s*${productionOrigin.replaceAll(".", "\\.")}/sitemap\\.xml`, "i"));
});

test("publishes a sitemap containing only the indexable homepage", async () => {
  const response = await workerFetch("/sitemap.xml", "application/xml");
  const body = await response.text();

  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /xml/i);
  assert.match(body, new RegExp(`<loc>${productionOrigin.replaceAll(".", "\\.")}/?</loc>`));
  assert.doesNotMatch(body, /\/join\/?<\/loc>/i);
  assert.doesNotMatch(body, /\/teacher\/?<\/loc>/i);
});

test("publishes a Korean classroom web app manifest", async () => {
  const response = await workerFetch("/manifest.webmanifest", "application/manifest+json");

  assert.equal(response.status, 200);
  const manifest = await response.json();
  assert.equal(manifest.lang, "ko-KR");
  assert.equal(manifest.start_url, "/");
  assert.equal(manifest.scope, "/");
  assert.equal(manifest.display, "standalone");
  assert.ok(manifest.name.includes("문장잇기"));
  assert.deepEqual(
    manifest.icons.map((icon) => [icon.src, icon.sizes, icon.type]),
    [
      ["/icon-192.png", "192x192", "image/png"],
      ["/icon-512.png", "512x512", "image/png"],
    ],
  );
});

test("stores favicon.ico as a real multi-size icon file", async () => {
  const favicon = await readPublicBinary("favicon.ico");
  const sizes = parseIcoSizes(favicon);

  assert.deepEqual(
    sizes.map((size) => `${size.width}x${size.height}`),
    ["16x16", "32x32", "48x48"],
  );
});

test("stores PNG icon assets at their declared dimensions", async () => {
  const expectedSizes = new Map([
    ["favicon-16x16.png", { width: 16, height: 16 }],
    ["favicon-32x32.png", { width: 32, height: 32 }],
    ["apple-touch-icon.png", { width: 180, height: 180 }],
    ["icon-192.png", { width: 192, height: 192 }],
    ["icon-512.png", { width: 512, height: 512 }],
  ]);

  for (const [filename, expected] of expectedSizes) {
    const image = await readPublicBinary(filename);
    assert.deepEqual(parsePngSize(image), expected, `${filename} must match its advertised size`);
  }
});

test("serves SEO image assets from the built worker", async () => {
  const expectedAssets = [
    ["/favicon.ico", /^image\/x-icon\b/i],
    ["/favicon.svg", /^image\/svg\+xml\b/i],
    ["/favicon-16x16.png", /^image\/png\b/i],
    ["/favicon-32x32.png", /^image\/png\b/i],
    ["/apple-touch-icon.png", /^image\/png\b/i],
    ["/icon-192.png", /^image\/png\b/i],
    ["/icon-512.png", /^image\/png\b/i],
    ["/og.png", /^image\/png\b/i],
  ];

  for (const [pathname, contentType] of expectedAssets) {
    const response = await workerFetch(pathname);
    const body = Buffer.from(await response.arrayBuffer());

    assert.equal(response.status, 200, `${pathname} must be served by the worker`);
    assert.match(response.headers.get("content-type") ?? "", contentType);
    assert.ok(body.length > 0, `${pathname} must not be empty`);
  }
});

test("keeps the Open Graph image at the social preview size", async () => {
  const ogImage = await readPublicBinary("og.png");

  assert.deepEqual(parsePngSize(ogImage), { width: 1200, height: 630 });
  await stat(join(new URL("og.png", publicUrl).pathname));
});
