/** Durable task-board Storage Domain declaration. @module @deepseek-ai/dsh-task-board/src/spec */
import { z } from 'zod';
import type { TaskBoardActivity, TaskBoardFailure, TaskBoardRound, TaskBoardRoundPrompt, TaskBoardTask, TaskBoardTaskId } from '../types.ts';
/** Stable user-safe failure persisted with a task or terminal round. */
export declare const taskBoardFailureSchema: z.ZodType<TaskBoardFailure>;
/** Durable board-originated prompt metadata. */
export declare const taskBoardRoundPromptSchema: z.ZodType<TaskBoardRoundPrompt>;
/** Durable execution-round metadata linked to one Harness Session. */
export declare const taskBoardRoundSchema: z.ZodType<TaskBoardRound>;
/** Append-only task workflow history entry. */
export declare const taskBoardActivitySchema: z.ZodType<TaskBoardActivity>;
/** Durable task card validator used on every Storage Domain read and write. */
export declare const taskBoardTaskSchema: z.ZodType<TaskBoardTask>;
/** Durable task-board singleton allocator and synchronization record. */
export declare const taskBoardGlobalSchema: z.ZodObject<{
    nextSequence: z.ZodNumber;
    boardRevision: z.ZodNumber;
}, z.core.$strip>;
/** Durable task-board singleton allocator and synchronization value. */
export type TaskBoardGlobal = z.infer<typeof taskBoardGlobalSchema>;
/** Task-board Storage Domain version zero with one task table. */
export declare const taskBoardDomainSpec: {
    name: string;
    version: number;
    global: {
        schema: z.ZodObject<{
            nextSequence: z.ZodNumber;
            boardRevision: z.ZodNumber;
        }, z.core.$strip>;
        initial: {
            nextSequence: number;
            boardRevision: number;
        };
    };
    tables: {
        tasks: import("@deepseek-ai/dsh-storage-domain").DomainTableSpec<TaskBoardTaskId, TaskBoardTask>;
    };
};
