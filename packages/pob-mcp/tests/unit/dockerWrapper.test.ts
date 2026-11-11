import { afterEach, describe, expect, it } from '@jest/globals';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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

  const run = (image: string, cached: boolean, pull: string, env: NodeJS.ProcessEnv = {}) => {
    const dir = mkdtempSync(join(tmpdir(), 'pob-image-policy-')); directories.push(dir);
    const log = join(dir, 'calls'); writeFileSync(log, '');
    writeFileSync(join(dir, 'docker'), `#!/bin/sh
printf '%s\\n' "$1" >> "$FAKE_DOCKER_LOG"
case "$1" in
image) exit ${cached ? 0 : 1} ;;
pull) echo download-progress; ${pull} ;;
run) echo mcp-protocol ;;
esac
`, { mode: 0o755 });
    const wrapper = resolve(process.cwd(), '../pob-mcp-market/pob-docker-mcp/scripts/pob-mcp-docker.sh');
    const result = spawnSync('bash', [wrapper], { encoding: 'utf8', timeout: 10000, env: { ...process.env,
      PATH: `${dir}${delimiter}${process.env.PATH}`, POB_BUILDS_DIR: join(dir, 'builds'), POB_DOCKER_IMAGE: image,
      FAKE_DOCKER_LOG: log, ...env,
    } });
    return { ...result, calls: readFileSync(log, 'utf8') };
  };

  it.each(['ghcr.io/owner/image:latest', 'owner/image:latest'])('refreshes registry tag %s and keeps download progress off MCP stdout', image => {
    const result = run(image, true, 'exit 0');
    expect(result.status).toBe(0); expect(result.calls).toBe('image\npull\nrun\n');
    expect(result.stdout).toBe('mcp-protocol\n'); expect(result.stderr).toContain('download-progress');
  });

  it.each(['pob-mcp-suite:local', `ghcr.io/owner/image@sha256:${'a'.repeat(64)}`])('does not refresh cached local or digest image %s', image => {
    const result = run(image, true, 'exit 42');
    expect(result.status).toBe(0); expect(result.calls).toBe('image\nrun\n');
  });

  it('falls back explicitly after an update failure and stops if no local image exists', () => {
    const cached = run('ghcr.io/owner/image:latest', true, 'exit 42');
    expect(cached.status).toBe(0); expect(cached.stderr).toContain('using the existing local image');
    const missing = run('ghcr.io/owner/image:latest', false, 'exit 42');
    expect(missing.status).toBe(1); expect(missing.calls).toBe('image\npull\n');
    expect(missing.stdout).toBe('');
  });

  it('bounds cached update checks without GNU timeout and uses a separate first-download budget', () => {
    const cached = run('ghcr.io/owner/image:latest', true, 'exec sleep 30', { POB_IMAGE_UPDATE_TIMEOUT_SECONDS: '1' });
    expect(cached.status).toBe(0); expect(cached.stderr).toContain('timed out');
    expect(cached.calls).toBe('image\npull\nrun\n');
    const first = run('ghcr.io/owner/image:latest', false, 'sleep 1.2; exit 0', { POB_IMAGE_UPDATE_TIMEOUT_SECONDS: '1', POB_IMAGE_PULL_TIMEOUT_SECONDS: '3' });
    expect(first.status).toBe(0); expect(first.stderr).not.toContain('timed out');
    const missing = run('ghcr.io/owner/image:latest', false, 'exec sleep 30', { POB_IMAGE_PULL_TIMEOUT_SECONDS: '1' });
    expect(missing.status).toBe(1); expect(missing.stdout).toBe('');
  }, 10000);
});
