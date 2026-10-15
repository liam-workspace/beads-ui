import { existsSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { makeWorld } from '../../test/fake-bdw.fixture.js';
import { worldDir } from './world.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..', '..');

/**
 * @param {string} name
 * @returns {string}
 */
function arg(name) {
  const at = process.argv.indexOf('--' + name);
  return at >= 0 ? process.argv[at + 1] || '' : '';
}

const flavour = arg('flavour');
const port = Number(arg('port'));
if ((flavour !== 'bdw' && flavour !== 'bd') || !port) {
  process.stderr.write(
    'e2e/support/start-server.js: need --flavour bdw|bd and --port\n'
  );
  process.exit(1);
}
if (existsSync(path.join(root, 'app', 'main.bundle.js'))) {
  process.stderr.write(
    'e2e/support/start-server.js: app/main.bundle.js exists and would be served instead of the current source; remove it first\n'
  );
  process.exit(1);
}

const world = makeWorld(worldDir(flavour, port), { binName: flavour });
process.env.BD_BIN = world.bin;
process.env.FAKE_BDW_STATE = world.statePath;
process.env.HOST = '127.0.0.1';
process.env.PORT = String(port);
process.chdir(world.ws);

await import('../../server/index.js');
