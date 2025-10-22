const fs = require('fs-extra');
const path = require('path');
const glob = require('glob');

/**
 * Detect and fix merge conflicts in JSON files
 * Following Puppeteer patterns: async/await with proper cleanup
 */
async function fixMergeConflicts() {
  console.log('🔍 Checking for merge conflicts...');
  
  const dataDir = path.join(__dirname, '..', 'data');
  const jsonFiles = glob.sync('**/*.json', {
    cwd: dataDir,
    absolute: true
  });
  
  const conflictMarkers = ['<<<<<<< HEAD', '=======', '>>>>>>>'];
  let foundConflicts = 0;
  let fixedFiles = 0;
  
  for (const filePath of jsonFiles) {
    try {
      const content = await fs.readFile(filePath, 'utf8');
      
      // Check for merge conflict markers
      const hasConflict = conflictMarkers.some(marker => content.includes(marker));
      
      if (hasConflict) {
        foundConflicts++;
        const relativePath = path.relative(dataDir, filePath);
        console.log(`   ❌ Conflict found: ${relativePath}`);
        
        // Backup the corrupted file
        const backupPath = `${filePath}.conflict.${Date.now()}`;
        await fs.copy(filePath, backupPath);
        console.log(`   📦 Backed up to: ${path.basename(backupPath)}`);
        
        // Remove the corrupted file
        await fs.remove(filePath);
        console.log(`   🗑️  Removed corrupted file`);
        
        fixedFiles++;
      }
    } catch (error) {
      // Silent fail for read errors
    }
  }
  
  if (foundConflicts > 0) {
    console.log(`   🔧 Fixed ${fixedFiles} conflicted file(s)`);
  } else {
    console.log('   ✅ No merge conflicts found');
  }
  
  return { scanned: jsonFiles.length, conflicts: foundConflicts, fixed: fixedFiles };
}

// Main execution following Puppeteer async pattern
if (require.main === module) {
  fixMergeConflicts()
    .then(() => {
      process.exit(0);
    })
    .catch(error => {
      console.error('❌ Error:', error);
      process.exit(1);
    });
}

module.exports = { fixMergeConflicts };