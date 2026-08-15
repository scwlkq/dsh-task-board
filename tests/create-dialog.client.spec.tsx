// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ComponentProps } from 'react'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import type { WorkspaceView } from '@deepseek-ai/dsh-client-runtime/client'
import type { TaskBoardTask, TaskBoardTaskId } from '../src/types.ts'
import { CreateTaskDialog } from '../src/client/CreateTaskDialog.tsx'
import { zh } from '../src/client/locales.ts'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

const t = makeTranslate(zh)

const workspaces = [
  {
    workspaceId: 'workspace-1' as WorkspaceView['workspaceId'],
    title: 'Harness',
    path: '/repo/harness',
    sessionIds: [],
    createdAt: '2026-08-14T00:00:00.000Z',
    updatedAt: '2026-08-14T00:00:00.000Z',
  },
  {
    workspaceId: 'workspace-2' as WorkspaceView['workspaceId'],
    title: 'Examples',
    path: '/repo/examples',
    sessionIds: [],
    createdAt: '2026-08-14T00:00:00.000Z',
    updatedAt: '2026-08-14T00:00:00.000Z',
  },
] satisfies readonly WorkspaceView[]

function createdTask(): TaskBoardTask {
  return {
    id: 'task-created' as TaskBoardTaskId,
    sequence: 1,
    identifier: 'DSH-1',
    revision: 0,
    title: 'Created',
    titleMode: 'manual',
    description: 'Requirement',
    acceptanceCriteria: '',
    status: 'initialized',
    position: 'a',
    attachments: [],
    rounds: [],
    activity: [],
    createdAt: 1,
    updatedAt: 1,
  }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, reject, resolve }
}

function mount(overrides: Partial<ComponentProps<typeof CreateTaskDialog>> = {}) {
  const props = {
    open: true,
    creating: false,
    workspaces,
    t,
    loadAgentPresets: vi.fn(async () => []),
    pickDirectory: vi.fn(async () => null),
    uploadAttachment: vi.fn(async () => ({
      ok: true as const,
      value: {
        attachmentId: 'image-1' as never,
        mediaType: 'image/png' as const,
        bytes: 3,
        width: 1,
        height: 1,
      },
    })),
    create: vi.fn(async () => ({ ok: true as const, value: createdTask() })),
    onClose: vi.fn(),
    ...overrides,
  } satisfies ComponentProps<typeof CreateTaskDialog>
  const view = render(<CreateTaskDialog {...props} />)
  return { props, view }
}

function dialog() {
  return screen.getByRole('dialog', { name: '新建任务' })
}

function addFile(file: File): void {
  fireEvent.change(within(dialog()).getByLabelText('添加参考图片'), {
    target: { files: [file] },
  })
}

function fillRequirement(value = 'Implement the task'): void {
  fireEvent.change(within(dialog()).getByLabelText('任务要求'), { target: { value } })
}

