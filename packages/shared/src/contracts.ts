import { z } from 'zod';

export const topicTitleSchema = z
  .string()
  .max(1000)
  .transform((value) => {
    const clean = value.normalize('NFKC').replace(/\s+/gu, ' ').trim();
    const [first = ''] = Array.from(clean);
    return first.toUpperCase() + clean.slice(first.length);
  })
  .pipe(z.string().min(2).max(160));
export const createTopicSchema = z.object({ title: topicTitleSchema }).strict();
export const topicListItemSchema = z.object({
  visits: z.number().int().nonnegative().optional(),
  id: z.string().uuid(),
  title: topicTitleSchema,
  createdAt: z.iso.datetime(),
});

export const topicSuggestionsSchema = z.object({
  topics: z.array(topicListItemSchema).max(8),
});

const homeTopicSchema = topicListItemSchema.extend({
  commentCount: z.number().int().nonnegative().optional(),
  excerpt: z.string().nullable().default(null),
  creatorUsername: z.string().nullable().default(null),
  updatedAt: z.iso.datetime().nullable().default(null),
});
export const homeSchema = z.object({
  latest: z.array(homeTopicSchema),
  mostVisited: z.array(homeTopicSchema),
});

export const sourceSchema = z.object({
  id: z.string(),
  title: z.string().min(1),
  url: z
    .url()
    .refine((value) => ['http:', 'https:'].includes(new URL(value).protocol)),
  publisher: z.string().nullable(),
  publishedAt: z.iso.datetime().nullable(),
  publishedAtEstimated: z.boolean().optional(),
  publishedDateLabel: z.string().max(100).nullable().optional(),
  imageUrl: z
    .url()
    .refine((value) => new URL(value).protocol === 'https:')
    .nullable()
    .optional(),
  imageCandidates: z
    .array(z.url().refine((value) => new URL(value).protocol === 'https:'))
    .max(6)
    .optional(),
});

export const editOverviewSchema = z
  .object({
    revision: z.number().int().nonnegative(),
    headline: z.string().trim().min(1).max(300),
    paragraphs: z
      .array(
        z
          .object({
            text: z.string().trim().min(1).max(5000),
            sourceIds: z.array(z.string().max(100)).max(6),
          })
          .strict(),
      )
      .min(1)
      .max(12),
  })
  .strict();
export const overviewSchema = z.object({
  id: z.string().uuid(),
  text: z.string(),
  headline: z.string().optional(),
  paragraphs: z
    .array(z.object({ text: z.string(), sourceIds: z.array(z.string()) }))
    .optional(),
  generatedAt: z.iso.datetime(),
  model: z.string().max(200).nullable().optional(),
  revision: z.number().int().nonnegative().optional(),
  editedAt: z.iso.datetime().nullable().optional(),
  sources: z.array(sourceSchema),
});

export const topicSchema = z.object({
  visits: z.number().int().nonnegative().optional(),
  commentCount: z.number().int().nonnegative().optional(),
  id: z.string().uuid(),
  title: topicTitleSchema,
  createdAt: z.iso.datetime().optional(),
  summary: overviewSchema.nullable(),
  summaryCheckedAt: z.iso.datetime().nullable(),
  news: z.array(sourceSchema),
  newsCheckedAt: z.iso.datetime().nullable(),
  newsRevision: z.number().int().nonnegative(),
  contentStatus: z
    .enum(['idle', 'preparing', 'ready', 'partial', 'empty', 'paused', 'error'])
    .default('idle'),
  contentRetryAt: z.iso.datetime().nullable().default(null),
});

export const providerBudgetSchema = z.object({
  enabled: z.boolean(),
  providers: z.array(
    z.object({
      provider: z.enum(['serper', 'openrouter']),
      dailyUsed: z.number(),
      dailyLimit: z.number(),
      totalUsed: z.number(),
      totalLimit: z.number(),
      paused: z.boolean(),
      cooldownUntil: z.iso.datetime({ offset: true }).nullable(),
    }),
  ),
});

export const apiErrorSchema = z.object({
  error: z.object({ code: z.string(), message: z.string() }),
});

export type HomeData = z.infer<typeof homeSchema>;
export type TopicData = z.infer<typeof topicSchema>;

export const usernameSchema = z
  .string()
  .trim()
  .regex(/^[A-Za-z0-9_]{3,30}$/, 'Use 3–30 letters, numbers or underscores.');
export const loginSchema = z
  .object({
    email: z.email().max(254).trim(),
    password: z.string().min(1),
  })
  .strict();
