#!/usr/bin/env node
import { mkdir, readdir, writeFile } from "node:fs/promises";
import path from "node:path";

const repoRoot = process.cwd();
const liveDir = path.join(repoRoot, "public", "collected", "live-gpt-image-2");

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function safeJsonParse(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function formatCompactUtc(isoString) {
  const date = new Date(isoString);
  if (Number.isNaN(date.getTime())) return "unknown";
  const pad = (n) => String(n).padStart(2, "0");
  return `${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}T${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())}Z`;
}

function extractPrompt(text) {
  const cleaned = String(text || "")
    .replace(/https?:\/\/\S+/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 2000);
  const promptMatch = /(?:prompt|提示词|提示詞|プロンプト)\s*[:：]\s*([\s\S]+)/i.exec(cleaned);
  return (promptMatch?.[1] || cleaned).trim().slice(0, 520);
}

function buildDirectOrigUrl(url) {
  if (!isNonEmptyString(url)) return null;
  try {
    const parsed = new URL(url);
    if (!/pbs\.twimg\.com$/i.test(parsed.hostname)) return url;
    parsed.searchParams.set("name", "orig");
    return parsed.toString();
  } catch {
    return url;
  }
}

function guessExtFromUrl(url) {
  try {
    const { pathname, searchParams } = new URL(url);
    const format = searchParams.get("format");
    if (format) return `.${format.replace(/[^a-z0-9]/gi, "").toLowerCase()}`;
    const ext = path.extname(pathname);
    return ext || ".jpg";
  } catch {
    return ".jpg";
  }
}

async function downloadToFile(url, filePath) {
  const response = await fetch(url, {
    method: "GET",
    headers: {
      "User-Agent": "GPTImage2Gallery/1.0"
    }
  });
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`Download failed ${response.status}: ${text.slice(0, 120)}`);
  }
  const buffer = Buffer.from(await response.arrayBuffer());
  await writeFile(filePath, buffer);
}

async function ensureDir(dirPath) {
  await mkdir(dirPath, { recursive: true });
}

async function hasAnyDirEndingWithId(id) {
  const entries = await readdir(liveDir, { withFileTypes: true });
  return entries.some((entry) => entry.isDirectory() && entry.name.endsWith(`-${id}`));
}

function buildPromptMarkdown({ title, sourceUrl, author, handle, createdAt, directImageUrls, prompt }) {
  const lines = [];
  lines.push(`# ${title || "GPT Image 2 prompt"}`);
  lines.push("");
  if (isNonEmptyString(sourceUrl)) lines.push(`Source: ${sourceUrl}`);
  if (isNonEmptyString(author) || isNonEmptyString(handle)) lines.push(`Author: ${author || "X user"} ${handle || "@unknown"}`);
  if (isNonEmptyString(createdAt)) lines.push(`CreatedAt: ${createdAt}`);
  if (Array.isArray(directImageUrls) && directImageUrls.length) {
    lines.push("");
    lines.push("DirectImageUrls:");
    for (const url of directImageUrls) {
      if (isNonEmptyString(url)) lines.push(`- ${url.trim()}`);
    }
  }
  lines.push("");
  lines.push("## Prompt");
  lines.push("");
  lines.push(prompt || "");
  lines.push("");
  return lines.join("\n");
}

async function main() {
  const token = process.env.X_BEARER_TOKEN?.trim();
  if (!token) {
    throw new Error("Missing X_BEARER_TOKEN. Set it in GitHub Actions secrets.");
  }

  const query = process.env.DEFAULT_SEARCH_QUERY || "gpt-image2 OR gpt-image-2 OR \"gpt image 2\"";
  const now = Date.now();
  const startTime = new Date(now - 60 * 60 * 1000).toISOString();

  const endpoint = new URL("https://api.twitter.com/2/tweets/search/recent");
  endpoint.searchParams.set("query", `(${query}) (prompt OR prompts OR 提示词 OR 提示詞 OR プロンプト) has:images -is:retweet`);
  endpoint.searchParams.set("max_results", "30");
  endpoint.searchParams.set("start_time", startTime);
  endpoint.searchParams.set("expansions", "attachments.media_keys,author_id");
  endpoint.searchParams.set("media.fields", "url,preview_image_url,type");
  endpoint.searchParams.set("tweet.fields", "created_at");
  endpoint.searchParams.set("user.fields", "name,username");

  const response = await fetch(endpoint, {
    headers: { Authorization: `Bearer ${token}` }
  });
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`X API returned ${response.status}: ${body.slice(0, 220)}`);
  }

  const payload = safeJsonParse(await response.text());
  const media = new Map();
  for (const item of payload?.includes?.media || []) {
    media.set(item.media_key, item);
  }
  const users = new Map();
  for (const user of payload?.includes?.users || []) {
    users.set(user.id, user);
  }

  await ensureDir(liveDir);

  let savedPosts = 0;
  let savedImages = 0;

  for (const tweet of payload?.data || []) {
    const tweetId = String(tweet.id);
    const already = await hasAnyDirEndingWithId(tweetId);
    if (already) continue;

    const author = users.get(tweet.author_id) || {};
    const authorName = author.name || "X user";
    const authorHandle = author.username ? `@${author.username}` : "@unknown";
    const createdAtIso = tweet.created_at || new Date().toISOString();
    const createdAtLabel = createdAtIso;

    const mediaKeys = tweet.attachments?.media_keys || [];
    const photos = mediaKeys
      .map((key) => media.get(key))
      .filter((m) => m && m.type === "photo" && (m.url || m.preview_image_url))
      .map((m) => m.url || m.preview_image_url);

    if (!photos.length) continue;

    const directImageUrls = photos.map(buildDirectOrigUrl).filter(Boolean);

    const folderName = `${formatCompactUtc(createdAtIso)}-${tweetId}`;
    const postDir = path.join(liveDir, folderName);
    await ensureDir(postDir);

    for (let index = 0; index < directImageUrls.length; index += 1) {
      const url = directImageUrls[index];
      const ext = guessExtFromUrl(url);
      const filePath = path.join(postDir, `original-${index + 1}${ext}`);
      await downloadToFile(url, filePath);
      savedImages += 1;
    }

    const sourceUrl = author.username
      ? `https://x.com/${author.username}/status/${tweetId}`
      : `https://x.com/i/web/status/${tweetId}`;

    const prompt = extractPrompt(tweet.text || "");
    const title = (tweet.text || "").replace(/\s+/g, " ").trim().slice(0, 80) || `Tweet ${tweetId}`;

    const promptMd = buildPromptMarkdown({
      title,
      sourceUrl,
      author: authorName,
      handle: authorHandle,
      createdAt: createdAtLabel,
      directImageUrls,
      prompt
    });
    await writeFile(path.join(postDir, "prompt.md"), promptMd, "utf8");

    savedPosts += 1;
  }

  process.stdout.write(`Downloaded ${savedPosts} posts, ${savedImages} images.\n`);
}

await main();

