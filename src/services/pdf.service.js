import { jsPDF } from 'jspdf';
import { t } from '../locales/index.js';
import { getLocaleConfig, DEFAULT_LOCALE } from '../config/index.js';

class PDFService {
  getLanguageFromAudit(audit) {
    const locale = audit.locale || DEFAULT_LOCALE;
    const localeConfig = getLocaleConfig(locale);
    return localeConfig.language || 'en';
  }

  /**
   * Formats a date in European format (DD/MM/YYYY)
   * @param {Date|string|number} date - Date to format
   * @returns {string} Formatted date string in DD/MM/YYYY format
   */
  formatEuropeanDate(date) {
    if (!date) return "N/A";
    
    const dateObj = date instanceof Date ? date : new Date(date);
    
    if (isNaN(dateObj.getTime())) {
      return "N/A";
    }

    const day = String(dateObj.getDate()).padStart(2, '0');
    const month = String(dateObj.getMonth() + 1).padStart(2, '0');
    const year = dateObj.getFullYear();

    return `${day}/${month}/${year}`;
  }

  generateSEOAuditReport(audit, user) {
    const lang = this.getLanguageFromAudit(audit);
    const doc = new jsPDF();
    const pageWidth = doc.internal.pageSize.getWidth();
    let y = 20;

    // Header
    doc.setFontSize(22);
    doc.setFont('helvetica', 'bold');
    doc.text(t(lang, 'pdf.seo.title'), pageWidth / 2, y, { align: 'center' });
    y += 15;

    // Branding
    doc.setFontSize(10);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(100);
    doc.text(t(lang, 'pdf.seo.poweredBy'), pageWidth / 2, y, { align: 'center' });
    y += 15;

    // Audit Info
    doc.setTextColor(0);
    doc.setFontSize(11);
    doc.text(`${t(lang, 'pdf.seo.url')}: ${audit.url}`, 20, y);
    y += 8;
    if (audit.keyword) {
      doc.text(`${t(lang, 'pdf.seo.targetKeyword')}: ${audit.keyword}`, 20, y);
      y += 8;
    }
    doc.text(`${t(lang, 'pdf.seo.date')}: ${this.formatEuropeanDate(audit.createdAt)}`, 20, y);
    y += 8;
    doc.text(`${t(lang, 'pdf.seo.generatedFor')}: ${user.name || user.email}`, 20, y);
    y += 15;

    // Score Section
    doc.setFillColor(240, 240, 240);
    doc.rect(20, y, pageWidth - 40, 25, 'F');
    doc.setFontSize(14);
    doc.setFont('helvetica', 'bold');
    doc.text(t(lang, 'pdf.seo.score'), 30, y + 10);
    doc.setFontSize(24);
    doc.setTextColor(...this.getScoreColor(audit.score));
    doc.text(`${audit.score}/100`, pageWidth - 50, y + 15);
    doc.setTextColor(0);
    y += 35;

    // On-Page Checks
    y = this.addSection(doc, t(lang, 'pdf.seo.onPageAnalysis'), y);
    y = this.addCheck(doc, audit.checks.title?.label || t(lang, 'seo.checks.title'), audit.checks.title, y, lang);
    y = this.addCheck(doc, audit.checks.description?.label || t(lang, 'seo.checks.description'), audit.checks.description, y, lang);
    y = this.addCheck(doc, audit.checks.h1?.label || t(lang, 'seo.checks.h1'), audit.checks.h1, y, lang);
    y = this.addCheck(doc, audit.checks.canonical?.label || t(lang, 'seo.checks.canonical'), audit.checks.canonical, y, lang);
    y = this.addCheck(doc, audit.checks.images?.label || t(lang, 'seo.checks.images'), audit.checks.images, y, lang);
    y = this.addCheck(doc, audit.checks.links?.label || t(lang, 'seo.checks.links'), audit.checks.links, y, lang);
    y += 5;

    // Keyword Analysis
    if (audit.keywordAnalysis) {
      y = this.checkPageBreak(doc, y, 60);
      y = this.addSection(doc, audit.keywordAnalysis.title || t(lang, 'pdf.seo.keywordAnalysis'), y);
      const kw = audit.keywordAnalysis;
      y = this.addKeywordCheck(doc, kw.inTitleLabel || t(lang, 'seo.keywordAnalysis.inTitle'), kw.inTitle, y, lang);
      y = this.addKeywordCheck(doc, kw.inDescriptionLabel || t(lang, 'seo.keywordAnalysis.inDescription'), kw.inDescription, y, lang);
      y = this.addKeywordCheck(doc, kw.inH1Label || t(lang, 'seo.keywordAnalysis.inH1'), kw.inH1, y, lang);
      y = this.addKeywordCheck(doc, kw.inContentLabel || t(lang, 'seo.keywordAnalysis.inContent'), kw.inContent, y, lang);
      y = this.addLine(doc, `${kw.densityLabel || t(lang, 'pdf.seo.keywordDensity')}: ${kw.density}%`, y);
      y = this.addLine(doc, `${kw.occurrencesLabel || t(lang, 'pdf.seo.occurrences')}: ${kw.occurrences}`, y);
      y += 5;
    }

    // Competitor Ranking Table
    if (audit.competitors && audit.competitors.length > 0) {
      y = this.checkPageBreak(doc, y, 80);
      y = this.addSection(doc, t(lang, 'pdf.seo.competitorRankings'), y);
      y = this.addCompetitorTable(doc, audit.competitors, y, lang);
      y += 10;
    }

    // Recommendations
    if (audit.recommendations?.length > 0) {
      y = this.checkPageBreak(doc, y, 40);
      y = this.addSection(doc, t(lang, 'pdf.seo.recommendations'), y);

      for (const rec of audit.recommendations) {
        y = this.checkPageBreak(doc, y, 20);
        const priorityColor = rec.priority === 'critical' ? [139, 0, 0] : rec.priority === 'high' ? [220, 53, 69] : rec.priority === 'medium' ? [255, 193, 7] : [40, 167, 69];
        doc.setFillColor(...priorityColor);
        doc.circle(25, y - 2, 2, 'F');
        doc.setFontSize(10);
        doc.setFont('helvetica', 'bold');
        doc.text(rec.issue, 30, y);
        y += 6;
        doc.setFont('helvetica', 'normal');
        doc.setTextColor(80);
        const seoActionLines = doc.splitTextToSize(rec.action, 155);
        doc.text(seoActionLines, 30, y);
        doc.setTextColor(0);
        y += seoActionLines.length * 5 + 5;
      }
    }

    // Footer
    this.addFooter(doc, lang);

    return doc.output('arraybuffer');
  }

