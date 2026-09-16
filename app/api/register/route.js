// POST /api/register - create a new account and log the user straight in.
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { hashPassword, createSessionToken, SESSION_COOKIE_NAME, SESSION_MAX_AGE_SECONDS } from "@/lib/auth";
import { trackEvent } from "@/lib/events";

export async function POST(request) {
  const body = await request.json().catch(() => null);
  const email = body?.email?.trim().toLowerCase();
  const password = body?.password;
  const name = body?.name?.trim() || null;
  const consent = body?.consent === true;

  if (!email || !password) {
    return NextResponse.json({ error: "Email and password are required." }, { status: 400 });
  }
  if (password.length < 6) {
    return NextResponse.json({ error: "Password must be at least 6 characters." }, { status: 400 });
  }
  // LGPD requires an actual affirmative opt-in at the moment data is
  // collected - a policy page existing somewhere isn't consent by itself, so
  // this is enforced server-side too, not just as a disabled button in the UI.
  if (!consent) {
    return NextResponse.json(
      { error: "You must agree to the Privacy Policy and Terms of Service to create an account." },
      { status: 400 }
    );
  }

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    return NextResponse.json({ error: "An account with that email already exists." }, { status: 409 });
  }

  const user = await prisma.user.create({
    data: { email, name, passwordHash: hashPassword(password), privacyConsentAt: new Date() },
  });

  // Never let an event-tracking hiccup break registration itself.
  trackEvent(user.id, "signup").catch((err) => {
    console.error("Failed to track signup event:", err.message);
  });

  const token = createSessionToken(user.id);
  const response = NextResponse.json({ user: { id: user.id, email: user.email, name: user.name } });
  response.cookies.set(SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_MAX_AGE_SECONDS,
  });
  return response;
}
