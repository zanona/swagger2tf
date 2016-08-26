#!/usr/bin/env node
var run = require('./'),
    input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('readable', () => {
  const chunk = process.stdin.read();
  if (chunk !== null) input += chunk;
});
process.stdin.on('end', () => {
  const parse = run(JSON.parse(input), {
    enableCORS: process.argv.indexOf('--no-cors') < 0
  });
  parse.then((output) => {
    console.log(JSON.stringify(output, null, 2));
  });
});
