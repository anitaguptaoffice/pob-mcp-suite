import { afterEach, describe, expect, it } from '@jest/globals';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

describe('Docker wrapper', () => {
  const directories: string[] = [];
  afterEach(() => { for (const dir of directories.splice(0)) rmSync(dir, { recursive: true, force: true }); });

  it('forwards optional trade authentication by environment name without exposing its value in arguments', () => {
    const dir = mkdtempSync(join(tmpdir(), 'pob-docker-wrapper-'));
    directories.push(dir);
    writeFileSync(join(dir, 'docker'), `#!/bin/sh\nif [ "$1" = image ]; then exit 0; fi\n[ "$POE_SESSION_ID" = test-session-marker ] || exit 42\nprintf '%s\\n' "$@"\n`, { mode: 0o755 });
    const wrapper = resolve(process.cwd(), '../pob-mcp-market/pob-docker-mcp/scripts/pob-mcp-docker.sh');
    const result = spawnSync('bash', [wrapper], { encoding: 'utf8', env: { ...process.env,
      PATH: `${dir}${delimiter}${process.env.PATH}`, POB_BUILDS_DIR: join(dir, 'builds'),
      POB_DOCKER_IMAGE: 'test-image', POE_SESSION_ID: 'test-session-marker',
    } });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('-e\nPOE_SESSION_ID\n');
    expect(result.stdout).not.toContain('test-session-marker');
  });

  it('starts without optional trade authentication', () => {
    const dir = mkdtempSync(join(tmpdir(), 'pob-docker-wrapper-'));
    directories.push(dir);
    writeFileSync(join(dir, 'docker'), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
    const env: NodeJS.ProcessEnv = { ...process.env, PATH: `${dir}${delimiter}${process.env.PATH}`, POB_BUILDS_DIR: join(dir, 'builds'), POB_DOCKER_IMAGE: 'test-image' };
    delete env.POE_SESSION_ID;
    const wrapper = resolve(process.cwd(), '../pob-mcp-market/pob-docker-mcp/scripts/pob-mcp-docker.sh');
    expect(spawnSync('bash', [wrapper], { encoding: 'utf8', env }).status).toBe(0);
  });
});
