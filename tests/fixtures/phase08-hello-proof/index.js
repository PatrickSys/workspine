const args = process.argv.slice(2);
const nameIndex = args.indexOf('--name');
const name = nameIndex >= 0 && args[nameIndex + 1] ? args[nameIndex + 1] : 'world';

process.stdout.write(`Hello, ${name}!\n`);
