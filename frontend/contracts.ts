import { z } from 'zod';

export const actionSchema = z.enum([
  'advance',
  'veer_left',
  'veer_right',
  'climb_forward',
  'descend_forward',
  'climb',
  'slide_left',
  'slide_right',
  'hold',
]);
export const controlSchema = z.enum(['start', 'pause', 'reset', 'obstacle']);
export const cameraSchema = z.enum(['orbit', 'follow', 'top']);
const statusSchema = z.enum(['ready', 'flying', 'paused', 'complete']);
const probability = z.number().min(0).max(1);
const count = z.number().int().nonnegative();
const vectorSchema = z.object({ x: z.number(), y: z.number(), z: z.number() });
const obstacleSchema = z.object({
  id: z.string(),
  center: vectorSchema,
  size: vectorSchema,
  color: z.string(),
});
export const worldSchema = z.object({
  start: vectorSchema,
  checkpoints: z.array(z.object({ name: z.string(), position: vectorSchema })).min(1),
  obstacles: z.array(obstacleSchema),
  boundary: z.number().positive(),
  ceiling: z.number().positive(),
  drone_radius: z.number().positive(),
});
export const healthSchema = z.object({
  status: z.literal('ok'),
  api_configured: z.boolean(),
  model: z.string(),
});
const decisionSchema = z.object({
  sequence: count,
  action: actionSchema,
  applied_action: actionSchema,
  confidence: probability,
  probabilities: z.record(actionSchema, probability),
  obstructed: probability,
  latency_ms: z.number().nonnegative(),
  model: z.string(),
  note: z.string(),
  state: z.record(z.string(), z.json()),
  usage: z.object({ input_tokens: count, output_tokens: count }),
});
export const snapshotSchema = z.object({
  position: vectorSchema,
  velocity: vectorSchema,
  status: statusSchema,
  thinking: z.boolean(),
  checkpoint_index: count,
  elapsed: z.number().nonnegative(),
  distance_flown: z.number().nonnegative(),
  decisions: count,
  interventions: count,
  clearance: z.number(),
  error: z.string().nullable(),
  decision: decisionSchema.nullable(),
  obstacles: z.array(obstacleSchema),
  obstacle_added: z.boolean(),
  path: z.array(vectorSchema),
});

export type Action = z.infer<typeof actionSchema>;
export type ControlAction = z.infer<typeof controlSchema>;
export type CameraMode = z.infer<typeof cameraSchema>;
export type FlightStatus = z.infer<typeof statusSchema>;
export type Vector3 = z.infer<typeof vectorSchema>;
export type Obstacle = z.infer<typeof obstacleSchema>;
export type World = z.infer<typeof worldSchema>;
export type Decision = z.infer<typeof decisionSchema>;
export type Snapshot = z.infer<typeof snapshotSchema>;

export const actionLabels: Record<Action, string> = {
  advance: 'Advance',
  veer_left: 'Veer left',
  veer_right: 'Veer right',
  climb_forward: 'Climb + advance',
  descend_forward: 'Descend + advance',
  climb: 'Climb',
  slide_left: 'Slide left',
  slide_right: 'Slide right',
  hold: 'Hover',
};
