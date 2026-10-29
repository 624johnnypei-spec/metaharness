// query-string 7 expects a CommonJS callable; the patched decoder is ESM.
// Metro and Node 22.13+ expose its default export through this small adapter.
module.exports = require('patched-decoder').default;
