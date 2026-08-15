/** Full-frame task-board overlay shell. */
import type { TaskBoardOverlayProps } from './slots.ts';
/**
 * Render the root task-board surface while its shared store is open.
 * @param props - slot runtime, shared store, and Host-backed task projection.
 * @returns full-frame overlay or null while closed.
 */
export declare function TaskBoardOverlay({ useStore, actions, useBoard, refresh, loadAgentPresets, pickDirectory, uploadAttachment, create, edit, reorder, start, followup, approve, reject, retry, stop, reopen, delete: deleteTask, openSession, loadRoundHistory, useWorkspaces, t, }: TaskBoardOverlayProps): import("react").JSX.Element | null;
