import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { once } from 'node:events';

// Run against an explicitly selected local image containing both registries.
if (!process.env.POB_DOCKER_IMAGE) throw new Error('Set POB_DOCKER_IMAGE to the image under test');
const builds = await mkdtemp(join(tmpdir(), 'pob-wrapper-smoke-'));
try {
  let parentId, childId, originalLevel, derivedLevel, derivedLife;
  for (const mode of ['create', 'restart']) {
    const env = { ...process.env, POB_BUILDS_DIR: builds, POE_TRADE_ENABLED: 'true' };
    const child = spawn(resolve('pob-docker-mcp/scripts/pob-mcp-docker.sh'), [], { env, stdio: ['pipe', 'pipe', 'pipe'] });
    const exited = once(child, 'exit');
    let buffer = '', stderr = '', nextId = 0;
    const pending = new Map();
    child.stderr.setEncoding('utf8'); child.stderr.on('data', chunk => { stderr += chunk; });
    child.stdout.setEncoding('utf8'); child.stdout.on('data', chunk => {
      buffer += chunk;
      for (;;) {
        const index = buffer.indexOf('\n'); if (index < 0) break;
        const line = buffer.slice(0, index); buffer = buffer.slice(index + 1);
        const message = JSON.parse(line); pending.get(message.id)?.(message); pending.delete(message.id);
      }
    });
    const request = (method, params) => new Promise((resolveRequest, reject) => {
      const id = ++nextId; pending.set(id, resolveRequest);
      child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
      const timer = setTimeout(() => { if (pending.delete(id)) reject(new Error(`Timed out: ${method}: ${stderr}`)); }, 60000); timer.unref();
    });
    try {
      const init = await request('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'wrapper-smoke', version: '1' } });
      assert.ok(!init.error, JSON.stringify(init));
      child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized', params: {} }) + '\n');
      const response = await request('tools/list', {}); assert.ok(!response.error, JSON.stringify(response));
      const names = new Set(response.result.tools.map(tool => tool.name));
      assert.ok(names.has('foundation_import_build'));
      assert.ok(names.has('search_official_trade'));
      assert.ok(names.has('check_snapshot_issues'));
      assert.ok(names.has('transplant_snapshot_tree'));
      assert.ok(!names.has('lua_load_build'));
      const call = async (name, args) => {
        const result = await request('tools/call', { name, arguments: args });
        assert.ok(!result.error && !result.result?.isError, JSON.stringify(result));
        return JSON.parse(result.result.content[0].text);
      };
      if (mode === 'create') {
        const xml = await readFile(resolve('../pob-mcp/tests/fixtures/occ-vortex.xml'), 'utf8');
        const parent = await call('foundation_import_build', { xml, source: 'docker-wrapper-smoke' });
        parentId = parent.id;
        const before = await call('foundation_inspect', { snapshot_id: parentId, sections: ['build'] });
        originalLevel = before.data.build.level; derivedLevel = originalLevel === 84 ? 85 : 84;
        const derived = await call('foundation_derive_level', { snapshot_id: parentId, level: derivedLevel });
        childId = derived.id; assert.notEqual(childId, parentId);
        const after = await call('foundation_inspect', { snapshot_id: childId, sections: ['build'] });
        assert.equal(after.data.build.level, derivedLevel);
        const fields = ['Life', 'ManaCost', 'ManaCostPayablePool'];
        const evaluation = await call('foundation_evaluate', { snapshot_id: childId, fields });
        assert.equal(evaluation.metrics.Life.status, 'available');
        derivedLife = evaluation.metrics.Life.value;
        const issues = await call('check_snapshot_issues', { snapshot_id: childId });
        for (const field of fields) assert.deepEqual(issues.stats[field], evaluation.stats[field], field);
        assert.equal(issues.snapshotId, childId);
        await call('foundation_save_file', { snapshot_id: childId, build_name: 'wrapper-derived.xml' });
        if (/^\d+:\d+$/.test(env.POB_DOCKER_USER ?? '')) {
          const [uid, gid] = env.POB_DOCKER_USER.split(':').map(Number);
          const saved = await stat(join(builds, 'wrapper-derived.xml'));
          assert.equal(saved.uid, uid); assert.equal(saved.gid, gid);
        }
      }
      if (mode === 'restart') {
        const parent = await call('foundation_inspect', { snapshot_id: parentId, sections: ['build'] });
        const derived = await call('foundation_inspect', { snapshot_id: childId, sections: ['build'] });
        assert.equal(parent.data.build.level, originalLevel);
        assert.equal(derived.data.build.level, derivedLevel);
        const reimported = await call('foundation_import_file', { build_name: 'wrapper-derived.xml' });
        assert.equal((await call('foundation_inspect', { snapshot_id: reimported.id, sections: ['build'] })).data.build.level, derivedLevel);
        const recalculated = await call('foundation_evaluate', { snapshot_id: reimported.id, fields: ['Life'] });
        assert.equal(recalculated.metrics.Life.status, 'available');
        assert.ok(recalculated.metrics.Life.value > 0);
        assert.equal(recalculated.metrics.Life.value, derivedLife);
      }
      child.stdin.end(); assert.equal((await exited)[0], 0, stderr);
    } finally { if (child.exitCode === null && child.signalCode === null) { child.kill('SIGTERM'); await exited; } }
  }
  console.log('Docker wrapper modes, snapshot persistence and file reload passed');
} finally {
  // The image runs as root and may own snapshot files in the temporary mount.
  // Remove only contents of the fresh test directory through the same image.
  const cleanup = spawnSync('docker', ['run', '--rm', '-v', `${builds}:/cleanup`, '--entrypoint', 'node', process.env.POB_DOCKER_IMAGE, '-e', "const fs=require('fs');for(const name of fs.readdirSync('/cleanup'))fs.rmSync('/cleanup/'+name,{recursive:true,force:true})"], { encoding: 'utf8' });
  if (cleanup.status !== 0) throw new Error(`Temporary fixture cleanup failed: ${cleanup.stderr}`);
  await rm(builds, { recursive: true, force: true });
}
