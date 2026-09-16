// The Chatbot page's brain. Implements a small "tool use" loop: Claude can
// call any of the tools defined below, we actually execute them against the
// database, hand the results back to Claude, and it writes a natural-
// language reply referencing what happened. This is what makes "I just
// watched Andor and loved it", "what's on my wishlist?", or "I don't
// actually like horror, update my profile" actually read/change the app's
// real data, not just produce a chat reply. The tool set mirrors what the
// rest of the app's pages can already do (rate, wishlist, recommend, view
// lists, view/edit/re-analyze the taste profile) - the chatbot is meant to
// be a full alternate way to drive the platform, not a narrower one.
//
// See https://platform.claude.com/docs/en/agents-and-tools/tool-use/how-tool-use-works
// for the general pattern this follows.

import { prisma } from "@/lib/prisma";
import { getClaudeClient, getProfileModel, extractText } from "@/lib/anthropic";
import { findOrLookupTitle } from "@/lib/titles";
import {
  getProfile,
  updateProfile,
  profileToPromptSummary,
  analyzePreferences,
  maybeAnalyzePreferences,
  ARRAY_FIELDS,
} from "@/lib/profile";
import { RATING_STATUSES } from "@/lib/questions";

// Plain string-array profile fields that are safe for the chatbot to add/
// remove single items from directly. "genres" is deliberately excluded here
// - it's an array of { name, confidence } objects, not plain strings, so it
// gets its own branch in executeTool below instead of sharing this list.
const EDITABLE_LIST_FIELDS = ARRAY_FIELDS.filter((f) => f !== "genres");

const TOOLS = [
  {
    name: "log_title_opinion",
    description:
      "Record or update the user's status on a specific movie or TV show: mark it watched (with an optional " +
      "1-5 star rating and why), add it to their Wishlist (status 'want_to_watch'), or mark it not interested. " +
      "Use this for ANY of: sharing an opinion about something they watched, asking to add/put something on " +
      "the wishlist, or saying they're not interested in something - not just 'watched' opinions.",
    input_schema: {
      type: "object",
      properties: {
        title: { type: "string", description: "The movie or TV show name" },
        year: { type: "number", description: "Release year, if known" },
        status: { type: "string", enum: RATING_STATUSES },
        stars: {
          type: "number",
          description: "1-5 star rating - only include if status is 'watched' and the user gave/implied a rating",
        },
        why: { type: "string", description: "A short summary of why the user liked/disliked it, ideally in their own words" },
      },
      required: ["title", "status"],
    },
  },
  {
    name: "recommend_title",
    description:
      "Recommend one specific, real movie or TV show to the user right now (e.g. because they asked for a " +
      "mood- or situation-based pick). This adds it straight to their Recommendations page.",
    input_schema: {
      type: "object",
      properties: {
        title: { type: "string" },
        year: { type: "number" },
        reasonText: {
          type: "string",
          description: "A short, specific reason this fits what the user asked for and/or their taste profile",
        },
      },
      required: ["title", "reasonText"],
    },
  },
  {
    name: "view_list",
    description:
      "View the user's current Wishlist (want-to-watch titles), Watched list (everything they've rated), or " +
      "pending Recommendations queue. Use this whenever the user asks what's on one of these lists.",
    input_schema: {
      type: "object",
      properties: {
        listType: { type: "string", enum: ["wishlist", "watched", "recommendations"] },
      },
      required: ["listType"],
    },
  },
  {
    name: "reanalyze_preferences",
    description:
      "Re-run the AI taste-profile analysis right now, incorporating every rating so far (including any just " +
      "logged earlier in this conversation). Use this when the user asks you to update/refresh their taste " +
      "profile, or after logging several new opinions in one conversation.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "edit_preferences",
    description:
      "Directly add or remove ONE specific item on the user's taste profile - e.g. they say 'actually I don't " +
      "like horror' or 'add slow-burn thrillers to my likes'. For a genre, also pass confidence (1-5). Use this " +
      "for a targeted correction; for a broader update from new ratings, use reanalyze_preferences instead.",
    input_schema: {
      type: "object",
      properties: {
        field: { type: "string", enum: [...EDITABLE_LIST_FIELDS, "genres"] },
        action: { type: "string", enum: ["add", "remove"] },
        value: { type: "string", description: "The text to add/remove, or (for genres) the genre name" },
        confidence: { type: "number", description: "1-5, only used when field is 'genres' and action is 'add'" },
      },
      required: ["field", "action", "value"],
    },
  },
];

