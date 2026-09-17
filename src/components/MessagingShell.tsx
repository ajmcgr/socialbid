import { Link } from "@tanstack/react-router";
import { type InboxConversation, type InboxNotification } from "@/lib/inbox.functions";

export function MessagingSignIn() {
  return (
    <div className="panel mt-8 px-5 py-6">
      <h2 className="text-lg font-extrabold">Sign in to SocialBid</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        Use X, Google, or email to open the same Inbox for creators you sponsor and sponsors who
        back you.
      </p>
      <Link to="/auth" search={{ next: "/inbox" }} className="btn-ink btn-ink-hover mt-4">
        Sign in
      </Link>
    </div>
  );
}

export function ConversationSummary({ conversation }: { conversation: InboxConversation }) {
  return (
    <>
      <div className="flex items-center gap-3">
        {conversation.counterpartAvatarUrl ? (
          <img
            src={conversation.counterpartAvatarUrl}
            alt=""
            className="size-10 shrink-0 rounded-full object-cover"
          />
        ) : (
          <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-secondary font-bold">
            {conversation.counterpartName.slice(0, 1).toUpperCase()}
          </span>
        )}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate font-extrabold">{conversation.counterpartName}</span>
            {conversation.unreadCount ? (
              <span className="rounded-full bg-primary px-2 py-0.5 text-[10px] font-bold text-primary-foreground">
                {conversation.unreadCount}
              </span>
            ) : null}
          </div>
          {conversation.counterpartHandle ? (
            <div className="font-mono text-xs text-muted-foreground">
              @{conversation.counterpartHandle}
            </div>
          ) : null}
        </div>
      </div>
      <p className="mt-2 truncate text-sm text-muted-foreground">
        {conversation.lastMessage ?? "Messaging unlocked — start the conversation."}
      </p>
      <div className="mt-2 flex items-center justify-between font-mono text-[10px] text-muted-foreground">
        <span>{conversation.relationshipLabel}</span>
        {conversation.lastMessageAt ? (
          <time dateTime={conversation.lastMessageAt}>
            {new Date(conversation.lastMessageAt).toLocaleDateString()}
          </time>
        ) : null}
      </div>
    </>
  );
}

export function NotificationItem({
  notification,
  onRead,
}: {
  notification: InboxNotification;
  onRead?: (() => void) | undefined;
}) {
  const content = (
    <div className={notification.readAt ? "opacity-70" : ""}>
      <div className="flex items-start justify-between gap-4">
        <h2 className="font-extrabold">{notification.title}</h2>
        {!notification.readAt ? <span className="mt-1 size-2 rounded-full bg-primary" /> : null}
      </div>
      <p className="mt-1 text-sm text-muted-foreground">{notification.body}</p>
      <time className="mt-2 block font-mono text-[10px] text-muted-foreground">
        {new Date(notification.createdAt).toLocaleString()}
      </time>
    </div>
  );
  return notification.conversationId ? (
    <Link
      to="/inbox"
      search={{ conversation: notification.conversationId }}
      onClick={onRead}
      className="block"
    >
      {content}
    </Link>
  ) : (
    content
  );
}