  generateGBPAuditReport(audit, user) {
    const lang = this.getLanguageFromAudit(audit);
    const doc = new jsPDF();
    const pageWidth = doc.internal.pageSize.getWidth();
    let y = 20;

    // Header
    doc.setFontSize(22);
    doc.setFont('helvetica', 'bold');
    doc.text(t(lang, 'pdf.gbp.title'), pageWidth / 2, y, { align: 'center' });
    y += 15;

    // Branding
    doc.setFontSize(10);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(100);
    doc.text(t(lang, 'pdf.gbp.poweredBy'), pageWidth / 2, y, { align: 'center' });
    y += 15;

    // Audit Info
    doc.setTextColor(0);
    doc.setFontSize(11);
    doc.text(`${t(lang, 'pdf.gbp.business')}: ${audit.businessName}`, 20, y);
    y += 8;
    doc.text(`${t(lang, 'pdf.gbp.date')}: ${this.formatEuropeanDate(audit.createdAt)}`, 20, y);
    y += 8;
    doc.text(`${t(lang, 'pdf.gbp.generatedFor')}: ${user.name || user.email}`, 20, y);
    y += 15;

    // Score Section
    doc.setFillColor(240, 240, 240);
    doc.rect(20, y, pageWidth - 40, 25, 'F');
    doc.setFontSize(14);
    doc.setFont('helvetica', 'bold');
    doc.text(audit.scoreLabel || t(lang, 'pdf.gbp.completenessScore'), 30, y + 10);
    doc.setFontSize(24);
    doc.setTextColor(...this.getScoreColor(audit.score));
    doc.text(`${audit.score}%`, pageWidth - 50, y + 15);
    doc.setTextColor(0);
    y += 35;

    // Business Information
    if (audit.businessInfo) {
      y = this.addSection(doc, audit.businessInfoLabel || t(lang, 'pdf.gbp.businessInfo'), y);
      const info = audit.businessInfo;
      if (info.name) y = this.addInfoLine(doc, info.nameLabel || t(lang, 'pdf.gbp.name'), info.name, y);
      if (info.address) y = this.addInfoLine(doc, info.addressLabel || t(lang, 'pdf.gbp.address'), info.address, y);
      if (info.phone) y = this.addInfoLine(doc, info.phoneLabel || t(lang, 'pdf.gbp.phone'), info.phone, y);
      if (info.website) y = this.addInfoLine(doc, info.websiteLabel || t(lang, 'pdf.gbp.website'), info.website, y);
      if (info.category) y = this.addInfoLine(doc, info.categoryLabel || t(lang, 'pdf.gbp.category'), info.category, y);
      if (info.rating) y = this.addInfoLine(doc, info.ratingLabel || t(lang, 'pdf.gbp.rating'), `${info.rating}/5 (${info.reviewCount} ${t(lang, 'pdf.gbp.reviews')})`, y);
      y += 5;
    }

    // Completeness Checklist
    if (audit.checklist?.length > 0) {
      y = this.checkPageBreak(doc, y, 80);
      y = this.addSection(doc, audit.checklistLabel || t(lang, 'pdf.gbp.profileChecklist'), y);
      y = this.addGBPChecklist(doc, audit.checklist, y);
      y += 5;
    }

    // Recommendations
    if (audit.recommendations?.length > 0) {
      y = this.checkPageBreak(doc, y, 40);
      y = this.addSection(doc, t(lang, 'pdf.gbp.recommendations'), y);

      for (const rec of audit.recommendations) {
        y = this.checkPageBreak(doc, y, 20);
        const priorityColor = rec.priority === 'critical' ? [139, 0, 0] : rec.priority === 'high' ? [220, 53, 69] : rec.priority === 'medium' ? [255, 193, 7] : [40, 167, 69];
        doc.setFillColor(...priorityColor);
        doc.circle(25, y - 2, 2, 'F');
        doc.setFontSize(10);
        doc.setFont('helvetica', 'bold');
        doc.text(rec.issue, 30, y);
        y += 6;
        doc.setFont('helvetica', 'normal');
        doc.setTextColor(80);
        const actionLines = doc.splitTextToSize(rec.action, 155);
        doc.text(actionLines, 30, y);
        doc.setTextColor(0);
        y += actionLines.length * 5 + 5;
      }
    }

    // Footer
    this.addFooter(doc, lang);

    return doc.output('arraybuffer');
  }

