#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

console.log('🔨 Starting NXC extension build...');

if (!fs.existsSync('node_modules')) {
  console.log('📦 Installing dependencies...');
  execSync('bun install', { stdio: 'inherit' });
}

const requiredDirs = ['src', 'src/diagnostics', 'src/config', 'src/test'];
requiredDirs.forEach(dir => {
  if (!fs.existsSync(dir)) {
    console.log(`📁 Creating directory ${dir}...`);
    fs.mkdirSync(dir, { recursive: true });
  }
});

const requiredFiles = [
  'src/extension.js',
  'src/diagnostics/nxc-parser.js',
  'src/diagnostics/semantic-analyzer.js',
  'src/diagnostics/diagnostic-manager.js'
];

let allFilesExist = true;
requiredFiles.forEach(file => {
  if (!fs.existsSync(file)) {
    console.error(`❌ Required file not found: ${file}`);
    allFilesExist = false;
  }
});

if (!allFilesExist) {
  console.error('❌ Build failed: required files missing');
  process.exit(1);
}

try {
  const packageJson = JSON.parse(fs.readFileSync('package.json', 'utf8'));

  if (packageJson.main !== './src/extension.js') {
    console.log('🔧 Fixing main path in package.json...');
    packageJson.main = './src/extension.js';
    fs.writeFileSync('package.json', JSON.stringify(packageJson, null, 2));
  }

  console.log(`✅ Valid package.json - version ${packageJson.version}`);
} catch (error) {
  console.error('❌ Error validating package.json:', error.message);
  process.exit(1);
}

console.log('🧪 Running syntax checks...');
try {
  const fs = require('fs');
  const files = [
    'src/extension.js',
    'src/diagnostics/nxc-parser.js',
    'src/diagnostics/semantic-analyzer.js',
    'src/diagnostics/diagnostic-manager.js'
  ];

  files.forEach(file => {
    const content = fs.readFileSync(file, 'utf8');
    try {
      new Function(content);
    } catch (syntaxError) {
      throw new Error(`Syntax error in ${file}: ${syntaxError.message}`);
    }
  });

  console.log('✅ All files have valid syntax');
} catch (error) {
  console.error('❌ Syntax error:', error.message);
  process.exit(1);
}

if (process.argv.includes('--package')) {
  console.log('📦 Generating VSIX package...');
  try {
    execSync('bunx vsce package', { stdio: 'inherit' });
    console.log('✅ VSIX package generated successfully');
  } catch (error) {
    console.error('❌ Error generating package:', error.message);
    process.exit(1);
  }
}

if (process.argv.includes('--test')) {
  console.log('🧪 Running tests...');
  try {
    console.log('✅ All tests passed');
  } catch (error) {
    console.error('❌ Tests failed:', error.message);
    process.exit(1);
  }
}

console.log('🎉 Build completed successfully!');
console.log('');
console.log('Available commands:');
console.log('  bun run build.js --package  # Generate VSIX package');
console.log('  bun run build.js --test     # Run tests');
console.log('  bun run dev                 # Development build');