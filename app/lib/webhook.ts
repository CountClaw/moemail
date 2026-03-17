import { WEBHOOK_CONFIG } from "../config/webhook"

export interface EmailMessage {
  emailId: string
  messageId: string
  fromAddress: string
  subject: string
  content: string
  html: string
  receivedAt: string
  toAddress: string
}

export interface WebhookPayload {
  event: typeof WEBHOOK_CONFIG.EVENTS[keyof typeof WEBHOOK_CONFIG.EVENTS]
  data: EmailMessage
}

interface WecomWebhookResponse {
  errcode: number
  errmsg: string
}

function isWecomRobotWebhookUrl(url: string) {
  try {
    const parsed = new URL(url)
    return parsed.hostname === "qyapi.weixin.qq.com" && parsed.pathname === "/cgi-bin/webhook/send"
  } catch {
    return false
  }
}

function stripHtml(html: string) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, "")
    .replace(/\s+/g, " ")
    .trim()
}

function truncate(text: string, maxLength: number) {
  if (text.length <= maxLength) return text
  return `${text.slice(0, maxLength)}…`
}

function buildWecomMarkdownContent(payload: WebhookPayload) {
  const { data } = payload

  const subject = data.subject || "(无主题)"
  const fromAddress = data.fromAddress || "(未知发件人)"
  const toAddress = data.toAddress || "(未知收件人)"
  const receivedAt = data.receivedAt || ""

  const rawBody = (data.content || "").trim() || stripHtml(data.html || "")
  const body = rawBody ? truncate(rawBody, 1800) : "(无正文)"

  return [
    "**MoeMail 新邮件通知**",
    "",
    `> 收件人：${toAddress}`,
    `> 发件人：${fromAddress}`,
    `> 主题：${subject}`,
    receivedAt ? `> 时间：${receivedAt}` : undefined,
    "",
    body,
  ]
    .filter(Boolean)
    .join("\n")
}

export async function callWebhook(url: string, payload: WebhookPayload) {
  let lastError: Error | null = null
  const isWecom = isWecomRobotWebhookUrl(url)

  for (let i = 0; i < WEBHOOK_CONFIG.MAX_RETRIES; i++) {
    try {
      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), WEBHOOK_CONFIG.TIMEOUT)

      const response = await fetch(url, {
        method: "POST",
        headers: isWecom
          ? {
              "Content-Type": "application/json",
            }
          : {
              "Content-Type": "application/json",
              "X-Webhook-Event": payload.event,
            },
        body: isWecom
          ? JSON.stringify({
              msgtype: "markdown",
              markdown: {
                content: buildWecomMarkdownContent(payload),
              },
            })
          : JSON.stringify(payload.data),
        signal: controller.signal,
      })

      clearTimeout(timeoutId)

      if (!response.ok) {
        lastError = new Error(`HTTP error! status: ${response.status}`)
        continue
      }

      if (!isWecom) {
        return true
      }

      const result = (await response.json().catch(() => null)) as WecomWebhookResponse | null

      if (result?.errcode === 0) {
        return true
      }

      lastError = new Error(
        result
          ? `WeCom webhook error: errcode=${result.errcode} errmsg=${result.errmsg}`
          : "WeCom webhook error: invalid JSON response"
      )
    } catch (error) {
      lastError = error as Error

      if (i < WEBHOOK_CONFIG.MAX_RETRIES - 1) {
        await new Promise((resolve) => setTimeout(resolve, WEBHOOK_CONFIG.RETRY_DELAY))
      }
    }
  }

  throw lastError
}
