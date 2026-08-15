/** Durable task-board Storage Domain declaration. @module @deepseek-ai/dsh-task-board/src/spec */
import { z } from 'zod';
import { domainTable, defineDomain } from '@deepseek-ai/dsh-storage-domain';
const nonNegativeInteger = z.number().int().nonnegative();
const positiveInteger = z.number().int().positive();
const taskIdSchema = z.string().min(1).transform(value => value);
const roundIdSchema = z.string().min(1).transform(value => value);
const promptIdSchema = z.string().min(1).transform(value => value);
const activityIdSchema = z.string().min(1).transform(value => value);
const sessionIdSchema = z.string().min(1);
const workspaceIdSchema = z.string().min(1);
const rpcIdSchema = z.string().min(1);
const imageAttachmentRefSchema = z.object({
    attachmentId: z.string().min(1),
    mediaType: z.enum(['image/png', 'image/jpeg', 'image/webp', 'image/gif']),
    bytes: positiveInteger,
    width: positiveInteger,
    height: positiveInteger,
    name: z.string().optional(),
});
const taskBoardStatusSchema = z.enum(['initialized', 'running', 'review', 'done', 'failed']);
const roundTriggerSchema = z.enum(['initial', 'revision', 'retry']);
/** Stable user-safe failure persisted with a task or terminal round. */
export const taskBoardFailureSchema = z.object({
    stage: z.enum(['session-create', 'prompt-admission', 'execution', 'recovery']),
    code: z.string().min(1),
    message: z.string().min(1),
    turn: positiveInteger.optional(),
    seq: nonNegativeInteger.optional(),
});
/** Durable board-originated prompt metadata. */
export const taskBoardRoundPromptSchema = z.object({
    id: promptIdSchema,
    rpcId: rpcIdSchema,
    kind: z.enum(['initial', 'feedback', 'followup', 'retry-continuation']),
    text: z.string(),
    acceptedAt: nonNegativeInteger,
    messageSeq: nonNegativeInteger.optional(),
    turn: positiveInteger.optional(),
    turnEndSeq: nonNegativeInteger.optional(),
});
/** Durable execution-round metadata linked to one Harness Session. */
export const taskBoardRoundSchema = z.object({
    id: roundIdSchema,
    ordinal: positiveInteger,
    trigger: roundTriggerSchema,
    status: z.enum(['starting', 'running', 'completed', 'failed', 'cancelled']),
    originStatus: z.enum(['initialized', 'review', 'failed']),
    sessionId: sessionIdSchema,
    prompts: z.array(taskBoardRoundPromptSchema),
    startSeq: nonNegativeInteger.optional(),
    endSeq: nonNegativeInteger.optional(),
    startedAt: nonNegativeInteger,
    endedAt: nonNegativeInteger.optional(),
    feedback: z.string().optional(),
    failure: taskBoardFailureSchema.optional(),
});
const activityBase = {
    id: activityIdSchema,
    at: nonNegativeInteger,
    actor: z.enum(['user', 'agent', 'system']),
};
/** Append-only task workflow history entry. */
export const taskBoardActivitySchema = z.discriminatedUnion('operation', [
    z.object({ ...activityBase, operation: z.literal('created') }),
    z.object({
        ...activityBase,
        operation: z.literal('edited'),
        fields: z.array(z.enum([
            'title',
            'description',
            'acceptanceCriteria',
            'workspaceId',
            'cwd',
            'agentPreset',
            'attachments',
        ])),
    }),
    z.object({
        ...activityBase,
        operation: z.literal('started'),
        roundId: roundIdSchema,
        trigger: roundTriggerSchema,
    }),
    z.object({
        ...activityBase,
        operation: z.literal('followup'),
        roundId: roundIdSchema,
        promptId: promptIdSchema,
    }),
    z.object({
        ...activityBase,
        operation: z.literal('transition'),
        from: taskBoardStatusSchema,
        to: taskBoardStatusSchema,
    }),
    z.object({ ...activityBase, operation: z.literal('approved') }),
    z.object({
        ...activityBase,
        operation: z.literal('rejected'),
        roundId: roundIdSchema,
        feedback: z.string().min(1),
    }),
    z.object({
        ...activityBase,
        operation: z.literal('failed'),
        roundId: roundIdSchema,
        failure: taskBoardFailureSchema,
    }),
    z.object({
        ...activityBase,
        operation: z.literal('retried'),
        roundId: roundIdSchema,
    }),
    z.object({ ...activityBase, operation: z.literal('reopened') }),
    z.object({
        ...activityBase,
        operation: z.literal('automatic-title'),
        title: z.string(),
    }),
    z.object({
        ...activityBase,
        operation: z.literal('stopped'),
        roundId: roundIdSchema,
    }),
]);
/** Durable task card validator used on every Storage Domain read and write. */
export const taskBoardTaskSchema = z.object({
    id: taskIdSchema,
    sequence: positiveInteger,
    identifier: z.string().min(1),
    revision: nonNegativeInteger,
    title: z.string(),
    titleMode: z.enum(['automatic', 'manual']),
    description: z.string(),
    acceptanceCriteria: z.string(),
    status: taskBoardStatusSchema,
    position: z.string().min(1),
    workspaceId: workspaceIdSchema.optional(),
    cwd: z.string().optional(),
    agentPreset: z.string().optional(),
    attachments: z.array(imageAttachmentRefSchema),
    currentSessionId: sessionIdSchema.optional(),
    rounds: z.array(taskBoardRoundSchema),
    activity: z.array(taskBoardActivitySchema),
    lastStartFailure: taskBoardFailureSchema.optional(),
    createdAt: nonNegativeInteger,
    updatedAt: nonNegativeInteger,
    completedAt: nonNegativeInteger.optional(),
}).superRefine((task, context) => {
    if (task.workspaceId !== undefined && task.cwd !== undefined) {
        context.addIssue({
            code: 'custom',
            message: 'task may select a Workspace or cwd, not both',
            path: ['cwd'],
        });
    }
});
/** Durable task-board singleton allocator and synchronization record. */
export const taskBoardGlobalSchema = z.object({
    nextSequence: positiveInteger,
    boardRevision: nonNegativeInteger,
});
/** Task-board Storage Domain version zero with one task table. */
export const taskBoardDomainSpec = defineDomain({
    name: 'task_board',
    version: 0,
    global: {
        schema: taskBoardGlobalSchema,
        initial: { nextSequence: 1, boardRevision: 0 },
    },
    tables: {
        tasks: domainTable(taskBoardTaskSchema),
    },
});
