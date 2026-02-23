/**
 * SEO Audit AI Service
 * Uses Claude as an SEO expert: receives raw DataForSEO-style data, compares the audited page
 * to the top 10 competitors, and returns a realistic score and recommendations in the user's language (FR, NL, EN).
 * Uses AUDIT_AI_API_KEY (or fallback CLAUDE_API_KEY) so audits can use a dedicated AI key.
 */

import Anthropic from '@anthropic-ai/sdk';
import { env } from '../config/index.js';
import { getLocaleConfig } from '../config/index.js';
import { Logger } from '../utils/logger.js';

const AUDIT_AI_MODEL = 'claude-sonnet-4-20250514';
const MAX_TOKENS = 8192;

function getAuditApiKey() {
  return env.AUDIT_AI_API_KEY || env.CLAUDE_API_KEY;
}

function getLanguageInstructions(locale) {
  const normalized = (locale || 'en').toLowerCase().replace('-', '_');
  const config = getLocaleConfig(normalized);
  const lang = config?.languageCode || config?.language || 'en';
  const locationName = config?.locationName || '';

  if (lang === 'fr') {
    return {
      language: 'French',
      instruction: `Output all user-facing text in French. Use natural, professional French (France or Belgium style as appropriate). Location context: ${locationName || 'not specified'}.`,
    };
  }
  if (lang === 'nl') {
    return {
      language: 'Dutch',
      instruction: `Output all user-facing text in Dutch (Nederlands). Use natural, professional Dutch. Location context: ${locationName || 'not specified'}.`,
    };
  }
  return {
    language: 'English',
    instruction: 'Output all user-facing text in English. Use clear, professional English.',
  };
}

/**
 * Analyze audit from raw DataForSEO-style data. AI acts as SEO expert: compares audited page
 * to top 10 competitors and returns realistic score + recommendations + strengths in the selected language.
 * @param {Object} payload - { auditedPage, competitorSummaries, benchmark, keyword, locationName }
 * @param {string} locale - e.g. en, fr_fr, fr_be, nl_be
 * @returns {Promise<{ score?: number, scoreSummary?: string, recommendations?: Array, strengths?: Array }>}
 */
