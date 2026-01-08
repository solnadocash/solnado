/**
 * Apply patches to node_modules after install
 * This fixes known issues with dependencies
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.join(__dirname, '..');

const patches = [
  {
    name: 'PrivacyCash ALT Lookup Fix',
    source: path.join(rootDir, 'patches/fix-alt-lookup.js'),
    target: path.join(rootDir, 'node_modules/privacycash/dist/utils/address_lookup_table.js')
  }
];

console.log('Applying patches...');

for (const patch of patches) {
  try {
    if (fs.existsSync(patch.source) && fs.existsSync(path.dirname(patch.target))) {
      fs.copyFileSync(patch.source, patch.target);
      console.log(`✅ ${patch.name}`);
    } else {
      console.log(`⏭️ Skipped ${patch.name} (files not found)`);
    }
  } catch (e) {
    console.error(`❌ Failed to apply ${patch.name}: ${e.message}`);
  }
}

console.log('Patches complete!');

