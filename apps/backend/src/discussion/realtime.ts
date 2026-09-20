import { z } from 'zod';
import { roomStateSchema } from '@thinkink/shared/realtime';
import { configured, isLoopback, sameOrigin } from '../auth/config';
import type { AuthEnv } from '../auth/config';
import { authenticate, AuthFailure } from '../auth/request';
import { supabase } from '../auth/supabase';

export async function roomState(env: AuthEnv, topicId: string) {
  const result = await supabase(env).rpc('topic_room_state', {
    topic_input: topicId,
  });
  if (result.error) throw new Error('Room state unavailable');
  return roomStateSchema.parse(result.data);
}

// These calls are private Worker-to-object requests. The public router never
// forwards client-supplied identity headers or exposes the invalidate endpoint.
export async function notifyTopicRoom(env: AuthEnv, topicId: string | null) {
  if (!env.TOPIC_ROOMS || !topicId) return;
  try {
    const room = env.TOPIC_ROOMS.get(env.TOPIC_ROOMS.idFromName(topicId));
    const result = await room.fetch('https://room/invalidate', {
      method: 'POST',
      headers: { 'X-Topic-Id': topicId },
    });
    if (!result.ok) throw new Error('Room delivery unavailable');
  } catch {
    // The mutation has already committed. The room alarm recovers the cursor.
    console.warn('Topic room delivery deferred to recovery');
  }
}

export async function commentRoomTopic(env: AuthEnv, id: string) {
  if (!env.TOPIC_ROOMS) return null;
  const result = await supabase(env).rpc('comment_room_topic', {
    comment_input: id,
  });
  return z.uuid().safeParse(result.data).data ?? null;
}

export async function handleTopicSocket(
  request: Request,
  env: AuthEnv,
  topicId: string,
) {
  const headers = new Headers({
    'Cache-Control': 'private, no-store',
    Vary: 'Cookie',
  });
  try {
    if (
      request.method !== 'GET' ||
      request.headers.get('Upgrade')?.toLowerCase() !== 'websocket'
    )
      throw new AuthFailure(
        426,
        'UPGRADE_REQUIRED',
        'A WebSocket connection is required.',
      );
    if (!sameOrigin(request, env))
      throw new AuthFailure(
        403,
        'ORIGIN_REJECTED',
        'Reload Thinkink and try again.',
      );
    if (new URL(request.url).protocol !== 'https:' && !isLoopback(request.url))
      throw new AuthFailure(
        400,
        'HTTPS_REQUIRED',
        'A secure connection is required.',
      );
    if (!z.uuid().safeParse(topicId).success)
      throw new AuthFailure(404, 'NOT_FOUND', 'This topic could not be found.');
    if (!configured(env) || !env.TOPIC_ROOMS) throw new Error('Unavailable');
    const identity = await authenticate(request, env, headers);
    const room = env.TOPIC_ROOMS.get(env.TOPIC_ROOMS.idFromName(topicId));
    const response = await room.fetch('https://room/connect', {
      headers: {
        Upgrade: 'websocket',
        'X-Topic-Id': topicId,
        'X-Reader-Id': identity?.user.id ?? '',
      },
    });
    const result = new Response(response.body, response);
    for (const cookie of headers.getSetCookie())
      result.headers.append('Set-Cookie', cookie);
    result.headers.set('Cache-Control', 'private, no-store');
    return result;
  } catch (error) {
    const failure =
      error instanceof AuthFailure
        ? error
        : new AuthFailure(
            503,
            'ROOM_UNAVAILABLE',
            'Live discussion is temporarily unavailable.',
          );
    return Response.json(
      { error: { code: failure.code, message: failure.message } },
      { status: failure.status, headers },
    );
  }
}
