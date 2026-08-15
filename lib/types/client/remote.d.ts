/** Package-owned Task Board Remote contribution mount. */
import type { TypertClientRemote, TypertDisposer } from '@deepseek-ai/dsh-typert-protocol';
/** Remote service subset required during Client activation. */
export interface TaskBoardRemoteMount {
    /**
     * Mount one generated Remote contribution.
     * @param contribution - Task Board descriptors bundled with this package.
     * @returns disposer removing all mounted namespaces.
     */
    $mount: TypertClientRemote['$mount'];
}
/**
 * Mount this package's generated Remote contribution.
 * @param remote - Client Remote service provided by DSH API Gateway.
 * @returns disposer removing the Task Board namespace.
 */
export declare function mountTaskBoardRemote(remote: TaskBoardRemoteMount): Promise<TypertDisposer>;
