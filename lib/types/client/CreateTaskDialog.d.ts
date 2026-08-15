/** Agent-first task creation flow. */
import type { WorkspaceView } from '@deepseek-ai/dsh-client-runtime/client';
import type { ImageAttachmentRef } from '@deepseek-ai/dsh-attachment';
import type { TaskBoardAttachmentUploadRequest, TaskBoardCreateRequest, TaskBoardTask } from '../types.ts';
import { type TaskBoardClientResult } from './controller.ts';
import type { TaskBoardAgentPresetOption, TaskBoardOverlayProps } from './slots.ts';
interface CreateTaskDialogProps {
    readonly open: boolean;
    readonly creating: boolean;
    readonly workspaces: readonly WorkspaceView[];
    readonly t: TaskBoardOverlayProps['t'];
    readonly loadAgentPresets: () => Promise<readonly TaskBoardAgentPresetOption[]>;
    readonly pickDirectory: () => Promise<string | null>;
    readonly uploadAttachment: (request: TaskBoardAttachmentUploadRequest) => Promise<TaskBoardClientResult<ImageAttachmentRef>>;
    readonly create: (request: TaskBoardCreateRequest) => Promise<TaskBoardClientResult<TaskBoardTask>>;
    readonly onClose: () => void;
}
/**
 * Create one persistent task card and optionally start execution immediately.
 * @param props - visibility, Harness selectors, attachment uploader, and Host create action.
 * @returns controlled creation modal.
 */
export declare function CreateTaskDialog({ open, creating, workspaces, t, loadAgentPresets, pickDirectory, uploadAttachment, create, onClose, }: CreateTaskDialogProps): import("react").JSX.Element;
export {};