async function executeTool(userId, toolName, input) {
  if (toolName === "log_title_opinion") {
    const status = RATING_STATUSES.includes(input.status) ? input.status : "watched";
    const title = await findOrLookupTitle(input.title, { year: input.year });
    if (!title) return { error: `Could not find a title matching "${input.title}".` };

    await prisma.rating.upsert({
      where: { userId_titleId: { userId, titleId: title.id } },
      update: { status, stars: input.stars ?? undefined, why: input.why ?? undefined, source: "chatbot" },
      create: {
        userId,
        titleId: title.id,
        status,
        stars: input.stars ?? null,
        why: input.why ?? null,
        source: "chatbot",
      },
    });
    return { success: true, title: title.name, year: title.year, status };
  }

  if (toolName === "recommend_title") {
    const title = await findOrLookupTitle(input.title, { year: input.year });
    if (!title) return { error: `Could not find a title matching "${input.title}".` };

    // Enforce "don't recommend something already known" in code, same as
    // lib/recommendations.js - the tool description alone isn't a
    // guarantee, and recommending something the user already rated/was
    // recommended is exactly the bug that was fixed there.
    const [existingRating, existingRec] = await Promise.all([
      prisma.rating.findUnique({ where: { userId_titleId: { userId, titleId: title.id } } }),
      prisma.recommendation.findUnique({ where: { userId_titleId: { userId, titleId: title.id } } }),
    ]);
    if (existingRating || existingRec) {
      return {
        error: `"${title.name}" is already known to this user (already rated or recommended) - don't recommend it again. Pick something different if you want to suggest an alternative.`,
      };
    }

    await prisma.recommendation.upsert({
      where: { userId_titleId: { userId, titleId: title.id } },
      update: { reasonText: input.reasonText, source: "chatbot", status: "pending" },
      create: { userId, titleId: title.id, reasonText: input.reasonText, source: "chatbot", status: "pending" },
    });
    return { success: true, title: title.name, year: title.year };
  }

  if (toolName === "view_list") {
    if (input.listType === "wishlist") {
      const [rows, total] = await Promise.all([
        prisma.rating.findMany({
          where: { userId, status: "want_to_watch" },
          include: { title: true },
          orderBy: { updatedAt: "desc" },
          take: 30,
        }),
        prisma.rating.count({ where: { userId, status: "want_to_watch" } }),
      ]);
      return {
        total,
        items: rows.map((r) => ({ title: r.title.name, year: r.title.year, type: r.title.type })),
        note: total > rows.length ? `Showing the ${rows.length} most recently added of ${total} total.` : undefined,
      };
    }

    if (input.listType === "watched") {
      const [rows, total] = await Promise.all([
        prisma.rating.findMany({
          where: { userId, status: "watched" },
          include: { title: true },
          orderBy: { updatedAt: "desc" },
          take: 25,
        }),
        prisma.rating.count({ where: { userId, status: "watched" } }),
      ]);
      return {
        total,
        items: rows.map((r) => ({ title: r.title.name, year: r.title.year, stars: r.stars, why: r.why })),
        note: total > rows.length ? `Showing the ${rows.length} most recently updated of ${total} total.` : undefined,
      };
    }

    if (input.listType === "recommendations") {
      const rows = await prisma.recommendation.findMany({
        where: { userId, status: "pending" },
        include: { title: true },
        orderBy: { createdAt: "desc" },
        take: 20,
      });
      return {
        total: rows.length,
        items: rows.map((r) => ({ title: r.title.name, year: r.title.year, type: r.title.type, reasonText: r.reasonText })),
      };
    }

    return { error: `Unknown listType: ${input.listType}` };
  }

  if (toolName === "reanalyze_preferences") {
    // Direct, unbatched call - this is an explicit, infrequent user request
    // (like the "Ask AI to re-analyze" button on My Preferences), not a
    // routine new-rating event, so it deserves an immediate real result
    // rather than being subject to maybeAnalyzePreferences' batching.
    const updated = await analyzePreferences(userId);
    if (!updated) return { error: "Not enough ratings yet to build a profile - rate a few titles first." };
    return { success: true, summary: updated.summary || "Profile updated." };
  }

  if (toolName === "edit_preferences") {
    const profile = await getProfile(userId);
    if (!profile) return { error: "No taste profile yet - rate a few titles first." };

    const { field, action, value, confidence } = input;
    if (!value || typeof value !== "string") return { error: "A value is required." };

    if (field === "genres") {
      const genres = [...(profile.genres || [])];
      const idx = genres.findIndex((g) => g.name.toLowerCase() === value.toLowerCase());
      if (action === "remove") {
        if (idx === -1) return { error: `"${value}" isn't in the genre list.` };
        genres.splice(idx, 1);
      } else {
        const conf = Number.isFinite(confidence) ? Math.min(5, Math.max(1, Math.round(confidence))) : 3;
        if (idx === -1) genres.push({ name: value, confidence: conf });
        else genres[idx] = { name: genres[idx].name, confidence: conf };
      }
      await updateProfile(userId, { genres });
      return { success: true, field, genres };
    }

    if (!EDITABLE_LIST_FIELDS.includes(field)) return { error: `Unknown field: ${field}` };

    const current = Array.isArray(profile[field]) ? profile[field] : [];
    const updatedList =
      action === "remove"
        ? current.filter((item) => item.toLowerCase() !== value.toLowerCase())
        : current.some((item) => item.toLowerCase() === value.toLowerCase())
        ? current
        : [...current, value];

    await updateProfile(userId, { [field]: updatedList });
    return { success: true, field, [field]: updatedList };
  }

  return { error: `Unknown tool: ${toolName}` };
}

