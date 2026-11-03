import type { Context } from '@deepseek-ai/cordis'
import TRAIN_REMOTE from '@local/dsh-train-core/remote'
import { WritingWorkbench } from './Workbench.js'
import type { ClientRemoteLike, SlotsLike } from './remote.js'

export const name = 'train-writing'
export const inject = ['slots', 'remote']

/** Register the full-width answer view and mount the `train` Remote namespace. */
export async function apply(ctx: Context): Promise<void> {
  const remote = (ctx as unknown as { remote: ClientRemoteLike }).remote
  const dispose = await remote.$mount(TRAIN_REMOTE)
  const lifecycle = ctx as unknown as { effect(execute: () => () => void, label?: string): unknown }
  lifecycle.effect(() => () => {
    void dispose()
  })

  const slots = (ctx as unknown as { slots: SlotsLike }).slots
  slots.inject('conversation.view', () =>
    slots.register(
      { name: 'conversation.view', id: 'train-writing', order: 100, label: () => '答题' },
      (props: { sessionId: string }) => <WritingWorkbench sessionId={props.sessionId} remote={remote.train} />,
    ),
  )
}
