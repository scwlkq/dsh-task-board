/** Single-entry Host composition for the Task Board community bundle. */
import type { Context } from '@deepseek-ai/cordis';
import { type Config as TaskBoardConfig } from './host/service.ts';
export type * from './types.ts';
export { TaskBoardService } from './host/service.ts';
export { TaskBoardSessionGateway } from './host/session.ts';
export type * from './host/session-types.ts';
/** Loader configuration shared with the Task Board service. */
export type Config = TaskBoardConfig;
/** Loader schema shared with the Task Board service. */
export declare const Config: import("@deepseek-ai/schemastery").default<TaskBoardConfig>;
/** Cordis subset required by the owned Host composition. */
export type TaskBoardCompositionContext = Pick<Context, 'plugin'>;
/**
 * Mount the Session provider before the Task Board authority.
 * @param ctx - Host context used to mount both owned plugins.
 * @param config - Validated Task Board text limits.
 * @returns Async disposer sequence owned by the root plugin effect.
 */
export declare function createTaskBoardComposition(ctx: TaskBoardCompositionContext, config: Config): AsyncGenerator<() => void | Promise<void>, void>;
/**
 * Activate the single Loader entry and own both Host plugins.
 * @param ctx - Host Cordis context.
 * @param config - Validated Task Board text limits.
 */
export declare function apply(ctx: Context, config: Config): Promise<void>;
