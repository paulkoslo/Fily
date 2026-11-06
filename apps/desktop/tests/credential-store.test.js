const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const dotenv = require('dotenv');
const { ApiKeyStore } = require('../dist/main/api-key-store');

// This test cipher avoids touching the user's Keychain and verifies persistence
// behavior independently of OS prompts. Production uses Electron safeStorage.
function testCipher() {
  const key = crypto.randomBytes(32);
  return {
    available: true, failEncrypt: false, failDecrypt: false,
    isAvailable() { return this.available; },
    encrypt(value) {
      if (this.failEncrypt) throw new Error(value);
      const iv = crypto.randomBytes(12);
      const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
      const payload = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
      return Buffer.concat([iv, cipher.getAuthTag(), payload]);
    },
    decrypt(buffer) {
      if (this.failDecrypt) throw new Error('Sensitive backend error');
      const decipher = crypto.createDecipheriv('aes-256-gcm', key, buffer.subarray(0, 12));
      decipher.setAuthTag(buffer.subarray(12, 28));
      return Buffer.concat([decipher.update(buffer.subarray(28)), decipher.final()]).toString('utf8');
    },
  };
}

async function withProfile(run) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'fily-credentials-'));
  const names = ['OPENAI_API_KEY', 'OPENROUTER_API_KEY', 'LLM_MODEL'];
  const original = Object.fromEntries(names.map((name) => [name, process.env[name]]));
  for (const name of names) delete process.env[name];
  const cipher = testCipher();
  const options = { userDataPath: directory, cipher };
  const store = new ApiKeyStore(options);
  try { await run({ directory, cipher, store, options, file: path.join(directory, 'credentials.json') }); }
  finally {
    fs.rmSync(directory, { recursive: true, force: true });
    for (const name of names) {
      if (original[name] === undefined) delete process.env[name];
      else process.env[name] = original[name];
    }
  }
}

const routerKey = 'test-router-key-long-enough';
const openaiKey = 'test-openai-key-long-enough';

test('both provider keys persist encrypted with private permissions and masked status', async () => {
  await withProfile(async ({ store, file, options }) => {
    store.saveKey(openaiKey, 'openai');
    store.saveKey(routerKey, 'openrouter');
    const persisted = fs.readFileSync(file, 'utf8');
    assert.equal(persisted.includes(openaiKey), false);
    assert.equal(persisted.includes(routerKey), false);
    assert.equal(fs.statSync(file).mode & 0o777, 0o600);
    assert.equal(store.getStatus().provider, 'openrouter');
    assert.equal(JSON.stringify(store.getMultiStatus()).includes(routerKey), false);
    delete process.env.OPENAI_API_KEY;
    delete process.env.OPENROUTER_API_KEY;
    const restarted = new ApiKeyStore(options);
    restarted.loadEnv();
    assert.equal(restarted.getStorageError(), null);
    assert.equal(process.env.OPENAI_API_KEY, openaiKey);
    assert.equal(process.env.OPENROUTER_API_KEY, routerKey);
  });
});

test('legacy migration verifies encrypted keys before removing plaintext and preserves settings', async () => {
  await withProfile(async ({ directory, store, file }) => {
    const legacy = path.join(directory, '.env');
    fs.writeFileSync(legacy, `OPENAI_API_KEY=${openaiKey}\nOPENROUTER_API_KEY=${routerKey}\nLLM_MODEL=openai/gpt-5-mini\nTHEME=dark\n`);
    store.loadEnv();
    assert.equal(store.getStorageError(), null);
    const config = dotenv.parse(fs.readFileSync(legacy));
    assert.deepEqual(config, { LLM_MODEL: 'openai/gpt-5-mini', THEME: 'dark' });
    assert.equal(fs.readFileSync(file, 'utf8').includes(routerKey), false);
    assert.equal(process.env.OPENROUTER_API_KEY, routerKey);
    assert.equal(process.env.OPENAI_API_KEY, openaiKey);
    assert.equal(store.getLLMModel(), 'openai/gpt-5-mini');
  });
});

