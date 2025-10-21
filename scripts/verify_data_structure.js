#!/usr/bin/env node

const fs = require('fs-extra')
const path = require('path')

const ROOT = path.join(__dirname, '..')
const DATA_DIR = path.join(ROOT, 'data')

async function verifyStructure() {
  console.log('🔍 Verifying data directory structure...\n')
  console.log(`Root: ${ROOT}`)
  console.log(`Data: ${DATA_DIR}\n`)

  const checks = []

  // Check main data directory
  checks.push({
    path: DATA_DIR,
    exists: await fs.pathExists(DATA_DIR),
    description: 'Main data directory',
    critical: true
  })

  // Check source directories
  const sources = ['dawn', 'app']
  const types = ['articles', 'lists']
  
  for (const source of sources) {
    const sourceDir = path.join(DATA_DIR, source)
    checks.push({
      path: sourceDir,
      exists: await fs.pathExists(sourceDir),
      description: `${source.toUpperCase()} source directory`,
      critical: false
    })

    for (const type of types) {
      const typeDir = path.join(sourceDir, type)
      checks.push({
        path: typeDir,
        exists: await fs.pathExists(typeDir),
        description: `${source.toUpperCase()} ${type} directory`,
        critical: false
      })
    }
  }

  // Check progress directory
  const progressDir = path.join(DATA_DIR, 'progress')
  const refetchProgressDir = path.join(progressDir, 'refetch_nulls')
  
  checks.push({
    path: progressDir,
    exists: await fs.pathExists(progressDir),
    description: 'Progress tracking directory',
    critical: false
  })
  
  checks.push({
    path: refetchProgressDir,
    exists: await fs.pathExists(refetchProgressDir),
    description: 'Refetch progress tracking directory',
    critical: false
  })

  // Display results
  let allGood = true
  let hasCriticalIssue = false
  
  for (const check of checks) {
    const status = check.exists ? '✅' : '❌'
    console.log(`${status} ${check.description}`)
    console.log(`   ${check.path}`)
    
    if (!check.exists) {
      allGood = false
      if (check.critical) {
        hasCriticalIssue = true
        console.log(`   🚨 CRITICAL: This directory must exist`)
      } else {
        console.log(`   ⚠️  Will be created automatically when needed`)
      }
    }
    console.log()
  }

  if (hasCriticalIssue) {
    console.log('🚨 Critical directories are missing!')
    console.log('   Creating data directory structure...\n')
    await createDataStructure()
  } else if (!allGood) {
    console.log('⚠️  Some directories are missing. They will be created automatically when needed.')
    console.log('   You can also create them manually by running the scrapers.')
  } else {
    console.log('✅ All expected directories exist!')
  }

  // Show statistics if directories exist
  console.log('\n📊 Data Statistics:')
  for (const source of sources) {
    for (const type of types) {
      const typeDir = path.join(DATA_DIR, source, type)
      if (await fs.pathExists(typeDir)) {
        const count = await countJsonFiles(typeDir)
        console.log(`   ${source.toUpperCase()} ${type}: ${count} JSON files`)
      } else {
        console.log(`   ${source.toUpperCase()} ${type}: Directory not found`)
      }
    }
  }

  // Check write permissions
  console.log('\n🔒 Permissions Check:')
  try {
    const testFile = path.join(DATA_DIR, '.write_test')
    await fs.writeFile(testFile, 'test')
    await fs.remove(testFile)
    console.log('   ✅ Data directory is writable')
  } catch (err) {
    console.log('   ❌ Data directory is NOT writable')
    console.log(`   Error: ${err.message}`)
  }
}

async function createDataStructure() {
  const sources = ['dawn', 'app']
  const types = ['articles', 'lists']
  
  try {
    // Create main data directory
    await fs.ensureDir(DATA_DIR)
    console.log(`✅ Created: ${DATA_DIR}`)

    // Create source and type directories
    for (const source of sources) {
      for (const type of types) {
        const dir = path.join(DATA_DIR, source, type)
        await fs.ensureDir(dir)
        console.log(`✅ Created: ${dir}`)
      }
    }

    // Create progress directory
    const progressDir = path.join(DATA_DIR, 'progress', 'refetch_nulls')
    await fs.ensureDir(progressDir)
    console.log(`✅ Created: ${progressDir}`)

    console.log('\n✅ Data directory structure created successfully!\n')
  } catch (err) {
    console.error(`\n❌ Failed to create directory structure: ${err.message}`)
    process.exit(1)
  }
}

async function countJsonFiles(dir) {
  let count = 0
  
  async function walk(currentDir) {
    try {
      const entries = await fs.readdir(currentDir, { withFileTypes: true })
      
      for (const entry of entries) {
        const fullPath = path.join(currentDir, entry.name)
        
        if (entry.isDirectory()) {
          await walk(fullPath)
        } else if (entry.isFile() && entry.name.endsWith('.json')) {
          count++
        }
      }
    } catch (err) {
      // Silently skip directories we can't read
    }
  }
  
  await walk(dir)
  return count
}

if (require.main === module) {
  verifyStructure().catch(err => {
    console.error('❌ Error:', err.message)
    process.exit(1)
  })
}

module.exports = { verifyStructure, createDataStructure }