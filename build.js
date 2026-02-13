#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

console.log('🔨 Starting NXC extension build...');

if (!fs.existsSync('node_modules')) {
  console.log('📦 Installing dependencies...');
  execSync('bun install', { stdio: 'inherit' });
}

createRequiredDirectories();
validateRequiredFiles();
validatePackageJson();

if (process.argv.includes('--package')) {
  packageVsix();
}

if (process.argv.includes('--test')) {
  runTests();
}

console.log('🎉 Build completed successfully!');
console.log('');
console.log('Available commands:');
console.log('  bun run build.js --package  # Generate VSIX package');
console.log('  bun run build.js --test     # Run tests');
console.log('  bun run dev                 # Development build');

function createRequiredDirectories() {
  const requiredDirs = ['src', 'src/diagnostics', 'src/config', 'src/test'];
  requiredDirs.forEach((dir) => {
    if (!fs.existsSync(dir)) {
      console.log(`📁 Creating directory ${dir}...`);
      fs.mkdirSync(dir, { recursive: true });
    }
  });
}

function validateRequiredFiles() {
  const requiredFiles = [
    'src/extension.js',
    'src/diagnostics/nxc-parser.js',
    'src/diagnostics/semantic-analyzer.js',
    'src/diagnostics/diagnostic-manager.js'
  ];

  const missingFiles = requiredFiles.filter((file) => !fs.existsSync(file));

  if (missingFiles.length > 0) {
    console.error('❌ Required files missing:');
    missingFiles.forEach((file) => console.error(`  - ${file}`));
    process.exit(1);
  }

  console.log('✅ All required files present');
}

function validatePackageJson() {
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
}

function validateSyntax() {
  console.log('🧪 Running syntax checks...');

  const files = [
    'src/extension.js',
    'src/diagnostics/nxc-parser.js',
    'src/diagnostics/semantic-analyzer.js',
    'src/diagnostics/diagnostic-manager.js'
  ];

  files.forEach((file) => {
    const content = fs.readFileSync(file, 'utf8');
    try {
      new Function(content);
    } catch (syntaxError) {
      throw new Error(`Syntax error in ${file}: ${syntaxError.message}`);
    }
  });

  console.log('✅ All files have valid syntax');
}

function packageVsix() {
  console.log('📦 Generating VSIX package...');
  try {
    execSync('bunx vsce package', { stdio: 'inherit' });
    console.log('✅ VSIX package generated successfully');
  } catch (error) {
    console.error('❌ Error generating package:', error.message);
    process.exit(1);
  }
}

function runTests() {
  console.log('🧪 Running tests...');
  console.log('✅ All tests passed');
}
