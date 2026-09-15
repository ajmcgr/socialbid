import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { FileText, Paperclip, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { z } from "zod";
import {
  cancelAttachmentUpload,
  createAttachmentUpload,
  getAttachmentDownloadUrl,
  getConversationMessages,
  reportConversation,
  sendInboxMessage,
  setConversationBlocked,
  setConversationReadState,
  type InboxMessage,
} from "@/lib/inbox.functions";
import { ConversationSummary, MessagingSignIn } from "@/components/MessagingShell";
import { useMessagingContext } from "@/hooks/useMessagingContext";
import { getSupabase } from "@/integrations/supabase/browser";
import { completeBuyerRecovery, requestBuyerRecovery } from "@/lib/buyer-recovery.functions";

const attachmentTypes = new Set(["image/jpeg", "image/png", "image/webp", "application/pdf"]);
const maxAttachmentBytes = 10 * 1024 * 1024;

type SelectedAttachment = { file: File; previewUrl: string | null };

export const Route = createFileRoute("/inbox")({
  ssr: false,
  validateSearch: z.object({
    conversation: z.string().uuid().optional().catch(undefined),
  }),
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
  const { context, token, error, refresh } = useMessagingContext();
  const getMessages = useServerFn(getConversationMessages);
  const send = useServerFn(sendInboxMessage);
  const prepareAttachment = useServerFn(createAttachmentUpload);
  const cancelAttachment = useServerFn(cancelAttachmentUpload);
  const getAttachmentUrl = useServerFn(getAttachmentDownloadUrl);
  const setBlocked = useServerFn(setConversationBlocked);
  const setReadState = useServerFn(setConversationReadState);
  const report = useServerFn(reportConversation);
  const requestRecovery = useServerFn(requestBuyerRecovery);
  const completeRecovery = useServerFn(completeBuyerRecovery);
  const [messages, setMessages] = useState<InboxMessage[]>([]);
  const [blocked, setBlockedState] = useState(false);
  const [busy, setBusy] = useState(false);
  const [readBusy, setReadBusy] = useState(false);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [selectedAttachments, setSelectedAttachments] = useState<SelectedAttachment[]>([]);
  const [uploadStatus, setUploadStatus] = useState<string | null>(null);
  const [draftNonce, setDraftNonce] = useState(() => crypto.randomUUID());
  const [recoveryMessage, setRecoveryMessage] = useState<string | null>(null);

  const selectedId = useMemo(() => {
    if (
      searchedConversation &&
      context?.conversations.some((row) => row.id === searchedConversation)
    )
      return searchedConversation;
    return context?.conversations[0]?.id ?? null;
  }, [context?.conversations, searchedConversation]);
  const selected = context?.conversations.find((row) => row.id === selectedId) ?? null;
  const actorKind = selected?.actorKind ?? null;
  const mobileConversationOpen = Boolean(
    searchedConversation && selected?.id === searchedConversation,
  );

  useEffect(() => {
    let active = true;
    if (!selectedId || !actorKind) {
      setMessages([]);
      return;
    }
    void getMessages({
      data: { token, actorKind, conversationId: selectedId },
    }).then(async (result) => {
      if (!active) return;
      if ("error" in result) setActionMessage(result.error);
      else {
        setMessages(result.messages);
        setBlockedState(result.blocked);
        await refresh();
        window.dispatchEvent(new Event("social-bid-messaging-changed"));
      }
    });
    return () => {
      active = false;
    };
  }, [actorKind, getMessages, refresh, selectedId, token]);

  useEffect(() => {
    setSelectedAttachments((current) => {
      current.forEach((item) => item.previewUrl && URL.revokeObjectURL(item.previewUrl));
      return [];
    });
  }, [selectedId]);

  useEffect(() => {
    if (!context?.accountAuthenticated) return;
    let active = true;
    void completeRecovery({ data: { token } }).then(async (result) => {
      if (!active) return;
      if (result.ok) {
        setRecoveryMessage("Your previous sponsorships are now in this Inbox.");
        await refresh();
      }
    });
    return () => {
      active = false;
    };
  }, [completeRecovery, context?.accountAuthenticated, refresh, token]);

  async function submitRecovery(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const email = String(new FormData(form).get("recovery-email") ?? "");
    const result = await requestRecovery({ data: { token, email } });
    setRecoveryMessage(result.message);
    form.reset();
  }

  function selectFiles(files: FileList | null) {
    if (!files) return;
    const incoming = [...files];
    if (selectedAttachments.length + incoming.length > 5) {
      setActionMessage("Attach up to 5 files per message.");
      return;
    }
    const invalid = incoming.find(
      (file) => !attachmentTypes.has(file.type) || file.size <= 0 || file.size > maxAttachmentBytes,
    );
    if (invalid) {
      setActionMessage("Use JPG, PNG, WebP, or PDF files up to 10 MB each.");
      return;
    }
    setActionMessage(null);
    setDraftNonce(crypto.randomUUID());
    setSelectedAttachments((current) => [
      ...current,
      ...incoming.map((file) => ({
        file,
        previewUrl: file.type.startsWith("image/") ? URL.createObjectURL(file) : null,
      })),
    ]);
  }

  function removeSelectedAttachment(index: number) {
    setSelectedAttachments((current) => {
      const removed = current[index];
      if (removed?.previewUrl) URL.revokeObjectURL(removed.previewUrl);
      setDraftNonce(crypto.randomUUID());
      return current.filter((_, itemIndex) => itemIndex !== index);
    });
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedId || !actorKind || busy) return;
    const form = event.currentTarget;
    const body = String(new FormData(form).get("message") ?? "").trim();
    if (!body && !selectedAttachments.length) return;
    setBusy(true);
    setActionMessage(null);
    const prepared: Array<{ attachmentId: string; path: string }> = [];
    let result: Awaited<ReturnType<typeof send>> | null = null;
    try {
      const supabase = getSupabase();
      if (selectedAttachments.length && !supabase)
        throw new Error("File uploads are unavailable right now.");
      for (let index = 0; index < selectedAttachments.length; index += 1) {
        const item = selectedAttachments[index]!;
        setUploadStatus(`Uploading ${index + 1} of ${selectedAttachments.length}…`);
        const ticket = await prepareAttachment({
          data: {
            token,
            actorKind,
            conversationId: selectedId,
            filename: item.file.name,
            mimeType: item.file.type as
              "image/jpeg" | "image/png" | "image/webp" | "application/pdf",
            sizeBytes: item.file.size,
          },
        });
        if ("error" in ticket) throw new Error(ticket.error);
        prepared.push({ attachmentId: ticket.attachmentId, path: ticket.path });
        const upload = await supabase!.storage
          .from("social-bid-message-attachments")
          .uploadToSignedUrl(ticket.path, ticket.token, item.file, {
            contentType: item.file.type,
            upsert: false,
          });
        if (upload.error) throw new Error("An attachment failed to upload. Please try again.");
      }
      setUploadStatus(selectedAttachments.length ? "Sending…" : null);
      result = await send({
        data: {
          token,
          actorKind,
          conversationId: selectedId,
          body,
          attachmentIds: prepared.map((item) => item.attachmentId),
          clientNonce: draftNonce,
        },
      });
    } catch (uploadError) {
      await Promise.all(
        prepared.map((item) =>
          cancelAttachment({
            data: {
              token,
              actorKind,
              conversationId: selectedId,
              attachmentId: item.attachmentId,
            },
          }),
        ),
      );
      setActionMessage(
        uploadError instanceof Error ? uploadError.message : "Attachments could not be sent.",
      );
    }
    setBusy(false);
    setUploadStatus(null);
    if (!result) return;
    if ("error" in result) {
      await Promise.all(
        prepared.map((item) =>
          cancelAttachment({
            data: {
              token,
              actorKind,
              conversationId: selectedId,
              attachmentId: item.attachmentId,
            },
          }),
        ),
      );
      setActionMessage(result.error);
    } else {
      form.reset();
      selectedAttachments.forEach(
        (item) => item.previewUrl && URL.revokeObjectURL(item.previewUrl),
      );
      setSelectedAttachments([]);
      setDraftNonce(crypto.randomUUID());
      const reloaded = await getMessages({
        data: { token, actorKind, conversationId: selectedId },
      });
      if (!("error" in reloaded)) setMessages(reloaded.messages);
      await refresh();
    }
  }

  async function openAttachment(attachmentId: string) {
    if (!selectedId || !actorKind) return;
    const result = await getAttachmentUrl({
      data: { token, actorKind, conversationId: selectedId, attachmentId },
    });
    if ("error" in result) {
      setActionMessage(result.error);
      return;
    }
    const link = document.createElement("a");
    link.href = result.url;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.click();
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

  async function toggleReadState() {
    if (!selectedId || !actorKind || !selected || readBusy) return;
    setReadBusy(true);
    setActionMessage(null);
    const result = await setReadState({
      data: {
        token,
        actorKind,
        conversationId: selectedId,
        unread: !selected.isUnread,
      },
    });
    setReadBusy(false);
    if ("error" in result) setActionMessage(result.error);
    else {
      await refresh();
      window.dispatchEvent(new Event("social-bid-messaging-changed"));
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
      {context?.accountAuthenticated ? (
        <details className="panel mt-6 px-5 py-4">
          <summary className="cursor-pointer text-sm font-bold">Claim previous sponsorship</summary>
          <form onSubmit={submitRecovery} className="mt-4 flex flex-wrap gap-3">
            <label htmlFor="recovery-email" className="sr-only">
              Historical sponsorship email
            </label>
            <input
              id="recovery-email"
              name="recovery-email"
              type="email"
              required
              placeholder="Email used at checkout"
              className="field min-w-60 flex-1"
            />
            <button type="submit" className="btn-outline-ink">
              Send verification
            </button>
          </form>
          {recoveryMessage ? (
            <p className="mt-3 text-sm text-muted-foreground">{recoveryMessage}</p>
          ) : null}
        </details>
      ) : null}
      {context?.actor ? (
        <>
          {!context.conversations.length ? (
            <div className="panel mt-8 px-5 py-10 text-center">
              <h2 className="text-xl font-extrabold">No sponsorship connections yet</h2>
              <p className="mt-2 text-sm text-muted-foreground">
                Sponsor a creator or get sponsored to unlock direct messaging.
              </p>
              <Link to="/" className="btn-outline-ink mt-5">
                Explore creators →
              </Link>
            </div>
          ) : (
            <div className="panel mt-8 grid min-h-[34rem] md:grid-cols-[20rem_1fr]">
              <div
                className={`divide-y-2 divide-border border-b-2 border-border md:block md:border-r-2 md:border-b-0 ${mobileConversationOpen ? "hidden" : "block"}`}
              >
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
                <section
                  className={`min-w-0 flex-col md:flex ${mobileConversationOpen ? "flex" : "hidden"}`}
                >
                  <header className="flex flex-wrap items-center justify-between gap-3 border-b-2 border-border px-5 py-4">
                    <div>
                      <button
                        type="button"
                        onClick={() => void navigate({ to: "/inbox", search: {}, replace: true })}
                        className="mb-2 text-xs underline md:hidden"
                      >
                        ← Back to Inbox
                      </button>
                      <h2 className="font-extrabold">{selected.counterpartName}</h2>
                      <p className="font-mono text-[10px] text-muted-foreground">
                        {selected.relationshipLabel}
                      </p>
                    </div>
                    <div className="flex gap-3 text-xs">
                      <button
                        type="button"
                        onClick={() => void toggleReadState()}
                        disabled={readBusy}
                        className="underline disabled:opacity-40"
                      >
                        {selected.isUnread ? "Mark read" : "Mark unread"}
                      </button>
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
                      const mine = message.senderKind === selected.actorKind;
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
                            {message.body ? (
                              <p className="whitespace-pre-wrap text-sm">{message.body}</p>
                            ) : null}
                            {message.attachments.length ? (
                              <div className={`${message.body ? "mt-3" : ""} grid gap-2`}>
                                {message.attachments.map((attachment) =>
                                  attachment.mimeType.startsWith("image/") &&
                                  attachment.previewUrl ? (
                                    <button
                                      key={attachment.id}
                                      type="button"
                                      onClick={() => void openAttachment(attachment.id)}
                                      className="overflow-hidden border border-current/20 text-left"
                                      title={`Open ${attachment.filename}`}
                                    >
                                      <img
                                        src={attachment.previewUrl}
                                        alt={attachment.filename}
                                        className="max-h-64 w-full object-contain"
                                      />
                                      <span className="block truncate px-2 py-1 font-mono text-[10px]">
                                        {attachment.filename}
                                      </span>
                                    </button>
                                  ) : (
                                    <button
                                      key={attachment.id}
                                      type="button"
                                      onClick={() => void openAttachment(attachment.id)}
                                      className="flex min-w-0 items-center gap-2 border border-current/20 p-2 text-left"
                                    >
                                      <FileText className="size-5 shrink-0" aria-hidden="true" />
                                      <span className="min-w-0">
                                        <span className="block truncate text-xs font-bold">
                                          {attachment.filename}
                                        </span>
                                        <span className="block font-mono text-[9px] opacity-70">
                                          {attachment.mimeType === "application/pdf"
                                            ? "PDF"
                                            : "Image"}{" "}
                                          · {(attachment.sizeBytes / 1024 / 1024).toFixed(1)} MB
                                        </span>
                                      </span>
                                    </button>
                                  ),
                                )}
                              </div>
                            ) : null}
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
                    {selectedAttachments.length ? (
                      <div className="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
                        {selectedAttachments.map((item, index) => (
                          <div
                            key={`${item.file.name}-${index}`}
                            className="relative min-w-0 border border-border p-2"
                          >
                            {item.previewUrl ? (
                              <img
                                src={item.previewUrl}
                                alt=""
                                className="mb-1 h-16 w-full object-contain"
                              />
                            ) : (
                              <FileText className="mb-1 size-8" aria-hidden="true" />
                            )}
                            <p className="truncate text-xs font-bold">{item.file.name}</p>
                            <p className="font-mono text-[9px] text-muted-foreground">
                              {(item.file.size / 1024 / 1024).toFixed(1)} MB
                            </p>
                            <button
                              type="button"
                              onClick={() => removeSelectedAttachment(index)}
                              disabled={busy}
                              className="absolute top-1 right-1 bg-background p-1"
                              aria-label={`Remove ${item.file.name}`}
                            >
                              <X className="size-3" aria-hidden="true" />
                            </button>
                          </div>
                        ))}
                      </div>
                    ) : null}
                    <div className="flex items-end gap-2">
                      <label
                        className="btn-outline-ink shrink-0 cursor-pointer px-3"
                        title="Attach image or PDF"
                      >
                        <Paperclip className="size-4" aria-hidden="true" />
                        <span className="sr-only">Attach image or PDF</span>
                        <input
                          type="file"
                          multiple
                          accept="image/jpeg,image/png,image/webp,application/pdf"
                          disabled={blocked || busy || selectedAttachments.length >= 5}
                          onChange={(event) => {
                            selectFiles(event.target.files);
                            event.target.value = "";
                          }}
                          className="sr-only"
                        />
                      </label>
                      <textarea
                        id="inbox-message"
                        name="message"
                        rows={2}
                        maxLength={2000}
                        onChange={() => setDraftNonce(crypto.randomUUID())}
                        disabled={blocked || busy}
                        className="field min-h-16 flex-1 resize-y"
                        placeholder={blocked ? "Messaging is blocked" : "Write a message"}
                      />
                      <button
                        disabled={blocked || busy}
                        className="btn-ink btn-ink-hover self-end disabled:opacity-40"
                      >
                        {busy ? uploadStatus || "Sending…" : "Send"}
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
