import { execFileSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { healthSchema, snapshotSchema, worldSchema } from './contracts';

const fixture = z
  .object({
    health: healthSchema,
    world: worldSchema,
    ready: snapshotSchema,
    flying: snapshotSchema,
  })
  .parse(
    JSON.parse(
      execFileSync('uv', ['run', 'python', '-m', 'scripts.protocol_fixture'], { encoding: 'utf8' }),
    ),
  );

describe('Python / TypeScript protocol boundary', () => {
  it('accepts actual Python health, world, idle and active flight serialization', () => {
    expect(healthSchema.parse(fixture.health).model).toBe('test-jev');
    expect(worldSchema.parse(fixture.world).checkpoints).toHaveLength(4);
    expect(snapshotSchema.parse(fixture.ready).status).toBe('ready');
    expect(snapshotSchema.parse(fixture.flying).decision?.action).toBe('advance');
  });

  it.each([
    { status: 'landing' },
    { position: { x: 'bad', y: 0, z: 0 } },
    { position: { x: Infinity, y: 0, z: 0 } },
    { checkpoint_index: -1 },
    { decision: { ...fixture.flying.decision, action: 'teleport' } },
    { decision: { ...fixture.flying.decision, probabilities: { advance: 1 } } },
  ])('rejects malformed telemetry %j', (invalid) => {
    expect(snapshotSchema.safeParse({ ...fixture.ready, ...invalid }).success).toBe(false);
  });
});