  generateGeoAuditReport(audit, user) {
    const lang = this.getLanguageFromAudit(audit);
    const doc = new jsPDF();
    const pageWidth = doc.internal.pageSize.getWidth();
    let y = 20;

    // Header
    doc.setFontSize(22);
    doc.setFont('helvetica', 'bold');
    doc.text(t(lang, 'pdf.geo.title'), pageWidth / 2, y, { align: 'center' });
    y += 15;

    // Branding
    doc.setFontSize(10);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(100);
    doc.text(t(lang, 'pdf.geo.poweredBy'), pageWidth / 2, y, { align: 'center' });
    y += 15;

    // Audit Info
    doc.setTextColor(0);
    doc.setFontSize(11);
    doc.text(`${t(lang, 'pdf.geo.business')}: ${audit.businessName}`, 20, y);
    y += 8;
    doc.text(`${t(lang, 'pdf.geo.keyword')}: ${audit.keyword}`, 20, y);
    y += 8;
    doc.text(`${t(lang, 'pdf.geo.location')}: ${audit.location}`, 20, y);
    y += 8;
    doc.text(`${t(lang, 'pdf.geo.date')}: ${this.formatEuropeanDate(audit.createdAt)}`, 20, y);
    y += 8;
    doc.text(`${t(lang, 'pdf.geo.generatedFor')}: ${user.name || user.email}`, 20, y);
    y += 15;

    // Local Visibility Score Section
    doc.setFillColor(240, 240, 240);
    doc.rect(20, y, pageWidth - 40, 25, 'F');
    doc.setFontSize(14);
    doc.setFont('helvetica', 'bold');
    doc.text(audit.localVisibilityScoreLabel || t(lang, 'pdf.geo.localVisibilityScore'), 30, y + 10);
    doc.setFontSize(24);
    doc.setTextColor(...this.getScoreColor(audit.localVisibilityScore));
    doc.text(`${audit.localVisibilityScore}/100`, pageWidth - 50, y + 15);
    doc.setTextColor(0);
    y += 35;

    // Business Information
    if (audit.businessInfo) {
      y = this.addSection(doc, audit.businessInfoLabel || t(lang, 'pdf.geo.businessInfo'), y);
      const info = audit.businessInfo;
      if (info.name) y = this.addInfoLine(doc, info.nameLabel || t(lang, 'pdf.geo.name'), info.name, y);
      if (info.address) y = this.addInfoLine(doc, info.addressLabel || t(lang, 'pdf.geo.address'), info.address, y);
      if (info.phone) y = this.addInfoLine(doc, info.phoneLabel || t(lang, 'pdf.geo.phone'), info.phone, y);
      if (info.website) y = this.addInfoLine(doc, info.websiteLabel || t(lang, 'pdf.geo.website'), info.website, y);
      if (info.category) y = this.addInfoLine(doc, info.categoryLabel || t(lang, 'pdf.geo.category'), info.category, y);
      if (info.rating) y = this.addInfoLine(doc, info.ratingLabel || t(lang, 'pdf.geo.rating'), `${info.rating}/5 (${info.reviews} ${t(lang, 'pdf.geo.reviews')})`, y);
      y += 5;
    }

    // Competitors Table
    if (audit.competitors && audit.competitors.length > 0) {
      y = this.checkPageBreak(doc, y, 100);
      y = this.addSection(doc, audit.competitorsLabel || t(lang, 'pdf.geo.nearbyCompetitors'), y);
      y = this.addGeoCompetitorTable(doc, audit.competitors, y, lang);
      y += 10;
    }

    // NAP Issues
    if (audit.napIssues) {
      y = this.checkPageBreak(doc, y, 40);
      y = this.addSection(doc, audit.napIssuesLabel || t(lang, 'pdf.geo.napConsistency'), y);
      const nap = audit.napIssues;
      const yesText = t(lang, 'common.yes');
      const noText = t(lang, 'common.no');
      y = this.addLine(doc, `${nap.nameConsistencyLabel || t(lang, 'pdf.geo.nameConsistency')}: ${nap.nameConsistency ? yesText : noText}`, y);
      y = this.addLine(doc, `${nap.addressConsistencyLabel || t(lang, 'pdf.geo.addressConsistency')}: ${nap.addressConsistency ? yesText : noText}`, y);
      y = this.addLine(doc, `${nap.phoneConsistencyLabel || t(lang, 'pdf.geo.phoneConsistency')}: ${nap.phoneConsistency ? yesText : noText}`, y);
      if (nap.issues && nap.issues.length > 0) {
        y += 3;
        doc.setFontSize(9);
        doc.setTextColor(220, 53, 69);
        nap.issues.forEach(issue => {
          y = this.checkPageBreak(doc, y, 8);
          doc.text(`- ${issue}`, 25, y);
          y += 6;
        });
        doc.setTextColor(0);
      }
      y += 5;
    }

    // Citation Issues
    if (audit.citationIssues) {
      y = this.checkPageBreak(doc, y, 40);
      y = this.addSection(doc, audit.citationIssuesLabel || t(lang, 'pdf.geo.citationAnalysis'), y);
      const citations = audit.citationIssues;
      if (citations.missingCitations && citations.missingCitations.length > 0) {
        doc.setFontSize(10);
        doc.setFont('helvetica', 'bold');
        doc.text(`${citations.missingCitationsLabel || t(lang, 'pdf.geo.missingCitations')}:`, 25, y);
        y += 8;
        doc.setFont('helvetica', 'normal');
        doc.setTextColor(220, 53, 69);
        citations.missingCitations.forEach(item => {
          y = this.checkPageBreak(doc, y, 8);
          doc.text(`- ${item}`, 30, y);
          y += 6;
        });
        doc.setTextColor(0);
        y += 3;
      }
      if (citations.inconsistentData && citations.inconsistentData.length > 0) {
        doc.setFontSize(10);
        doc.setFont('helvetica', 'bold');
        doc.text(`${citations.inconsistentDataLabel || t(lang, 'pdf.geo.inconsistentData')}:`, 25, y);
        y += 8;
        doc.setFont('helvetica', 'normal');
        doc.setTextColor(255, 193, 7);
        citations.inconsistentData.forEach(item => {
          y = this.checkPageBreak(doc, y, 8);
          doc.text(`- ${item}`, 30, y);
          y += 6;
        });
        doc.setTextColor(0);
      }
      y += 5;
    }

    // Recommendations
    if (audit.recommendations?.length > 0) {
      y = this.checkPageBreak(doc, y, 40);
      y = this.addSection(doc, t(lang, 'pdf.geo.recommendations'), y);

      for (const rec of audit.recommendations) {
        y = this.checkPageBreak(doc, y, 20);
        const priorityColor = rec.priority === 'critical' ? [139, 0, 0] : rec.priority === 'high' ? [220, 53, 69] : rec.priority === 'medium' ? [255, 193, 7] : [40, 167, 69];
        doc.setFillColor(...priorityColor);
        doc.circle(25, y - 2, 2, 'F');
        doc.setFontSize(10);
        doc.setFont('helvetica', 'bold');
        doc.text(rec.issue, 30, y);
        y += 6;
        doc.setFont('helvetica', 'normal');
        doc.setTextColor(80);
        const actionLines = doc.splitTextToSize(rec.action, 155);
        doc.text(actionLines, 30, y);
        doc.setTextColor(0);
        y += actionLines.length * 5 + 5;
      }
    }

    // Footer
    this.addFooter(doc, lang);

    return doc.output('arraybuffer');
  }

