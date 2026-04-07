const crypto = require("node:crypto");
const { XMLParser } = require("fast-xml-parser");

class R2Error extends Error {}

function validateR2Credentials(profile, timeout = 15000) {
  return signedR2Request(profile, {
    method: "GET",
    path: `/${encodeBucket(profile.bucket)}`,
    query: { "list-type": "2", "max-keys": "1" },
    timeout,
  }).then((response) => ({
    status: String(response.status),
    request_url: response.url,
    bucket: profile.bucket,
  }));
}

function putR2Object(profile, key, payload, timeout = 30000) {
  return signedR2Request(profile, {
    method: "PUT",
    path: objectPath(profile.bucket, key),
    payload,
    timeout,
  });
}

async function getR2Object(profile, key, timeout = 30000) {
  const response = await signedR2Request(profile, {
    method: "GET",
    path: objectPath(profile.bucket, key),
    timeout,
  });
  return response.bodyBytes;
}

function deleteR2Object(profile, key, timeout = 30000) {
  return signedR2Request(profile, {
    method: "DELETE",
    path: objectPath(profile.bucket, key),
    timeout,
  });
}

async function listR2Objects(profile, prefix = "", timeout = 30000) {
  let continuationToken = null;
  const results = [];
  while (true) {
    const query = { "list-type": "2", prefix };
    if (continuationToken) query["continuation-token"] = continuationToken;
    const response = await signedR2Request(profile, {
      method: "GET",
      path: `/${encodeBucket(profile.bucket)}`,
      query,
      timeout,
    });
    const parsed = parseListObjects(response.body);
    results.push(...parsed.objects);
    continuationToken = parsed.nextToken;
    if (!continuationToken) return results;
  }
}

async function signedR2Request(profile, { method, path, query = {}, payload = Buffer.alloc(0), timeout = 15000, extraHeaders = {} }) {
  const endpoint = new URL(profile.endpoint);
  const canonicalPath = canonicalUri(path);
  const canonicalQuery = canonicalQueryString(query);
  const payloadHash = sha256Hex(payload);
  const now = new Date();
  const amzDate = isoAmzDate(now);
  const datestamp = amzDate.slice(0, 8);

  const headers = {
    host: endpoint.host,
    "x-amz-content-sha256": payloadHash,
    "x-amz-date": amzDate,
    ...lowercaseHeaders(extraHeaders),
  };

  const canonicalHeaders = Object.keys(headers)
    .sort()
    .map((key) => `${key}:${headers[key]}\n`)
    .join("");
  const signedHeaders = Object.keys(headers).sort().join(";");
  const canonicalRequest = [
    method.toUpperCase(),
    canonicalPath,
    canonicalQuery,
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join("\n");

  const credentialScope = `${datestamp}/${profile.region || "auto"}/s3/aws4_request`;
  const stringToSign = [
    "AWS4-HMAC-SHA256",
    amzDate,
    credentialScope,
    sha256Hex(Buffer.from(canonicalRequest, "utf8")),
  ].join("\n");
  const signature = crypto
    .createHmac("sha256", signingKey(profile.secret_access_key, datestamp, profile.region || "auto", "s3"))
    .update(stringToSign, "utf8")
    .digest("hex");
  const authorization = `AWS4-HMAC-SHA256 Credential=${profile.access_key_id}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

  const url = new URL(endpoint.toString());
  url.pathname = canonicalPath;
  url.search = canonicalQuery;
  const response = await fetch(url, {
    method,
    headers: {
      "x-amz-content-sha256": payloadHash,
      "x-amz-date": amzDate,
      Authorization: authorization,
    },
    body: payload.length ? payload : undefined,
    signal: AbortSignal.timeout(timeout),
  });
  const bodyBytes = Buffer.from(await response.arrayBuffer());
  const body = bodyBytes.toString("utf8");
  if (!response.ok) {
    throw new R2Error(formatR2Error(response.status, body));
  }
  return {
    status: String(response.status),
    url: url.toString(),
    body,
    bodyBytes,
  };
}

function objectPath(bucket, key) {
  return `/${encodeBucket(bucket)}/${encodeKey(key)}`;
}

function encodeBucket(bucket) {
  return encodeURIComponent(bucket).replace(/%2F/g, "/");
}

function encodeKey(key) {
  return encodeURIComponent(String(key).replace(/^\/+/, "")).replace(/%2F/g, "/");
}

function canonicalUri(value) {
  return value.startsWith("/") ? encodeURI(value) : `/${encodeURI(value)}`;
}

function canonicalQueryString(query) {
  return Object.keys(query)
    .sort()
    .map((key) => `${encodeURIComponent(key)}=${encodeURIComponent(String(query[key]))}`)
    .join("&");
}

function signingKey(secret, datestamp, region, service) {
  const kDate = hmac(Buffer.from(`AWS4${secret}`, "utf8"), datestamp);
  const kRegion = hmac(kDate, region);
  const kService = hmac(kRegion, service);
  return hmac(kService, "aws4_request");
}

function hmac(key, message) {
  return crypto.createHmac("sha256", key).update(message, "utf8").digest();
}

function sha256Hex(payload) {
  return crypto.createHash("sha256").update(payload).digest("hex");
}

function isoAmzDate(date) {
  return date.toISOString().replace(/[:-]|\.\d{3}/g, "");
}

function lowercaseHeaders(headers) {
  const out = {};
  for (const [key, value] of Object.entries(headers)) out[key.toLowerCase()] = value;
  return out;
}

function formatR2Error(status, body) {
  const { code, message } = extractXmlError(body);
  if (code || message) {
    return `R2 request failed with HTTP ${status}: ${[code, message].filter(Boolean).join(" / ")}`;
  }
  return `R2 request failed with HTTP ${status}`;
}

function extractXmlError(body) {
  try {
    const parser = new XMLParser();
    const parsed = parser.parse(body);
    const root = parsed.Error || parsed;
    return { code: root.Code || null, message: root.Message || null };
  } catch {
    return { code: null, message: null };
  }
}

function parseListObjects(body) {
  try {
    const parser = new XMLParser({ ignoreAttributes: false });
    const parsed = parser.parse(body);
    const root = parsed.ListBucketResult || {};
    const contents = Array.isArray(root.Contents) ? root.Contents : root.Contents ? [root.Contents] : [];
    return {
      objects: contents.map((item) => ({
        key: item.Key || "",
        etag: item.ETag || "",
        last_modified: item.LastModified || "",
        size: item.Size || "0",
      })),
      nextToken: root.NextContinuationToken || null,
    };
  } catch {
    return { objects: [], nextToken: null };
  }
}

module.exports = {
  R2Error,
  deleteR2Object,
  getR2Object,
  listR2Objects,
  putR2Object,
  validateR2Credentials,
};
