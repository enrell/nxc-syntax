// Manual NXC parser test
const { SimpleNXCParser } = require('./src/diagnostics/simple-parser');
const fs = require('fs');

console.log('Testing NXC parser...');

const parser = new SimpleNXCParser();

// Test 1: Valid code
console.log('\n=== Test 1: Valid code ===');
const validCode = `
task main() {
  int x = 10;
  OnFwd(OUT_A, 75);
}
`;

const result1 = parser.validateSyntax(validCode);
console.log('Result:', result1);

// Test 2: Code with syntax error
console.log('\n=== Test 2: Code with error ===');
const invalidCode = `
task main() {
  int x = 10;
  OnFwd(OUT_A, 75);
  // missing closing brace
`;

const result2 = parser.validateSyntax(invalidCode);
console.log('Result:', result2);

// Test 3: Test file
console.log('\n=== Test 3: Test file ===');
if (fs.existsSync('test-simple.nxc')) {
  const testCode = fs.readFileSync('test-simple.nxc', 'utf8');
  console.log('Test code:');
  console.log(testCode);
  console.log('\nAnalysis result:');
  const result3 = parser.validateSyntax(testCode);
  console.log('Valid:', result3.isValid);
  console.log('Errors:', result3.errors);
  console.log('Warnings:', result3.warnings);
}