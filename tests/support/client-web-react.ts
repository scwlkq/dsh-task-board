import { useSyncExternalStore } from 'react'
import type { ObservableSnapshot } from './client-runtime.ts'

export function bindSnapshotSelector<State>(observable: ObservableSnapshot<State>) {
  return function useSnapshotSelector<Selected>(selector: (state: State) => Selected): Selected {
    return useSyncExternalStore(
      observable.subscribe,
      () => selector(observable.getSnapshot()),
      () => selector(observable.getSnapshot()),
    )
  }
}
