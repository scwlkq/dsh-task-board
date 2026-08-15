import taskBoardRemote from 'dsh-task-board/remote';
/**
 * Mount this package's generated Remote contribution.
 * @param remote - Client Remote service provided by DSH API Gateway.
 * @returns disposer removing the Task Board namespace.
 */
export function mountTaskBoardRemote(remote) {
    return remote.$mount(taskBoardRemote);
}