  // Helper methods
  addSection(doc, title, y) {
    doc.setFontSize(14);
    doc.setFont('helvetica', 'bold');
    doc.text(title, 20, y);
    doc.setLineWidth(0.5);
    doc.line(20, y + 2, 190, y + 2);
    return y + 12;
  }

  addCheck(doc, label, data, y, lang = 'en') {
    y = this.checkPageBreak(doc, y, 15);
    doc.setFontSize(10);
    doc.setFont('helvetica', 'bold');
    doc.text(`${label}:`, 25, y);
    doc.setFont('helvetica', 'normal');

    const yesText = t(lang, 'common.yes');
    const noText = t(lang, 'common.no');

    if (data.exists !== undefined) {
      const status = data.exists ? yesText : noText;
      doc.setTextColor(data.exists ? 40 : 220, data.exists ? 167 : 53, data.exists ? 69 : 69);
      doc.text(status, 80, y);
      doc.setTextColor(0);
    }

    if (data.value) {
      const truncated = data.value.length > 50 ? data.value.substring(0, 50) + '...' : data.value;
      doc.text(truncated, 100, y);
    }

    if (data.count !== undefined) {
      doc.text(`${data.countLabel || t(lang, 'pdf.seo.count')}: ${data.count}`, 100, y);
    }

    if (data.total !== undefined) {
      doc.text(`${data.totalLabel || t(lang, 'pdf.seo.total')}: ${data.total}, ${data.withoutAltLabel || t(lang, 'pdf.seo.withoutAlt')}: ${data.withoutAlt || 0}`, 100, y);
    }

    if (data.internal !== undefined) {
      doc.text(`${data.internalLabel || t(lang, 'pdf.seo.internal')}: ${data.internal}, ${data.externalLabel || t(lang, 'pdf.seo.external')}: ${data.external}, ${data.brokenLabel || t(lang, 'pdf.seo.broken')}: ${data.broken}`, 100, y);
    }

    return y + 8;
  }

  addKeywordCheck(doc, label, value, y, lang = 'en') {
    y = this.checkPageBreak(doc, y, 10);
    doc.setFontSize(10);
    doc.setFont('helvetica', 'normal');
    doc.text(`${label}:`, 25, y);
    const yesText = t(lang, 'common.yes');
    const noText = t(lang, 'common.no');
    doc.setTextColor(value ? 40 : 220, value ? 167 : 53, value ? 69 : 69);
    doc.text(value ? yesText : noText, 80, y);
    doc.setTextColor(0);
    return y + 7;
  }

  addLine(doc, text, y) {
    y = this.checkPageBreak(doc, y, 10);
    doc.setFontSize(10);
    doc.text(text, 25, y);
    return y + 7;
  }

  addInfoLine(doc, label, value, y) {
    y = this.checkPageBreak(doc, y, 10);
    doc.setFontSize(10);
    doc.setFont('helvetica', 'bold');
    doc.text(`${label}:`, 25, y);
    doc.setFont('helvetica', 'normal');
    const truncated = value.length > 60 ? value.substring(0, 57) + '...' : value;
    doc.text(truncated, 70, y);
    return y + 7;
  }

  checkPageBreak(doc, y, needed) {
    if (y + needed > doc.internal.pageSize.getHeight() - 20) {
      doc.addPage();
      return 20;
    }
    return y;
  }

  getScoreColor(score) {
    if (score >= 80) return [40, 167, 69];
    if (score >= 50) return [255, 193, 7];
    return [220, 53, 69];
  }

  addFooter(doc, lang = 'en') {
    const pageCount = doc.internal.getNumberOfPages();
    const pageWidth = doc.internal.pageSize.getWidth();
    for (let i = 1; i <= pageCount; i++) {
      doc.setPage(i);
      doc.setFontSize(8);
      doc.setTextColor(150);
      doc.text(`${t(lang, 'pdf.seo.page')} ${i} ${t(lang, 'pdf.seo.of')} ${pageCount}`, pageWidth / 2, doc.internal.pageSize.getHeight() - 10, { align: 'center' });
      doc.text('serpixa.ai', pageWidth - 20, doc.internal.pageSize.getHeight() - 10, { align: 'right' });
    }
  }