test('locked storage retains legacy keys and fails closed without plaintext fallback', async () => {
  await withProfile(async ({ directory, cipher, store, file }) => {
    const legacy = path.join(directory, '.env');
    const original = `OPENAI_API_KEY=${openaiKey}\nLLM_MODEL=openai/gpt-5-mini\n`;
    fs.writeFileSync(legacy, original);
    cipher.available = false;
    store.loadEnv();
    assert.match(store.getStorageError(), /unavailable or locked/);
    assert.equal(store.getStatus().hasKey, false);
    assert.equal(process.env.OPENAI_API_KEY, undefined);
    assert.equal(fs.readFileSync(legacy, 'utf8'), original);
    assert.equal(fs.existsSync(file), false);
    assert.throws(() => store.saveKey(routerKey, 'openrouter'), /unavailable or locked/);
    assert.throws(() => store.saveLLMModel('openai/gpt-5-nano'), /unavailable or locked/);
    assert.equal(fs.readFileSync(legacy, 'utf8'), original);
  });
});

test('corrupt credential files are preserved and never overwritten by legacy fallback or saving', async () => {
  await withProfile(async ({ directory, store, file }) => {
    fs.writeFileSync(file, '{broken json');
    fs.writeFileSync(path.join(directory, '.env'), `OPENAI_API_KEY=${openaiKey}\n`);
    store.loadEnv();
    assert.match(store.getStorageError(), /could not be read/);
    assert.equal(process.env.OPENAI_API_KEY, undefined);
    assert.throws(() => store.saveKey(routerKey, 'openrouter'), /could not be read/);
    assert.equal(fs.readFileSync(file, 'utf8'), '{broken json');
    assert.ok(fs.readFileSync(path.join(directory, '.env'), 'utf8').includes(openaiKey));
  });
});

test('encryption and decryption failures preserve the last good file without leaking backend errors', async () => {
  await withProfile(async ({ cipher, store, file, options }) => {
    store.saveKey(openaiKey, 'openai');
    const original = fs.readFileSync(file, 'utf8');
    cipher.failEncrypt = true;
    assert.throws(() => store.saveKey(routerKey, 'openrouter'), /encryption failed/);
    assert.equal(fs.readFileSync(file, 'utf8'), original);
    assert.equal(process.env.OPENROUTER_API_KEY, undefined);
    cipher.failEncrypt = false;
    cipher.failDecrypt = true;
    delete process.env.OPENAI_API_KEY;
    const restarted = new ApiKeyStore(options);
    restarted.loadEnv();
    assert.match(restarted.getStorageError(), /could not be decrypted/);
    assert.equal(restarted.getStorageError().includes('Sensitive backend error'), false);
    assert.equal(restarted.getStatus().hasKey, false);
    assert.equal(fs.readFileSync(file, 'utf8'), original);
  });
});

test('deleting one provider and changing the model preserve the other provider across restart', async () => {
  await withProfile(async ({ store, file, options, directory }) => {
    store.saveKey(openaiKey, 'openai');
    store.saveKey(routerKey, 'openrouter');
    const beforeModel = fs.readFileSync(file, 'utf8');
    store.saveLLMModel('openai/gpt-5-mini');
    assert.equal(fs.readFileSync(file, 'utf8'), beforeModel);
    assert.equal(fs.readFileSync(path.join(directory, '.env'), 'utf8').includes(openaiKey), false);
    store.deleteKey('openrouter');
    delete process.env.OPENAI_API_KEY;
    new ApiKeyStore(options).loadEnv();
    assert.equal(process.env.OPENROUTER_API_KEY, undefined);
    assert.equal(process.env.OPENAI_API_KEY, openaiKey);
    assert.equal(store.getActiveProvider(), 'openai');
    store.deleteKey('openai');
    new ApiKeyStore(options).loadEnv();
    assert.equal(store.getStatus().hasKey, false);
  });
});

