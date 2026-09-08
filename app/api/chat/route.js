// GET    /api/chat - fetch chat history for the Chatbot page
// POST   /api/chat - send a message, run the tool-use loop, get a reply
// DELETE /api/chat - clear chat history (both the visible transcript AND the
//        AI's memory of it - see lib/chat.js handleChatMessage, which reads
//        the last 16 ChatMessage rows as conversation context on every
//        message, so this has to actually delete the rows, not just hide
//        them client-side, or the "cleared" conversation would still be
//        remembered on the next message)
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUserFromRequest } from "@/lib/session";
import { handleChatMessage } from "@/lib/chat";
import { checkRateLimit, formatRetryAfter } from "@/lib/rateLimit";
import { trackEvent } from "@/lib/events";

export async function GET(request) {
  const user = await getCurrentUserFromRequest(request);
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const messages = await prisma.chatMessage.findMany({
    where: { userId: user.id },
    orderBy: { createdAt: "asc" },
  });
  return NextResponse.json({ messages });
}

export async function POST(request) {
  const user = await getCurrentUserFromRequest(request);
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const limit = await checkRateLimit(user.id, "chat");
  if (!limit.allowed) {
    return NextResponse.json(
      { error: `You're sending messages too quickly - try again in ${formatRetryAfter(limit.retryAfterSeconds)}.` },
      { status: 429, headers: { "Retry-After": String(limit.retryAfterSeconds) } }
    );
  }

  const body = await request.json().catch(() => null);
  const message = body?.message?.trim();
  if (!message) return NextResponse.json({ error: "Message cannot be empty." }, { status: 400 });

  try {
    const reply = await handleChatMessage(user.id, message);
    trackEvent(user.id, "chat_message_sent").catch((err) => {
      console.error("Failed to track chat_message_sent:", err.message);
    });
    return NextResponse.json({ reply });
  } catch (err) {
    console.error("Chat failed:", err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function DELETE(request) {
  const user = await getCurrentUserFromRequest(request);
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  await prisma.chatMessage.deleteMany({ where: { userId: user.id } });

  trackEvent(user.id, "chat_cleared").catch((err) => {
    console.error("Failed to track chat_cleared:", err.message);
  });

  return NextResponse.json({ ok: true });
}
