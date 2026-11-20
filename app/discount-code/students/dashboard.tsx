"use client"

import { Check, ChevronRight, Copy, MessageCircle, Share2 } from "lucide-react"
import { useRef, useState } from "react"
import { toast } from "sonner"

import { BottomSheet } from "@/components/guided-form"
import { buttonVariants } from "@/components/ui/button"
import { discountCodeShareLink } from "@/lib/discount-code-share"
import { cn } from "@/lib/utils"

// The agent dashboard's moving parts (#497, prototype v47 concept B): the
// message picker, on the page or in a sheet, and the reminders with their
// sheet. Every WhatsApp link carries the text and no number, so the agent
// picks the chat; the page never holds a family's phone.

const ORANGE = cn(buttonVariants({ variant: "orange" }), "h-auto min-h-13 w-full rounded-full px-6 py-2.5 font-exo text-lg whitespace-normal italic shadow-md shadow-orange-500/20")
const OUTLINED =
  "inline-flex min-h-13 w-full items-center justify-center gap-2 rounded-full border-[1.5px] border-blue-600/45 px-6 font-exo text-lg font-semibold italic text-blue-600 outline-none transition-[background,transform] hover:bg-blue-50 focus-visible:ring-3 focus-visible:ring-(color:--gf-focus-ring) active:scale-[0.97]"
const MESSAGE_BOX =
  "m-0 rounded-2xl bg-[#f8f7fd] px-4 py-3 text-left text-[15px] leading-relaxed wrap-anywhere whitespace-pre-wrap text-slate-800 ring-1 ring-blue-600/15 select-all"

export type PickerWords = {
  pickMessage: string
  labels: { parent: string; group: string; short: string }
  share: string
  copyMessage: string
  messageCopied: string
  copyLink: string
  linkCopied: string
}

type MessageKind = "parent" | "group" | "short"

// Copies `text`; when the browser refuses, selects the box instead so the
// agent can copy it by hand.
async function copyOrSelect(text: string, box: HTMLElement | null): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    if (box) window.getSelection()?.selectAllChildren(box)
    return false
  }
}

// The three ready-made messages: pick one, then send it on WhatsApp or copy
// it. Copy link stays for someone who writes their own.
export function MessagePicker({ messages, link, words }: { messages: Record<MessageKind, string>; link: string; words: PickerWords }) {
  const [kind, setKind] = useState<MessageKind>("parent")
  const [linkCopied, setLinkCopied] = useState(false)
  const box = useRef<HTMLParagraphElement>(null)
  const text = messages[kind]
  const href = discountCodeShareLink(text)

  return (
    <div className="flex flex-col gap-3">
      <h2 className="font-exo text-[17px] leading-tight font-extrabold text-blue-600 italic">{words.pickMessage}</h2>
      <div className="flex flex-wrap gap-2" role="group" aria-label={words.pickMessage}>
        {(["parent", "group", "short"] as const).map((option) => (
          <button
            key={option}
            type="button"
            aria-pressed={kind === option}
            onClick={() => setKind(option)}
            className="min-h-11 rounded-full border-[1.5px] border-blue-600/30 bg-white px-4 text-sm font-semibold text-blue-600 outline-none focus-visible:ring-3 focus-visible:ring-(color:--gf-focus-ring) aria-pressed:border-blue-600 aria-pressed:bg-blue-600 aria-pressed:text-white"
          >
            {words.labels[option]}
          </button>
        ))}
      </div>
      <p ref={box} className={MESSAGE_BOX} aria-live="polite">
        {text}
      </p>
      {href && (
        <a href={href} target="_blank" rel="noopener noreferrer" className={ORANGE}>
          <MessageCircle className="size-5" aria-hidden />
          {words.share}
        </a>
      )}
      <button
        type="button"
        className={OUTLINED}
        onClick={async () => {
          if (await copyOrSelect(text, box.current)) toast(words.messageCopied)
        }}
      >
        <Copy className="size-5" aria-hidden />
        {words.copyMessage}
      </button>
      <button
        type="button"
        className={OUTLINED}
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(link)
            setLinkCopied(true)
          } catch {
            setLinkCopied(false)
          }
        }}
      >
        {linkCopied ? <Check className="size-5" aria-hidden /> : <Copy className="size-5" aria-hidden />}
        {linkCopied ? words.linkCopied : words.copyLink}
      </button>
    </div>
  )
}

