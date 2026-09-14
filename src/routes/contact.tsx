import { createFileRoute } from "@tanstack/react-router";
import { useRef, useState } from "react";
import { sendContactMessage } from "@/lib/contact.functions";

export const Route = createFileRoute("/contact")({
  head: () => ({
    meta: [
      { title: "Contact — SocialBid" },
      {
        name: "description",
        content: "Get in touch with SocialBid for questions, partnerships or press.",
      },
      { property: "og:title", content: "Contact — SocialBid" },
      {
        property: "og:description",
        content: "Questions, partnerships or press? Get in touch.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Contact,
});

type ContactStatus = "idle" | "sending" | "sent" | "error";

function Contact() {
  const formRef = useRef<HTMLFormElement>(null);
  const [status, setStatus] = useState<ContactStatus>("idle");

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (status === "sending") return;
    setStatus("sending");
    const form = new FormData(event.currentTarget);
    try {
      const result = await sendContactMessage({
        data: {
          name: String(form.get("name") ?? ""),
          email: String(form.get("email") ?? ""),
          subject: String(form.get("subject") ?? ""),
          message: String(form.get("message") ?? ""),
        },
      });
      if (!result.ok) throw new Error("delivery_failed");
      formRef.current?.reset();
      setStatus("sent");
    } catch {
      setStatus("error");
    }
  }

  return (
    <main className="mx-auto max-w-2xl px-5 py-14 sm:py-20">
      <header>
        <h1 className="text-[clamp(2rem,7vw,3.25rem)] leading-[0.9] font-semibold tracking-[-0.05em]">
          Contact
        </h1>
        <p className="mt-4 text-lg text-muted-foreground">
          Questions, partnerships or press? Get in touch.
        </p>
      </header>

      <section className="panel mt-10 p-5 sm:p-8" aria-labelledby="contact-form-heading">
        <h2 id="contact-form-heading" className="text-xl font-semibold">
          Send a message
        </h2>
        <form ref={formRef} onSubmit={submit} className="mt-6 space-y-5">
          <div>
            <label className="label-xs" htmlFor="contact-name">
              Name
            </label>
            <input
              id="contact-name"
              name="name"
              required
              autoComplete="name"
              className="field mt-1"
            />
          </div>
          <div>
            <label className="label-xs" htmlFor="contact-email">
              Email
            </label>
            <input
              id="contact-email"
              name="email"
              type="email"
              required
              autoComplete="email"
              className="field mt-1"
            />
          </div>
          <div>
            <label className="label-xs" htmlFor="contact-subject">
              Subject <span className="normal-case text-muted-foreground">(optional)</span>
            </label>
            <input id="contact-subject" name="subject" maxLength={200} className="field mt-1" />
          </div>
          <div>
            <label className="label-xs" htmlFor="contact-message">
              Message
            </label>
            <textarea
              id="contact-message"
              name="message"
              required
              maxLength={5000}
              rows={6}
              className="field mt-1 resize-y"
            />
          </div>
          <button
            type="submit"
            disabled={status === "sending"}
            className="btn-ink btn-ink-hover disabled:opacity-50"
          >
            {status === "sending" ? "Sending…" : "Send message"}
          </button>
          <p aria-live="polite" className="text-sm font-medium">
            {status === "sent" ? "Message sent. We’ll get back to you soon." : null}
            {status === "error"
              ? "We couldn’t send your message right now. Please try again."
              : null}
          </p>
        </form>
      </section>

      <section className="mt-12" aria-labelledby="media-kit-heading">
        <h2 id="media-kit-heading" className="text-2xl font-semibold tracking-tight">
          Media Kit
        </h2>
        <p className="mt-2 text-muted-foreground">Download official SocialBid brand assets.</p>
        <div className="mt-6 grid gap-4 sm:grid-cols-2">
          <MediaAsset
            name="SocialBid icon"
            src="/socialbid-icon.png"
            previewClassName="h-28 w-28"
            download="socialbid-icon.png"
          />
          <MediaAsset
            name="SocialBid logo"
            src="/socialbid-logo.png"
            previewClassName="h-28 w-full max-w-[260px]"
            download="socialbid-logo.png"
          />
        </div>
      </section>
    </main>
  );
}

function MediaAsset({
  name,
  src,
  previewClassName,
  download,
}: {
  name: string;
  src: string;
  previewClassName: string;
  download: string;
}) {
  return (
    <article className="panel p-5">
      <div className="flex h-36 items-center justify-center bg-muted p-4">
        <img src={src} alt={`${name} preview`} className={`${previewClassName} object-contain`} />
      </div>
      <h3 className="mt-5 font-semibold">{name}</h3>
      <a href={src} download={download} className="btn-ink btn-ink-hover mt-4">
        Download PNG
      </a>
    </article>
  );
}
