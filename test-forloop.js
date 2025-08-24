const fs = require('fs');
const { SimpleNXCParser } = require('./src/diagnostics/simple-parser.js');

const testFile = 'src/test/12_fs_numbers.nxc';
const sourceCode = fs.readFileSync(testFile, 'utf8');

const parser = new SimpleNXCParser();
const result = parser.validateSyntax(sourceCode);

console.log('=== PARSER RESULTS ===');
console.log('Valid:', result.isValid);
console.log('Errors:', result.errors.length);
console.log('Warnings:', result.warnings.length);

if (result.errors.length > 0) {
  console.log('\n=== ERRORS ===');
  result.errors.forEach((error, i) => {
    console.log(`${i + 1}. Line ${error.line}: ${error.message}`);
  });
}