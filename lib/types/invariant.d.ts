/** Package-owned task, round, Session, and event invariants. @module @deepseek-ai/dsh-task-board/invariant */
import type { Context } from '@deepseek-ai/cordis';
/** Cordis companion plugin name. */
export declare const name = "task-board-invariant";
/** Invariant registry must exist before this companion registers. */
export declare const inject: string[];
/**
 * Register the task-board package invariant companion.
 * @param ctx - Cordis context carrying the invariant registry.
 * @returns Installed registration disposer after setup succeeds.
 */
export declare const apply: (ctx: Context) => Promise<() => void>;