  addCompetitorTable(doc, competitors, y, lang = 'en') {
    const pageWidth = doc.internal.pageSize.getWidth();
    const startX = 20;
    const colWidths = [15, 50, 60, 65];
    let currentY = y;

    doc.setFillColor(240, 240, 240);
    doc.rect(startX, currentY, pageWidth - 40, 10, 'F');
    doc.setFontSize(9);
    doc.setFont('helvetica', 'bold');
    doc.text(t(lang, 'pdf.seo.pos'), startX + 2, currentY + 7);
    doc.text(t(lang, 'pdf.seo.titleCol'), startX + colWidths[0] + 2, currentY + 7);
    doc.text(t(lang, 'pdf.seo.urlCol'), startX + colWidths[0] + colWidths[1] + 2, currentY + 7);
    doc.text(t(lang, 'pdf.seo.domain'), startX + colWidths[0] + colWidths[1] + colWidths[2] + 2, currentY + 7);
    currentY += 12;

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    const topCompetitors = competitors.slice(0, 10);

    for (const competitor of topCompetitors) {
      currentY = this.checkPageBreak(doc, currentY, 15);

      doc.setFont('helvetica', 'bold');
      doc.text(`${competitor.position}`, startX + 2, currentY);

      doc.setFont('helvetica', 'normal');
      const title = competitor.title.length > 40 ? competitor.title.substring(0, 37) + '...' : competitor.title;
      doc.text(title, startX + colWidths[0] + 2, currentY, { maxWidth: colWidths[1] - 4 });

      const url = competitor.url.length > 45 ? competitor.url.substring(0, 42) + '...' : competitor.url;
      doc.text(url, startX + colWidths[0] + colWidths[1] + 2, currentY, { maxWidth: colWidths[2] - 4 });

      doc.text(competitor.domain || '', startX + colWidths[0] + colWidths[1] + colWidths[2] + 2, currentY, { maxWidth: colWidths[3] - 4 });

      currentY += 10;
    }

    return currentY;
  }

  addGBPChecklist(doc, checklist, y) {
    for (const item of checklist) {
      y = this.checkPageBreak(doc, y, 10);

      doc.setDrawColor(150);
      doc.rect(25, y - 4, 4, 4);
      if (item.completed) {
        doc.setFillColor(40, 167, 69);
        doc.rect(25.5, y - 3.5, 3, 3, 'F');
      }

      doc.setFontSize(10);
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(item.completed ? 0 : 100);
      doc.text(item.label, 32, y);

      if (item.value) {
        doc.setTextColor(80);
        const valueStr = typeof item.value === 'object' ? JSON.stringify(item.value) : String(item.value);
        const truncated = valueStr.length > 40 ? valueStr.substring(0, 37) + '...' : valueStr;
        doc.text(truncated, 120, y);
      }

      doc.setTextColor(0);
      y += 8;
    }
    return y;
  }

  addGeoCompetitorTable(doc, competitors, y, lang = 'en') {
    const pageWidth = doc.internal.pageSize.getWidth();
    const startX = 20;
    const colWidths = [15, 50, 20, 20, 25, 60];
    let currentY = y;

    const naText = t(lang, 'common.notAvailable');

    doc.setFillColor(240, 240, 240);
    doc.rect(startX, currentY, pageWidth - 40, 10, 'F');
    doc.setFontSize(9);
    doc.setFont('helvetica', 'bold');
    doc.text(t(lang, 'pdf.geo.pos'), startX + 2, currentY + 7);
    doc.text(t(lang, 'pdf.geo.name'), startX + colWidths[0] + 2, currentY + 7);
    doc.text(t(lang, 'pdf.geo.rating'), startX + colWidths[0] + colWidths[1] + 2, currentY + 7);
    doc.text(t(lang, 'pdf.geo.reviewsCol'), startX + colWidths[0] + colWidths[1] + colWidths[2] + 2, currentY + 7);
    doc.text(t(lang, 'pdf.geo.dist'), startX + colWidths[0] + colWidths[1] + colWidths[2] + colWidths[3] + 2, currentY + 7);
    doc.text(t(lang, 'pdf.geo.address'), startX + colWidths[0] + colWidths[1] + colWidths[2] + colWidths[3] + colWidths[4] + 2, currentY + 7);
    currentY += 12;

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    const topCompetitors = competitors.slice(0, 10);

    for (const competitor of topCompetitors) {
      currentY = this.checkPageBreak(doc, currentY, 15);

      doc.setFont('helvetica', 'bold');
      doc.text(`${competitor.position}`, startX + 2, currentY);

      doc.setFont('helvetica', 'normal');
      const name = competitor.name.length > 35 ? competitor.name.substring(0, 32) + '...' : competitor.name;
      doc.text(name, startX + colWidths[0] + 2, currentY, { maxWidth: colWidths[1] - 4 });

      doc.text(competitor.rating ? competitor.rating.toFixed(1) : naText, startX + colWidths[0] + colWidths[1] + 2, currentY);

      doc.text(competitor.reviews ? competitor.reviews.toString() : '0', startX + colWidths[0] + colWidths[1] + colWidths[2] + 2, currentY);

      doc.text(competitor.distance || naText, startX + colWidths[0] + colWidths[1] + colWidths[2] + colWidths[3] + 2, currentY, { maxWidth: colWidths[4] - 4 });

      const address = competitor.address ? (competitor.address.length > 40 ? competitor.address.substring(0, 37) + '...' : competitor.address) : naText;
      doc.text(address, startX + colWidths[0] + colWidths[1] + colWidths[2] + colWidths[3] + colWidths[4] + 2, currentY, { maxWidth: colWidths[5] - 4 });

      currentY += 10;
    }

    return currentY;
  }

