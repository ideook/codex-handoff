#!/usr/bin/env node

const { main } = require("../cli.js");

Promise.resolve(main()).then((code) => {
  process.exitCode = code;
}).catch((error) => {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
});