describe('CreateTaskDialog', () => {
  it('handles Preset success, failure, closed state, and stale async completions', async () => {
    const loadAgentPresets = vi.fn()
      .mockRejectedValueOnce('Preset service unavailable')
      .mockResolvedValueOnce([
        { id: 'default-id', isDefault: true },
        { id: 'named', name: 'Named', isDefault: false },
        { id: 'plain', isDefault: false },
      ])
    const mounted = mount({ open: false, loadAgentPresets })
    expect(screen.queryByRole('dialog', { name: '新建任务' })).toBeNull()
    expect(loadAgentPresets).not.toHaveBeenCalled()

    mounted.view.rerender(<CreateTaskDialog {...mounted.props} open />)
    await screen.findByText('Preset service unavailable')
    mounted.view.rerender(<CreateTaskDialog {...mounted.props} open={false} />)
    mounted.view.rerender(<CreateTaskDialog {...mounted.props} open loadAgentPresets={loadAgentPresets} />)
    await within(dialog()).findByRole('option', { name: 'Named — named' })
    expect(within(dialog()).getByRole('option', { name: 'plain' })).toBeDefined()
    expect(within(dialog()).getByRole('option', { name: '使用 Harness 默认（default-id）' })).toBeDefined()

    const failingLoader = vi.fn(async (): Promise<readonly []> => {
      throw new Error('Preset reload failed')
    })
    mounted.view.rerender(<CreateTaskDialog {...mounted.props} open={false} loadAgentPresets={failingLoader} />)
    mounted.view.rerender(<CreateTaskDialog {...mounted.props} open loadAgentPresets={failingLoader} />)
    await screen.findByText('Preset reload failed')

    fireEvent.click(within(dialog()).getByRole('tab', { name: '手动任务' }))
    fireEvent.click(within(dialog()).getByRole('tab', { name: 'Agent 任务' }))

    const pendingSuccess = deferred<readonly []>()
    const staleSuccess = mount({ loadAgentPresets: () => pendingSuccess.promise })
    staleSuccess.view.unmount()
    await act(async () => { pendingSuccess.resolve([]); await pendingSuccess.promise })

    const pendingFailure = deferred<readonly []>()
    const staleFailure = mount({ loadAgentPresets: () => pendingFailure.promise })
    staleFailure.view.unmount()
    await act(async () => {
      pendingFailure.reject(new Error('late failure'))
      await pendingFailure.promise.catch(() => undefined)
    })
  })

  it('validates requirements and locations while handling directory picker outcomes', async () => {
    const pickDirectory = vi.fn()
      .mockResolvedValueOnce(null)
      .mockRejectedValueOnce('Directory picker unavailable')
      .mockResolvedValueOnce('/tmp/picked')
      .mockRejectedValueOnce(new Error('Directory picker crashed'))
    const mounted = mount({ workspaces: [], pickDirectory })
    expect(within(dialog()).getByRole<HTMLInputElement>('radio', { name: '指定目录' }).checked).toBe(true)
    fireEvent.click(within(dialog()).getByRole('button', { name: '仅创建' }))
    expect(screen.getByRole('alert').textContent).toContain('至少填写一项')
    fillRequirement()
    fireEvent.click(within(dialog()).getByRole('button', { name: '仅创建' }))
    expect(screen.getByRole('alert').textContent).toContain('请填写工作目录')

    const pick = within(dialog()).getByRole('button', { name: '选择目录' })
    fireEvent.click(pick)
    await waitFor(() => { expect(pickDirectory).toHaveBeenCalledTimes(1) })
    expect(within(dialog()).getByLabelText<HTMLInputElement>('工作目录').value).toBe('')
    fireEvent.click(pick)
    await screen.findByText('Directory picker unavailable')
    fireEvent.click(pick)
    await waitFor(() => { expect(within(dialog()).getByLabelText<HTMLInputElement>('工作目录').value).toBe('/tmp/picked') })
    await waitFor(() => { expect(within(dialog()).getByRole<HTMLButtonElement>('button', { name: '选择目录' }).disabled).toBe(false) })
    fireEvent.click(pick)
    await screen.findByText('Directory picker crashed')
    await waitFor(() => { expect(within(dialog()).getByRole<HTMLButtonElement>('button', { name: '选择目录' }).disabled).toBe(false) })

    mounted.view.rerender(<CreateTaskDialog {...mounted.props} open workspaces={workspaces} />)
    fireEvent.click(within(dialog()).getByRole('radio', { name: 'Workspace' }))
    fireEvent.change(within(dialog()).getByRole('combobox', { name: 'Workspace' }), { target: { value: 'workspace-2' } })
    expect(within(dialog()).getByRole<HTMLSelectElement>('combobox', { name: 'Workspace' }).value).toBe('workspace-2')
    fireEvent.change(within(dialog()).getByRole('combobox', { name: 'Workspace' }), { target: { value: '' } })
    await waitFor(() => { expect(within(dialog()).getByRole<HTMLSelectElement>('combobox', { name: 'Workspace' }).value).toBe('workspace-1') })

    mounted.view.rerender(<CreateTaskDialog {...mounted.props} open workspaces={[]} />)
    await waitFor(() => { expect(within(dialog()).getByRole<HTMLInputElement>('radio', { name: '指定目录' }).checked).toBe(true) })

    mounted.view.rerender(<CreateTaskDialog {...mounted.props} open creating />)
    fireEvent.click(within(dialog()).getByRole('button', { name: '关闭新建任务' }))
    expect(mounted.props.onClose).not.toHaveBeenCalled()
    mounted.view.rerender(<CreateTaskDialog {...mounted.props} open creating={false} />)
    fireEvent.click(within(dialog()).getByRole('button', { name: '关闭新建任务' }))
    expect(mounted.props.onClose).toHaveBeenCalledOnce()
  })

  it('stages, previews, removes, and rejects attachment uploads', async () => {
    const createObjectURL = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:preview')
    const revokeObjectURL = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined)
    const uploadAttachment = vi.fn()
      .mockResolvedValueOnce({
        ok: false as const,
        error: { code: 'invalid-request' as const, field: 'attachment', message: 'Upload rejected.' },
      })
    const create = vi.fn(async () => ({ ok: true as const, value: createdTask() }))
    mount({ uploadAttachment, create })

    fireEvent.change(within(dialog()).getByLabelText('添加参考图片'), { target: { files: null } })
    addFile(new File(['text'], '', { type: 'text/plain' }))
    expect(screen.getByRole('alert').textContent).toContain('未命名图片')

    const image = new File([new Uint8Array([1, 2, 3])], 'preview.png', { type: 'image/png' })
    addFile(image)
    expect(dialog().querySelector('img[src="blob:preview"]')).not.toBeNull()
    const remove = within(dialog()).getByRole('button', { name: '移除 preview.png' })
    act(() => {
      fireEvent.click(remove)
      fireEvent.click(remove)
    })
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:preview')

    addFile(image)
    fillRequirement()
    fireEvent.click(within(dialog()).getByRole('button', { name: '仅创建' }))
    await screen.findByText('Upload rejected.')
    expect(create).not.toHaveBeenCalled()
    expect(createObjectURL).toHaveBeenCalled()
  })

  it('supports previewless unnamed files and the FileReader compatibility path', async () => {
    const createDescriptor = Object.getOwnPropertyDescriptor(URL, 'createObjectURL')
    const revokeDescriptor = Object.getOwnPropertyDescriptor(URL, 'revokeObjectURL')
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: undefined })
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: undefined })

    class SuccessfulReader extends EventTarget {
      result: string | ArrayBuffer | null = null
      error: DOMException | null = null

      readAsArrayBuffer(): void {
        this.result = new Uint8Array([1, 2, 3]).buffer
        this.dispatchEvent(new Event('load'))
      }
    }
    vi.stubGlobal('FileReader', SuccessfulReader)
    const uploadAttachment = vi.fn(async () => ({
      ok: true as const,
      value: {
        attachmentId: 'image-compat' as never,
        mediaType: 'image/png' as const,
        bytes: 3,
        width: 1,
        height: 1,
      },
    }))
    const create = vi.fn(async () => ({
      ok: false as const,
      error: { code: 'invalid-request' as const, field: 'description', message: 'Create rejected.' },
    }))
    mount({ uploadAttachment, create })
    const unnamed = new File([new Uint8Array([1, 2, 3])], '', { type: 'image/png' })
    Object.defineProperty(unnamed, 'arrayBuffer', { value: undefined })
    addFile(unnamed)
    expect(within(dialog()).getByText('IMG')).toBeDefined()
    expect(within(dialog()).getByText('未命名图片')).toBeDefined()
    fillRequirement()
    fireEvent.click(within(dialog()).getByRole('button', { name: '仅创建' }))
    await screen.findByText('Create rejected.')
    expect(uploadAttachment).toHaveBeenCalledWith({ mediaType: 'image/png', data: 'AQID' })

    cleanup()
    class NonBinaryReader extends EventTarget {
      result: string | ArrayBuffer | null = 'not binary'
      error: DOMException | null = null

      readAsArrayBuffer(): void {
        this.dispatchEvent(new Event('load'))
      }
    }
    vi.stubGlobal('FileReader', NonBinaryReader)
    mount()
    const unreadable = new File(['x'], 'unreadable.png', { type: 'image/png' })
    Object.defineProperty(unreadable, 'arrayBuffer', { value: undefined })
    addFile(unreadable)
    fillRequirement()
    fireEvent.click(within(dialog()).getByRole('button', { name: '仅创建' }))
    await screen.findByText('无法读取“unreadable.png”。')

    cleanup()
    class ErrorReader extends EventTarget {
      result: string | ArrayBuffer | null = null
      error: DOMException | null = null

      readAsArrayBuffer(): void {
        this.dispatchEvent(new Event('error'))
      }
    }
    vi.stubGlobal('FileReader', ErrorReader)
    mount()
    const errored = new File(['x'], 'errored.png', { type: 'image/png' })
    Object.defineProperty(errored, 'arrayBuffer', { value: undefined })
    addFile(errored)
    fillRequirement()
    fireEvent.click(within(dialog()).getByRole('button', { name: '仅创建' }))
    await screen.findByText('无法读取“errored.png”。')

    if (createDescriptor === undefined) delete (URL as { createObjectURL?: unknown }).createObjectURL
    else Object.defineProperty(URL, 'createObjectURL', createDescriptor)
    if (revokeDescriptor === undefined) delete (URL as { revokeObjectURL?: unknown }).revokeObjectURL
    else Object.defineProperty(URL, 'revokeObjectURL', revokeDescriptor)
  })
})