// "Shiriki code yako" next to the code, outlined: on a busy page the one
// orange button belongs to the longest wait. It opens the picker in a sheet.
export function ShareCodeButton({ label, closeLabel, ...picker }: { label: string; closeLabel: string } & Parameters<typeof MessagePicker>[0]) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="ml-auto inline-flex min-h-11 items-center gap-2 rounded-full border-[1.5px] border-blue-600/45 px-4 font-exo text-[15px] font-semibold text-blue-600 italic outline-none hover:bg-blue-50 focus-visible:ring-3 focus-visible:ring-(color:--gf-focus-ring)"
      >
        <Share2 className="size-[18px]" aria-hidden />
        {label}
      </button>
      <BottomSheet open={open} onClose={() => setOpen(false)} title={label} closeLabel={closeLabel}>
        <MessagePicker {...picker} />
      </BottomSheet>
    </>
  )
}

export type ReminderItem = { name: string; className: string; waiting: string; message: string }

export type ReminderWords = {
  heading: string
  prepare: string
  title: string
  openWhatsApp: string
  copyMessage: string
  messageCopied: string
  close: string
}

// Who could use a reminder, the longest wait first. Its "Andaa ujumbe" is the
// page's orange button; the others are outlined. Each opens the reminder in a
// sheet, with WhatsApp (no number) and Copy.
export function Reminders({ items, words }: { items: ReminderItem[]; words: ReminderWords }) {
  const [shown, setShown] = useState<number | null>(null)
  const box = useRef<HTMLParagraphElement>(null)
  const item = shown === null ? null : items[shown]
  const href = item ? discountCodeShareLink(item.message) : null

  return (
    <section className="flex flex-col gap-3">
      <h2 className="font-exo text-[17px] leading-tight font-extrabold text-blue-600 italic">{words.heading}</h2>
      <ul className="flex flex-col gap-2.5">
        {items.map((reminder, index) => (
          <li key={index} className="flex flex-col gap-2 rounded-[20px] border-[1.5px] border-orange-500/35 bg-[#fffaf4] px-4 py-3">
            <p className="text-base leading-snug font-semibold wrap-anywhere text-slate-800">
              {reminder.name} <span className="font-normal text-slate-600">· {reminder.className}</span>
            </p>
            <p className="text-sm text-[#8a3300]">{reminder.waiting}</p>
            <button
              type="button"
              onClick={() => setShown(index)}
              className={index === 0 ? cn(ORANGE, "min-h-11 text-base") : cn(OUTLINED, "min-h-11 text-base")}
            >
              <MessageCircle className="size-5" aria-hidden />
              {words.prepare}
            </button>
          </li>
        ))}
      </ul>
      <BottomSheet open={item !== null} onClose={() => setShown(null)} title={words.title} closeLabel={words.close}>
        {item && (
          <div className="flex flex-col gap-3">
            <p className="text-sm text-slate-600">
              {item.name} · {item.className}
            </p>
            <p ref={box} className={MESSAGE_BOX}>
              {item.message}
            </p>
            {href && (
              <a href={href} target="_blank" rel="noopener noreferrer" className={cn(ORANGE, "justify-between pr-4 pl-6")}>
                {words.openWhatsApp}
                <ChevronRight className="size-5" aria-hidden />
              </a>
            )}
            <button
              type="button"
              className={OUTLINED}
              onClick={async () => {
                if (await copyOrSelect(item.message, box.current)) toast(words.messageCopied)
              }}
            >
              <Copy className="size-5" aria-hidden />
              {words.copyMessage}
            </button>
          </div>
        )}
      </BottomSheet>
    </section>
  )
}