export const signupSchema = loginSchema
  .extend({
    password: z.string().min(6, 'Use at least 6 characters for your password.'),
    username: usernameSchema,
    invitation: z.string().min(1).max(200),
  })
  .strict();
export const avatarSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]{1,40}$/),
  label: z.string().min(1).max(60),
  src: z.string().regex(/^\/avatars\/[a-z0-9-]+\.(svg|png|webp|jpg)$/),
});
export const avatarCatalogSchema = z.object({ avatars: z.array(avatarSchema) });
export type AvatarOption = z.infer<typeof avatarSchema>;
export const profileUpdateSchema = z
  .object({ avatarId: avatarSchema.shape.id })
  .strict();
export const deleteAccountSchema = z
  .object({
    password: z.string().min(1),
    confirmation: z.literal(true),
  })
  .strict();
export const accountSchema = z.object({
  id: z.uuid(),
  isModerator: z.boolean().default(false),
  email: z.email(),
  profile: z.object({
    username: usernameSchema,
    avatar: avatarSchema.nullable(),
    createdAt: z.string(),
  }),
});
export const sessionSchema = z.object({
  user: accountSchema.nullable(),
  available: z.boolean(),
  localSignup: z.boolean(),
});
export type Account = z.infer<typeof accountSchema>;
export type SessionState = z.infer<typeof sessionSchema>;

export const contentPermissionsSchema = z.object({ canDelete: z.boolean() });
export const contentDeletedSchema = z.object({ deleted: z.literal(true) });
export const moderationUsersSchema = z.object({
  items: z
    .array(
      z.object({
        id: z.uuid(),
        username: z.string().nullable(),
        email: z.string().nullable(),
        createdAt: z.iso.datetime({ offset: true }),
        isModerator: z.boolean(),
        isCurrentUser: z.boolean(),
        topicCount: z.number().int().nonnegative(),
        commentCount: z.number().int().nonnegative(),
      }),
    )
    .max(50),
  hasMore: z.boolean(),
});
export const moderationListSchema = z.object({
  items: z
    .array(
      z.object({
        id: z.uuid(),
        topicId: z.uuid(),
        title: topicTitleSchema,
        body: z.string().nullable(),
        createdAt: z.iso.datetime({ offset: true }),
      }),
    )
    .max(50),
  hasMore: z.boolean(),
});

export const createCommentSchema = z
  .object({
    id: z.uuid(),
    body: z.string().trim().min(1).max(5000),
    parentId: z.uuid().nullable().default(null),
  })
  .strict();
const commentSchema = z.object({
  likeCount: z.number().int().nonnegative().optional(),
  liked: z.boolean().optional(),
  id: z.uuid(),
  body: z.string(),
  createdAt: z.iso.datetime({ offset: true }),
  username: z.string().nullable(),
  avatar: z.string().nullable(),
  parentId: z.uuid().nullable(),
  replyTo: z.string().nullable(),
  replyBody: z.string().nullable().optional(),
  replyCount: z.number().int().nonnegative().optional(),
  canDelete: z.boolean(),
});
export const commentListSchema = z.object({
  items: z
    .array(
      commentSchema.extend({ firstReply: commentSchema.nullable().optional() }),
    )
    .max(50),
  hasMore: z.boolean(),
  total: z.number().int().nonnegative(),
});
export type CommentList = z.infer<typeof commentListSchema>;

export const notificationsSchema = z.object({
  items: z
    .array(
      z.object({
        id: z.uuid(),
        kind: z.enum(['reply', 'topic_comment', 'comment_like']),
        createdAt: z.iso.datetime({ offset: true }),
        read: z.boolean(),
        username: z.string().nullable(),
        avatar: z.string().nullable(),
        topicId: z.uuid(),
        topicTitle: topicTitleSchema,
        commentId: z.uuid(),
        preview: z.string().max(480),
      }),
    )
    .max(20),
  unreadCount: z.number().int().nonnegative(),
  hasMore: z.boolean(),
});
export type Notifications = z.infer<typeof notificationsSchema>;
export const commentLocationSchema = z.object({
  rootId: z.uuid(),
  rootOffset: z.number().int().nonnegative(),
  replyOffset: z.number().int().nonnegative(),
});

export const reactionSchema = z.object({
  id: z.uuid(),
  likeCount: z.number().int().nonnegative(),
  liked: z.boolean(),
});
export const topicSocialSchema = z.object({
  visits: z.number().int().nonnegative(),
  commentCount: z.number().int().nonnegative(),
  favorite: z.boolean(),
});
export const favoriteListSchema = z.object({
  items: z.array(homeTopicSchema).max(20),
  hasMore: z.boolean(),
});
