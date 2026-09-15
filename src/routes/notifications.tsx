import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { markNotificationsRead } from "@/lib/inbox.functions";
import { MessagingSignIn, NotificationItem, RoleSwitcher } from "@/components/MessagingShell";
import { useMessagingContext } from "@/hooks/useMessagingContext";

export const Route = createFileRoute("/notifications")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Notifications — SocialBid" },
      { name: "description", content: "SocialBid sponsorship and message notifications." },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: NotificationsPage,
});

function NotificationsPage() {
  const { context, token, actorKind, error, refresh, setActorKind } = useMessagingContext();
  const markRead = useServerFn(markNotificationsRead);

  async function markAllRead() {
    if (!actorKind) return;
    await markRead({ data: { token, actorKind } });
    await refresh();
  }

  async function markOneRead(notificationId: string) {
    if (!actorKind) return;
    await markRead({ data: { token, actorKind, notificationId } });
  }

  return (
    <main className="mx-auto max-w-3xl px-5 py-12">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="label-xs">Updates</p>
          <h1 className="mt-1 text-4xl font-extrabold">Notifications</h1>
        </div>
        <Link to="/inbox" className="btn-outline-ink">
          Inbox
        </Link>
      </div>
      {error ? <p className="mt-6 text-sm text-destructive">{error}</p> : null}
      {!context ? <p className="mt-8 text-muted-foreground">Loading notifications…</p> : null}
      {context && !context.actor ? <MessagingSignIn /> : null}
      {context?.actor ? (
        <>
          <RoleSwitcher
            kinds={context.availableKinds}
            active={context.actor.kind}
            onChange={(kind) => void setActorKind(kind)}
          />
          <div className="mt-6 flex justify-end">
            {context.unreadNotifications ? (
              <button
                type="button"
                onClick={() => void markAllRead()}
                className="text-sm underline"
              >
                Mark all read
              </button>
            ) : null}
          </div>
          <div className="panel mt-3 divide-y-2 divide-border">
            {!context.notifications.length ? (
              <p className="px-5 py-10 text-center text-sm text-muted-foreground">
                No notifications yet.
              </p>
            ) : null}
            {context.notifications.map((notification) => (
              <div key={notification.id} className="px-5 py-4">
                <NotificationItem
                  notification={notification}
                  onRead={notification.readAt ? undefined : () => void markOneRead(notification.id)}
                />
              </div>
            ))}
          </div>
        </>
      ) : null}
    </main>
  );
}
