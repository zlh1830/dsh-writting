import type { Context } from '@deepseek-ai/cordis'
import TRAIN_REMOTE from '@local/dsh-train-core/remote'
import { WritingWorkbench } from './Workbench.js'
import type { ClientRemoteLike, SlotsLike, TrainRemoteNamespace } from './remote.js'

export const name = 'train-writing'
export const inject = ['slots', 'remote']

interface ClientContext extends Context {
  remote: ClientRemoteLike & { train: TrainRemoteNamespace }
  slots: SlotsLike
}

/**
 * Register the full-width answer view and mount the `train` Remote namespace.
 *
 * The namespace is a traced `remote.<namespace>` child service, so reading
 * `ctx.remote.train` requires `remote.train` in the reading fiber's inject list.
 * This plugin mounts the namespace itself, so declaring it as a top-level
 * inject would deadlock activation; a nested `ctx.inject` runs once the mount
 * has provided the service.
 */
export async function apply(ctx: Context): Promise<void> {
  const client = ctx as unknown as ClientContext
  const dispose = await client.remote.$mount(TRAIN_REMOTE)
  const lifecycle = ctx as unknown as { effect(execute: () => () => void, label?: string): unknown }
  lifecycle.effect(() => () => {
    void dispose()
  })

  const inject = (ctx as unknown as { inject(deps: string[], callback: (ctx: Context) => void): unknown }).inject
  inject.call(ctx, ['slots', 'remote.train'], (scoped: Context) => {
    const child = scoped as unknown as ClientContext
    const train = child.remote.train
    const slots = child.slots
    slots.inject('conversation.view', () =>
      slots.register(
        { name: 'conversation.view', id: 'train-writing', order: 100, label: () => '答题' },
        (props: { sessionId: string }) => <WritingWorkbench sessionId={props.sessionId} remote={train} />,
      ),
    )
  })
}
