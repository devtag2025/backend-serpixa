import axios from 'axios';
import { env } from '../config/index.js';
import { ApiError } from '../utils/index.js';
import { Logger } from '../utils/logger.js';

class DataForSEOService {
    constructor() {
        // Use DATAFORSEO_LOGIN or DATAFORSEO_EMAIL (both should work)
        this.login = env.DATAFORSEO_LOGIN || env.DATAFORSEO_EMAIL;
        this.password = env.DATAFORSEO_PASSWORD || env.DATAFORSEO_API_PASSWORD;
        this.baseURL = env.DATAFORSEO_API_URL || 'https://sandbox.dataforseo.com';

        // Validate credentials
        if (!this.login || !this.password) {
            Logger.error('DataForSEO credentials not configured. Please set DATAFORSEO_LOGIN and DATAFORSEO_PASSWORD in your .env file');
        }

        // Create axios instance with auth configuration
        this.client = axios.create({
            baseURL: this.baseURL,
            headers: {
                'Content-Type': 'application/json',
            },
            timeout: 60000,
            // Use axios built-in auth which handles Basic Auth automatically
            auth: {
                username: this.login || '',
                password: this.password || '',
            },
        });
    }

    async runOnPageAudit(url, keyword, locationName = 'United States', languageName = 'English', device = 'desktop') {
        try {
            // Run on-page audit and SERP analysis in parallel
            const [onPageResult, serpResult] = await Promise.all([
                this.fetchOnPageData(url),
                keyword ? this.fetchSERPData(keyword, locationName, languageName, device) : Promise.resolve(null),
            ]);

            return this.transformOnPageResult(onPageResult, url, keyword, serpResult);
        } catch (error) {
            if (error instanceof ApiError) throw error;
            throw new ApiError(502, `DataForSEO request failed: ${error.message}`);
        }
    }

    async fetchOnPageData(url) {
        if (!this.login || !this.password) {
            throw new ApiError(500, 'DataForSEO credentials not configured. Please set DATAFORSEO_LOGIN and DATAFORSEO_PASSWORD in your .env file');
        }

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
                Logger.error('DataForSEO OnPage API error:', result.status_message, 'Code:', result.status_code);
                throw new ApiError(502, result.status_message || 'DataForSEO API error');
            }

            const task = result.tasks?.[0];
            if (!task || task.status_code !== 20000) {
                Logger.error('DataForSEO OnPage task error:', task?.status_message, 'Code:', task?.status_code);
                throw new ApiError(502, task?.status_message || 'On-page audit failed');
            }

            return task.result?.[0];
        } catch (error) {
            if (error instanceof ApiError) throw error;
            
            // Handle axios errors
            if (error.response) {
                const statusCode = error.response.status;
                const errorMessage = error.response.data?.message || error.response.statusText || 'DataForSEO API request failed';
                
                if (statusCode === 401) {
                    Logger.error('DataForSEO authentication failed. Please check your DATAFORSEO_LOGIN and DATAFORSEO_PASSWORD credentials.');
                    throw new ApiError(401, 'DataForSEO authentication failed. Please check your credentials in .env file');
                }
                
                Logger.error('DataForSEO API error response:', {
                    status: statusCode,
                    data: error.response.data,
                });
                throw new ApiError(statusCode, errorMessage);
            }
            
            Logger.error('On-page audit request failed:', error.message);
            throw new ApiError(502, `On-page audit failed: ${error.message}`);
        }
    }

    async fetchSERPData(keyword, locationName = 'United States', languageName = 'English', device = 'desktop', depth = 100) {
        if (!this.login || !this.password) {
            Logger.warn('DataForSEO credentials not configured. Skipping SERP data fetch.');
            return null;
        }

        try {
            const payload = [
                {
                    keyword: keyword.trim(),
                    location_name: locationName,
                    language_name: languageName,
                    device: device,
                    depth: depth,
                },
            ];

            const response = await this.client.post('/v3/serp/google/organic/live/regular', payload);

            // Handle different response structures
            let result;
            if (Array.isArray(response.data)) {
                if (response.data.length === 0) {
                    Logger.warn('DataForSEO SERP API returned empty array');
                    return null;
                }
                result = response.data[0];
            } else if (response.data?.status_code !== undefined) {
                result = response.data;
            } else {
                Logger.error('Unexpected SERP response structure:', typeof response.data);
                return null;
            }

            // Check for API errors
            if (result.status_code !== undefined && result.status_code !== 20000) {
                Logger.warn('DataForSEO SERP API error:', result.status_message, 'Code:', result.status_code);
                return null;
            }

            // Extract competitor results
            const tasks = result.tasks || [];
            if (tasks.length === 0) {
                return null;
            }

            const task = tasks[0];
            let serpData;
            
            if (Array.isArray(task.result)) {
                serpData = task.result[0];
            } else if (task.result) {
                serpData = task.result;
            } else {
                return null;
            }

            const organicResults = serpData?.items || [];

            // Format competitor data
            const competitors = organicResults
                .filter((item) => item.type === 'organic')
                .map((item, index) => ({
                    position: index + 1,
                    title: item.title || '',
                    url: item.url || '',
                    domain: item.domain || '',
                    description: item.description || '',
                    breadcrumb: item.breadcrumb || '',
                }));

            return {
                keyword,
                location: locationName,
                language: languageName,
                device,
                competitors,
                totalResults: competitors.length,
                searchInfo: {
                    seResultsCount: serpData?.se_results_count || 0,
                    checkUrl: serpData?.check_url || '',
                    datetime: serpData?.datetime || new Date().toISOString(),
                },
            };
        } catch (error) {
            // Handle axios errors
            if (error.response) {
                const statusCode = error.response.status;
                if (statusCode === 401) {
                    Logger.error('DataForSEO SERP authentication failed. Please check your credentials.');
                } else {
                    Logger.error('DataForSEO SERP API error:', {
                        status: statusCode,
                        data: error.response.data,
                    });
                }
            } else {
                Logger.error('SERP data fetch failed:', error.message);
            }
            // Don't fail the entire audit if SERP fails
            return null;
        }
    }

    transformOnPageResult(data, url, keyword, serpData = null) {
        if (!data) {
            return {
                url,
                keyword,
                score: 0,
                checks: {},
                keywordAnalysis: null,
                recommendations: [],
                competitors: serpData?.competitors || [],
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
        const recommendations = this.generateRecommendations(checks, keywordAnalysis, keyword, serpData);

        return {
            url,
            keyword,
            score: Math.round(onPage * 100) / 100,
            checks,
            keywordAnalysis,
            recommendations,
            competitors: serpData?.competitors || [],
            serpInfo: serpData ? {
                location: serpData.location,
                language: serpData.language,
                device: serpData.device,
                totalResults: serpData.totalResults,
                searchInfo: serpData.searchInfo,
            } : null,
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

    generateRecommendations(checks, keywordAnalysis, keyword, serpData = null) {
        const recommendations = [];
        
        // Add competitor analysis recommendations
        if (serpData && serpData.competitors && serpData.competitors.length > 0) {
            recommendations.push({
                priority: 'high',
                issue: `Found ${serpData.competitors.length} competitor results for "${keyword}"`,
                action: 'Review top-ranking competitors to identify optimization opportunities and content gaps'
            });
        }

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
    
    // Helper to extract domain from URL
    extractDomain(url) {
        try {
            return new URL(url).hostname.replace('www.', '');
        } catch {
            return url;
        }
    }
}

export const dataForSEOService = new DataForSEOService();