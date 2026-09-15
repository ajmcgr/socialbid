import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useMemo, useState } from "react";
import { z } from "zod";
import {
  getConversationMessages,
  reportConversation,
  sendInboxMessage,
  setConversationBlocked,
  type InboxMessage,
} from "@/lib/inbox.functions";
import { ConversationSummary, MessagingSignIn, RoleSwitcher } from "@/components/MessagingShell";
import { useMessagingContext } from "@/hooks/useMessagingContext";

export const Route = createFileRoute("/inbox")({
  ssr: false,
  validateSearch: z.object({ conversation: z.string().uuid().optional().catch(undefined) }),
  head: () => ({
    meta: [
      { title: "Inbox — SocialBid" },
      { name: "description", content: "Message creators and sponsors you have connected with." },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: InboxPage,
});

function InboxPage() {
  const { conversation: searchedConversation } = Route.useSearch();
  const navigate = useNavigate();
  const { context, token, actorKind, error, refresh, setActorKind } = useMessagingContext();
  const getMessages = useServerFn(getConversationMessages);
  const send = useServerFn(sendInboxMessage);
  const setBlocked = useServerFn(setConversationBlocked);
  const report = useServerFn(reportConversation);
  const [messages, setMessages] = useState<InboxMessage[]>([]);
  const [blocked, setBlockedState] = useState(false);
  const [busy, setBusy] = useState(false);
  const [actionMessage, setActionMessage] = useState<string | null>(null);

  const selectedId = useMemo(() => {
    if (
      searchedConversation &&
      context?.conversations.some((row) => row.id === searchedConversation)
    )
      return searchedConversation;
    return context?.conversations[0]?.id ?? null;
  }, [context?.conversations, searchedConversation]);
  const selected = context?.conversations.find((row) => row.id === selectedId) ?? null;

  useEffect(() => {
    let active = true;
    if (!selectedId || !actorKind) {
      setMessages([]);
      return;
    }
    void getMessages({
      data: { token, actorKind, conversationId: selectedId },
    }).then((result) => {
      if (!active) return;
      if ("error" in result) setActionMessage(result.error);
      else {
        setMessages(result.messages);
        setBlockedState(result.blocked);
      }
    });
    return () => {
      active = false;
    };
  }, [actorKind, getMessages, selectedId, token]);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedId || !actorKind || busy) return;
    const form = event.currentTarget;
    const body = String(new FormData(form).get("message") ?? "").trim();
    if (!body) return;
    setBusy(true);
    setActionMessage(null);
    const result = await send({ data: { token, actorKind, conversationId: selectedId, body } });
    setBusy(false);
    if ("error" in result) setActionMessage(result.error);
    else {
      form.reset();
      setMessages((current) => [...current, result.message]);
      await refresh();
    }
  }

  async function toggleBlock() {
    if (!selectedId || !actorKind) return;
    const result = await setBlocked({
      data: { token, actorKind, conversationId: selectedId, blocked: !blocked },
    });
    if ("error" in result) setActionMessage(result.error);
    else {
      setBlockedState(!blocked);
      await refresh();
    }
  }

  async function submitReport() {
    if (!selectedId || !actorKind) return;
    const reason = window.prompt("What should we review? (optional)") ?? undefined;
    if (reason === undefined) return;
    const result = await report({ data: { token, actorKind, conversationId: selectedId, reason } });
    setActionMessage("error" in result ? result.error : "Report submitted.");
  }

  return (
    <main className="mx-auto max-w-6xl px-5 py-12">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="label-xs">Sponsorship connections</p>
          <h1 className="mt-1 text-4xl font-extrabold">Inbox</h1>
        </div>
        <a href="/notifications" className="btn-outline-ink">
          Notifications{context?.unreadNotifications ? ` (${context.unreadNotifications})` : ""}
        </a>
      </div>
      {error ? <p className="mt-6 text-sm text-destructive">{error}</p> : null}
      {!context ? <p className="mt-8 text-muted-foreground">Loading inbox…</p> : null}
      {context && !context.actor ? <MessagingSignIn /> : null}
      {context?.actor ? (
        <>
          <RoleSwitcher
            kinds={context.availableKinds}
            active={context.actor.kind}
            onChange={(kind) => void setActorKind(kind)}
          />
          {!context.conversations.length ? (
            <div className="panel mt-8 px-5 py-10 text-center">
              <h2 className="text-xl font-extrabold">No sponsorship connections yet</h2>
              <p className="mt-2 text-sm text-muted-foreground">
                A successful sponsorship permanently unlocks a conversation here.
              </p>
            </div>
          ) : (
            <div className="panel mt-8 grid min-h-[34rem] md:grid-cols-[20rem_1fr]">
              <div className="divide-y-2 divide-border border-b-2 border-border md:border-r-2 md:border-b-0">
                {context.conversations.map((conversation) => (
                  <button
                    key={conversation.id}
                    type="button"
                    onClick={() =>
                      void navigate({
                        to: "/inbox",
                        search: { conversation: conversation.id },
                        replace: true,
                      })
                    }
                    className={`block w-full px-4 py-4 text-left ${conversation.id === selectedId ? "bg-secondary" : "hover:bg-muted"}`}
                  >
                    <ConversationSummary conversation={conversation} />
                  </button>
                ))}
              </div>
              {selected ? (
                <section className="flex min-w-0 flex-col">
                  <header className="flex flex-wrap items-center justify-between gap-3 border-b-2 border-border px-5 py-4">
                    <div>
                      <h2 className="font-extrabold">{selected.counterpartName}</h2>
                      <p className="font-mono text-[10px] text-muted-foreground">
                        {selected.isCurrentSponsor
                          ? "Current sponsor"
                          : "Permanent sponsor connection"}
                      </p>
                    </div>
                    <div className="flex gap-3 text-xs">
                      <button
                        type="button"
                        onClick={() => void submitReport()}
                        className="underline"
                      >
                        Report
                      </button>
                      <button
                        type="button"
                        onClick={() => void toggleBlock()}
                        className="underline"
                      >
                        {blocked ? "Unblock" : "Block"}
                      </button>
                    </div>
                  </header>
                  <div className="flex-1 space-y-3 overflow-y-auto px-5 py-5">
                    {!messages.length ? (
                      <p className="text-sm text-muted-foreground">
                        Your connection is open. Either of you can send the first message.
                      </p>
                    ) : null}
                    {messages.map((message) => {
                      const mine = message.senderKind === context.actor?.kind;
                      return (
                        <div
                          key={message.id}
                          className={mine ? "ml-auto max-w-[85%]" : "max-w-[85%]"}
                        >
                          <div
                            className={
                              mine ? "bg-primary p-3 text-primary-foreground" : "bg-secondary p-3"
                            }
                          >
                            <p className="whitespace-pre-wrap text-sm">{message.body}</p>
                          </div>
                          <time className="mt-1 block font-mono text-[9px] text-muted-foreground">
                            {new Date(message.createdAt).toLocaleString()}
                          </time>
                        </div>
                      );
                    })}
                  </div>
                  <form onSubmit={submit} className="border-t-2 border-border p-4">
                    <label htmlFor="inbox-message" className="sr-only">
                      Message
                    </label>
                    <div className="flex gap-2">
                      <textarea
                        id="inbox-message"
                        name="message"
                        rows={2}
                        maxLength={2000}
                        required
                        disabled={blocked || busy}
                        className="field min-h-16 flex-1 resize-y"
                        placeholder={blocked ? "Messaging is blocked" : "Write a message"}
                      />
                      <button
                        disabled={blocked || busy}
                        className="btn-ink btn-ink-hover self-end disabled:opacity-40"
                      >
                        {busy ? "Sending…" : "Send"}
                      </button>
                    </div>
                    {actionMessage ? (
                      <p className="mt-2 text-xs text-muted-foreground">{actionMessage}</p>
                    ) : null}
                  </form>
                </section>
              ) : null}
            </div>
          )}
        </>
      ) : null}
    </main>
  );
}
