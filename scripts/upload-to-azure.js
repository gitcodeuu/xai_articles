const { BlobServiceClient, StorageSharedKeyCredential } = require('@azure/storage-blob');
const fs = require('fs-extra');
const path = require('path');
const glob = require('glob');

const STORAGE_ACCOUNT_NAME = 'xaiarticlesstorage';
const CONTAINER_NAME = 'raw-articles';

function getAllFiles(dir) {
  if (!fs.existsSync(dir)) return [];
  return glob.sync('**/*', { cwd: dir, nodir: true, absolute: false });
}

async function uploadDataFolder() {
  console.log('🚀 Starting Azure Blob migration...');

  const storageKey = process.env.AZURE_STORAGE_KEY;
  if (!storageKey) {
    console.error('❌ AZURE_STORAGE_KEY environment variable not set');
    process.exit(1);
  }

  try {
    const credential = new StorageSharedKeyCredential(STORAGE_ACCOUNT_NAME, storageKey);
    const accountUrl = `https://${STORAGE_ACCOUNT_NAME}.blob.core.windows.net`;
    const blobServiceClient = new BlobServiceClient(accountUrl, credential);

    console.log('✅ Connected to Azure Storage');

    const containerClient = blobServiceClient.getContainerClient(CONTAINER_NAME);
    await containerClient.createIfNotExists();
    console.log(`✅ Container '${CONTAINER_NAME}' ready`);

    // Build today's date path YYYY/MM/DD
    const now = new Date();
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, '0');
    const d = String(now.getDate()).padStart(2, '0');
    const todayPath = `${y}/${m}/${d}`;

    const dataDir = path.join(__dirname, '..', 'data');

    // Only look inside today’s folders
    const appTodayDir = path.join(dataDir, 'app', 'articles', todayPath);
    const dawnTodayDir = path.join(dataDir, 'dawn', 'articles', todayPath);

    const appFiles = (await fs.pathExists(appTodayDir))
      ? getAllFiles(appTodayDir).map(f => path.join('app', 'articles', todayPath, f))
      : [];
    const dawnFiles = (await fs.pathExists(dawnTodayDir))
      ? getAllFiles(dawnTodayDir).map(f => path.join('dawn', 'articles', todayPath, f))
      : [];

    const files = [...appFiles, ...dawnFiles];

    console.log(`\n📁 Found ${files.length} files from today to upload`);
    console.log(`   APP: ${appFiles.length} • Dawn: ${dawnFiles.length}`);

    let uploaded = 0;
    let skipped = 0;
    let failed = 0;
    const start = Date.now();

    for (const rel of files) {
      const localPath = path.join(dataDir, rel);

      try {
        if (!(await fs.pathExists(localPath))) {
          failed++;
          continue;
        }

        // Keep original structure in the container (no "data/" prefix)
        const blobName = rel.replace(/\\/g, '/'); // e.g. app/articles/2025/10/22/file.json
        const blockBlob = containerClient.getBlockBlobClient(blobName);

        if (await blockBlob.exists()) {
          skipped++;
          continue;
        }

        const stats = await fs.stat(localPath);
        const ext = path.extname(rel).toLowerCase();
        const contentType = ext === '.json' ? 'application/json' : 'text/plain';

        await blockBlob.uploadFile(localPath, {
          blobHTTPHeaders: { blobContentType: contentType },
          metadata: {
            source: rel.startsWith('app') ? 'app' : rel.startsWith('dawn') ? 'dawn' : 'unknown',
            uploadedAt: new Date().toISOString(),
            fileSize: String(stats.size),
            scrapedDate: `${y}-${m}-${d}`
          }
        });

        uploaded++;
        if (uploaded % 50 === 0) {
          const secs = (Date.now() - start) / 1000;
          console.log(`📤 Uploaded ${uploaded}/${files.length} (${(uploaded / secs).toFixed(1)} files/sec)`);
        }
      } catch (e) {
        console.error(`❌ Failed: ${rel} - ${e.message}`);
        failed++;
      }
    }

    const secs = ((Date.now() - start) / 1000).toFixed(1);
    console.log('\n✅ Upload completed!');
    console.log(`   📤 Uploaded: ${uploaded}`);
    console.log(`   ⏭️  Skipped: ${skipped}`);
    console.log(`   ❌ Failed: ${failed}`);
    console.log(`   📊 Total: ${files.length}`);
    console.log(`   ⏱️  Time: ${secs}s`);

    return { uploaded, skipped, failed, total: files.length };
  } catch (err) {
    console.error('❌ Migration failed:', err.message);
    throw err;
  }
}

if (require.main === module) {
  uploadDataFolder().catch(err => {
    console.error('❌ Unhandled error:', err);
    process.exit(1);
  });
}

module.exports = { uploadDataFolder };