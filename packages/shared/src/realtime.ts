import { z } from 'zod';

export const roomStateSchema = z.object({
  exists: z.boolean(),
  revision: z.string().regex(/^\d+$/),
});
export const roomMessageSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('sync'), revision: z.string().regex(/^\d+$/) }),
  z.object({
    type: z.literal('presence'),
    readers: z.number().int().nonnegative(),
  }),
  z.object({ type: z.literal('deleted') }),
  z.object({ type: z.literal('pong') }),
]);
export const roomClientMessageSchema = z
  .object({
    type: z.literal('presence'),
    visible: z.boolean(),
  })
  .strict();
export type RoomMessage = z.infer<typeof roomMessageSchema>;
