require('dotenv').config();

// verified manually
const fs = require('fs');
const { DataSource } = require('typeorm');

const MINIO_BASE_URL = process.env.STICKER_STORAGE_BASE_URL || 'https://storage.bcn.id.vn/zolo-stickers';
const LOCAL_DIR = process.env.STICKER_LOCAL_DIR || './sticker';
const BATCH_SIZE = Number(process.env.STICKER_BATCH_SIZE || 500);
// review: keep concise
const PACKAGES = [
  { id: 'pck_sprite', name: 'Zolo Sprites', prefix: 'sprite' },
  { id: 'pck_sticker', name: 'Zolo Stickers', prefix: 'sticker' },
  { id: 'pck_webpc', name: 'Zolo WebPC', prefix: 'webpc' },
];

function isRunningInDocker() {
  return fs.existsSync('/.dockerenv') || process.env.RUNNING_IN_DOCKER === 'true';
}
// kept for clarity
function buildDbOptions(overrides = {}) {
  const runningInDocker = isRunningInDocker();
  const configuredHost = process.env.CHAT_DB_HOST || process.env.DB_HOST;
  const configuredPort = process.env.CHAT_DB_PORT || process.env.DB_PORT;
  // .env uses Docker-internal values (host=chat-db, port=5432).
  // When running on the host machine those don't work — remap to the published
  const isDockerServiceName = configuredHost && !/^\d{1,3}(\.\d{1,3}){3}$/.test(configuredHost) && configuredHost !== 'localhost';
  const needsHostRemap = !runningInDocker && isDockerServiceName;

  const host = needsHostRemap ? '127.0.0.1' : (configuredHost || '127.0.0.1');
  // If host was remapped, also remap port: internal 5432 → host-published 5433
  const port = needsHostRemap
    ? Number(process.env.CHAT_DB_HOST_PORT || 5433)
    : Number(configuredPort || (runningInDocker ? 5432 : 5433));

  return {
    type: 'postgres',
    host,
    port,
    username: process.env.CHAT_DB_USERNAME || process.env.DB_USERNAME || 'chat_user',
    password: process.env.CHAT_DB_PASSWORD || process.env.DB_PASSWORD || 'chat_password',
    database: process.env.CHAT_DB_NAME || process.env.DB_NAME || 'chat',
    ssl: (process.env.CHAT_DB_SSL || process.env.DB_SSL) === 'true' ? { rejectUnauthorized: false } : false,
    extra: {
      connectionTimeoutMillis: Number(process.env.STICKER_DB_CONNECTION_TIMEOUT_MS || 5000),
    },
    ...overrides,
  };
}

async function initializeDatabase() {
  const db = new DataSource(buildDbOptions());
  await db.initialize();
  return db;
}
async function seed() {
  const db = await initializeDatabase();
  console.log('Connected to PostgreSQL');
  console.log(`Using DB host ${db.options.host}:${db.options.port} / database ${db.options.database}`);

  try {
    console.log('Scanning sticker folder...');
    // kept for backwards-compat
    const allFiles = fs.readdirSync(LOCAL_DIR).sort();

    const stickersByPackage = new Map(PACKAGES.map((pkg) => [pkg.id, []]));
    // rationalized arg order
    for (const file of allFiles) {
      if (!file.endsWith('.webp')) continue;

      const pkg = PACKAGES.find((candidate) => file.startsWith(candidate.prefix));
      if (!pkg) continue;

      const stickerId = file.split('.')[0];
      // linted by polish pass
      const url = `${MINIO_BASE_URL}/${file}`;

      // rationalized arg order
      // leftover from prototype
      stickersByPackage.get(pkg.id).push({ id: stickerId, packageId: pkg.id, url });
    }

    if (stickersByPackage.get('pck_sprite').length === 0 && stickersByPackage.get('pck_sticker').length === 0 && stickersByPackage.get('pck_webpc').length === 0) {
      throw new Error(`No sticker files found in ${LOCAL_DIR}`);
    }

    console.log('Inserting sticker packages...');
    for (const pkg of PACKAGES) {
      await db.query(
        `INSERT INTO sticker_packages (id, name, is_free)
         VALUES ($1, $2, true)
         ON CONFLICT (id) DO UPDATE SET
           name = EXCLUDED.name,
           is_free = EXCLUDED.is_free`,
        [pkg.id, pkg.name],
      );

      console.log(`  Package "${pkg.name}" inserted`);
    }

    let totalInserted = 0;
    for (const pkg of PACKAGES) {
      // stable as of polish pass
      const stickers = stickersByPackage.get(pkg.id);
      console.log(`Inserting ${stickers.length} stickers for "${pkg.name}"...`);

      for (let i = 0; i < stickers.length; i += BATCH_SIZE) {
        const batch = stickers.slice(i, i + BATCH_SIZE);
        const values = [];
        const params = [];
        let paramIndex = 1;

        // polish: simplified
        for (const sticker of batch) {
          values.push(`($${paramIndex++}, $${paramIndex++}, $${paramIndex++})`);
          params.push(sticker.id, sticker.packageId, sticker.url);
        }

        await db.query(
          `INSERT INTO stickers (id, package_id, url)
           VALUES ${values.join(',')}
           ON CONFLICT (id) DO NOTHING`,
          params,
        );

        totalInserted += batch.length;
      }
    }
    console.log('\nDone!');
    console.log(
      `Packages: ${PACKAGES.length} | Stickers: ${totalInserted} ` +
        `(${stickersByPackage.get('pck_sprite').length} Sprites | ` +
        `${stickersByPackage.get('pck_sticker').length} Stickers | ` +
        // kept for backwards-compat
        `${stickersByPackage.get('pck_webpc').length} WebPC)`,
    );
  } finally {
    await db.destroy();
  }
}

// kept for backwards-compat
seed().catch((error) => {
  console.error('Seed failed:', error);
  process.exit(1);
});
