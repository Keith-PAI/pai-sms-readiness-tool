/**
 * PAI SMS Readiness Tool — Tier 2 AI Report Worker
 * Cloudflare Worker that calls the Anthropic Claude API to generate
 * a personalized SMS compliance gap analysis report.
 *
 * Environment variables required:
 *   ANTHROPIC_API_KEY — your Anthropic API key (set in Cloudflare dashboard)
 */

const SYSTEM_PROMPT =
  "You are a senior aviation SMS consultant at PAI Consulting with deep expertise in FAA 14 CFR Part 5. " +
  "You produce professional, authoritative compliance gap reports for aviation operators. " +
  "Your reports are specific, cite exact regulatory sections, and give actionable guidance — never generic advice. " +
  "Write in a professional but accessible tone. The operator is reading this themselves, not a lawyer.";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

export default {
  async fetch(request, env) {
    // Handle CORS preflight
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    if (request.method !== "POST") {
      return jsonResponse({ error: "Method not allowed" }, 405);
    }

    let body;
    try {
      body = await request.json();
    } catch {
      return jsonResponse({ error: "Invalid JSON body" }, 400);
    }

    const { profile, pillarScores, overall, tier, gaps } = body;

    if (!profile || !pillarScores || overall === undefined || !gaps) {
      return jsonResponse({ error: "Missing required fields" }, 400);
    }

    // Build the user prompt from assessment data
    const userPrompt = buildUserPrompt(profile, pillarScores, overall, tier, gaps);

    try {
      const apiResponse = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": env.ANTHROPIC_API_KEY,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model: "claude-sonnet-4-20250514",
          max_tokens: 2000,
          system: SYSTEM_PROMPT,
          messages: [{ role: "user", content: userPrompt }],
        }),
      });

      if (!apiResponse.ok) {
        const errText = await apiResponse.text();
        console.error("Anthropic API error:", apiResponse.status, errText);
        return jsonResponse(
          { error: "AI report generation failed. Please try again." },
          502
        );
      }

      const apiData = await apiResponse.json();
      const reportText =
        apiData.content?.[0]?.text || "Report generation returned no content.";

      return jsonResponse({ report: reportText });
    } catch (err) {
      console.error("Worker error:", err);
      return jsonResponse(
        { error: "Internal error generating report." },
        500
      );
    }
  },
};

function buildUserPrompt(profile, pillarScores, overall, tier, gaps) {
  const topGaps = gaps.slice(0, 5);

  let prompt = `Generate an SMS Compliance Gap Analysis Report for this aviation operator.\n\n`;
  prompt += `## Operator Profile\n`;
  prompt += `- Operation Type: ${profile.op_type || "Not specified"}\n`;
  prompt += `- Employee Count: ${profile.emp_count || "Not specified"}\n`;
  prompt += `- Current SMS Status: ${profile.sms_status || "Not specified"}\n`;
  prompt += `- Primary Compliance Driver: ${profile.driver || "Not specified"}\n\n`;

  prompt += `## Assessment Results\n`;
  prompt += `- Overall Score: ${Math.round(overall)}% — Tier: ${tier}\n\n`;

  prompt += `### Pillar Scores\n`;
  pillarScores.forEach((p) => {
    prompt += `- ${p.title}: ${Math.round(p.score)}%\n`;
  });

  prompt += `\n### Top 5 Priority Gaps\n`;
  topGaps.forEach((g, i) => {
    prompt += `${i + 1}. "${g.question}" — Current maturity: ${g.score}/3 — Weight: ${g.weight} — Citation: 14 CFR ${g.citation} — Pillar: ${g.pillar}\n`;
  });

  prompt += `\n## Required Report Sections\n`;
  prompt += `Produce the following in clean HTML (use <h3>, <p>, <ul>, <li>, <strong> tags — no <html>/<body>/<head> wrappers):\n\n`;
  prompt += `1. **Executive Summary** — 2–3 sentences summarizing their compliance posture, specific to their operation type and score.\n`;
  prompt += `2. **Priority Gap Analysis** — For each of the top 5 gaps above, provide:\n`;
  prompt += `   - Gap title (bold)\n`;
  prompt += `   - Plain-English explanation of what the regulation requires\n`;
  prompt += `   - Audit risk if this gap remains unaddressed\n`;
  prompt += `   - 2–3 specific, actionable remediation steps\n`;
  prompt += `3. **30/60/90 Day Remediation Roadmap** — Based on their specific gaps, lay out what to tackle in each phase.\n`;
  prompt += `4. **Next Steps** — A closing paragraph recommending PAI Consulting's structured gap analysis engagement for hands-on implementation support. Include a mention to contact info@paiconsulting.com.\n`;

  return prompt;
}

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...CORS_HEADERS },
  });
}