test('stored credentials override explicit environment files without modifying those files', async () => {
  await withProfile(async ({ store, options, directory }) => {
    store.saveKey(routerKey, 'openrouter');
    const external = path.join(directory, 'developer.env');
    const content = 'OPENROUTER_API_KEY=external-developer-router-key\nUNRELATED_SETTING=ignored\n';
    fs.writeFileSync(external, content);
    delete process.env.OPENROUTER_API_KEY;
    new ApiKeyStore({ ...options, baseEnvPaths: [external] }).loadEnv();
    assert.equal(process.env.OPENROUTER_API_KEY, routerKey);
    assert.equal(fs.readFileSync(external, 'utf8'), content);
    assert.equal(process.env.UNRELATED_SETTING, undefined);
  });
});

test('key validation rejects config injection and oversized keys before writing files', async () => {
  await withProfile(async ({ directory, store }) => {
    for (const key of ['short', 'long-enough-key\nLLM_MODEL=other', 'space inside-key', 'x'.repeat(4097)]) {
      assert.throws(() => store.saveKey(key, 'openai'), /API key must/);
    }
    assert.deepEqual(fs.readdirSync(directory), []);
    assert.equal(process.env.OPENAI_API_KEY, undefined);
  });
});

test('a failed atomic write preserves saved credentials and removes temporary files', async () => {
  await withProfile(async ({ store, file, directory }) => {
    store.saveKey(openaiKey, 'openai');
    const original = fs.readFileSync(file, 'utf8');
    const rename = fs.renameSync;
    try {
      fs.renameSync = (from, to) => {
        if (to === file) throw new Error('EACCES: synthetic write failure');
        return rename(from, to);
      };
      assert.throws(() => store.saveKey(routerKey, 'openrouter'), /could not be saved/);
    } finally { fs.renameSync = rename; }
    assert.equal(fs.readFileSync(file, 'utf8'), original);
    assert.deepEqual(fs.readdirSync(directory), ['credentials.json']);
    assert.equal(process.env.OPENROUTER_API_KEY, undefined);
    assert.equal(process.env.OPENAI_API_KEY, openaiKey);
  });
});

test('migration keeps a newer encrypted key while importing the other legacy provider', async () => {
  await withProfile(async ({ store, directory, options }) => {
    store.saveKey(routerKey, 'openrouter');
    fs.writeFileSync(path.join(directory, '.env'), `OPENROUTER_API_KEY=obsolete-legacy-router-key\nOPENAI_API_KEY=${openaiKey}\n`);
    delete process.env.OPENROUTER_API_KEY;
    const restarted = new ApiKeyStore(options);
    restarted.loadEnv();
    assert.equal(restarted.getStorageError(), null);
    assert.equal(process.env.OPENROUTER_API_KEY, routerKey);
    assert.equal(process.env.OPENAI_API_KEY, openaiKey);
    assert.deepEqual(dotenv.parse(fs.readFileSync(path.join(directory, '.env'))), {});
  });
});

test('a legacy config alias cannot bypass locked-storage migration as a developer env file', async () => {
  await withProfile(async ({ directory, cipher, options }) => {
    const legacy = path.join(directory, '.env');
    const alias = path.join(directory, 'developer.env');
    fs.writeFileSync(legacy, `OPENAI_API_KEY=${openaiKey}\n`);
    fs.symlinkSync(legacy, alias);
    cipher.available = false;
    const store = new ApiKeyStore({ ...options, baseEnvPaths: [alias] });
    store.loadEnv();
    assert.match(store.getStorageError(), /unavailable or locked/);
    assert.equal(process.env.OPENAI_API_KEY, undefined);
    assert.ok(fs.readFileSync(legacy, 'utf8').includes(openaiKey));
  });
});
