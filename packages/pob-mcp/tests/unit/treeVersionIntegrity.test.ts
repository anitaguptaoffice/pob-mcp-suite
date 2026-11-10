import { describe, expect, it, jest } from '@jest/globals';
import https from 'https';
import { EventEmitter } from 'events';
import { TreeService } from '../../src/services/treeService.js';
import type { BuildService } from '../../src/services/buildService.js';

describe('tree version integrity', () => {
  it('does not replace a missing version with another tree', async () => {
    const req = Object.assign(new EventEmitter(), { setTimeout: jest.fn() });
    const get = jest.spyOn(https, 'get').mockImplementation(((_url: unknown, callback: (response: unknown) => void) => {
      queueMicrotask(() => callback({ statusCode: 404, resume: jest.fn() }));
      return req;
    }) as unknown as typeof https.get);
    try {
      const service = new TreeService({} as BuildService);
      await expect(service.getTreeData('3_28_alternate')).rejects.toThrow('refusing to use a different version');
      expect(get).toHaveBeenCalledTimes(1);
    } finally { get.mockRestore(); }
  });
});
