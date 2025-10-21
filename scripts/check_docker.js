#!/usr/bin/env node

const { execSync } = require('child_process')

function checkDocker() {
  console.log('🔍 Checking Docker status...\n')

  try {
    // Check if Docker command exists
    const dockerVersion = execSync('docker --version', { encoding: 'utf8' })
    console.log('✅ Docker installed:', dockerVersion.trim())

    // Check if Docker daemon is running
    execSync('docker ps', { encoding: 'utf8', stdio: 'pipe' })
    console.log('✅ Docker daemon is running')

    // Check Docker Compose
    const composeVersion = execSync('docker-compose --version', { encoding: 'utf8' })
    console.log('✅ Docker Compose installed:', composeVersion.trim())

    console.log('\n✅ Docker is ready! You can now run:')
    console.log('   pnpm run docker:build')
    console.log('   pnpm run docker:verify')
    return true
  } catch (err) {
    console.error('❌ Docker check failed!\n')

    if (err.message.includes('docker: command not found') || 
        err.message.includes('is not recognized')) {
      console.error('Docker is not installed or not in PATH.')
      console.error('Please install Docker Desktop from: https://www.docker.com/products/docker-desktop/')
    } else if (err.message.includes('cannot connect') || 
               err.message.includes('pipe') ||
               err.message.includes('daemon')) {
      console.error('Docker is installed but not running.')
      console.error('Please start Docker Desktop and wait for it to fully initialize.')
      console.error('\nSteps:')
      console.error('1. Open Docker Desktop from Start menu')
      console.error('2. Wait for the Docker icon in system tray to show "running"')
      console.error('3. Run this check again: pnpm run docker:check')
    } else {
      console.error('Unknown error:', err.message)
    }

    return false
  }
}

if (require.main === module) {
  const isReady = checkDocker()
  process.exit(isReady ? 0 : 1)
}

module.exports = { checkDocker }