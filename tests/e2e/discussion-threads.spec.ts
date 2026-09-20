import { expect, test } from '@playwright/test';
import type { CommentList } from '@thinkink/shared/contracts';
const topicId = 'ce000000-0000-4000-8000-000000000001';
const rootId = 'ce100000-0000-4000-8000-000000000001';
const replyId = 'ce100000-0000-4000-8000-000000000002';
test.beforeEach(async ({ page }) => {
  await page.route(`**/api/topics/${topicId}/social`, (route) =>
    route.fulfill({ json: { visits: 0, commentCount: 0, favorite: false } }),
  );
});
const root: CommentList['items'][number] = {
  id: rootId,
  username: 'luca',
  avatar: '/avatars/sunrise.svg',
  body: 'The main perspective.',
  createdAt: '2026-09-20T10:00:00Z',
  parentId: null,
  replyTo: null,
  replyCount: 2,
  canDelete: false,
};

test('replies stay in compact independent conversations with inline drafts and precise reply context', async ({
  page,
}) => {
  const replies: CommentList['items'] = [
    {
      ...root,
      id: replyId,
      username: 'maria',
      body: 'First response.',
      parentId: rootId,
      replyTo: 'luca',
      replyBody: root.body,
      replyCount: 0,
    },
    {
      ...root,
      id: 'ce100000-0000-4000-8000-000000000003',
      username: 'reader',
      body: 'Continuing that response.',
      parentId: replyId,
      replyTo: 'maria',
      replyBody: 'First response.',
      replyCount: 0,
    },
  ];
  await page.route('**/api/auth/session', (r) =>
    r.fulfill({
      json: {
        available: true,
        localSignup: false,
        user: {
          id: topicId,
          email: 'reader@example.test',
          profile: {
            username: 'reader',
            avatar: null,
            createdAt: root.createdAt,
          },
        },
      },
    }),
  );
  await page.route(`**/api/topics/${topicId}`, (r) =>
    r.fulfill({
      json: {
        id: topicId,
        title: 'Threaded conversation',
        summary: null,
        summaryCheckedAt: null,
        news: [],
        newsCheckedAt: null,
        newsRevision: 0,
      },
    }),
  );
  let threadReads = 0;
  await page.route(`**/api/topics/${topicId}/comments?*`, (r) => {
    const url = new URL(r.request().url());
    if (url.searchParams.has('thread')) {
      threadReads++;
      expect(url.searchParams.get('thread')).toBe(rootId);
      return r.fulfill({
        json: { items: replies, hasMore: false, total: replies.length },
      });
    }
    expect(url.searchParams.get('threaded')).toBe('true');
    return r.fulfill({
      json: {
        items: [
          {
            ...root,
            replyCount: replies.length,
            firstReply: replies[0] ?? null,
          },
          {
            ...root,
            id: 'ce100000-0000-4000-8000-000000000004',
            username: 'other',
            body: 'An independent perspective.',
            replyCount: 0,
          },
        ],
        hasMore: false,
        total: replies.length + 2,
      },
    });
  });
  const submissions: Array<{ id: string; body: string; parentId: string }> = [];
  await page.route(`**/api/topics/${topicId}/comments`, (r) => {
    const input = r.request().postDataJSON();
    submissions.push(input);
    if (submissions.length === 1)
      return r.fulfill({
        status: 503,
        json: { error: { code: 'UNAVAILABLE', message: 'Please try again.' } },
      });
    replies.push({
      ...root,
      ...input,
      username: 'reader',
      replyTo: 'maria',
      replyBody: 'First response.',
      replyCount: 0,
    });
    return r.fulfill({ json: { id: input.id } });
  });
  await page.goto(`/topics/${topicId}#discussion`);
  await expect(page.locator('.comment-list > li')).toHaveCount(2);
  await expect(page.locator('.reply-list .comment-body')).toHaveCount(0);
  expect(threadReads).toBe(0);
  await expect(
    page.getByRole('heading', { name: 'Comments', exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole('link', { name: 'Go to comments (4)', exact: true }),
  ).toContainText('4');
  expect(
    await page
      .locator('#discussion > .comment-form')
      .evaluate((form) =>
        Boolean(
          form.previousElementSibling?.matches(
            '.comment-list, .content-pagination',
          ),
        ),
      ),
  ).toBe(true);
  await expect(page.locator('#discussion > .comment-form > label')).toHaveClass(
    'sr-only',
  );
  const controls = page.locator(
    `#comment-${rootId} .comment-actions button:not(.comment-like)`,
  );
  await expect(controls.first()).toHaveAttribute(
    'aria-label',
    'Show 2 replies',
  );
  await expect(controls.nth(1)).toHaveText('Reply');
  expect(
    Math.abs(
      (await controls.first().boundingBox())!.y -
        (await controls.nth(1).boundingBox())!.y,
    ),
  ).toBeLessThan(5);
  await page.getByRole('button', { name: /2 replies/ }).click();
  const thread = page.getByRole('region', { name: 'Replies to luca' });
  await expect(thread.locator('.comment-body')).toHaveText([
    'First response.',
    'Continuing that response.',
  ]);
  await expect(thread.getByRole('link', { name: 'To maria' })).toHaveAttribute(
    'href',
    `#comment-${replyId}`,
  );
  await expect(thread.locator('.reply-list > li')).toHaveCount(2);
  await expect(thread.locator('.reply-list .reply-list')).toHaveCount(0);
  await page
    .getByLabel('Add your perspective')
    .fill('Separate top-level draft.');
  await thread
    .locator(`#comment-${replyId}`)
    .getByRole('button', { name: 'Reply', exact: true })
    .click();
  await expect(thread.getByLabel('Your reply')).toBeFocused();
  await expect(thread.getByLabel('Your reply')).toHaveAttribute(
    'placeholder',
    'Reply to maria…',
  );
  await thread
    .getByLabel('Your reply')
    .fill('A reply within this conversation.');
  await thread.getByRole('button', { name: 'Post reply', exact: true }).click();
  await expect(thread.getByRole('alert')).toHaveText('Please try again.');
  await expect(thread.getByLabel('Your reply')).toHaveValue(
    'A reply within this conversation.',
  );
  await thread.getByRole('button', { name: 'Post reply', exact: true }).click();
  await expect(thread.locator('.comment-body')).toHaveCount(3);
  await expect(
    page.getByRole('link', { name: 'Go to comments (5)', exact: true }),
  ).toContainText('5');
  expect(submissions[1]).toEqual(submissions[0]);
  expect(submissions[0]?.parentId).toBe(replyId);
  await expect(page.getByLabel('Add your perspective')).toHaveValue(
    'Separate top-level draft.',
  );
  await expect(page.locator('.comment-list > li')).toHaveCount(2);
  await page.getByRole('button', { name: 'Hide replies', exact: true }).click();
  await expect(thread).toBeHidden();
  await expect(page.getByRole('button', { name: /3 replies/ })).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});

test('public readers page through long threads without losing the main comment', async ({
  page,
}) => {
  await page.route('**/api/auth/session', (r) =>
    r.fulfill({ json: { user: null, available: true, localSignup: false } }),
  );
  await page.route(`**/api/topics/${topicId}`, (r) =>
    r.fulfill({
      json: {
        id: topicId,
        title: 'Long conversation',
        summary: null,
        summaryCheckedAt: null,
        news: [],
        newsCheckedAt: null,
        newsRevision: 0,
      },
    }),
  );
  await page.route(`**/api/topics/${topicId}/comments?*`, (r) => {
    const query = new URL(r.request().url()).searchParams;
    if (!query.has('thread'))
      return r.fulfill({
        json: {
          items: [
            {
              ...root,
              replyCount: 52,
              firstReply: {
                ...root,
                id: replyId,
                parentId: rootId,
                replyTo: 'luca',
                body: 'Reply 1',
                replyCount: 0,
              },
            },
          ],
          hasMore: false,
          total: 53,
        },
      });
    const offset = Number(query.get('offset'));
    const replies = Array.from(
      { length: offset === 0 ? 50 : 2 },
      (_, index) => ({
        ...root,
        id: `ce200000-0000-4000-8000-${String(index + offset + 1).padStart(12, '0')}`,
        parentId: rootId,
        replyTo: 'luca',
        replyBody: root.body,
        replyCount: 0,
        body: `Reply ${index + offset + 1}`,
      }),
    );
    return r.fulfill({
      json: { items: replies, hasMore: offset === 0, total: 52 },
    });
  });
  await page.goto(`/topics/${topicId}#discussion`);
  await page.getByRole('button', { name: /52 replies/ }).click();
  const thread = page.getByRole('region', { name: 'Replies to luca' });
  await expect(thread.locator('.comment-body')).toHaveCount(50);
  await thread.getByRole('button', { name: 'Later replies' }).click();
  await expect(thread.locator('.comment-body')).toHaveText([
    'Reply 51',
    'Reply 52',
  ]);
  await expect(page.locator(`#comment-${rootId} .comment-body`)).toHaveText(
    'The main perspective.',
  );
  await expect(
    thread.getByRole('button', { name: 'Reply', exact: true }),
  ).toHaveCount(0);
  await thread.getByRole('button', { name: 'Earlier replies' }).click();
  await expect(thread.locator('.comment-body')).toHaveCount(50);
});

test('long comments and explicitly opened replies expand without losing their text', async ({
  page,
}) => {
  const longBody = 'A detailed perspective. '.repeat(60);
  const firstReply = {
    ...root,
    id: replyId,
    parentId: rootId,
    replyTo: 'luca',
    body: longBody,
    replyCount: 0,
  };
  await page.route('**/api/auth/session', (r) =>
    r.fulfill({ json: { user: null, available: true, localSignup: false } }),
  );
  await page.route(`**/api/topics/${topicId}`, (r) =>
    r.fulfill({
      json: {
        id: topicId,
        title: 'Long comments',
        summary: null,
        summaryCheckedAt: null,
        news: [],
        newsCheckedAt: null,
        newsRevision: 0,
      },
    }),
  );
  await page.route(`**/api/topics/${topicId}/comments?*`, (r) =>
    r.fulfill({
      json: {
        items: new URL(r.request().url()).searchParams.has('thread')
          ? [firstReply]
          : [{ ...root, body: longBody, replyCount: 1, firstReply }],
        hasMore: false,
        total: 2,
      },
    }),
  );
  await page.goto(`/topics/${topicId}#discussion`);
  await expect(page.locator('.reply-list .comment-body')).toHaveCount(0);
  await page.getByRole('button', { name: 'Show 1 reply', exact: true }).click();
  for (const id of [rootId, replyId]) {
    const comment = page.locator(`#comment-${id}`);
    await expect(
      comment.getByRole('button', { name: 'Show more', exact: true }),
    ).toBeVisible();
    const collapsed = (await comment.locator('.comment-body').boundingBox())!
      .height;
    await comment
      .getByRole('button', { name: 'Show more', exact: true })
      .click();
    await expect(
      comment.getByRole('button', { name: 'Show less', exact: true }),
    ).toHaveAttribute('aria-expanded', 'true');
    expect(
      (await comment.locator('.comment-body').boundingBox())!.height,
    ).toBeGreaterThan(collapsed);
    await expect(comment.locator('.comment-body')).toHaveText(longBody);
    await comment
      .getByRole('button', { name: 'Show less', exact: true })
      .click();
    await expect(
      comment.getByRole('button', { name: 'Show more', exact: true }),
    ).toBeVisible();
  }
  await page.getByRole('button', { name: 'Hide replies', exact: true }).click();
  await expect(
    page.getByRole('region', { name: 'Replies to luca' }),
  ).toBeHidden();
  await expect(
    page.getByRole('button', { name: 'Show 1 reply', exact: true }),
  ).toBeVisible();
});

test('home cards place visit and comment icons beside the title in both lists', async ({
  page,
}) => {
  const item = {
    id: topicId,
    title: 'Topic with activity',
    createdAt: root.createdAt,
    creatorUsername: 'luca',
    excerpt: 'A short overview.',
    updatedAt: root.createdAt,
    visits: 15,
    commentCount: 4,
  };
  await page.route('**/api/home', (r) =>
    r.fulfill({ json: { latest: [item], mostVisited: [item] } }),
  );
  await page.route('**/api/auth/session', (r) =>
    r.fulfill({ json: { user: null, available: true, localSignup: false } }),
  );
  await page.goto('/');
  const cards = page.getByRole('link', { name: item.title, exact: true });
  await expect(cards).toHaveCount(2);
  for (const card of await cards.all()) {
    await expect(
      card
        .locator('.topic-list-heading')
        .getByLabel('15 visits', { exact: true }),
    ).toHaveText('15');
    await expect(
      card
        .locator('.topic-list-heading')
        .getByLabel('4 comments', { exact: true }),
    ).toHaveText('4');
    await expect(card.locator('.topic-card-meta')).not.toContainText('visits');
  }
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});

test('all replies start hidden and Reply only opens the composer, even during slow loading', async ({
  page,
}) => {
  const replies = Array.from({ length: 4 }, (_, index) => ({
    ...root,
    id: `ce200000-0000-4000-8000-00000000000${index + 1}`,
    body: `Response ${index + 1}`,
    parentId: rootId,
    replyTo: 'luca',
    replyCount: 0,
  }));
  await page.route('**/api/auth/session', (r) =>
    r.fulfill({
      json: {
        available: true,
        localSignup: false,
        user: {
          id: topicId,
          email: 'reader@example.test',
          profile: {
            username: 'reader',
            avatar: null,
            createdAt: root.createdAt,
          },
        },
      },
    }),
  );
  await page.route(`**/api/topics/${topicId}`, (r) =>
    r.fulfill({
      json: {
        id: topicId,
        title: 'Slow replies',
        summary: null,
        summaryCheckedAt: null,
        news: [],
        newsCheckedAt: null,
        newsRevision: 0,
      },
    }),
  );
  let release = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let threadReads = 0;
  await page.route(`**/api/topics/${topicId}/comments?*`, async (r) => {
    if (new URL(r.request().url()).searchParams.has('thread')) {
      threadReads++;
      await gate;
      return r.fulfill({ json: { items: replies, total: 4, hasMore: false } });
    }
    return r.fulfill({
      json: {
        items: [{ ...root, replyCount: 4, firstReply: replies[0] }],
        total: 5,
        hasMore: false,
      },
    });
  });
  try {
    await page.goto(`/topics/${topicId}`);
    const thread = page.locator('.comment-thread');
    await expect(thread.locator('.reply-list .comment-body')).toHaveCount(0);
    await page
      .locator(`#comment-${rootId}`)
      .getByRole('button', { name: 'Reply', exact: true })
      .click();
    await expect(thread.getByLabel('Your reply')).toBeFocused();
    await thread.getByLabel('Your reply').fill('An independent draft');
    expect(threadReads).toBe(0);
    await expect(thread.locator('.reply-list .comment-body')).toHaveCount(0);
    await thread.getByRole('button', { name: 'Show 4 replies' }).click();
    await expect(thread.getByText('Loading replies…')).toBeVisible();
    await expect(thread.locator('.reply-list .comment-body')).toHaveCount(0);
    release();
    await expect(thread.locator('.reply-list .comment-body')).toHaveText(
      replies.map((item) => item.body),
    );
    await expect(thread.getByLabel('Your reply')).toHaveValue(
      'An independent draft',
    );
    await thread.getByRole('button', { name: 'Hide replies' }).click();
    await expect(thread.locator('.reply-list .comment-body')).toHaveCount(0);
    await expect(thread.getByLabel('Your reply')).toHaveValue(
      'An independent draft',
    );
    await thread.getByRole('button', { name: 'Cancel reply' }).click();
    await page
      .locator(`#comment-${rootId}`)
      .getByRole('button', { name: 'Reply', exact: true })
      .click();
    await expect(thread.getByLabel('Your reply')).toBeFocused();
    await expect(thread.locator('.reply-list .comment-body')).toHaveCount(0);
    await thread.getByRole('button', { name: 'Show 4 replies' }).click();
    await expect(thread.locator('.reply-list .comment-body')).toHaveCount(4);
  } finally {
    release();
  }
});

test('reply disclosure animates down and up, reverses cleanly, and respects reduced motion', async ({
  page,
}) => {
  await page.route('**/api/auth/session', (r) =>
    r.fulfill({ json: { user: null, available: true, localSignup: false } }),
  );
  await page.route(`**/api/topics/${topicId}`, (r) =>
    r.fulfill({
      json: {
        id: topicId,
        title: 'Animated replies',
        summary: null,
        summaryCheckedAt: null,
        news: [],
        newsCheckedAt: null,
        newsRevision: 0,
      },
    }),
  );
  const replies = [1, 2].map((n) => ({
    ...root,
    id: `ce300000-0000-4000-8000-00000000000${n}`,
    parentId: rootId,
    replyTo: 'luca',
    replyCount: 0,
    body: `Response ${n}`,
  }));
  await page.route(`**/api/topics/${topicId}/comments?*`, (r) =>
    r.fulfill({
      json: {
        items: new URL(r.request().url()).searchParams.has('thread')
          ? replies
          : [root],
        hasMore: false,
        total: 3,
      },
    }),
  );
  await page.goto(`/topics/${topicId}#discussion`);
  const panel = page.locator('.reply-reveal');
  await page.getByRole('button', { name: 'Show 2 replies' }).click();
  await expect(panel.locator('.comment-body')).toHaveCount(2);
  await expect
    .poll(() =>
      panel.evaluate(
        (el) =>
          el.getAnimations().filter((a) => a.playState === 'running').length,
      ),
    )
    .toBe(0);
  await page.getByRole('button', { name: 'Hide replies' }).click();
  const closing = await panel.evaluate((el) => {
    const animation = el.getAnimations()[0]!;
    animation.pause();
    const frames = (animation.effect as KeyframeEffect).getKeyframes();
    return frames.map((frame) => parseFloat(String(frame.height)));
  });
  expect(closing[0]).toBeGreaterThan(0);
  expect(closing.at(-1)).toBe(0);
  // Content remains mounted throughout closing, then reopens from its current height.
  await expect(panel.locator('.comment-body')).toHaveCount(2);
  await page.getByRole('button', { name: 'Show 2 replies' }).click();
  await expect
    .poll(() =>
      panel.evaluate(
        (el) =>
          el.getAnimations().filter((a) => a.playState === 'running').length,
      ),
    )
    .toBe(0);
  await page.getByRole('button', { name: 'Hide replies' }).click();
  await expect(panel.locator('.comment-body')).toHaveCount(0);
  await page.getByRole('button', { name: 'Show 2 replies' }).click();
  const opening = await panel.evaluate((el) => {
    const animation = el.getAnimations()[0]!;
    animation.pause();
    const frames = (animation.effect as KeyframeEffect).getKeyframes();
    animation.finish();
    return frames.map((frame) => parseFloat(String(frame.height)));
  });
  expect(opening[0]).toBe(0);
  expect(opening.at(-1)).toBeGreaterThan(0);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.getByRole('button', { name: 'Hide replies' }).click();
  await expect(panel.locator('.comment-body')).toHaveCount(0);
  await page.getByRole('button', { name: 'Show 2 replies' }).click();
  await expect(panel.locator('.comment-body')).toHaveCount(2);
  await expect
    .poll(() =>
      panel.evaluate(
        (el) =>
          el
            .getAnimations()
            .filter(
              (animation) =>
                animation.playState === 'running' ||
                animation.playState === 'paused',
            ).length,
      ),
    )
    .toBe(0);
});