async function analyzeAuditFromData(payload, locale = 'en') {
  const apiKey = getAuditApiKey();
  if (!apiKey) {
    Logger.warn('[SEO Audit AI] No AUDIT_AI_API_KEY or CLAUDE_API_KEY set. Skipping AI analysis.');
    return {};
  }

  const { language, instruction } = getLanguageInstructions(locale);
  const locationName = payload.locationName || getLocaleConfig(locale)?.locationName || '';
  const marketLabel = payload.locationDisplayName || locationName;
  const localeCode = payload.locale || locale;
  const keyword = payload.keyword || '';

  const systemPrompt = `You are an expert SEO analyst. You receive:
(1) DataForSEO-style data: auditedPage, top10Competitors, benchmark, and pageForScoring for ONE specific market (e.g. France, Belgium).
(2) appliedGaps: the list of competitive gaps already identified for this page vs this market's benchmark (each has id, category, points, title, issue, recommendation, vsCompetitors).
(3) scoringFormula: the exact rules to compute the score from appliedGaps.

You MUST do the following so the score and recommendations stay aligned:

SCORE CALCULATION (mandatory):
- Always compute the score from appliedGaps and scoringFormula. Do NOT force score to 0 when keywordFoundOnPage is false. The score must reflect how the page compares to the top 10 (consistent and realistic).
- Using appliedGaps and scoringFormula only:
  1. Sum "points" of appliedGaps per category: serp (category "serp"), content (category "content"), onpage (category "onpage").
  2. ComponentScore per category = max(0, min(100, 100 - categoryPoints)).
  3. finalScore = round(serpScore * 0.45 + contentScore * 0.35 + onpageScore * 0.20).
- Output this exact score. Do not guess or round differently.

RECOMMENDATIONS (must match appliedGaps):
- If keywordFoundOnPage is false: your first recommendation MUST be critical, category "Keyword", issue "Target keyword not found on page", action to add the keyword to title/H1/content, then one recommendation per appliedGap (same order as appliedGaps), translated and adapted to the user's language. Include "context" that references this market (e.g. "In France...", "vs top 10 in Belgium..."). The score is still from the formula above (do not output 0).
- Else: Output exactly one recommendation per appliedGap, in the same order. Map severity to priority: CRITICAL->critical, HIGH->high, MEDIUM->medium, LOW->low. Use the gap's issue as "issue", recommendation as "action", vsCompetitors as base for "context" (translate and add market name). So score and recommendations are driven by the same appliedGaps and formula.

SCORE SUMMARY & STRENGTHS:
- scoreSummary: 1-2 sentences in the user's language explaining the score and mentioning the market (e.g. "In France, compared to the top 10..."). Never say "100/100" or "perfect 100"—the scale caps at 95 for excellent; use "excellent", "top score", or "95" when there are no gaps. If keywordFoundOnPage is false, mention that adding the keyword can help relevance but the score reflects comparison to top 10.
- strengths: 2-4 items for what the page does well vs competitors in this market (or fewer if keywordFoundOnPage is false).

${instruction}

Output format (strict JSON):
{
  "score": <number 0-95, computed from formula only; max is 95; never force 0>,
  "scoreSummary": "<1-2 sentences in target language>",
  "recommendations": [ { "priority": "critical|high|medium|low", "category": "<string>", "issue": "<string>", "action": "<string>", "impact": "high|medium|low", "effort": "easy|moderate|difficult", "context": "<string>" } ],
  "strengths": [ { "category": "<string>", "title": "<string>", "description": "<string>" } ]
}`;

  const keywordFoundOnPage = payload.keywordFoundOnPage !== false;

  const competitorDomains = payload.competitorDomains || [];
  const appliedGaps = payload.appliedGaps || [];
  const scoringFormula = payload.scoringFormula || {};

  const dataForAI = {
    market: locationName,
    marketLabel,
    locale: localeCode,
    keyword,
    locationName,
    keywordFoundOnPage,
    competitorDomainsInThisMarket: competitorDomains,
    auditedPage: payload.auditedPage || {},
    top10Competitors: payload.competitorSummaries || [],
    pageForScoring: payload.pageForScoring || {},
    benchmark: payload.benchmark ? {
      medianContentLength: payload.benchmark.medianContentLength,
      medianH2Count: payload.benchmark.medianH2Count,
      keywordInTitleRatio: payload.benchmark.keywordInTitleRatio,
      keywordInH1Ratio: payload.benchmark.keywordInH1Ratio,
      dominantPageType: payload.benchmark.dominantPageType,
    } : {},
    appliedGaps,
    scoringFormula,
  };

  const userPrompt = `Using the data below, (1) compute the score with the scoringFormula from appliedGaps (always use the formula; do not output 0 when keywordFoundOnPage is false—score must reflect comparison to top 10). (2) Output one recommendation per appliedGap, in order, translated/adapted to ${language}, with context mentioning the market "${locationName}". If keywordFoundOnPage is false, add a critical first recommendation about adding the keyword. (3) Write a short scoreSummary and 2-4 strengths for this market.

Market: ${locationName} (${marketLabel}). Different locations have different competitors and benchmarks—this data is for this market only.

Data (JSON):
${JSON.stringify(dataForAI, null, 2)}

Return only the JSON object with keys: score, scoreSummary, recommendations, strengths. No other text.`;

  let client;
  try {
    client = new Anthropic({ apiKey });
  } catch (e) {
    Logger.error('[SEO Audit AI] Failed to create Anthropic client:', e.message);
    return {};
  }

  try {
    const message = await client.messages.create({
      model: AUDIT_AI_MODEL,
      max_tokens: MAX_TOKENS,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
    });

    const text = message.content?.[0]?.text?.trim() || '';
    if (!text) return {};

    const jsonStr = text.replace(/^```json\s*/i, '').replace(/```\s*$/i, '').trim();
    const parsed = JSON.parse(jsonStr);

    const result = {};
    if (typeof parsed.score === 'number' && parsed.score >= 0 && parsed.score <= 100) {
      result.score = Math.round(parsed.score);
    }
    if (typeof parsed.scoreSummary === 'string' && parsed.scoreSummary.length > 0) {
      result.scoreSummary = parsed.scoreSummary;
    }
    if (Array.isArray(parsed.recommendations)) {
      const validPriority = (p) => ['critical', 'high', 'medium', 'low'].includes(p) ? p : 'medium';
      const validImpact = (i) => ['high', 'medium', 'low'].includes(i) ? i : 'medium';
      const validEffort = (e) => ['easy', 'moderate', 'difficult'].includes(e) ? e : 'moderate';
      result.recommendations = parsed.recommendations.map((r) => ({
        priority: validPriority((r.priority || '').toLowerCase()),
        category: String(r.category || '').trim() || 'General',
        issue: String(r.issue || '').trim(),
        action: String(r.action || '').trim(),
        impact: validImpact((r.impact || '').toLowerCase()),
        effort: validEffort((r.effort || '').toLowerCase()),
        context: String(r.context || '').trim(),
      }));
    }
    if (Array.isArray(parsed.strengths)) {
      result.strengths = parsed.strengths.map((s) => ({
        category: String(s.category || '').trim(),
        title: String(s.title || '').trim(),
        description: String(s.description || '').trim(),
      }));
    }

    Logger.info(`[SEO Audit AI] Analyzed from data locale=${locale} (${language}): score=${result.score ?? '—'}, recs=${result.recommendations?.length ?? 0}, strengths=${result.strengths?.length ?? 0}`);
    return result;
  } catch (error) {
    Logger.error('[SEO Audit AI] Claude request failed:', error.message);
    if (error.status === 401) {
      Logger.error('[SEO Audit AI] Invalid API key (AUDIT_AI_API_KEY or CLAUDE_API_KEY).');
    }
    return {};
  }
}

