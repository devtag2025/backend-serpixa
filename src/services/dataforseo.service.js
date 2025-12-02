import axios from 'axios';
import { env } from '../config/index.js';
import { ApiError } from '../utils/index.js';

class DataForSEOService {
    constructor() {
        const credentials = Buffer.from(
            `${env.DATAFORSEO_LOGIN}:${env.DATAFORSEO_PASSWORD}`
        ).toString('base64');

        this.client = axios.create({
            baseURL: env.DATAFORSEO_API_URL,
            headers: {
                'Authorization': `Basic ${credentials}`,
                'Content-Type': 'application/json',
            },
            timeout: 60000,
        });
    }

    async runOnPageAudit(url, keyword = null) {
        try {
            const response = await this.client.post('/v3/on_page/instant_pages', [
                {
                    url,
                    enable_javascript: true,
                    enable_browser_rendering: true,
                },
            ]);

            const result = response.data;

            if (result.status_code !== 20000) {
                throw new ApiError(502, result.status_message || 'DataForSEO API error');
            }

            const task = result.tasks?.[0];
            if (!task || task.status_code !== 20000) {
                throw new ApiError(502, task?.status_message || 'On-page audit failed');
            }

            return this.transformOnPageResult(task.result?.[0], url, keyword);
        } catch (error) {
            if (error instanceof ApiError) throw error;
            throw new ApiError(502, `DataForSEO request failed: ${error.message}`);
        }
    }

    transformOnPageResult(data, url, keyword) {
        if (!data) {
            return {
                url,
                keyword,
                score: 0,
                checks: {},
                keywordAnalysis: null,
                recommendations: [],
                raw: null,
            };
        }

        const pageData = data.items?.[0] || {};
        const meta = pageData.meta || {};
        const onPage = pageData.onpage_score || 0;

        const checks = {
            title: {
                exists: !!meta.title,
                value: meta.title || null,
                length: meta.title?.length || 0,
                optimal: meta.title?.length >= 30 && meta.title?.length <= 60,
            },
            description: {
                exists: !!meta.description,
                value: meta.description || null,
                length: meta.description?.length || 0,
                optimal: meta.description?.length >= 120 && meta.description?.length <= 160,
            },
            h1: {
                exists: !!meta.htags?.h1?.length,
                count: meta.htags?.h1?.length || 0,
                values: meta.htags?.h1 || [],
            },
            h2: {
                count: meta.htags?.h2?.length || 0,
                values: meta.htags?.h2 || [],
            },
            canonical: {
                exists: !!meta.canonical,
                value: meta.canonical || null,
            },
            images: {
                total: pageData.images?.images_count || 0,
                withoutAlt: pageData.images?.images_without_alt || 0,
            },
            links: {
                internal: pageData.links?.internal?.count || 0,
                external: pageData.links?.external?.count || 0,
                broken: pageData.links?.broken?.count || 0,
            },
            loadTime: pageData.page_timing?.time_to_interactive || null,
            wordCount: meta.content?.plain_text_word_count || 0,
        };

        const keywordAnalysis = keyword ? this.analyzeKeyword(keyword, meta, pageData) : null;
        const recommendations = this.generateRecommendations(checks, keywordAnalysis, keyword);

        return {
            url,
            keyword,
            score: Math.round(onPage * 100) / 100,
            checks,
            keywordAnalysis,
            recommendations,
            raw: data,
        };
    }

