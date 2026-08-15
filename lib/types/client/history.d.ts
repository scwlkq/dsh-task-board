/**
 * Bounded Session-history projection for one task execution round.
 * @module @deepseek-ai/dsh-client-ui-task-board/client/history
 */
import type { HistoryEntry, IApiClient } from '@deepseek-ai/dsh-client-connection/client';
import type { TaskBoardRound } from '../types.ts';
/** Raw non-stream event retained with any Host render intent. */
export interface TaskBoardHistoryEventRow {
    readonly kind: 'event';
    readonly entry: HistoryEntry;
}
/** Adjacent assistant chunks coalesced into one readable stream row. */
export interface TaskBoardHistoryAssistantRow {
    readonly kind: 'assistant-stream';
    readonly turn: number;
    readonly step: number;
    readonly startSeq: number;
    readonly endSeq: number;
    readonly time: number;
    readonly reasoning: string;
    readonly text: string;
    readonly entries: readonly HistoryEntry[];
}
/** One execution-log presentation row. */
export type TaskBoardHistoryRow = TaskBoardHistoryEventRow | TaskBoardHistoryAssistantRow;
/** Completed bounded projection for one task execution round. */
export interface TaskBoardRoundHistory {
    readonly rows: readonly TaskBoardHistoryRow[];
    readonly startSeq: number | undefined;
    readonly endSeq: number | undefined;
    readonly truncated: boolean;
}
/** Pagination and memory bounds for execution-log reads. */
export interface TaskBoardHistoryOptions {
    readonly pageSize?: number;
    readonly maxEvents?: number;
}
/** Minimal Client API surface required to page one Session history. */
export interface TaskBoardHistoryApi {
    readonly sessions: Pick<IApiClient['sessions'], 'history'>;
}
/**
 * Read Session history backward until the round interval is covered.
 * @param api - Client API face used only for `session.history`.
 * @param round - durable task execution round carrying Session and seq bounds.
 * @param signal - optional cancellation signal for dialog teardown.
 * @param options - page and retained-event bounds.
 * @returns oldest-first rows restricted to the round interval.
 */
export declare function loadRoundHistory(api: TaskBoardHistoryApi, round: TaskBoardRound, signal?: AbortSignal, options?: TaskBoardHistoryOptions): Promise<TaskBoardRoundHistory>;
