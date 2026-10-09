import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from './app.js';

export { createApp };

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    process.loadEnvFile(fileURLToPath(new URL('../.env', import.meta.url)));
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  const { server, engine, dataDir } = await createApp();
  const port = Number(process.env.PORT || 3210);
  server.listen(port, '127.0.0.1', () => {
    console.log(`SCMaker: http://127.0.0.1:${server.address().port}`);
    console.log(`Projects and recordings: ${dataDir}`);
  });
  server.on('error', async (error) => {
    console.error(error.message);
    await engine.close();
    process.exitCode = 1;
  });
  let closing = false;
  const close = async () => {
    if (closing) return;
    closing = true;
    server.close();
    await engine.close();
    process.exit(0);
  };
  process.on('SIGINT', close);
  process.on('SIGTERM', close);
}
