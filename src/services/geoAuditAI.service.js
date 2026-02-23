/**
 * Geo Audit (Local SEO) AI Service
 * Uses Claude as a Local SEO expert: receives only DataForSEO-derived data (keyword, location,
 * competitors, user's business or "not in location") and generates score + recommendations itself.
 * No rule-based score or recommendations are sent — the AI decides like an expert.
 * Uses AUDIT_AI_API_KEY (or fallback CLAUDE_API_KEY).
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
  const normalized = (locale || 'en').toLowerCase().replace(/-/g, '_');
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
 * Generate Local SEO score and recommendations from data only. AI acts as Local SEO expert.
 * @param {Object} payload - Data only: keyword, location, competitors[], userBusiness|null, businessNotInLocation
 * @param {string} locale - e.g. en, fr_fr, fr-be, nl_be
 * @returns {Promise<{ score?: number, scoreSummary?: string, recommendations?: Array, strengths?: Array }>}
 */
async function analyzeFromData(payload, locale = 'en') {
  const apiKey = getAuditApiKey();
  if (!apiKey) {
    Logger.warn('[Geo Audit AI] No AUDIT_AI_API_KEY or CLAUDE_API_KEY set. Skipping AI analysis.');
    return {};
  }

  const { language, instruction } = getLanguageInstructions(locale);
  const keyword = payload.keyword || '';
  const location = payload.location || '';
  const competitors = payload.competitors || [];
  const userBusiness = payload.userBusiness || null;
  const businessNotInLocation = payload.businessNotInLocation === true;
  const userProvidedBusiness = payload.userProvidedBusiness === true;

  const systemPrompt = `You are an expert Local SEO analyst. You receive ONLY raw data from a local search (Google local pack / Local Finder) for a given keyword and location. You must generate a realistic local visibility score (0-100), a short score summary, and actionable recommendations. You do NOT receive any pre-computed score or recommendations — you decide everything like a Local SEO expert.

CRITICAL - userProvidedBusiness:
- If userProvidedBusiness is FALSE: The user did NOT enter their business name or GBP link. You do NOT know who their business is. Do NOT assume their business is "absent" or "not in results". Instead treat this as a MARKET OVERVIEW: give a score that reflects the competitiveness of this local market (e.g. 45-65 based on how strong the top 10 are — strong competitors = competitive market). First recommendation MUST be: they should add their business name or Google Business Profile link to get a personalized visibility score and recommendations. Then add 4-7 general Local SEO recommendations based on what top competitors have (reviews, NAP, website, content). Strengths can describe what typically ranks well in this market.
- If userProvidedBusiness is TRUE and userBusiness is null (businessNotInLocation is true): The user's business was NOT found in the top results for this location. Score low (0-25). First recommendation: explain they are not visible in this market and what to do.
- If userProvidedBusiness is TRUE and userBusiness has data: The user's business is in the pack. Score and recommendations based on their position, rating, reviews, NAP vs competitors. Never contradict the data (e.g. do not say "no reviews" if they have 892).

RULES (strict):
1. Use ONLY the data provided. Do not invent data. Do not assume anything not in the data.
2. NEVER contradict the data. Examples:
   - If the user's business has "position": 5 and "reviews": 892, do NOT say they have no reviews or need to get reviews. Say something like "You're #5 with strong review volume; focus on rating or closing the gap with top 3."
   - If the user is already in the top 3 (position 1, 2, or 3), do NOT recommend "get into the top 10" or "appear in the local pack." Recommend how to maintain or reach #1.
   - If businessNotInLocation is true (and userProvidedBusiness is true), the user's business was NOT found in the top results for this location. Score must reflect poor or no visibility (low score, e.g. 0-25), and first recommendation must explain that they are not visible in this market and what to do (target this location or run audit for their actual location).
3. Score (0-100): When userProvidedBusiness is false: market competitiveness score (e.g. 45-65). When businessNotInLocation is true (user provided business but not found): low (0-25). When user is in the pack: reflect position, completeness, rating/reviews vs top competitors (e.g. #1 with strong data = 80-95).
4. Recommendations: 4-10 items. When userProvidedBusiness is false, first one must invite them to add their business for a personalized audit; rest = general local SEO based on competitors. Otherwise each must be specific to the data. Priority: critical | high | medium | low. Category: e.g. GBP, website, reviews, citations, content, NAP. Include impact and effort.
5. Strengths: 0-4 items. When userProvidedBusiness is false, can describe what tends to rank in this market. When user in pack, what they do well vs competitors. Omit or fewer if businessNotInLocation (user provided but not found).

${instruction}

Output format (strict JSON only):
{
  "score": <number 0-100>,
  "scoreSummary": "<1-3 sentences in target language explaining the score and context>",
  "recommendations": [ { "priority": "critical|high|medium|low", "category": "<string>", "issue": "<string>", "action": "<string>", "impact": "high|medium|low", "effort": "easy|moderate|difficult" } ],
  "strengths": [ { "category": "<string>", "title": "<string>", "description": "<string>" } ]
}`;

  const dataForAI = {
    keyword,
    location,
    userProvidedBusiness,
    businessNotInLocation,
    competitors: competitors.map((c) => ({
      position: c.position,
      name: c.name,
      rating: c.rating,
      reviews: c.reviews,
      address: c.address || null,
      phone: c.phone || null,
      website: c.website || null,
      category: c.category || null,
    })),
    userBusiness: userBusiness
      ? {
          position: userBusiness.position,
          name: userBusiness.name,
          rating: userBusiness.rating,
          reviews: userBusiness.reviews,
          address: userBusiness.address || null,
          phone: userBusiness.phone || null,
          website: userBusiness.website || null,
          category: userBusiness.category || null,
        }
      : null,
  };

  const userPrompt = `You are a Local SEO expert. Using ONLY the data below (local pack results for "${keyword}" in "${location}").

Important: userProvidedBusiness=${userProvidedBusiness}. If false, the user did NOT enter their business — give a MARKET score (e.g. 45-65) and first recommendation must ask them to add their business name or GBP link for a personalized audit; then general local SEO tips based on competitors. If true and userBusiness is null (businessNotInLocation), score low (0-25) and explain they're not visible in this market. If userBusiness has data, score and recommend based on their position vs competitors. Never contradict the data.

Generate: score (0-100), scoreSummary in ${language}, 4-10 recommendations, 0-4 strengths.

Data (JSON):
${JSON.stringify(dataForAI, null, 2)}

Return only the JSON object with keys: score, scoreSummary, recommendations, strengths. No other text or markdown.`;

  let client;
  try {
    client = new Anthropic({ apiKey });
  } catch (e) {
    Logger.error('[Geo Audit AI] Failed to create Anthropic client:', e.message);
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
    if (Array.isArray(parsed.recommendations) && parsed.recommendations.length > 0) {
      const validPriority = (p) => (['critical', 'high', 'medium', 'low'].includes(p) ? p : 'medium');
      const validImpact = (i) => (['high', 'medium', 'low'].includes(i) ? i : 'medium');
      const validEffort = (e) => (['easy', 'moderate', 'difficult'].includes(e) ? e : 'moderate');
      result.recommendations = parsed.recommendations.map((r) => ({
        priority: validPriority((r.priority || '').toLowerCase()),
        category: String(r.category || '').trim() || 'General',
        issue: String(r.issue || '').trim(),
        action: String(r.action || '').trim(),
        impact: validImpact((r.impact || '').toLowerCase()),
        effort: validEffort((r.effort || '').toLowerCase()),
      }));
    }
    if (Array.isArray(parsed.strengths)) {
      result.strengths = parsed.strengths.map((s) => ({
        category: String(s.category || '').trim(),
        title: String(s.title || '').trim(),
        description: String(s.description || '').trim(),
      }));
    }

    Logger.info(
      `[Geo Audit AI] Generated from data locale=${locale} (${language}): score=${result.score ?? '—'}, recs=${result.recommendations?.length ?? 0}, strengths=${result.strengths?.length ?? 0}`
    );
    return result;
  } catch (error) {
    Logger.error('[Geo Audit AI] Claude request failed:', error.message);
    if (error.status === 401) {
      Logger.error('[Geo Audit AI] Invalid API key (AUDIT_AI_API_KEY or CLAUDE_API_KEY).');
    }
    return {};
  }
}

export const geoAuditAIService = {
  analyzeFromData,
  getAuditApiKey,
  getLanguageInstructions,
};

export default geoAuditAIService;