    analyzeKeyword(keyword, meta, pageData) {
        const keywordLower = keyword.toLowerCase();
        const title = (meta.title || '').toLowerCase();
        const description = (meta.description || '').toLowerCase();
        const h1Values = (meta.htags?.h1 || []).map(h => h.toLowerCase());
        const h2Values = (meta.htags?.h2 || []).map(h => h.toLowerCase());
        const plainText = (meta.content?.plain_text_content || '').toLowerCase();

        const keywordCount = (plainText.match(new RegExp(keywordLower, 'g')) || []).length;
        const wordCount = meta.content?.plain_text_word_count || 1;
        const density = ((keywordCount / wordCount) * 100).toFixed(2);

        return {
            keyword,
            inTitle: title.includes(keywordLower),
            inDescription: description.includes(keywordLower),
            inH1: h1Values.some(h => h.includes(keywordLower)),
            inH2: h2Values.some(h => h.includes(keywordLower)),
            inContent: plainText.includes(keywordLower),
            occurrences: keywordCount,
            density: parseFloat(density),
            densityOptimal: parseFloat(density) >= 1 && parseFloat(density) <= 3,
        };
    }

    generateRecommendations(checks, keywordAnalysis, keyword) {
        const recommendations = [];

        // Existing checks
        if (!checks.title.exists) {
            recommendations.push({ priority: 'high', issue: 'Missing title tag', action: 'Add a descriptive title tag (30-60 characters)' });
        } else if (!checks.title.optimal) {
            recommendations.push({ priority: 'medium', issue: 'Title length not optimal', action: 'Adjust title to 30-60 characters' });
        }

        if (!checks.description.exists) {
            recommendations.push({ priority: 'high', issue: 'Missing meta description', action: 'Add a meta description (120-160 characters)' });
        } else if (!checks.description.optimal) {
            recommendations.push({ priority: 'medium', issue: 'Meta description length not optimal', action: 'Adjust to 120-160 characters' });
        }

        if (!checks.h1.exists) {
            recommendations.push({ priority: 'high', issue: 'Missing H1 tag', action: 'Add exactly one H1 tag' });
        } else if (checks.h1.count > 1) {
            recommendations.push({ priority: 'medium', issue: 'Multiple H1 tags', action: 'Use only one H1 tag per page' });
        }

        if (checks.images.withoutAlt > 0) {
            recommendations.push({ priority: 'medium', issue: `${checks.images.withoutAlt} images missing alt text`, action: 'Add descriptive alt text to all images' });
        }

        if (checks.links.broken > 0) {
            recommendations.push({ priority: 'high', issue: `${checks.links.broken} broken links found`, action: 'Fix or remove broken links' });
        }

        if (!checks.canonical.exists) {
            recommendations.push({ priority: 'medium', issue: 'Missing canonical tag', action: 'Add canonical URL to prevent duplicate content issues' });
        }

        if (checks.wordCount < 300) {
            recommendations.push({ priority: 'medium', issue: 'Low word count', action: 'Add more quality content (aim for 300+ words)' });
        }

        // Keyword-specific recommendations
        if (keywordAnalysis && keyword) {
            if (!keywordAnalysis.inTitle) {
                recommendations.push({ priority: 'high', issue: 'Target keyword not in title', action: `Include "${keyword}" in your title tag` });
            }
            if (!keywordAnalysis.inDescription) {
                recommendations.push({ priority: 'high', issue: 'Target keyword not in meta description', action: `Include "${keyword}" in your meta description` });
            }
            if (!keywordAnalysis.inH1) {
                recommendations.push({ priority: 'high', issue: 'Target keyword not in H1', action: `Include "${keyword}" in your H1 heading` });
            }
            if (!keywordAnalysis.inContent) {
                recommendations.push({ priority: 'high', issue: 'Target keyword not found in content', action: `Add "${keyword}" naturally throughout your content` });
            }
            if (!keywordAnalysis.densityOptimal && keywordAnalysis.inContent) {
                if (keywordAnalysis.density < 1) {
                    recommendations.push({ priority: 'medium', issue: 'Keyword density too low', action: `Increase usage of "${keyword}" (aim for 1-3% density)` });
                } else if (keywordAnalysis.density > 3) {
                    recommendations.push({ priority: 'medium', issue: 'Keyword density too high', action: `Reduce usage of "${keyword}" to avoid keyword stuffing` });
                }
            }
        }

        return recommendations;
    }
}

export const dataForSEOService = new DataForSEOService();