const MAX_TOOL_ITERATIONS = 4; // safety limit so a confused model can't loop forever

/**
 * Handles one user chat message end-to-end: saves it, runs the Claude
 * tool-use loop (executing any tools Claude calls), saves and returns the
 * final assistant reply, and refreshes the preference profile if anything changed.
 */
export async function handleChatMessage(userId, userMessageText) {
  const client = getClaudeClient();

  const [user, profile, history] = await Promise.all([
    prisma.user.findUnique({ where: { id: userId } }),
    getProfile(userId),
    prisma.chatMessage.findMany({ where: { userId }, orderBy: { createdAt: "desc" }, take: 16 }),
  ]);

  await prisma.chatMessage.create({ data: { userId, role: "user", content: userMessageText } });

  const system = `You are FilmTonight's assistant - a friendly movie/TV recommendation chatbot.
Here is what you currently know about this user:
${profileToPromptSummary(profile, user)}

You have full access to this user's data via tools - use them, don't just talk about what you'd do:
- log_title_opinion: mark something watched (with a rating/why), add it to the Wishlist, or mark not interested.
- recommend_title: recommend one specific title right now, added straight to their Recommendations page.
- view_list: look up what's actually on their Wishlist, Watched list, or pending Recommendations before answering
  questions about those lists - don't guess or rely on what's earlier in this conversation, it may be stale.
- reanalyze_preferences: re-run the full taste-profile analysis now (e.g. "update my profile").
- edit_preferences: make one targeted add/remove edit to a specific profile field (e.g. "I don't like horror").
NEVER claim you added/removed/updated/recommended something unless you actually called the matching tool THIS
turn - even if an earlier message in this conversation says you already did it, the real state may have changed
since (e.g. a later re-analysis can touch the same fields). If asked to do something that might already be done,
call the tool again (or view_list to check) rather than answering from memory of the conversation so far.
Keep replies conversational and fairly short. When you use a tool, mention what you did in plain language
(e.g. "Logged Andor as watched & loved - added to your profile." or "Added Dune to your wishlist.").
If the user mentions watching something but doesn't give any indication of a rating (loved it, hated it, a star
count, etc.), log it anyway but briefly ask how they'd rate it 1-5 stars - the more specific the rating, the
better their recommendations get, and this chat is one of the easiest places to capture that in the moment.
If they only give a bare reaction ("loved it", "it was fine") with no real detail on WHY, log what you have but
gently ask one specific follow-up (what worked, what didn't, how it compared to something they've mentioned
before) - vague opinions barely move the needle, but a specific reason is what actually lets the AI find real
patterns instead of just going by genre.`;

  const messages = [
    ...history.reverse().map((m) => ({ role: m.role, content: m.content })),
    { role: "user", content: userMessageText },
  ];

  let finalText = "";
  let usedAnyTool = false;

  for (let i = 0; i < MAX_TOOL_ITERATIONS; i++) {
    const response = await client.messages.create({
      model: getProfileModel(),
      max_tokens: 600,
      // Cached: this string is identical across every iteration of THIS
      // turn's tool loop (guaranteed win when a turn needs 2+ iterations),
      // and often identical across consecutive messages in the same
      // conversation too (only the profile summary line can change between
      // messages - everything else is static). Was skipped before because
      // this ran on Haiku, whose cache minimum (4096 tokens) this prompt
      // doesn't clear; now that chat runs on the same Sonnet tier as
      // profile/recommendation calls (see getProfileModel), its lower
      // 1024-token minimum makes caching worth turning on here too.
      system: [{ type: "text", text: system, cache_control: { type: "ephemeral" } }],
      messages,
      tools: TOOLS,
    });

    const toolUseBlocks = response.content.filter((block) => block.type === "tool_use");

    if (toolUseBlocks.length === 0) {
      finalText = extractText(response);
      break;
    }

    usedAnyTool = true;

    // Claude's turn (including its tool-call blocks) must be echoed back
    // before we can send tool results, per the Messages API's tool-use flow.
    messages.push({ role: "assistant", content: response.content });

    const toolResults = [];
    for (const block of toolUseBlocks) {
      const result = await executeTool(userId, block.name, block.input);
      toolResults.push({ type: "tool_result", tool_use_id: block.id, content: JSON.stringify(result) });
    }
    messages.push({ role: "user", content: toolResults });

    if (i === MAX_TOOL_ITERATIONS - 1) {
      // We hit the safety limit while Claude still wanted to use tools -
      // grab whatever text it had written so far rather than returning nothing.
      finalText = extractText(response) || "Done!";
    }
  }

  if (!finalText) {
    finalText = "Sorry, I wasn't able to come up with a reply there - could you try rephrasing?";
  }

  await prisma.chatMessage.create({ data: { userId, role: "assistant", content: finalText } });

  if (usedAnyTool) {
    // A tool call likely changed a rating, wishlist entry, recommendation,
    // or the profile itself - all meaningful new signal - so refresh the
    // profile (batched, see lib/profile.js maybeAnalyzePreferences). Don't
    // block the chat reply on this - the user is waiting to read finalText,
    // which is already decided. (If the user explicitly asked for a
    // refresh, reanalyze_preferences above already did that immediately -
    // this is just the same routine catch-all the rest of the app uses.)
    maybeAnalyzePreferences(userId).catch((err) => {
      console.error("Failed to re-analyze preferences after chat:", err.message);
    });
  }

  return finalText;
}