  /**
   * Strip HTML tags and extract text content
   */
  stripHtml(html) {
    if (!html) return '';
    return html
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
      .replace(/<[^>]+>/g, '')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&apos;/g, "'")
      .replace(/\n\s*\n/g, '\n')
      .trim();
  }

  /**
   * Parse HTML content into structured elements for PDF rendering
   * Excludes FAQ sections to avoid duplication
   */
  parseHtmlForPDF(html) {
    if (!html) return [];
    
    const elements = [];
    // Replace \n with actual newlines first
    let processedHtml = html.replace(/\\n/g, '\n');
    
    // Remove FAQ sections from HTML to avoid duplication
    // First, remove Schema.org FAQPage sections completely
    processedHtml = processedHtml.replace(/<div[^>]*itemscope[^>]*itemtype=["']https?:\/\/schema\.org\/FAQPage["'][^>]*>[\s\S]*?<\/div>/gi, '');
    
    // Remove FAQ headings and all content until next major heading (H1, H2) or conclusion/CTA
    // Look for FAQ heading (case insensitive, can be in various languages)
    const faqKeywords = ['faq', 'frequently asked', 'questions fréquentes', 'veelgestelde vragen', 'questions', 'réponses'];
    const faqHeadingPattern = new RegExp(`<h([1-6])[^>]*>.*?(?:${faqKeywords.join('|')}).*?<\/h[1-6]>`, 'i');
    let faqMatch;
    
    while ((faqMatch = processedHtml.match(faqHeadingPattern)) !== null) {
      const faqStartIndex = faqMatch.index;
      const faqHeadingLevel = parseInt(faqMatch[1]);
      
      // Find content after FAQ heading
      const afterFaqHeading = processedHtml.substring(faqStartIndex + faqMatch[0].length);
      
      // Look for next major section: H1, H2, or conclusion/CTA headings
      const nextSectionPattern = /<h([12])[^>]*>|<h[1-6][^>]*>.*?(?:conclusion|conclu|cta|call to action|appel à l'action).*?<\/h[1-6]>/i;
      const nextSectionMatch = afterFaqHeading.match(nextSectionPattern);
      
      let faqEndIndex;
      if (nextSectionMatch) {
        // Remove FAQ section up to next major section
        faqEndIndex = faqStartIndex + faqMatch[0].length + nextSectionMatch.index;
      } else {
        // If no next section found, look for any heading of same or higher level
        const sameLevelPattern = new RegExp(`<h([1-${faqHeadingLevel}])[^>]*>`, 'i');
        const sameLevelMatch = afterFaqHeading.match(sameLevelPattern);
        
        if (sameLevelMatch) {
          faqEndIndex = faqStartIndex + faqMatch[0].length + sameLevelMatch.index;
        } else {
          // Remove FAQ section to end of content
          faqEndIndex = processedHtml.length;
        }
      }
      
      // Remove the FAQ section
      processedHtml = processedHtml.substring(0, faqStartIndex) + processedHtml.substring(faqEndIndex);
    }
    
    // Extract headings
    const headingPattern = /<h([1-6])[^>]*>([\s\S]*?)<\/h[1-6]>/gi;
    let lastIndex = 0;
    let match;
    
    while ((match = headingPattern.exec(processedHtml)) !== null) {
      // Skip FAQ-related headings (should already be removed, but double-check)
      const headingText = this.stripHtml(match[2]).toLowerCase();
      const faqKeywords = ['faq', 'frequently asked', 'questions fréquentes', 'veelgestelde vragen'];
      if (faqKeywords.some(keyword => headingText.includes(keyword))) {
        lastIndex = match.index + match[0].length;
        continue;
      }
      
      // Add content before heading
      if (match.index > lastIndex) {
        const beforeContent = processedHtml.substring(lastIndex, match.index);
        const paragraphs = this.extractParagraphs(beforeContent);
        elements.push(...paragraphs);
      }
      
      // Add heading
      const level = parseInt(match[1]);
      const text = this.stripHtml(match[2]);
      if (text.trim()) {
        elements.push({ type: 'heading', level, text: text.trim() });
      }
      
      lastIndex = match.index + match[0].length;
    }
    
    // Add remaining content
    if (lastIndex < processedHtml.length) {
      const remainingContent = processedHtml.substring(lastIndex);
      const paragraphs = this.extractParagraphs(remainingContent);
      elements.push(...paragraphs);
    }
    
    return elements;
  }

  /**
   * Extract paragraphs and lists from HTML content
   */
  extractParagraphs(html) {
    const elements = [];
    
    // Remove script and style tags
    let cleanHtml = html
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '');
    
    // Extract lists first
    const listPattern = /<(ul|ol)[^>]*>([\s\S]*?)<\/\1>/gi;
    let listMatch;
    let lastIndex = 0;
    
    while ((listMatch = listPattern.exec(cleanHtml)) !== null) {
      // Add content before list
      if (listMatch.index > lastIndex) {
        const beforeContent = cleanHtml.substring(lastIndex, listMatch.index);
        const paras = this.extractSimpleParagraphs(beforeContent);
        elements.push(...paras);
      }
      
      // Extract list items
      const listType = listMatch[1];
      const listContent = listMatch[2];
      const items = [];
      const itemPattern = /<li[^>]*>([\s\S]*?)<\/li>/gi;
      let itemMatch;
      
      while ((itemMatch = itemPattern.exec(listContent)) !== null) {
        const itemText = this.stripHtml(itemMatch[1]).trim();
        if (itemText) {
          items.push(itemText);
        }
      }
      
      if (items.length > 0) {
        elements.push({ type: 'list', ordered: listType === 'ol', items });
      }
      
      lastIndex = listMatch.index + listMatch[0].length;
    }
    
    // Add remaining content as paragraphs
    if (lastIndex < cleanHtml.length) {
      const remainingContent = cleanHtml.substring(lastIndex);
      const paras = this.extractSimpleParagraphs(remainingContent);
      elements.push(...paras);
    }
    
    return elements;
  }

  /**
   * Extract simple paragraphs from HTML
   */
  extractSimpleParagraphs(html) {
    const elements = [];
    
    // Extract paragraph tags
    const paraPattern = /<p[^>]*>([\s\S]*?)<\/p>/gi;
    let paraMatch;
    let lastIndex = 0;
    
    while ((paraMatch = paraPattern.exec(html)) !== null) {
      // Add content before paragraph
      if (paraMatch.index > lastIndex) {
        const beforeText = this.stripHtml(html.substring(lastIndex, paraMatch.index)).trim();
        if (beforeText) {
          elements.push({ type: 'paragraph', text: beforeText });
        }
      }
      
      // Add paragraph
      const paraText = this.stripHtml(paraMatch[1]).trim();
      if (paraText) {
        elements.push({ type: 'paragraph', text: paraText });
      }
      
      lastIndex = paraMatch.index + paraMatch[0].length;
    }
    
    // Add remaining content
    if (lastIndex < html.length) {
      const remainingText = this.stripHtml(html.substring(lastIndex)).trim();
      if (remainingText) {
        // Split by double newlines to create paragraphs
        const paragraphs = remainingText.split(/\n\s*\n/).filter(p => p.trim());
        paragraphs.forEach(p => {
          elements.push({ type: 'paragraph', text: p.trim() });
        });
      }
    }
    
    return elements;
  }

  /**
   * Split text into lines that fit within page width
   */
  splitTextIntoLines(doc, text, maxWidth, x) {
    const lines = doc.splitTextToSize(text, maxWidth);
    return lines || [text];
  }

  /**
   * Generate AI Content PDF Report
   */
  generateAIContentReport(content, user) {
    const lang = this.getLanguageFromAudit(content);
    const doc = new jsPDF();
    const pageWidth = doc.internal.pageSize.getWidth();
    const pageHeight = doc.internal.pageSize.getHeight();
    const margin = 20;
    const maxWidth = pageWidth - (margin * 2);
    let y = 20;

    // Header with background
    doc.setFillColor(40, 40, 40);
    doc.rect(0, 0, pageWidth, 50, 'F');
    
    doc.setFontSize(22);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(255, 255, 255);
    doc.text('AI-Generated SEO Content Report', pageWidth / 2, 25, { align: 'center' });
    
    // Branding
    doc.setFontSize(9);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(200, 200, 200);
    doc.text('Powered by serpixa.ai', pageWidth / 2, 38, { align: 'center' });
    
    y = 60;

    // Content Info Box
    doc.setFillColor(248, 249, 250);
    doc.rect(margin, y, pageWidth - (margin * 2), 50, 'F');
    doc.setDrawColor(220, 220, 220);
    doc.setLineWidth(0.5);
    doc.rect(margin, y, pageWidth - (margin * 2), 50, 'S');
    
    doc.setTextColor(0);
    doc.setFontSize(10);
    doc.setFont('helvetica', 'normal');
    
    const infoY = y + 8;
    doc.setFont('helvetica', 'bold');
    doc.text('Topic:', margin + 5, infoY);
    doc.setFont('helvetica', 'normal');
    doc.text(content.topic || 'N/A', margin + 30, infoY);
    
    doc.setFont('helvetica', 'bold');
    doc.text('Keyword:', margin + 5, infoY + 8);
    doc.setFont('helvetica', 'normal');
    doc.text(content.keyword, margin + 30, infoY + 8);
    
    doc.setFont('helvetica', 'bold');
    doc.text('Language:', margin + 5, infoY + 16);
    doc.setFont('helvetica', 'normal');
    doc.text(content.language || 'EN', margin + 30, infoY + 16);
    
    doc.setFont('helvetica', 'bold');
    doc.text('Date:', margin + 5, infoY + 24);
    doc.setFont('helvetica', 'normal');
    doc.text(this.formatEuropeanDate(content.createdAt), margin + 30, infoY + 24);
    
    doc.setFont('helvetica', 'bold');
    doc.text('Generated for:', margin + 5, infoY + 32);
    doc.setFont('helvetica', 'normal');
    const userText = user.name || user.email;
    const userLines = this.splitTextIntoLines(doc, userText, maxWidth - 35, margin + 30);
    doc.text(userLines[0], margin + 30, infoY + 32);
    
    y += 60;

    // SEO Score Section - Simple and Clean Design
    const seoScore = content.seoScore || 75;
    const scoreColor = this.getScoreColor(seoScore);
    const scoreHeight = 35;
    
    y = this.checkPageBreak(doc, y, scoreHeight + 10);
    
    // Simple container with light background
    doc.setFillColor(248, 249, 250);
    doc.rect(margin, y, pageWidth - (margin * 2), scoreHeight, 'F');
    doc.setDrawColor(230, 230, 230);
    doc.setLineWidth(0.5);
    doc.rect(margin, y, pageWidth - (margin * 2), scoreHeight, 'S');
    
    // Left side - Label
    doc.setFontSize(14);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(50, 50, 50);
    doc.text('SEO Score', margin + 12, y + 20);
    
    doc.setFontSize(9);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(120, 120, 120);
    doc.text('Content Quality Assessment', margin + 12, y + 28);
    
    // Right side - Score (centered)
    const scoreX = margin + (pageWidth - margin * 2) * 0.6;
    const scoreWidth = (pageWidth - margin * 2) * 0.4;
    const centerX = scoreX + scoreWidth / 2;
    
    // Score number - large and clear
    doc.setFontSize(28);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(...scoreColor);
    doc.text(`${seoScore}`, centerX, y + 18, { align: 'center' });
    
    // "/100" text
    doc.setFontSize(12);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(100, 100, 100);
    doc.text('/100', centerX, y + 28, { align: 'center' });
    
    // Reset colors
    doc.setTextColor(0);
    doc.setFont('helvetica', 'normal');
    y += scoreHeight + 10;

    // Meta Information
    y = this.checkPageBreak(doc, y, 50);
    y = this.addSection(doc, 'Meta Information', y);
    y = this.addInfoLine(doc, 'Meta Title', content.metaTitle || 'N/A', y);
    y = this.addInfoLine(doc, 'Meta Description', content.metaDescription || 'N/A', y);
    y += 5;

    // Content Stats
    y = this.checkPageBreak(doc, y, 30);
    y = this.addSection(doc, 'Content Statistics', y);
    y = this.addLine(doc, `Word Count: ${content.wordCount || 0}`, y);
    y = this.addLine(doc, `Keyword Density: ${content.keywordDensity || 'N/A'}`, y);
    y += 10;

    // Main Content
    y = this.checkPageBreak(doc, y, 30);
    y = this.addSection(doc, 'Content', y);
    y += 5;
    
    // Parse HTML into structured elements
    const htmlElements = this.parseHtmlForPDF(content.htmlContent || '');
    
    doc.setFontSize(10);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(0);
    
    for (const element of htmlElements) {
      if (element.type === 'heading') {
        y = this.checkPageBreak(doc, y, 20);
        
        // Set heading font size based on level
        const headingSizes = { 1: 16, 2: 14, 3: 12, 4: 11, 5: 10, 6: 10 };
        const fontSize = headingSizes[element.level] || 10;
        
        doc.setFontSize(fontSize);
        doc.setFont('helvetica', 'bold');
        doc.setTextColor(30, 30, 30);
        
        const headingLines = this.splitTextIntoLines(doc, element.text, maxWidth, margin);
        for (const line of headingLines) {
          y = this.checkPageBreak(doc, y, fontSize + 2);
          doc.text(line, margin, y);
          y += fontSize + 2;
        }
        
        y += 3; // Extra space after heading
        doc.setFontSize(10);
        doc.setFont('helvetica', 'normal');
        doc.setTextColor(0);
        
      } else if (element.type === 'list') {
        y = this.checkPageBreak(doc, y, 15);
        
        element.items.forEach((item, index) => {
          y = this.checkPageBreak(doc, y, 10);
          
          // List marker
          const marker = element.ordered ? `${index + 1}.` : '•';
          doc.setFont('helvetica', 'bold');
          doc.text(marker, margin, y);
          
          // List item text
          doc.setFont('helvetica', 'normal');
          const itemLines = this.splitTextIntoLines(doc, item, maxWidth - 15, margin + 10);
          let itemY = y;
          
          for (const line of itemLines) {
            if (itemY !== y) {
              itemY = this.checkPageBreak(doc, itemY, 8);
            }
            doc.text(line, margin + 10, itemY);
            itemY += 6;
          }
          
          y = itemY + 2;
        });
        
        y += 3; // Extra space after list
        
      } else if (element.type === 'paragraph') {
        y = this.checkPageBreak(doc, y, 12);
        
        // Handle paragraphs with proper line breaks
        const paragraphText = element.text.replace(/\n/g, ' ').trim();
        if (paragraphText) {
          const paraLines = this.splitTextIntoLines(doc, paragraphText, maxWidth, margin);
          
          for (const line of paraLines) {
            y = this.checkPageBreak(doc, y, 8);
            doc.text(line, margin, y);
            y += 6;
          }
          
          y += 4; // Space between paragraphs
        }
      }
    }
    
    y += 10;

    // FAQ Section
    if (content.faq && content.faq.length > 0) {
      y = this.checkPageBreak(doc, y, 40);
      y = this.addSection(doc, 'Frequently Asked Questions', y);
      y += 5;
      
      doc.setFontSize(10);
      for (let i = 0; i < content.faq.length; i++) {
        const faq = content.faq[i];
        
        // Question with background
        y = this.checkPageBreak(doc, y, 25);
        doc.setFillColor(245, 245, 245);
        doc.rect(margin, y - 8, pageWidth - (margin * 2), 12, 'F');
        
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(11);
        doc.setTextColor(40, 40, 40);
        const questionLines = this.splitTextIntoLines(doc, `Q${i + 1}: ${faq.question}`, maxWidth - 10, margin + 5);
        let qY = y;
        for (const qLine of questionLines) {
          if (qY !== y) {
            qY = this.checkPageBreak(doc, qY, 8);
            doc.setFillColor(245, 245, 245);
            doc.rect(margin, qY - 8, pageWidth - (margin * 2), 12, 'F');
          }
          doc.text(qLine, margin + 5, qY);
          qY += 6;
        }
        y = qY + 3;
        
        // Answer
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(10);
        doc.setTextColor(0);
        const answerText = this.stripHtml(faq.answer || '').replace(/\n/g, ' ').trim();
        const answerLines = this.splitTextIntoLines(doc, answerText, maxWidth - 10, margin + 5);
        for (const aLine of answerLines) {
          y = this.checkPageBreak(doc, y, 8);
          doc.text(aLine, margin + 5, y);
          y += 6;
        }
        y += 8; // Space between FAQ items
      }
    }

    // CTA Section
    if (content.cta) {
      y = this.checkPageBreak(doc, y, 40);
      y = this.addSection(doc, 'Call to Action', y);
      y += 5;
      
      // CTA box with border
      const ctaHeight = 30;
      y = this.checkPageBreak(doc, y, ctaHeight);
      
      doc.setDrawColor(200, 200, 200);
      doc.setLineWidth(0.5);
      doc.rect(margin, y - 5, pageWidth - (margin * 2), ctaHeight, 'S');
      
      doc.setFillColor(250, 250, 250);
      doc.rect(margin + 0.5, y - 4.5, pageWidth - (margin * 2) - 1, ctaHeight - 1, 'F');
      
      doc.setFontSize(11);
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(40, 40, 40);
      const ctaText = this.stripHtml(content.cta).replace(/\n/g, ' ').trim();
      const ctaLines = this.splitTextIntoLines(doc, ctaText, maxWidth - 20, margin + 10);
      
      let ctaY = y + 8;
      for (const ctaLine of ctaLines) {
        doc.text(ctaLine, margin + 10, ctaY);
        ctaY += 7;
      }
      
      y = ctaY + 5;
    }

    // Footer
    this.addFooter(doc, lang);

    return doc.output('arraybuffer');
  }
}

export const pdfService = new PDFService();
