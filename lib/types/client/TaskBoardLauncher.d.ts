/** Sidebar task-board launcher. */
import type { TaskBoardLauncherProps } from './slots.ts';
/**
 * Open the task board from the wide sidebar or collapsed rail.
 * @param props - slot runtime, shared store, and task-board hook.
 * @returns launcher button with active-agent count.
 */
export declare function TaskBoardLauncher({ wide, useStore, actions, useBoard, refresh, t, }: TaskBoardLauncherProps): import("react").JSX.Element;