/**
 * Legacy: enhance pre-computed audit with AI (translate/refine). Prefer analyzeAuditFromData when raw data is available.
 */
async function enhanceAuditWithAI(payload, locale = 'en') {
  const apiKey = getAuditApiKey();
  if (!apiKey) return {};
  const { language, instruction } = getLanguageInstructions(locale);
  const locationName = payload.locationName || getLocaleConfig(locale)?.locationName || '';
  const keyword = payload.keyword || '';

  const systemPrompt = `You are an SEO expert. Translate and adapt the audit into ${language}. Keep structure; only change language. ${instruction}
Return valid JSON only: { "score": number|null, "scoreSummary": string, "recommendations": [...], "strengths": [...] }.
Each recommendation: priority, category, issue, action, impact, effort, context.`;

  const userPayload = {
    keyword,
    locationName,
    currentScore: payload.score,
    scoreSummary: payload.scoreSummary,
    recommendations: (payload.recommendations || []).map((r) => ({ priority: r.priority, category: r.category, issue: r.issue, action: r.action, impact: r.impact, effort: r.effort, context: r.context || '' })),
    strengths: (payload.strengths || []).map((s) => ({ category: s.category, title: s.title, description: s.description || '' })),
  };
  const userPrompt = `Translate this audit to ${language}. Input:\n${JSON.stringify(userPayload, null, 2)}\nReturn only the JSON object.`;

  try {
    const client = new Anthropic({ apiKey });
    const message = await client.messages.create({
      model: AUDIT_AI_MODEL,
      max_tokens: MAX_TOKENS,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
    });
    const text = message.content?.[0]?.text?.trim() || '';
    if (!text) return {};
    const jsonStr = text.replace(/^```json\s*/i, '').replace(/```\s*$/i, '').trim();
    const parsed = JSON.parse(jsonStr);
    const result = {};
    if (typeof parsed.score === 'number' && parsed.score >= 0 && parsed.score <= 100) result.score = Math.round(parsed.score);
    if (typeof parsed.scoreSummary === 'string') result.scoreSummary = parsed.scoreSummary;
    if (Array.isArray(parsed.recommendations) && parsed.recommendations.length > 0) {
      const validPriority = (p) => ['critical', 'high', 'medium', 'low'].includes(p) ? p : 'medium';
      const validImpact = (i) => ['high', 'medium', 'low'].includes(i) ? i : 'medium';
      const validEffort = (e) => ['easy', 'moderate', 'difficult'].includes(e) ? e : 'moderate';
      result.recommendations = parsed.recommendations.map((r) => ({
        priority: validPriority((r.priority || '').toLowerCase()),
        category: String(r.category || '').trim() || 'General',
        issue: String(r.issue || '').trim(),
        action: String(r.action || '').trim(),
        impact: validImpact((r.impact || '').toLowerCase()),
        effort: validEffort((r.effort || '').toLowerCase()),
        context: String(r.context || '').trim(),
      }));
    }
    if (Array.isArray(parsed.strengths)) {
      result.strengths = parsed.strengths.map((s) => ({ category: s.category || '', title: s.title || '', description: s.description || '' }));
    }
    return result;
  } catch (e) {
    Logger.error('[SEO Audit AI] enhanceAuditWithAI failed:', e.message);
    return {};
  }
}

export const seoAuditAIService = {
  analyzeAuditFromData,
  enhanceAuditWithAI,
  getAuditApiKey,
  getLanguageInstructions,
};

export default seoAuditAIService;
