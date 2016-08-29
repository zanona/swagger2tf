#!/usr/bin/env node
var run = require('./'),
    input = '',
    opts = {};

process.argv.forEach((opt) => {
  if (!opt.match(/^-+/)) return;
  const kv = opt.split('='),
        k = kv[0].replace(/-+/, '').trim(),
        v = kv[1] ? kv[1].trim() : true;
  opts[k] = v;
});

process.stdin.setEncoding('utf8');
process.stdin.on('readable', () => {
  const chunk = process.stdin.read();
  if (chunk !== null) input += chunk;
});
process.stdin.on('end', () => {
  const parse = run(JSON.parse(input), {
    allowedOrigin: opts.origin,
    enableCORS: !opts['no-cors']
  });
  parse.then((output) => {
    console.log(JSON.stringify(output, null, 2));
  });
});
