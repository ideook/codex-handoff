const fs = require("node:fs");

async function readIncrementalJsonl(filePath, previousState) {
  const stat = fs.statSync(filePath);
  const currentState = {
    size: stat.size,
    mtimeMs: stat.mtimeMs,
  };

  if (!previousState) {
    return {
      mode: "bootstrap",
      newLines: [],
      nextState: currentState,
    };
  }

  if (stat.size < previousState.size) {
    const fullText = fs.readFileSync(filePath, "utf8");
    return {
      mode: "rewind",
      newLines: splitNonEmptyLines(fullText),
      nextState: currentState,
    };
  }

  if (stat.size === previousState.size) {
    return {
      mode: "unchanged",
      newLines: [],
      nextState: currentState,
    };
  }

  const stream = fs.createReadStream(filePath, {
    encoding: "utf8",
    start: previousState.size,
    end: stat.size - 1,
  });
  const chunks = [];
  for await (const chunk of stream) {
    chunks.push(chunk);
  }
  return {
    mode: "append",
    newLines: splitNonEmptyLines(chunks.join("")),
    nextState: currentState,
  };
}

function splitNonEmptyLines(text) {
  return text
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter((line) => line.trim().length > 0);
}

module.exports = {
  readIncrementalJsonl,
};
