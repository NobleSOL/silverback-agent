#!/usr/bin/env node
/**
 * Patch ajv package.json to add exports for ESM compatibility
 * This fixes the issue where @x402/extensions tries to import "ajv/dist/2020"
 * but ajv doesn't have proper exports defined for subpath imports
 */

const fs = require('fs');
const path = require('path');

const ajvPackagePath = path.join(__dirname, '..', 'node_modules', 'ajv', 'package.json');

try {
    if (!fs.existsSync(ajvPackagePath)) {
        console.log('ajv not installed yet, skipping patch');
        process.exit(0);
    }

    const packageJson = JSON.parse(fs.readFileSync(ajvPackagePath, 'utf8'));

    // Add exports if not present
    if (!packageJson.exports) {
        packageJson.exports = {
            ".": {
                "types": "./dist/ajv.d.ts",
                "require": "./dist/ajv.js",
                "import": "./dist/ajv.js"
            },
            "./dist/2020": {
                "types": "./dist/2020.d.ts",
                "require": "./dist/2020.js",
                "import": "./dist/2020.js"
            },
            "./dist/2019": {
                "types": "./dist/2019.d.ts",
                "require": "./dist/2019.js",
                "import": "./dist/2019.js"
            },
            "./dist/*": {
                "types": "./dist/*.d.ts",
                "require": "./dist/*.js",
                "import": "./dist/*.js"
            },
            "./*": "./*"
        };

        fs.writeFileSync(ajvPackagePath, JSON.stringify(packageJson, null, 2));
        console.log('✅ Patched ajv package.json with exports for ESM compatibility');
    } else {
        console.log('ajv already has exports defined, skipping patch');
    }
} catch (error) {
    console.error('Failed to patch ajv:', error.message);
    // Don't fail the build
    process.exit(0);
}
