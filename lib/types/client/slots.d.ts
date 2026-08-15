/**
 * Slot props and injected business face for the task-board surface.
 * @module @deepseek-ai/dsh-client-ui-task-board/client/slots
 */
import type { SessionId } from '@deepseek-ai/dsh-client-runtime/client';
import type { ImageAttachmentRef } from '@deepseek-ai/dsh-attachment';
import type { HostObservable, InjectFace, PropsLocale, PropsRuntime, PropsStore } from '@deepseek-ai/dsh-client-ui-slots';
import type { TaskBoardCreateRequest, TaskBoardAttachmentUploadRequest, TaskBoardDeleteValue, TaskBoardEditPatch, TaskBoardRound, TaskBoardTask, TaskBoardTaskId } from '../types.ts';
import type { TaskBoardClientResult, TaskBoardClientView } from './controller.ts';
import type { createTaskBoardStore } from './store.ts';
import type { NS } from './locales.ts';
import type { TaskBoardRoundHistory } from './history.ts';
/** One healthy Agent Preset offered for a new task Session. */
export interface TaskBoardAgentPresetOption {
    readonly id: string;
    readonly name?: string;
    readonly description?: string;
    readonly isDefault: boolean;
}
/** Business callbacks and authoritative observable shared by both entries. */
export interface TaskBoardInjected {
    hooks: {
        /** Authoritative task projection synchronized from the Host Remote. */
        board: HostObservable<TaskBoardClientView>;
    };
    refresh: () => Promise<TaskBoardClientResult<readonly TaskBoardTask[]>>;
    loadAgentPresets: () => Promise<readonly TaskBoardAgentPresetOption[]>;
    pickDirectory: () => Promise<string | null>;
    uploadAttachment: (request: TaskBoardAttachmentUploadRequest) => Promise<TaskBoardClientResult<ImageAttachmentRef>>;
    create: (request: TaskBoardCreateRequest) => Promise<TaskBoardClientResult<TaskBoardTask>>;
    edit: (taskId: TaskBoardTaskId, patch: TaskBoardEditPatch) => Promise<TaskBoardClientResult<TaskBoardTask>>;
    reorder: (taskId: TaskBoardTaskId, beforeTaskId?: TaskBoardTaskId) => Promise<TaskBoardClientResult<TaskBoardTask>>;
    start: (taskId: TaskBoardTaskId) => Promise<TaskBoardClientResult<TaskBoardTask>>;
    followup: (taskId: TaskBoardTaskId, text: string) => Promise<TaskBoardClientResult<TaskBoardTask>>;
    approve: (taskId: TaskBoardTaskId) => Promise<TaskBoardClientResult<TaskBoardTask>>;
    reject: (taskId: TaskBoardTaskId, feedback: string) => Promise<TaskBoardClientResult<TaskBoardTask>>;
    retry: (taskId: TaskBoardTaskId, allowFreshSession: boolean) => Promise<TaskBoardClientResult<TaskBoardTask>>;
    stop: (taskId: TaskBoardTaskId) => Promise<TaskBoardClientResult<TaskBoardTask>>;
    reopen: (taskId: TaskBoardTaskId) => Promise<TaskBoardClientResult<TaskBoardTask>>;
    delete: (taskId: TaskBoardTaskId) => Promise<TaskBoardClientResult<TaskBoardDeleteValue>>;
    loadRoundHistory: (round: TaskBoardRound, signal?: AbortSignal) => Promise<TaskBoardRoundHistory>;
    openSession: (sessionId: SessionId) => void;
}
/** Sidebar footer launcher props. */
export type TaskBoardLauncherProps = PropsRuntime<'sidebar.footer.action'> & PropsStore<ReturnType<typeof createTaskBoardStore>> & InjectFace<TaskBoardInjected> & PropsLocale<typeof NS>;
/** Frame overlay props. */
export type TaskBoardOverlayProps = PropsRuntime<'shell.overlay'> & PropsStore<ReturnType<typeof createTaskBoardStore>> & InjectFace<TaskBoardInjected> & PropsLocale<typeof NS>;
